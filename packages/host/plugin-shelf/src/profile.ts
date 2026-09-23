/**
 * Profile mechanics for the chest: read the profile the running host booted
 * from, and install or remove a plugin package there.
 *
 * A profile is an ordinary directory (`$DSH_HOME/profiles/<name>`) whose
 * `package.json` carries `dsh.profile.bundles` — the ordered bundle layers the
 * Loader composes. Installing a plugin is therefore three concrete edits and
 * nothing more: a dependency entry pointing at the package, the bundle name in
 * that ordered list, and the `node_modules` link that lets a bare specifier
 * resolve to it. Layer order IS precedence, so reordering this list is the real
 * reordering of a plugin, not a display preference.
 *
 * @module @deepseek-ai/dsh-host-plugin-shelf/profile
 */

import { lstat, mkdir, readFile, readlink, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The profile facts the chest reads and writes. */
export interface ProfileManifest {
  /** Profile name: its directory name. */
  readonly name: string
  /** Absolute profile directory. */
  readonly root: string
  /** Bundle package names in patch-layer order. */
  readonly bundles: readonly string[]
}

/** A profile package.json parsed far enough to edit it losslessly. */
interface ProfileDocument {
  /** The whole manifest, so unknown keys survive a rewrite. */
  readonly record: Record<string, unknown>
  /** `dsh.profile` when it is a record, else null. */
  readonly profile: Record<string, unknown> | null
}

/** Narrow a parsed value to a plain record, or null when it is not one. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Resolve the booted profile directory from the Loader's base URL.
 * @param baseUrl - the Loader's base URL, absent outside a composed profile.
 * @returns The absolute profile directory, or null when there is none to read.
 */
export function profileRootOf(baseUrl: string | undefined): string | null {
  if (baseUrl === undefined || baseUrl.length === 0) return null
  try {
    return fileURLToPath(baseUrl)
  } catch {
    return null
  }
}

/** Read and parse a profile manifest document, or null when there is none. */
async function readDocument(root: string): Promise<ProfileDocument | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as unknown
  } catch {
    return null
  }
  const record = recordOf(parsed)
  if (record === null) return null
  const dsh = recordOf(record.dsh)
  return { record, profile: dsh === null ? null : recordOf(dsh.profile) }
}

/**
 * Read a profile's bundle list.
 * @param root - the candidate profile directory.
 * @returns The profile manifest, or null when the directory is not a profile.
 */
export async function readProfile(root: string): Promise<ProfileManifest | null> {
  const document = await readDocument(root)
  if (document === null || document.profile === null) return null
  const bundles = document.profile.bundles
  return {
    name: basename(root),
    root,
    bundles: Array.isArray(bundles) ? bundles.filter((item): item is string => typeof item === 'string') : [],
  }
}

