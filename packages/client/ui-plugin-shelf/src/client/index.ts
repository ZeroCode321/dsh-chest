/**
 * Chest plugin, browser half. Three registrations:
 *
 * - The `sidebar.plugins` section occupant: the chest itself, listing the
 *   `plugin` and `skill` groups and driving the Host Remotes through plain
 *   injected callbacks.
 * - An '@' trigger source: candidates are the same chest entries. Picking a
 *   skill lands the `/name` reference the skill pipeline already understands;
 *   picking a plugin lands its package directory, because a plugin is code the
 *   agent works ON rather than text it acts out.
 * - Export/import helpers: an export arrives as a `.chest` document and leaves
 *   as a browser download; an import arrives as a picked file and goes back over
 *   the same Remote.
 *
 * The listing is a registrant-private reactive fact: one snapshot store created
 * in apply, refreshed on `pluginShelf/change`, on connection resets, and after
 * every mutation (a mutation answers with the fresh listing, so no second read
 * is needed). The store also carries the live module names read from the plugin
 * inventory, which is how a row can tell "installed and running" from
 * "installed, restart to apply".
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the api-remotes Context merge (ctx.remote + all mounted
// Remote namespace types) into this compilation face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  ClientSessionContext, InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ChestBundle, ChestExportResult, ChestResult, ChestSkillDraft, ChestSnapshot,
} from '@deepseek-ai/dsh-host-plugin-shelf/types'
import { ChestSection } from './ChestSection.tsx'
import type { ChestActionOutcome, ChestInjected, ChestKind, ChestView } from './contract.ts'
import { en, zh, type PluginShelfLocaleKey } from './locales.ts'
import { createChestExpandedStore } from './preference.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Chest section and dialog copy. */
    pluginShelf: PluginShelfLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'pluginShelf'

export type { ChestActionOutcome, ChestKind, ChestSectionProps, ChestView } from './contract.ts'
export type { PluginShelfLocaleKey } from './locales.ts'

/** '@' menu group order; the group appears below the subagent source. */
const SOURCE_ORDER = 20

/** How long a revoked download URL stays alive, so the browser can finish saving. */
const DOWNLOAD_URL_LIFETIME_MS = 10_000

/** Required services: the trigger pipeline, slot ledger, locale, and both Remotes. */
export const inject = [
  'slots', 'locale', 'remote', 'remote.pluginShelf', 'remote.pluginInventory', 'inputTriggers',
]

/** Await one Remote call without letting a transport rejection escape. */
async function settle<T>(call: () => Promise<RemoteResult<T>>): Promise<RemoteResult<T> | null> {
  try {
    return await call()
  } catch {
    return null
  }
}

