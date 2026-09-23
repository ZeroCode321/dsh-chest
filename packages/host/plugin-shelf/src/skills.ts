/**
 * Skill-file mechanics for the chest: read and write the `SKILL.md` convention
 * the harness's own skill provider discovers — YAML frontmatter (`name`,
 * `description`, `whenToUse`, `disable-model-invocation`) above a markdown body.
 *
 * The chest deliberately writes the SAME shape a hand-authored skill has, so a
 * skill created here is a first-class skill: the `/name` composer reference and
 * the `skill` tool both find it, and a shared one drops into any skill root.
 *
 * @module @deepseek-ai/dsh-host-plugin-shelf/skills
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ChestSkillDraft } from './types.ts'
import { listTreeFiles } from './plugins.ts'

/** The entry file name of a directory-bundle skill. */
export const SKILL_FILE_NAME = 'SKILL.md'

/** One skill parsed off disk, body included (skills are small markdown). */
export interface SkillRecord {
  /** Stable id: the directory name, or the file name without extension. */
  readonly id: string
  /** Frontmatter `name`. */
  readonly name: string
  /** Frontmatter `description`. */
  readonly description: string
  /** Frontmatter `whenToUse`, absent when the skill omits it. */
  readonly whenToUse?: string
  /** Whether the skill opts out of model invocation. */
  readonly userOnly: boolean
  /** Absolute path of the entry file. */
  readonly path: string
  /** Absolute path of the containing directory. */
  readonly directory: string
  /** Whether the skill is a flat `<id>.md` file rather than a directory bundle. */
  readonly flat: boolean
  /** Extra files beside the entry file. */
  readonly files: number
  /** Markdown body below the frontmatter. */
  readonly body: string
}

/** Narrow a parsed value to a plain record, or null when it is not one. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Stable slug from a display name; falls back to `skill` when nothing survives.
 * @param name - the display name to slug.
 * @returns A lowercase, dash-joined id safe to use as a directory name.
 */
export function slugOf(name: string): string {
  const slug = name.trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'skill'
}

/**
 * Parse one skill document.
 * @param raw - the file body, BOM tolerated.
 * @returns the parsed skill without its location, or null when it is not a skill.
 */
export function parseSkillMarkdown(
  raw: string,
): Omit<SkillRecord, 'id' | 'path' | 'directory' | 'flat' | 'files'> | null {
  const text = raw.replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return null
  let meta: unknown
  try {
    meta = parseYaml(match[1] ?? '') as unknown
  } catch {
    return null
  }
  const record = recordOf(meta)
  if (record === null) return null
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const description = typeof record.description === 'string' ? record.description.trim() : ''
  if (name.length === 0 || description.length === 0) return null
  const whenToUse = typeof record.whenToUse === 'string' ? record.whenToUse.trim() : ''
  return {
    name,
    description,
    ...(whenToUse.length > 0 ? { whenToUse } : {}),
    userOnly: record['disable-model-invocation'] === true,
    body: (match[2] ?? '').trim(),
  }
}

/**
 * Render one skill document in the canonical on-disk shape.
 * @param draft - the authored fields.
 * @returns the whole file body, frontmatter included.
 */
export function renderSkillMarkdown(draft: ChestSkillDraft): string {
  // JSON.stringify emits a valid YAML double-quoted scalar, so a name holding
  // a colon, quote, or newline cannot break the frontmatter block.
  const lines = [
    '---',
    `name: ${JSON.stringify(draft.name.trim())}`,
    `description: ${JSON.stringify(draft.description.trim())}`,
  ]
  const whenToUse = draft.whenToUse?.trim() ?? ''
  if (whenToUse.length > 0) lines.push(`whenToUse: ${JSON.stringify(whenToUse)}`)
  if (draft.userOnly === true) lines.push('disable-model-invocation: true')
  lines.push('---', '', draft.body.trim(), '')
  return lines.join('\n')
}

/** Read one skill entry file into a record, or null when it is unreadable. */
async function readSkillAt(
  entryPath: string,
  directory: string,
  id: string,
  flat: boolean,
): Promise<SkillRecord | null> {
  let parsed: ReturnType<typeof parseSkillMarkdown>
  try {
    parsed = parseSkillMarkdown(await readFile(entryPath, 'utf8'))
  } catch {
    return null
  }
  if (parsed === null) return null
  const files = flat ? 0 : Math.max(0, (await listTreeFiles(directory).catch(() => [])).length - 1)
  return { id, ...parsed, path: entryPath, directory, flat, files }
}

/**
 * Scan a skill root.
 * @param root - the skill root directory (for example `$DSH_HOME/skills`).
 * @returns every readable skill, ordered by the id the natural order gives.
 */
export async function listSkills(root: string): Promise<SkillRecord[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found: SkillRecord[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      const record = await readSkillAt(
        join(root, entry.name, SKILL_FILE_NAME),
        join(root, entry.name),
        entry.name,
        false,
      )
      if (record !== null) found.push(record)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    if (entry.name === SKILL_FILE_NAME) continue
    const record = await readSkillAt(join(root, entry.name), root, entry.name.slice(0, -3), true)
    if (record !== null) found.push(record)
  }
  return found.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Write one skill, creating its directory bundle when absent.
 * @param root - the skill root.
 * @param id - the target id (already slugged by the caller).
 * @param draft - the authored fields.
 * @param flat - write a flat `<id>.md` instead of a directory bundle.
 * @returns the absolute path written.
 */
export async function writeSkill(
  root: string,
  id: string,
  draft: ChestSkillDraft,
  flat = false,
): Promise<string> {
  const body = renderSkillMarkdown(draft)
  if (flat) {
    const target = join(root, `${id}.md`)
    await writeFile(target, body, 'utf8')
    return target
  }
  const directory = join(root, id)
  await mkdir(directory, { recursive: true })
  const target = join(directory, SKILL_FILE_NAME)
  await writeFile(target, body, 'utf8')
  return target
}

/**
 * Remove one skill from the root: its directory bundle, or the flat file.
 * @param root - the skill root.
 * @param record - the skill as the scan found it.
 */
export async function removeSkill(root: string, record: SkillRecord): Promise<void> {
  if (record.flat) {
    await rm(join(root, `${record.id}.md`), { force: true })
    return
  }
  await rm(join(root, record.id), { recursive: true, force: true })
}