/** Persist an edited profile document, preserving formatting conventions. */
async function writeDocument(root: string, document: ProfileDocument): Promise<void> {
  const target = join(root, 'package.json')
  const temporary = `${target}.chest.tmp`
  await writeFile(temporary, `${JSON.stringify(document.record, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

/** Read the mutable dependency map, creating it when the manifest lacks one. */
function dependenciesOf(document: ProfileDocument): Record<string, unknown> {
  const existing = recordOf(document.record.dependencies)
  if (existing !== null) return existing
  const created: Record<string, unknown> = {}
  document.record.dependencies = created
  return created
}

/** Read the mutable bundle list, creating `dsh.profile.bundles` when absent. */
function bundlesOf(document: ProfileDocument): unknown[] {
  const profile = document.profile
  if (profile === null) return []
  const existing = profile.bundles
  if (Array.isArray(existing)) return existing
  const created: unknown[] = []
  profile.bundles = created
  return created
}

/**
 * The specifier a profile dependency uses for a plugin that stays where it is.
 * @param target - the absolute package directory.
 * @returns A `link:` specifier with forward slashes, portable in package.json.
 */
export function linkSpecifier(target: string): string {
  return `link:${target.replace(/\\/g, '/')}`
}

/**
 * Whether `node_modules/<packageName>` already resolves to `target`.
 * @param root - the profile directory.
 * @param packageName - the package name to look up.
 * @param target - the absolute package directory it should point at.
 */
async function linkResolvesTo(root: string, packageName: string, target: string): Promise<boolean> {
  const linkPath = join(root, 'node_modules', ...packageName.split('/'))
  try {
    const stats = await lstat(linkPath)
    if (!stats.isSymbolicLink()) return false
    return (await readlink(linkPath)) === target
  } catch {
    return false
  }
}

/**
 * Point `node_modules/<packageName>` at a package directory.
 * @param root - the profile directory.
 * @param packageName - the package name, scoped names included.
 * @param target - the absolute package directory.
 * @returns whether a link was created (false when one already resolved there).
 */
export async function linkPackage(root: string, packageName: string, target: string): Promise<boolean> {
  if (await linkResolvesTo(root, packageName, target)) return false
  const linkPath = join(root, 'node_modules', ...packageName.split('/'))
  await mkdir(dirname(linkPath), { recursive: true })
  // A pre-existing entry (an npm-installed copy, or a stale link) never wins:
  // the chest's install is the whole point of the call, so replace a link and
  // leave a real directory alone.
  try {
    const stats = await lstat(linkPath)
    if (!stats.isSymbolicLink()) return false
    await unlink(linkPath)
  } catch {
    // Absent — the symlink below creates it.
  }
  await symlink(target, linkPath, 'junction')
  return true
}

/**
 * Remove the `node_modules` link for one package, leaving a real directory alone.
 * @param root - the profile directory.
 * @param packageName - the package name to unlink.
 */
export async function unlinkPackage(root: string, packageName: string): Promise<void> {
  const linkPath = join(root, 'node_modules', ...packageName.split('/'))
  try {
    const stats = await lstat(linkPath)
    if (!stats.isSymbolicLink()) return
    await unlink(linkPath)
  } catch {
    // Absent — nothing to remove.
  }
}

/**
 * Record a plugin package as an installed bundle in the profile.
 * @param root - the profile directory.
 * @param packageName - the package name.
 * @param target - the absolute package directory.
 * @returns whether the manifest changed (false when the profile already agreed).
 */
export async function installIntoProfile(
  root: string,
  packageName: string,
  target: string,
): Promise<boolean> {
  const document = await readDocument(root)
  if (document === null || document.profile === null) {
    throw new Error('profile package.json has no dsh.profile block')
  }
  const wanted = linkSpecifier(target)
  const dependencies = dependenciesOf(document)
  const bundles = bundlesOf(document)
  let changed = dependencies[packageName] !== wanted
  if (changed) dependencies[packageName] = wanted
  if (!bundles.includes(packageName)) {
    bundles.push(packageName)
    changed = true
  }
  if (changed) await writeDocument(root, document)
  await linkPackage(root, packageName, target)
  return changed
}

/**
 * Drop a plugin package from the profile: dependency, bundle list, and link.
 * @param root - the profile directory.
 * @param packageName - the package name.
 * @returns whether the manifest changed.
 */
export async function uninstallFromProfile(root: string, packageName: string): Promise<boolean> {
  const document = await readDocument(root)
  if (document === null || document.profile === null) {
    throw new Error('profile package.json has no dsh.profile block')
  }
  const dependencies = dependenciesOf(document)
  const bundles = bundlesOf(document)
  let changed = false
  if (packageName in dependencies) {
    // Rebuilt rather than `delete`d: the repository's lint forbids a dynamic delete.
    const remainingDependencies: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(dependencies)) {
      if (key !== packageName) remainingDependencies[key] = value
    }
    document.record.dependencies = remainingDependencies
    changed = true
  }
  const remaining = bundles.filter(item => item !== packageName)
  if (remaining.length !== bundles.length) {
    bundles.length = 0
    bundles.push(...remaining)
    changed = true
  }
  if (changed) await writeDocument(root, document)
  await unlinkPackage(root, packageName)
  return changed
}

/**
 * Reorder bundle layers among the slots the named bundles already occupy.
 * @param root - the profile directory.
 * @param ordered - bundle names in the wanted order.
 * @returns whether the manifest changed.
 */
export async function reorderBundles(root: string, ordered: readonly string[]): Promise<boolean> {
  const document = await readDocument(root)
  if (document === null || document.profile === null) return false
  const bundles = bundlesOf(document)
  const slots: number[] = []
  for (const [index, item] of bundles.entries()) {
    if (typeof item === 'string' && ordered.includes(item)) slots.push(index)
  }
  if (slots.length !== ordered.length) return false
  let changed = false
  for (const [offset, index] of slots.entries()) {
    if (bundles[index] !== ordered[offset]) {
      bundles[index] = ordered[offset]
      changed = true
    }
  }
  if (changed) await writeDocument(root, document)
  return changed
}
