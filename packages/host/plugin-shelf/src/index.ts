/**
 * Chest gateway: the Host half of the sidebar chest.
 *
 * A chest holds two kinds of real artifact rather than text a model is asked to
 * pretend with:
 *
 * - **plugin** — plugin packages. The chest owns a store under
 *   `$DSH_HOME/chest/plugins` and can also register a folder in place (a plugin
 *   someone is developing). Installing one means three concrete profile edits —
 *   a `link:` dependency, the bundle name in `dsh.profile.bundles`, and the
 *   `node_modules` link — so installing, uninstalling, and reordering are real
 *   composition changes that take effect on the next restart. The chest says so
 *   instead of pretending the running process already changed.
 * - **skill** — `SKILL.md` files under the user skill root (`$DSH_HOME/skills`),
 *   the same files the `skill` tool and the `/name` composer reference discover,
 *   so a skill authored here is immediately a real skill.
 *
 * Both kinds export to one `.chest` document: a shareable single file carrying
 * every byte of the artifact, which this gateway can import back.
 *
 * Every mutation runs through one serialized queue, writes bookkeeping to
 * `chest.json`, and emits `pluginShelf/change` so observers re-list. Reads scan
 * the filesystem on every call: there is no cache to go stale.
 *
 * @module @deepseek-ai/dsh-host-plugin-shelf
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { watch as chokidarWatch } from 'chokidar'
import {
  applyOrder, emptyChestState, readChestState, writeChestState, type ChestState,
} from './state.ts'
import {
  asChestBundle, exists, listTreeFiles, readPluginManifest, readTreeFiles, safeRelativePath,
  writeBundleFiles,
} from './plugins.ts'
import {
  installIntoProfile, profileRootOf, readProfile, reorderBundles, uninstallFromProfile,
} from './profile.ts'
import { SKILL_FILE_NAME, listSkills, removeSkill, slugOf, writeSkill, type SkillRecord } from './skills.ts'
import type {
  ChestBundle, ChestExportResult, ChestFailure, ChestPluginEntry, ChestPluginRequest,
  ChestResult, ChestSkillDraft, ChestSkillEntry, ChestSnapshot,
} from './types.ts'

export type * from './types.ts'

/** Watcher change-debounce; a burst of edits settles into one notify. */
const NOTIFY_DEBOUNCE_MS = 150

/** Ceiling on one shared artifact, so a stray folder cannot flood a bundle. */
const MAX_BUNDLE_FILES = 2000

/** Chest layout: the roots this deployment manages. */
interface ChestLayout {
  /** Chest root (`$DSH_HOME/chest`), holding the bookkeeping file. */
  readonly root: string
  /** Where the chest owns plugin packages. */
  readonly plugins: string
  /** The user skill root the chest manages. */
  readonly skills: string
}

/** Deployment configuration: where the chest and its skill root live. */
export interface Config {
  /** Chest root; defaults to `$DSH_HOME/chest`. */
  readonly root: string
  /** Skill root the chest manages; defaults to `$DSH_HOME/skills`. */
  readonly skillRoot: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginShelf: PluginShelfGateway
  }
}

/** Build a frozen success branch. */
function success(value: ChestSnapshot): ChestResult {
  return Object.freeze({ ok: true, value })
}

