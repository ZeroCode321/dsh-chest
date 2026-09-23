/**
 * Chest section contracts. The sidebar shell declares the `sidebar.plugins`
 * hole (single, root scope — see `@deepseek-ai/dsh-client-ui-sidebar/client`)
 * and passes its fold state; this package registers the occupant.
 *
 * The chest listing is a registrant-private reactive fact and rides the
 * reserved `hooks` compartment: the renderer binds the snapshot source into the
 * `useChest` selector hook, so the component reads a live view without seeing
 * the source. Actions arrive as plain callbacks, already unwrapped from the
 * transport, so the component only ever renders a sentence.
 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChestSkillDraft, ChestSnapshot } from '@deepseek-ai/dsh-host-plugin-shelf/types'
// Type-only: pull the sidebar shell's SlotMap merges so PropsRuntime<'sidebar.plugins'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Which half of the chest an action addresses. */
export type ChestKind = 'plugin' | 'skill'

/**
 * One settled chest action, unwrapped for the UI. The transport envelope and
 * the business result are both folded away here: the component shows
 * `message` and refreshes, and never learns which layer refused.
 */
export type ChestActionOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** Client-side view of the chest, published through the hooks compartment. */
export interface ChestView {
  /** Lifecycle of the listing itself. */
  readonly status: 'loading' | 'ready' | 'error'
  /** The listing once a read settled. */
  readonly snapshot: ChestSnapshot | null
  /**
   * Module names the running process has ACTIVE, read from the plugin
   * inventory. An installed plugin missing here is installed but not yet live,
   * which is exactly what "restart to apply" means.
   */
  readonly liveModules: readonly string[]
}

/**
 * Registrant-private injected share: the reactive `chest` hook source plus the
 * actions the section drives.
 */
export interface ChestInjected {
  /** Re-read the chest and the live plugin inventory. */
  refresh(): void
  /** Register a plugin package from an absolute folder path, in place. */
  addPluginFromPath(path: string): Promise<ChestActionOutcome>
  /** Install one plugin into the booted profile (a restart applies it). */
  installPlugin(id: string): Promise<ChestActionOutcome>
  /** Remove one plugin from the profile. */
  uninstallPlugin(id: string): Promise<ChestActionOutcome>
  /** Drop one plugin from the chest (uninstalling it first when installed). */
  deletePlugin(id: string): Promise<ChestActionOutcome>
  /** Move one plugin one slot within its section. */
  movePlugin(id: string, direction: 'up' | 'down'): Promise<ChestActionOutcome>
  /** Save one plugin package into a `.chest` file the browser downloads. */
  exportPlugin(id: string): Promise<ChestActionOutcome>
  /** Author one new skill under the user skill root. */
  createSkill(draft: ChestSkillDraft): Promise<ChestActionOutcome>
  /** Rewrite one skill in place. */
  updateSkill(id: string, draft: ChestSkillDraft): Promise<ChestActionOutcome>
  /** Remove one skill. */
  deleteSkill(id: string): Promise<ChestActionOutcome>
  /** Move one skill one slot within its section. */
  moveSkill(id: string, direction: 'up' | 'down'): Promise<ChestActionOutcome>
  /** Save one skill into a `.chest` file the browser downloads. */
  exportSkill(id: string): Promise<ChestActionOutcome>
  /** Adopt a `.chest` document the user picked for one section. */
  importBundle(kind: ChestKind, file: File): Promise<ChestActionOutcome>
  /** Fold or unfold the section; the preference persists in the browser. */
  setExpanded(next: boolean): void
  /**
   * Live sources bound by the renderer: `useChest` reads the listing and
   * `useChestExpanded` reads the persisted fold preference.
   */
  hooks: {
    chest: HostObservable<ChestView>
    chestExpanded: HostObservable<boolean>
  }
}

/** Full section props: shell owner share + injected face + locale seat. */
export type ChestSectionProps =
  PropsRuntime<'sidebar.plugins'>
  & InjectFace<ChestInjected>
  & PropsLocale<'pluginShelf'>