/** Register the '@' source and the sidebar section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plugin-shelf: dictionaries')
  const t = ctx.locale.bind(NS)

  const store = createSnapshotStore<ChestView>({ status: 'loading', snapshot: null, liveModules: [] })
  // The fold is a browser preference, not server state: it persists in
  // localStorage so a folded chest stays folded across reloads.
  const expanded = createChestExpandedStore()

  const refresh = (): void => {
    void Promise.all([
      ctx.remote.pluginShelf.list().then(result => (result.ok ? result.value : null), () => null),
      ctx.remote.pluginInventory.list().then(result => (result.ok ? result.value : null), () => null),
    ]).then(([snapshot, inventory]) => {
      store.set({
        status: snapshot === null ? 'error' : 'ready',
        snapshot,
        liveModules: (inventory?.entries ?? [])
          .filter(entry => entry.fiberPhase === 'active')
          .map(entry => entry.moduleName),
      })
    })
  }

  /** Adopt a listing a mutation already returned, so an action costs one round trip. */
  const adopt = (snapshot: ChestSnapshot): void => {
    store.set({ ...store.getSnapshot(), status: 'ready', snapshot })
  }

  /** Fold the transport envelope and the business result into one sentence for the UI. */
  const run = async (call: () => Promise<RemoteResult<ChestResult>>): Promise<ChestActionOutcome> => {
    const result = await settle(call)
    if (result === null) return { ok: false, message: 'the host did not answer' }
    if (!result.ok) return { ok: false, message: `${result.error.code}: ${result.error.message}` }
    if (!result.value.ok) return { ok: false, message: result.value.error.message }
    adopt(result.value.value)
    return { ok: true }
  }

  /** Hand one exported bundle to the browser as a file. */
  const download = (bundle: ChestBundle): void => {
    const body = `${JSON.stringify(bundle, null, 2)}\n`
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${bundle.id}.chest`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => { URL.revokeObjectURL(url) }, DOWNLOAD_URL_LIFETIME_MS)
  }

  /** Export one artifact, downloading it when the Host packed it. */
  const exportOne = async (
    call: () => Promise<RemoteResult<ChestExportResult>>,
  ): Promise<ChestActionOutcome> => {
    const result = await settle(call)
    if (result === null) return { ok: false, message: 'the host did not answer' }
    if (!result.ok) return { ok: false, message: `${result.error.code}: ${result.error.message}` }
    if (!result.value.ok) return { ok: false, message: result.value.error.message }
    download(result.value.value)
    return { ok: true }
  }

  /** Move one entry one slot within its section, then persist the whole order. */
  const move = (kind: ChestKind, id: string, direction: 'up' | 'down'): Promise<ChestActionOutcome> => {
    const snapshot = store.getSnapshot().snapshot
    const ids = (kind === 'plugin' ? snapshot?.plugins : snapshot?.skills)?.map(entry => entry.id) ?? []
    const index = ids.indexOf(id)
    const target = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= ids.length) return Promise.resolve({ ok: true })
    const moved = ids[index]
    const replaced = ids[target]
    if (moved === undefined || replaced === undefined) return Promise.resolve({ ok: true })
    const next = [...ids]
    next[index] = replaced
    next[target] = moved
    return kind === 'plugin'
      ? run(() => ctx.remote.pluginShelf.reorderPlugins(next))
      : run(() => ctx.remote.pluginShelf.reorderSkills(next))
  }

  /** Read one picked `.chest` file and hand it to the matching Host method. */
  const importBundle = async (kind: ChestKind, file: File): Promise<ChestActionOutcome> => {
    let bundle: ChestBundle
    try {
      bundle = JSON.parse(await file.text()) as ChestBundle
    } catch {
      return { ok: false, message: `${file.name} is not readable JSON` }
    }
    return kind === 'plugin'
      ? run(() => ctx.remote.pluginShelf.importPlugin({ bundle }))
      : run(() => ctx.remote.pluginShelf.importSkill(bundle))
  }

  refresh()
  ctx.remote.$on('pluginShelf/change', () => { refresh() })
  ctx.on('connection/reset', () => { refresh() })

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'chest',
    order: SOURCE_ORDER,
    candidates: (_session: ClientSessionContext, req) => {
      const { status, snapshot } = store.getSnapshot()
      if (status !== 'ready' || snapshot === null) return Promise.resolve([])
      const query = req.query.trim().toLocaleLowerCase()
      const matches = (name: string, description: string): boolean =>
        query.length === 0
        || name.toLocaleLowerCase().includes(query)
        || description.toLocaleLowerCase().includes(query)
      const skills = snapshot.skills
        .filter(entry => matches(entry.name, entry.description))
        .map(entry => ({
          name: entry.name,
          description: entry.userOnly
            ? `${t('menuUserOnly')} · ${entry.description}`
            : entry.description,
        }))
      const plugins = snapshot.plugins
        .filter(entry => matches(entry.packageName, entry.description))
        .map(entry => ({
          name: entry.packageName,
          description: `${t('menuPluginPrefix')}${entry.installed ? t('installed') : t('notInstalled')}`,
        }))
      return Promise.resolve([...skills, ...plugins])
    },
    lexicon: () => {
      const { status, snapshot } = store.getSnapshot()
      if (status !== 'ready' || snapshot === null) return undefined
      return [
        ...snapshot.skills.map(entry => entry.name),
        ...snapshot.plugins.map(entry => entry.packageName),
      ]
    },
    subscribeLexicon: () => store.subscribe(() => {}),
    onPick: ({ candidate }) => {
      const { snapshot } = store.getSnapshot()
      if (snapshot === null) return undefined
      const skill = snapshot.skills.find(entry => entry.name === candidate.name)
      // A skill is invoked through the pipeline the '/' reference already owns;
      // the chest only shortens the trip to its name.
      if (skill !== undefined) return { text: `/${skill.name} ` }
      const plugin = snapshot.plugins.find(entry => entry.packageName === candidate.name)
      // A plugin is code the agent works on, so the pick hands over its folder.
      if (plugin !== undefined) return { text: `${plugin.packageName} (${plugin.path})` }
      return undefined
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-plugin-shelf: @ source')

  const injected = (): ChestInjected => ({
    refresh,
    addPluginFromPath: path => run(() => ctx.remote.pluginShelf.importPlugin({ path })),
    installPlugin: id => run(() => ctx.remote.pluginShelf.installPlugin(id)),
    uninstallPlugin: id => run(() => ctx.remote.pluginShelf.uninstallPlugin(id)),
    deletePlugin: id => run(() => ctx.remote.pluginShelf.deletePlugin(id)),
    movePlugin: (id, direction) => move('plugin', id, direction),
    exportPlugin: id => exportOne(() => ctx.remote.pluginShelf.exportPlugin(id)),
    createSkill: (draft: ChestSkillDraft) => run(() => ctx.remote.pluginShelf.createSkill(draft)),
    updateSkill: (id, draft) => run(() => ctx.remote.pluginShelf.updateSkill(id, draft)),
    deleteSkill: id => run(() => ctx.remote.pluginShelf.deleteSkill(id)),
    moveSkill: (id, direction) => move('skill', id, direction),
    exportSkill: id => exportOne(() => ctx.remote.pluginShelf.exportSkill(id)),
    importBundle,
    setExpanded: (next) => { expanded.set(next) },
    hooks: { chest: store, chestExpanded: expanded },
  })
  ctx.slots.inject('sidebar.plugins', () => ctx.slots.register({
    name: 'sidebar.plugins',
    locale: NS,
    inject: injected,
  }, ChestSection))
}