/** Build a frozen business-failure branch. */
function rejected(error: ChestFailure): ChestResult {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Build a frozen export-failure branch. */
function rejectedExport(error: ChestFailure): ChestExportResult {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Freeze one plugin entry before it crosses the service boundary. */
function freezePlugin(entry: ChestPluginEntry): ChestPluginEntry {
  return Object.freeze({ ...entry })
}

/** Freeze one skill entry before it crosses the service boundary. */
function freezeSkill(entry: ChestSkillEntry): ChestSkillEntry {
  return Object.freeze({ ...entry })
}

/** Freeze a profile view with its bundle list. */
function freezeProfile(profile: ChestSnapshot['profile']): ChestSnapshot['profile'] {
  return profile === null ? null : Object.freeze({ ...profile, bundles: Object.freeze([...profile.bundles]) })
}

/** Freeze a whole snapshot. */
function freezeSnapshot(snapshot: ChestSnapshot): ChestSnapshot {
  return Object.freeze({
    plugins: Object.freeze(snapshot.plugins.map(freezePlugin)),
    skills: Object.freeze(snapshot.skills.map(freezeSkill)),
    profile: freezeProfile(snapshot.profile),
    pluginRoot: snapshot.pluginRoot,
    skillRoot: snapshot.skillRoot,
    restartRequired: snapshot.restartRequired,
  })
}

/** Freeze one export bundle. */
function freezeBundle(bundle: ChestBundle): ChestBundle {
  return Object.freeze({ ...bundle, files: Object.freeze(bundle.files.map(file => Object.freeze({ ...file }))) })
}

/**
 * Remote-only service owning the chest: the plugin store, the registered
 * external plugin folders, the user skill root, and the profile edits that make
 * an installed plugin real.
 */
export class PluginShelfGateway extends TypertRemoteService {
  static Config: s<Config> = s.object({
    root: s.string().default(dshHomePath('chest')),
    skillRoot: s.string().default(dshHomePath('skills')),
  })

  private readonly layout: ChestLayout
  private state: ChestState = emptyChestState()
  private notifyTimer: ReturnType<typeof setTimeout> | undefined = undefined
  private mutationTail: Promise<unknown> = Promise.resolve()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - Host context.
   * @param config - Deployment configuration (chest root and skill root).
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginShelf')
    this.layout = {
      root: resolve(config.root),
      plugins: join(resolve(config.root), 'plugins'),
      skills: resolve(config.skillRoot),
    }
  }

  /** Create the chest roots, adopt boot bookkeeping, then watch them. */
  protected async [Service.init](): Promise<void> {
    await mkdir(this.layout.plugins, { recursive: true })
    await mkdir(this.layout.skills, { recursive: true })
    const stored = await readChestState(this.layout.root)
    // A flag written before this boot describes a profile the running process
    // has just loaded, so booting is exactly what clears it.
    this.state = { ...stored, restartRequired: false }
    if (stored.restartRequired) await writeChestState(this.layout.root, this.state)

    const watched = [this.layout.plugins, this.layout.skills, this.layout.root]
    const profileRoot = profileRootOf(this.ctx.baseUrl)
    if (profileRoot !== null) watched.push(join(profileRoot, 'package.json'))
    const watcher = chokidarWatch(watched, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
      depth: 2,
    })
    const onEvent = (path: string): void => {
      if (path.endsWith('.tmp')) return
      this.scheduleNotify()
    }
    watcher.on('add', onEvent)
    watcher.on('change', onEvent)
    watcher.on('unlink', onEvent)
    watcher.on('addDir', onEvent)
    watcher.on('unlinkDir', onEvent)
    watcher.on('error', (error: unknown) => {
      this.ctx.logger.warn('chest: watcher error: %o', error)
    })
    this.ctx.effect(() => async () => {
      if (this.notifyTimer !== undefined) clearTimeout(this.notifyTimer)
      this.mutationAdmissionOpen = false
      await watcher.close().catch(() => undefined)
    }, 'plugin-shelf.watcher')
  }

  /**
   * The whole chest: plugins, skills, the booted profile, and any pending restart.
   * @returns The whole chest listing, scanned afresh.
   */
  @Remote('list')
  async list(): Promise<ChestSnapshot> {
    return this.snapshot()
  }

  /**
   * Register a plugin package with the chest: a folder the user points at (the
   * chest records it in place), or a `.chest` document received from elsewhere
   * (the chest copies it into its own store).
   * @param request - a folder path to register in place, or a bundle to adopt.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('importPlugin')
  importPlugin(request: ChestPluginRequest): Promise<ChestResult> {
    return this.mutate(async () => {
      const bundle = request.bundle
      if (bundle !== undefined) {
        const validated = asChestBundle(bundle)
        if (validated === null || validated.kind !== 'plugin') {
          return { code: 'invalid-bundle', message: 'this file is not a plugin chest bundle' }
        }
        return this.adoptPluginBundle(validated)
      }
      const raw = request.path?.trim() ?? ''
      if (raw.length === 0) {
        return { code: 'invalid-input', message: 'a folder path or a chest bundle is required' }
      }
      const source = resolve(raw)
      const manifest = await readPluginManifest(source)
      if (manifest === null) {
        return {
          code: 'unsupported-package',
          message: `${source} holds no readable plugin package.json with a name`,
        }
      }
      const already = await this.findPluginByPath(source)
      if (already !== null) {
        return { code: 'duplicate-id', message: `${manifest.packageName} is already in the chest as ${already.id}` }
      }
      const id = await this.freePluginId(slugOf(basename(source)))
      this.state = { ...this.state, external: { ...this.state.external, [id]: source } }
      await writeChestState(this.layout.root, this.state)
      return null
    })
  }

  /**
   * Author one new skill under the user skill root.
   * @param draft - the authored skill fields.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('createSkill')
  createSkill(draft: ChestSkillDraft): Promise<ChestResult> {
    return this.mutate(async () => {
      const invalid = validateDraft(draft)
      if (invalid !== null) return invalid
      const id = slugOf(draft.name)
      if ((await this.findSkill(id)) !== null) {
        return { code: 'duplicate-id', message: `a skill named "${draft.name}" already exists (${id})` }
      }
      try {
        await writeSkill(this.layout.skills, id, draft)
      } catch (error) {
        return { code: 'io', message: `failed to write the skill: ${String(error)}` }
      }
      this.state = { ...this.state, skillOrder: [...this.state.skillOrder, id] }
      await writeChestState(this.layout.root, this.state)
      return null
    })
  }

  /**
   * Adopt one skill bundle received from another chest.
   * @param bundle - a skill `.chest` document received from another chest.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('importSkill')
  importSkill(bundle: ChestBundle): Promise<ChestResult> {
    return this.mutate(async () => {
      const validated = asChestBundle(bundle)
      if (validated === null || validated.kind !== 'skill') {
        return { code: 'invalid-bundle', message: 'this file is not a skill chest bundle' }
      }
      const id = slugOf(validated.id)
      if ((await this.findSkill(id)) !== null) {
        return { code: 'duplicate-id', message: `a skill named "${validated.name}" already exists (${id})` }
      }
      const directoryEntry = validated.files.some(file => safeRelativePath(file.path) === SKILL_FILE_NAME)
      try {
        if (directoryEntry) await writeBundleFiles(join(this.layout.skills, id), validated.files)
        else await this.writeFlatSkillBundle(id, validated)
      } catch (error) {
        return { code: 'invalid-bundle', message: `failed to unpack the skill bundle: ${String(error)}` }
      }
      if ((await this.findSkill(id)) === null) {
        await rm(join(this.layout.skills, id), { recursive: true, force: true }).catch(() => undefined)
        await rm(join(this.layout.skills, `${id}.md`), { force: true }).catch(() => undefined)
        return { code: 'invalid-bundle', message: 'the bundle holds no readable skill frontmatter' }
      }
      this.state = { ...this.state, skillOrder: [...this.state.skillOrder, id] }
      await writeChestState(this.layout.root, this.state)
      return null
    })
  }

  /** Write one flat single-file skill bundle as `<id>.md`. */
  private async writeFlatSkillBundle(id: string, bundle: ChestBundle): Promise<void> {
    const single = bundle.files.length === 1 ? bundle.files[0] : undefined
    if (single === undefined || !single.path.toLowerCase().endsWith('.md')) {
      throw new Error('a skill bundle holds either SKILL.md or one markdown file')
    }
    const body = single.encoding === 'utf8'
      ? single.content
      : Buffer.from(single.content, 'base64').toString('utf8')
    await writeFile(join(this.layout.skills, `${id}.md`), body, 'utf8')
  }

  /**
   * Rewrite one skill in place, keeping the shape the scan found.
   * @param id - the target skill id.
   * @param draft - the authored fields that replace the current ones.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('updateSkill')
  updateSkill(id: string, draft: ChestSkillDraft): Promise<ChestResult> {
    return this.mutate(async () => {
      const record = await this.findSkill(id)
      if (record === null) return { code: 'not-found', message: `skill "${id}" is not in the chest` }
      const invalid = validateDraft(draft)
      if (invalid !== null) return invalid
      try {
        await writeSkill(this.layout.skills, id, draft, record.flat)
      } catch (error) {
        return { code: 'io', message: `failed to write the skill: ${String(error)}` }
      }
      return null
    })
  }

  /**
   * Remove one skill: its directory bundle, or its flat markdown file.
   * @param id - the target skill id.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('deleteSkill')
  deleteSkill(id: string): Promise<ChestResult> {
    return this.mutate(async () => {
      const record = await this.findSkill(id)
      if (record === null) return { code: 'not-found', message: `skill "${id}" is not in the chest` }
      try {
        await removeSkill(this.layout.skills, record)
      } catch (error) {
        return { code: 'io', message: `failed to remove the skill: ${String(error)}` }
      }
      this.state = { ...this.state, skillOrder: this.state.skillOrder.filter(item => item !== id) }
      await writeChestState(this.layout.root, this.state)
      return null
    })
  }

  /**
   * Apply a chest skill order. Skills have no composition order; this is the listing's.
   * @param ids - every skill id, in the wanted order.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('reorderSkills')
  reorderSkills(ids: readonly string[]): Promise<ChestResult> {
    return this.mutate(async () => {
      const current = (await listSkills(this.layout.skills)).map(record => record.id)
      if (ids.length !== current.length || ids.some(id => !current.includes(id))) {
        return { code: 'invalid-input', message: 'the reorder list must name every skill in the chest exactly once' }
      }
      this.state = { ...this.state, skillOrder: [...ids] }
      await writeChestState(this.layout.root, this.state)
      return null
    })
  }

  /**
   * Install one registered plugin into the booted profile (a restart applies it).
   * @param id - the chest plugin id.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('installPlugin')
  installPlugin(id: string): Promise<ChestResult> {
    return this.mutate(async () => {
      const entry = await this.findPlugin(id)
      if (entry === null) return { code: 'not-found', message: `plugin "${id}" is not in the chest` }
      if (!entry.hasPatch) {
        return {
          code: 'unsupported-package',
          message: `${entry.packageName} declares no dsh.bundle.patch, so it cannot be installed as a bundle layer`,
        }
      }
      const profileRoot = this.profileRoot()
      if (profileRoot === null) {
        return { code: 'profile-unavailable', message: 'the running host did not report a profile directory' }
      }
      try {
        if (await installIntoProfile(profileRoot, entry.packageName, entry.path)) {
          this.state = { ...this.state, restartRequired: true }
        }
        await writeChestState(this.layout.root, this.state)
      } catch (error) {
        return { code: 'io', message: `failed to install ${entry.packageName}: ${String(error)}` }
      }
      return null
    })
  }

  /**
   * Remove one plugin from the profile: dependency, bundle layer, and link.
   * @param id - the chest plugin id.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('uninstallPlugin')
  uninstallPlugin(id: string): Promise<ChestResult> {
    return this.mutate(async () => {
      const entry = await this.findPlugin(id)
      if (entry === null) return { code: 'not-found', message: `plugin "${id}" is not in the chest` }
      if (!entry.installed) return null
      const profileRoot = this.profileRoot()
      if (profileRoot === null) {
        return { code: 'profile-unavailable', message: 'the running host did not report a profile directory' }
      }
      try {
        if (await uninstallFromProfile(profileRoot, entry.packageName)) {
          this.state = { ...this.state, restartRequired: true }
        }
        await writeChestState(this.layout.root, this.state)
      } catch (error) {
        return { code: 'io', message: `failed to uninstall ${entry.packageName}: ${String(error)}` }
      }
      return null
    })
  }

  /**
   * Drop one plugin from the chest, uninstalling it first when it is installed.
   * A store plugin's bytes go with it; an external registration leaves the
   * folder alone, because the chest never owned those files.
   * @param id - the chest plugin id.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('deletePlugin')
  deletePlugin(id: string): Promise<ChestResult> {
    return this.mutate(async () => {
      const entry = await this.findPlugin(id)
      if (entry === null) return { code: 'not-found', message: `plugin "${id}" is not in the chest` }
      const profileRoot = this.profileRoot()
      if (entry.installed && profileRoot !== null) {
        try {
          if (await uninstallFromProfile(profileRoot, entry.packageName)) {
            this.state = { ...this.state, restartRequired: true }
          }
        } catch (error) {
          return { code: 'io', message: `failed to uninstall ${entry.packageName}: ${String(error)}` }
        }
      }
      if (entry.origin === 'store') {
        await rm(join(this.layout.plugins, entry.id), { recursive: true, force: true })
      } else {
        const remaining: Record<string, string> = {}
        for (const [key, value] of Object.entries(this.state.external)) {
          if (key !== id) remaining[key] = value
        }
        this.state = { ...this.state, external: remaining }
      }
      this.state = { ...this.state, pluginOrder: this.state.pluginOrder.filter(item => item !== id) }
      await writeChestState(this.layout.root, this.state)
      return null
    })
  }

  /**
   * Apply a chest plugin order. Order among installed plugins IS the profile's
   * bundle layer order, so this can be a real precedence change.
   * @param ids - every plugin id, in the wanted order.
   * @returns The settled outcome, carrying the fresh listing on success.
   */
  @Remote('reorderPlugins')
  reorderPlugins(ids: readonly string[]): Promise<ChestResult> {
    return this.mutate(async () => {
      const entries = await this.pluginEntries()
      const current = entries.map(entry => entry.id)
      if (ids.length !== current.length || ids.some(id => !current.includes(id))) {
        return { code: 'invalid-input', message: 'the reorder list must name every plugin in the chest exactly once' }
      }
      const installedOrder = ids
        .map(id => entries.find(entry => entry.id === id && entry.installed))
        .filter((entry): entry is ChestPluginEntry => entry !== undefined)
        .map(entry => entry.packageName)
      const profileRoot = this.profileRoot()
      let restartRequired = this.state.restartRequired
      if (installedOrder.length > 1 && profileRoot !== null) {
        try {
          if (await reorderBundles(profileRoot, installedOrder)) restartRequired = true
        } catch (error) {
          return { code: 'io', message: `failed to reorder bundle layers: ${String(error)}` }
        }
      }
      this.state = { ...this.state, pluginOrder: [...ids], restartRequired }
      await writeChestState(this.layout.root, this.state)
      return null
    })
  }

  /**
   * Pack one plugin package into a shareable `.chest` document.
   * @param id - the chest plugin id.
   * @returns The packed bundle, or a business failure.
   */
  @Remote('exportPlugin')
  exportPlugin(id: string): Promise<ChestExportResult> {
    return this.exportArtifact(async () => {
      const entry = await this.findPlugin(id)
      if (entry === null) return { code: 'not-found', message: `plugin "${id}" is not in the chest` }
      const files = await listTreeFiles(entry.path)
      if (files.length === 0) return { code: 'io', message: `${entry.packageName} holds no readable files` }
      if (files.length > MAX_BUNDLE_FILES) {
        return { code: 'io', message: `${entry.packageName} holds ${files.length} files, too many to share` }
      }
      const encoded = await readTreeFiles(entry.path, files)
      if (encoded === null) return { code: 'io', message: `${entry.packageName} exceeds the chest bundle ceilings` }
      return freezeBundle({
        format: 'dsh-chest',
        revision: 1,
        kind: 'plugin',
        id: entry.id,
        name: entry.packageName,
        description: entry.description,
        createdAt: Date.now(),
        files: encoded,
      })
    })
  }

  /**
   * Pack one skill (entry file plus its resources) into a shareable `.chest` document.
   * @param id - the chest skill id.
   * @returns The packed bundle, or a business failure.
   */
  @Remote('exportSkill')
  exportSkill(id: string): Promise<ChestExportResult> {
    return this.exportArtifact(async () => {
      const record = await this.findSkill(id)
      if (record === null) return { code: 'not-found', message: `skill "${id}" is not in the chest` }
      const root = record.flat ? this.layout.skills : record.directory
      const files = record.flat ? [`${record.id}.md`] : await listTreeFiles(record.directory)
      const encoded = await readTreeFiles(root, files)
      if (encoded === null) return { code: 'io', message: `${record.name} exceeds the chest bundle ceilings` }
      return freezeBundle({
        format: 'dsh-chest',
        revision: 1,
        kind: 'skill',
        id: record.id,
        name: record.name,
        description: record.description,
        createdAt: Date.now(),
        files: encoded,
      })
    })
  }

  /** Adopt one imported plugin bundle into the store, leaving no trace on failure. */
  private async adoptPluginBundle(bundle: ChestBundle): Promise<ChestFailure | null> {
    const id = slugOf(bundle.id)
    const target = join(this.layout.plugins, id)
    if (await exists(target)) {
      return { code: 'duplicate-id', message: `the chest already holds a plugin folder named ${id}` }
    }
    try {
      await writeBundleFiles(target, bundle.files)
    } catch (error) {
      return { code: 'invalid-bundle', message: `failed to unpack the bundle: ${String(error)}` }
    }
    if ((await readPluginManifest(target)) === null) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined)
      return { code: 'invalid-bundle', message: 'the bundle holds no readable plugin package.json' }
    }
    this.state = { ...this.state, pluginOrder: [...this.state.pluginOrder, id] }
    await writeChestState(this.layout.root, this.state)
    return null
  }

  /** The profile directory the running host booted from, or null. */
  private profileRoot(): string | null {
    return profileRootOf(this.ctx.baseUrl)
  }

  /** Serialize one mutation behind the previous one, then answer with a fresh listing. */
  private mutate(operation: () => Promise<ChestFailure | null>): Promise<ChestResult> {
    return this.enqueue(async () => {
      let failure: ChestFailure | null
      try {
        failure = await operation()
      } catch (error) {
        failure = { code: 'io', message: String(error) }
      }
      if (failure !== null) return rejected(failure)
      this.notifyChange()
      return success(await this.snapshot())
    })
  }

  /** Serialize one export behind the mutation queue. */
  private exportArtifact(operation: () => Promise<ChestBundle | ChestFailure>): Promise<ChestExportResult> {
    return this.enqueue(async () => {
      let outcome: ChestBundle | ChestFailure
      try {
        outcome = await operation()
      } catch (error) {
        return rejectedExport({ code: 'io', message: String(error) })
      }
      return 'format' in outcome
        ? Object.freeze({ ok: true, value: freezeBundle(outcome) })
        : rejectedExport(outcome)
    })
  }

  /** Serialize one operation behind the previous one; rejects while disposing. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.mutationAdmissionOpen) {
      return Promise.reject(new Error('plugin-shelf: service is disposing'))
    }
    const previous = this.mutationTail
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.mutationTail = tail
    return result
  }

  /** Debounced change notification; a burst of writes settles into one emit. */
  private scheduleNotify(): void {
    if (this.notifyTimer !== undefined) clearTimeout(this.notifyTimer)
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined
      this.notifyChange()
    }, NOTIFY_DEBOUNCE_MS)
  }

  /** Notify every observer without making UI refresh load-bearing. */
  private notifyChange(): void {
    for (const callback of this.ctx.events.dispatch('emit', ['pluginShelf/change'])) {
      try {
        void Promise.resolve(callback()).catch((error: unknown) => {
          this.ctx.logger.warn(`pluginShelf/change listener rejected: ${String(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`pluginShelf/change listener threw: ${String(error)}`)
      }
    }
  }

  /** Compose the whole chest listing afresh. */
  private async snapshot(): Promise<ChestSnapshot> {
    const profileRoot = this.profileRoot()
    const profile = profileRoot === null ? null : await readProfile(profileRoot)
    return freezeSnapshot({
      plugins: await this.pluginEntries(),
      skills: await this.skillEntries(),
      profile: profile === null ? null : { name: profile.name, root: profile.root, bundles: profile.bundles },
      pluginRoot: this.layout.plugins,
      skillRoot: this.layout.skills,
      restartRequired: this.state.restartRequired,
    })
  }

  /**
   * Scan the store and the registered external folders, in chest order, each
   * entry carrying whether the booted profile lists it as an installed bundle.
   */
  private async pluginEntries(): Promise<ChestPluginEntry[]> {
    const profileRoot = this.profileRoot()
    const profile = profileRoot === null ? null : await readProfile(profileRoot)
    const installedBundles = new Set(profile?.bundles ?? [])
    const found: ChestPluginEntry[] = []
    let dirents: Dirent[] = []
    try {
      dirents = await readdir(this.layout.plugins, { withFileTypes: true })
    } catch {
      dirents = []
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
      const path = join(this.layout.plugins, dirent.name)
      const entry = await this.pluginEntry(dirent.name, path, 'store')
      if (entry !== null) found.push(entry)
    }
    for (const [id, path] of Object.entries(this.state.external)) {
      const entry = await this.pluginEntry(id, path, 'external')
      if (entry !== null) found.push(entry)
    }
    const ordered = applyOrder(found.map(entry => entry.id), this.state.pluginOrder)
    const byId = new Map(found.map(entry => [entry.id, entry]))
    return ordered
      .map(id => byId.get(id))
      .filter((entry): entry is ChestPluginEntry => entry !== undefined)
      .map(entry => ({ ...entry, installed: installedBundles.has(entry.packageName) }))
  }

  /** Read one plugin directory into an entry, or null when it is not a package. */
  private async pluginEntry(
    id: string,
    path: string,
    origin: 'store' | 'external',
  ): Promise<ChestPluginEntry | null> {
    const manifest = await readPluginManifest(path)
    if (manifest === null) return null
    return {
      id,
      packageName: manifest.packageName,
      version: manifest.version,
      description: manifest.description,
      path,
      origin,
      installed: false,
      hasPatch: manifest.hasPatch,
      hasClient: manifest.hasClient,
    }
  }

  /** Scan the skill root, in chest order. */
  private async skillEntries(): Promise<ChestSkillEntry[]> {
    const records = await listSkills(this.layout.skills)
    const ordered = applyOrder(records.map(record => record.id), this.state.skillOrder)
    const byId = new Map(records.map(record => [record.id, record]))
    const skills: ChestSkillEntry[] = []
    for (const id of ordered) {
      const record = byId.get(id)
      if (record === undefined) continue
      skills.push({
        id: record.id,
        name: record.name,
        description: record.description,
        ...(record.whenToUse === undefined ? {} : { whenToUse: record.whenToUse }),
        path: record.path,
        directory: record.directory,
        userOnly: record.userOnly,
        files: record.files,
        body: record.body,
      })
    }
    return skills
  }

  /** Find one plugin entry by chest id. */
  private async findPlugin(id: string): Promise<ChestPluginEntry | null> {
    return (await this.pluginEntries()).find(entry => entry.id === id) ?? null
  }

  /** Find one plugin entry already registered at a path. */
  private async findPluginByPath(path: string): Promise<ChestPluginEntry | null> {
    const wanted = resolve(path)
    return (await this.pluginEntries()).find(entry => resolve(entry.path) === wanted) ?? null
  }

  /** Find one skill by chest id. */
  private async findSkill(id: string): Promise<SkillRecord | null> {
    return (await listSkills(this.layout.skills)).find(record => record.id === id) ?? null
  }

  /** A store id that no plugin currently uses. */
  private async freePluginId(preferred: string): Promise<string> {
    const taken = new Set((await this.pluginEntries()).map(entry => entry.id))
    if (!taken.has(preferred)) return preferred
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const candidate = `${preferred}-${suffix}`
      if (!taken.has(candidate)) return candidate
    }
    return `${preferred}-${Date.now()}`
  }
}

/** Validate one authored skill draft; returns a failure or null. */
function validateDraft(draft: ChestSkillDraft): ChestFailure | null {
  if (draft.name.trim().length === 0) return { code: 'invalid-input', message: 'name is required' }
  if (draft.description.trim().length === 0) {
    return { code: 'invalid-input', message: 'description is required: the skill catalog shows it' }
  }
  return null
}

export default PluginShelfGateway
