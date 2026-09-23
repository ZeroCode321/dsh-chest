import { afterEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginShelfGateway from '../src/index.ts'
import { slugOf } from '../src/skills.ts'
import type { ChestSkillDraft } from '../src/types.ts'

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** A profile directory whose package.json carries dsh.profile.bundles. */
async function profileDir(): Promise<string> {
  const dir = await tempDir('dsh-chest-profile-')
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-chest-test',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2)}\n`, 'utf8')
  return dir
}

/** A minimal plugin package: manifest, patch layer, and a host entry. */
async function pluginPackage(name: string, parent: string): Promise<string> {
  const dir = join(parent, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({
    name,
    version: '1.0.0',
    description: 'chest test plugin',
    type: 'module',
    main: 'index.js',
    exports: { '.': './index.js', './client': { default: './lib/client.js' } },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
  }, null, 2)}\n`, 'utf8')
  await writeFile(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${name}\n      name: ${name}\n`, 'utf8')
  await writeFile(join(dir, 'index.js'), 'export function apply() {}\n', 'utf8')
  await mkdir(join(dir, 'lib'), { recursive: true })
  await writeFile(join(dir, 'lib', 'client.js'), 'window.__ModuleLoader__.load({ id: "x" })\n', 'utf8')
  return dir
}

interface Harness {
  readonly ctx: Context
  readonly chest: PluginShelfGateway
  readonly profile: string
  readonly skills: string
}

async function harness(): Promise<Harness> {
  const root = await tempDir('dsh-chest-')
  const skills = join(root, 'skills')
  const profile = await profileDir()
  const ctx = new Context()
  contexts.push(ctx)
  // The gateway reads the booted profile from the Loader's base URL.
  ctx.baseUrl = pathToFileURL(`${profile}\\`).href
  await ctx.plugin(PluginShelfGateway, { root: join(root, 'chest'), skillRoot: skills })
  return { ctx, chest: ctx.get('pluginShelf') as PluginShelfGateway, profile, skills }
}

const REVIEW: ChestSkillDraft = {
  name: '代码评审',
  description: '按清单评审一次改动',
  whenToUse: '当用户要求评审代码时',
  body: '# 评审\n\n1. 先看测试\n2. 再看边界\n',
}

/** Read one profile manifest back as a mutable record. */
async function profileManifest(profile: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as Record<string, unknown>
}

