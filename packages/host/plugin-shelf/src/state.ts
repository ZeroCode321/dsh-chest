/**
 * Chest bookkeeping: the one small JSON document under the chest root that
 * records what a directory listing cannot say — which external folders are
 * registered in place, the user's chosen order per section, and whether a
 * profile mutation is still waiting for the next restart.
 *
 * @module @deepseek-ai/dsh-host-plugin-shelf/state
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Bookkeeping file name inside the chest root. */
export const CHEST_STATE_FILE = 'chest.json'

/** On-disk bookkeeping shape. Everything here is optional on read. */
export interface ChestState {
  /** External plugin folders registered in place, by chest id. */
  readonly external: Record<string, string>
  /** Plugin ids in presentation order, most significant first. */
  readonly pluginOrder: readonly string[]
  /** Skill ids in presentation order, most significant first. */
  readonly skillOrder: readonly string[]
  /** True once a profile mutation awaits the next dsh restart. */
  readonly restartRequired: boolean
}

/**
 * The empty bookkeeping document: nothing registered, natural order, nothing pending.
 * @returns A fresh state value whose sections are all empty.
 */
export function emptyChestState(): ChestState {
  return { external: {}, pluginOrder: [], skillOrder: [], restartRequired: false }
}

/** Narrow one parsed value to a string map, dropping every non-string pair. */
function stringMapOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return result
}

/** Narrow one parsed value to a string list, dropping every non-string item. */
function stringListOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * Read the bookkeeping file, falling back to defaults when it is absent or unreadable.
 * @param root - the chest root holding `chest.json`.
 * @returns The stored state, or the empty state when nothing readable is there.
 */
export async function readChestState(root: string): Promise<ChestState> {
  let raw: string
  try {
    raw = await readFile(join(root, CHEST_STATE_FILE), 'utf8')
  } catch {
    return emptyChestState()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return emptyChestState()
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyChestState()
  const record = parsed as Record<string, unknown>
  return {
    external: stringMapOf(record.external),
    pluginOrder: stringListOf(record.pluginOrder),
    skillOrder: stringListOf(record.skillOrder),
    restartRequired: record.restartRequired === true,
  }
}

/**
 * Persist the bookkeeping file through a temp rename, so a reader never sees a half write.
 * @param root - the chest root holding `chest.json`.
 * @param state - the state to store.
 */
export async function writeChestState(root: string, state: ChestState): Promise<void> {
  const target = join(root, CHEST_STATE_FILE)
  const temporary = `${target}.tmp`
  const body = `${JSON.stringify({
    version: 1,
    external: state.external,
    pluginOrder: state.pluginOrder,
    skillOrder: state.skillOrder,
    restartRequired: state.restartRequired,
  }, null, 2)}\n`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, target)
}

/**
 * Order ids by a recorded preference: ids the preference names come first in
 * that order, and ids it does not name keep their natural order behind them.
 * @param ids - the ids that currently exist.
 * @param order - the recorded preference, possibly stale.
 * @returns the ids in presentation order.
 */
export function applyOrder(ids: readonly string[], order: readonly string[]): string[] {
  const known = new Set(ids)
  const ranked = order.filter(id => known.has(id))
  const seen = new Set(ranked)
  return [...ranked, ...ids.filter(id => !seen.has(id))]
}
