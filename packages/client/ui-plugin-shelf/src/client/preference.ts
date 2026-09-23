/**
 * The chest section's fold preference: one browser-wide boolean, persisted to
 * localStorage under a stable name so a folded chest stays folded across
 * reloads and sessions. The default is folded — the chest is a place you open to
 * work in, not a list that competes with the workspace browser for the column.
 *
 * @module @deepseek-ai/dsh-client-ui-plugin-shelf/client/preference
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** localStorage key for the fold preference. */
export const CHEST_EXPANDED_KEY = 'dsh.chest.expanded'

/**
 * Create the chest fold preference source.
 * @returns a persisted source shared by every mount in one plugin lifecycle.
 */
export function createChestExpandedStore(): SnapshotStore<boolean> {
  return createSnapshotStore(false, { persist: { name: CHEST_EXPANDED_KEY } })
}