describe('PluginShelfGateway (chest)', () => {
  it('publishes the chest methods under the pluginShelf namespace', async () => {
    const { chest } = await harness()
    expect(chest.typertRemote).toMatchObject({ serviceKey: 'pluginShelf', namespace: 'pluginShelf' })
    expect(remoteMethods(chest).map(method => method.method).sort()).toEqual([
      'createSkill', 'deletePlugin', 'deleteSkill', 'exportPlugin', 'exportSkill', 'importPlugin',
      'importSkill', 'installPlugin', 'list', 'reorderPlugins', 'reorderSkills', 'uninstallPlugin',
      'updateSkill',
    ])
  })

  it('reports an empty chest plus the booted profile', async () => {
    const { chest, skills } = await harness()
    const snapshot = await chest.list()
    expect(snapshot.plugins).toEqual([])
    expect(snapshot.skills).toEqual([])
    expect(snapshot.skillRoot).toBe(skills)
    expect(snapshot.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(snapshot.restartRequired).toBe(false)
  })

  it('writes, rewrites, and removes a real SKILL.md', async () => {
    const { chest, skills } = await harness()
    const created = await chest.createSkill(REVIEW)
    expect(created.ok).toBe(true)

    const file = join(skills, slugOf(REVIEW.name), 'SKILL.md')
    const body = await readFile(file, 'utf8')
    expect(body).toContain('description: "按清单评审一次改动"')
    expect(body).toContain('whenToUse: "当用户要求评审代码时"')
    expect(body).toContain('1. 先看测试')

    const listed = await chest.list()
    expect(listed.skills).toHaveLength(1)
    expect(listed.skills[0]).toMatchObject({ name: '代码评审', files: 0, userOnly: false })
    expect(listed.skills[0]?.body).toContain('先看测试')

    // A duplicate slug is a business failure, not an io error.
    const duplicate = await chest.createSkill(REVIEW)
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'duplicate-id' } })

    const updated = await chest.updateSkill(listed.skills[0]?.id ?? '', { ...REVIEW, body: '# 改过了\n' })
    expect(updated.ok).toBe(true)
    expect(await readFile(file, 'utf8')).toContain('改过了')

    const removed = await chest.deleteSkill(listed.skills[0]?.id ?? '')
    expect(removed.ok).toBe(true)
    expect((await chest.list()).skills).toEqual([])
  })

  it('registers a plugin folder in place and installs it into the profile', async () => {
    const { chest, profile } = await harness()
    const workspace = await tempDir('dsh-chest-plugins-')
    const source = await pluginPackage('dsh-demo', workspace)

    const registered = await chest.importPlugin({ path: source })
    expect(registered.ok).toBe(true)
    if (!registered.ok) return
    const entry = registered.value.plugins[0]
    expect(entry).toMatchObject({
      id: 'dsh-demo', packageName: 'dsh-demo', origin: 'external', installed: false,
      hasPatch: true, hasClient: true,
    })

    const installed = await chest.installPlugin('dsh-demo')
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.value.restartRequired).toBe(true)
    expect(installed.value.plugins[0]?.installed).toBe(true)

    const manifest = await profileManifest(profile)
    expect((manifest.dependencies as Record<string, string>)['dsh-demo']).toBe(`link:${source.replace(/\\/g, '/')}`)
    expect((manifest.dsh as { profile: { bundles: string[] } }).profile.bundles).toContain('dsh-demo')
    const link = join(profile, 'node_modules', 'dsh-demo')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)

    const uninstalled = await chest.uninstallPlugin('dsh-demo')
    expect(uninstalled.ok).toBe(true)
    const after = await profileManifest(profile)
    expect((after.dependencies as Record<string, string>)['dsh-demo']).toBeUndefined()
    expect((after.dsh as { profile: { bundles: string[] } }).profile.bundles).not.toContain('dsh-demo')
  })

  it('round-trips one plugin through a chest bundle and a store copy', async () => {
    const { chest } = await harness()
    const workspace = await tempDir('dsh-chest-roundtrip-')
    const source = await pluginPackage('dsh-whale-diving', workspace)
    await chest.importPlugin({ path: source })

    const exported = await chest.exportPlugin('dsh-whale-diving')
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    expect(exported.value).toMatchObject({ format: 'dsh-chest', revision: 1, kind: 'plugin' })
    const paths = exported.value.files.map(file => file.path)
    expect(paths).toContain('package.json')
    expect(paths).toContain('cordis.patch.yml')
    expect(paths).toContain('lib/client.js')

    // A bundle with a different id lands in the store, not next to the original.
    const adopted = await chest.importPlugin({ bundle: { ...exported.value, id: 'dsh-whale-diving-copy' } })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    const stored = adopted.value.plugins.find(entry => entry.id === 'dsh-whale-diving-copy')
    expect(stored).toMatchObject({ origin: 'store', installed: false })
    expect(await readFile(join(stored?.path ?? '', 'index.js'), 'utf8')).toContain('export function apply')

    // A traversal attempt never reaches the filesystem.
    const hostile = await chest.importPlugin({ bundle: { ...exported.value, id: 'evil', files: [{ path: '../escape.js', encoding: 'utf8', content: 'x' }] } })
    expect(hostile).toMatchObject({ ok: false, error: { code: 'invalid-bundle' } })
  })

  it('reorders the chest and the profile bundle slots together', async () => {
    const { chest, profile } = await harness()
    const workspace = await tempDir('dsh-chest-order-')
    await chest.importPlugin({ path: await pluginPackage('dsh-first', workspace) })
    await chest.importPlugin({ path: await pluginPackage('dsh-second', workspace) })
    await chest.installPlugin('dsh-first')
    await chest.installPlugin('dsh-second')

    const reordered = await chest.reorderPlugins(['dsh-second', 'dsh-first'])
    expect(reordered.ok).toBe(true)
    if (!reordered.ok) return
    expect(reordered.value.plugins.map(entry => entry.id)).toEqual(['dsh-second', 'dsh-first'])
    expect((await profileManifest(profile)).dsh).toMatchObject({
      profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-second', 'dsh-first'] },
    })

    // A list that does not name every plugin exactly once is refused.
    expect(await chest.reorderPlugins(['dsh-first'])).toMatchObject({
      ok: false, error: { code: 'invalid-input' },
    })
  })

  it('emits pluginShelf/change after a mutation', async () => {
    const { ctx, chest } = await harness()
    const changes: number[] = []
    ctx.on('pluginShelf/change', () => { changes.push(0) })

    await chest.createSkill(REVIEW)
    await chest.deleteSkill(slugOf(REVIEW.name))
    expect(changes.length).toBeGreaterThanOrEqual(2)
  })
})
