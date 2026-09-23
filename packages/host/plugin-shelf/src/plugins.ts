/**
 * Plugin-package mechanics for the chest: read a package manifest, walk and
 * copy a package tree, and pack or unpack the single-file bundle a chest
 * shares. Everything here is filesystem work on ONE directory, so the gateway
 * above stays about policy rather than about `Dirent`s.
 *
 * @module @deepseek-ai/dsh-host-plugin-shelf/plugins
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ChestBundle, ChestBundleFile } from './types.ts'

/** Directory names never copied into or out of a chest artifact. */
const SKIPPED_SEGMENTS: ReadonlySet<string> = new Set(['node_modules', '.git'])

/** Bundle-size ceilings; a chest artifact is a plugin or a skill, not a tree dump. */
const MAX_BUNDLE_FILES = 2000
const MAX_BUNDLE_FILE_BYTES = 8 * 1024 * 1024

/** What a plugin package's `package.json` tells the chest. */
export interface PluginManifest {
  /** Package name; the Loader resolves this, so it is the row identity too. */
  readonly packageName: string
  /** Declared version, empty when the manifest omits one. */
  readonly version: string
  /** Declared description, empty when the manifest omits one. */
  readonly description: string
  /** Whether the package ships a Loader patch layer (`dsh.bundle.patch`). */
  readonly hasPatch: boolean
  /** Whether the package ships a web browser half (`dsh.client.platform: web`). */
  readonly hasClient: boolean
}

/** Narrow a parsed value to a plain record, or null when it is not one. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Read one string field, trimming it; empty string when absent or not a string. */
function textOf(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Read a plugin package's manifest.
 * @param directory - the candidate package directory.
 * @returns the manifest facts, or null when the folder is not a plugin package.
 */
export async function readPluginManifest(directory: string): Promise<PluginManifest | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as unknown
  } catch {
    return null
  }
  const record = recordOf(parsed)
  if (record === null) return null
  const packageName = textOf(record, 'name')
  if (packageName.length === 0) return null
  const dsh = recordOf(record.dsh)
  const bundle = dsh === null ? null : recordOf(dsh.bundle)
  const client = dsh === null ? null : recordOf(dsh.client)
  return {
    packageName,
    version: textOf(record, 'version'),
    description: textOf(record, 'description'),
    hasPatch: bundle !== null && typeof bundle.patch === 'string' && bundle.patch.trim().length > 0,
    // The browser roster scanner refuses a declared client half that is not
    // for the web platform, so only a web declaration counts here.
    hasClient: client !== null && client.platform === 'web',
  }
}

/** Whether one directory entry name is a directory the chest should descend into. */
function descendsInto(name: string): boolean {
  return !SKIPPED_SEGMENTS.has(name) && !name.startsWith('.')
}

/**
 * List every regular file under a directory, as forward-slashed relative paths.
 * @param root - the directory to walk.
 * @returns sorted relative paths, or an empty list when the root is unreadable.
 */
export async function listTreeFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (current: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!descendsInto(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = relative(root, full)
      found.push(rel.split(sep).join('/'))
    }
  }
  await walk(root)
  return found.sort((left, right) => left.localeCompare(right))
}

/** Encode one file body, preferring readable UTF-8 and falling back to base64. */
function encodeBody(body: Buffer): ChestBundleFile['encoding'] {
  return Buffer.from(body.toString('utf8'), 'utf8').equals(body) ? 'utf8' : 'base64'
}

/**
 * Read a directory into bundle files.
 * @param root - the artifact directory.
 * @param files - relative paths to read (from {@link listTreeFiles}).
 * @returns the encoded files, or null when the artifact exceeds the ceilings.
 */
export async function readTreeFiles(
  root: string,
  files: readonly string[],
): Promise<ChestBundleFile[] | null> {
  if (files.length > MAX_BUNDLE_FILES) return null
  const collected: ChestBundleFile[] = []
  for (const rel of files) {
    const body = await readFile(join(root, rel))
    if (body.byteLength > MAX_BUNDLE_FILE_BYTES) return null
    const encoding = encodeBody(body)
    collected.push({
      path: rel,
      encoding,
      content: encoding === 'utf8' ? body.toString('utf8') : body.toString('base64'),
    })
  }
  return collected
}

/**
 * Normalize a bundle-relative path, refusing anything that could escape the target.
 * @param raw - the path as written in the bundle.
 * @returns the normalized forward-slashed path, or null when it is unsafe.
 */
export function safeRelativePath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/')
  if (normalized.length === 0 || normalized.startsWith('/')) return null
  if (/^[a-zA-Z]:/.test(normalized)) return null
  const segments = normalized.split('/').filter(segment => segment.length > 0 && segment !== '.')
  if (segments.length === 0) return null
  if (segments.some(segment => segment === '..' || SKIPPED_SEGMENTS.has(segment))) return null
  return segments.join('/')
}

/**
 * Narrow an inbound value to a chest bundle.
 * @param value - the untrusted value received over the wire.
 * @returns the bundle, or null when the document is not one this chest can read.
 */
export function asChestBundle(value: unknown): ChestBundle | null {
  const record = recordOf(value)
  if (record === null) return null
  if (record.format !== 'dsh-chest' || record.revision !== 1) return null
  const kind = record.kind
  if (kind !== 'plugin' && kind !== 'skill') return null
  if (typeof record.id !== 'string' || record.id.trim().length === 0) return null
  if (!Array.isArray(record.files)) return null
  const files: ChestBundleFile[] = []
  for (const item of record.files) {
    const file = recordOf(item)
    if (file === null) return null
    const path = typeof file.path === 'string' ? file.path : ''
    const encoding = file.encoding
    if (encoding !== 'utf8' && encoding !== 'base64') return null
    if (typeof file.content !== 'string') return null
    if (safeRelativePath(path) === null) return null
    files.push({ path, encoding, content: file.content })
  }
  if (files.length === 0 || files.length > MAX_BUNDLE_FILES) return null
  return {
    format: 'dsh-chest',
    revision: 1,
    kind,
    id: record.id.trim(),
    name: typeof record.name === 'string' ? record.name : record.id.trim(),
    description: typeof record.description === 'string' ? record.description : '',
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    files,
  }
}

/**
 * Write bundle files into a directory that must not yet exist.
 * @param target - the directory to create and fill.
 * @param files - the bundle's files, already validated by {@link asChestBundle}.
 * @returns the number of files written.
 */
export async function writeBundleFiles(
  target: string,
  files: readonly ChestBundleFile[],
): Promise<number> {
  await mkdir(target, { recursive: false })
  let written = 0
  try {
    for (const file of files) {
      const safe = safeRelativePath(file.path)
      if (safe === null) throw new Error(`unsafe bundle path: ${file.path}`)
      const full = resolve(target, safe)
      if (!full.startsWith(`${resolve(target)}${sep}`)) {
        throw new Error(`unsafe bundle path: ${file.path}`)
      }
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, file.encoding === 'utf8' ? file.content : Buffer.from(file.content, 'base64'))
      written += 1
    }
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return written
}

/**
 * Whether a path already exists.
 * @param path - the absolute path to test.
 * @returns True when something is there.
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
