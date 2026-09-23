/**
 * Chest event vocabulary and Remote payload types. Client-safe: nothing here
 * reaches a Host-only symbol, so a Client compilation face reads the same
 * `pluginShelf/change` signature the Host emits.
 *
 * A chest holds two kinds of thing, both of them real artifacts on disk rather
 * than text the model is asked to pretend with:
 *
 * - **plugin** — a directory holding a DSH plugin package (`package.json`, a
 *   `cordis.patch.yml` patch layer, and optionally a browser half). The chest
 *   owns a store of them and can link one into the running profile, which is
 *   what installing a plugin actually means.
 * - **skill** — a directory holding `SKILL.md` under the user skill root, the
 *   same file the `skill` tool and the `/name` composer reference discover.
 *
 * @module @deepseek-ai/dsh-host-plugin-shelf/types
 */

/** Where a registered plugin package lives. */
export type ChestPluginOrigin =
  /** Copied into `$DSH_HOME/chest/plugins`, so the chest owns the bytes. */
  | 'store'
  /** A folder elsewhere on disk the user registered in place. */
  | 'external'

/** One plugin package the chest knows about. */
export interface ChestPluginEntry {
  /** Stable chest id: the folder name. */
  readonly id: string
  /** Package name from its `package.json`. */
  readonly packageName: string
  /** Package version, empty when the manifest omits one. */
  readonly version: string
  /** Package description, empty when the manifest omits one. */
  readonly description: string
  /** Absolute path of the package directory. */
  readonly path: string
  /** Whether the chest owns the bytes or merely points at them. */
  readonly origin: ChestPluginOrigin
  /** Whether the profile records this package as an installed bundle. */
  readonly installed: boolean
  /** Whether the package ships a Loader patch layer (`dsh.bundle.patch`). */
  readonly hasPatch: boolean
  /** Whether the package ships a browser half (`dsh.client`, web platform). */
  readonly hasClient: boolean
}

/** One skill the chest manages under the user skill root. */
export interface ChestSkillEntry {
  /** Stable chest id: the directory (or file) name under the skill root. */
  readonly id: string
  /** Frontmatter `name`. */
  readonly name: string
  /** Frontmatter `description`. */
  readonly description: string
  /** Frontmatter `whenToUse`, absent when the skill omits it. */
  readonly whenToUse?: string
  /** Absolute path of the skill's `SKILL.md` (or its flat markdown file). */
  readonly path: string
  /** Absolute path of the skill directory (the file's parent for a flat skill). */
  readonly directory: string
  /** Whether the skill forbids model invocation (`disable-model-invocation`). */
  readonly userOnly: boolean
  /** Count of extra files beside the entry file; 0 for a flat skill. */
  readonly files: number
  /** The markdown body below the frontmatter, so the dialog opens from one read. */
  readonly body: string
}

/** The profile the running host booted from, as the chest sees it. */
export interface ChestProfileView {
  /** Profile name (its directory name). */
  readonly name: string
  /** Absolute profile directory. */
  readonly root: string
  /** Bundle package names in patch-layer order. */
  readonly bundles: readonly string[]
}

/** One complete chest listing. */
export interface ChestSnapshot {
  /** Plugin packages, in chest order. */
  readonly plugins: readonly ChestPluginEntry[]
  /** Skills, in chest order. */
  readonly skills: readonly ChestSkillEntry[]
  /** The booted profile, or null when the host cannot resolve one. */
  readonly profile: ChestProfileView | null
  /** Absolute directory holding plugin packages the chest owns. */
  readonly pluginRoot: string
  /** Absolute user skill root the chest manages. */
  readonly skillRoot: string
  /** Whether a profile mutation is waiting for the next dsh restart. */
  readonly restartRequired: boolean
}

/** Business failure branch shared by every mutating method. */
export interface ChestFailure {
  readonly code:
    | 'invalid-input'
    | 'duplicate-id'
    | 'not-found'
    | 'unsupported-package'
    | 'invalid-bundle'
    | 'profile-unavailable'
    | 'io'
  readonly message: string
}

/** One settled chest mutation: the failure, or the whole listing afresh. */
export type ChestResult =
  | { readonly ok: true; readonly value: ChestSnapshot }
  | { readonly ok: false; readonly error: ChestFailure }

/** One file inside a shareable chest bundle. */
export interface ChestBundleFile {
  /** Bundle-relative path, always forward-slashed and traversal-free. */
  readonly path: string
  /** How `content` encodes the bytes. */
  readonly encoding: 'utf8' | 'base64'
  /** The file body, encoded per `encoding`. */
  readonly content: string
}

/**
 * One shareable chest bundle: a single JSON document carrying a plugin package
 * or a skill directory whole, so sharing is one file and importing is one file.
 */
export interface ChestBundle {
  /** Format marker; a bundle without it is refused. */
  readonly format: 'dsh-chest'
  /** Format revision, so a future reader can migrate rather than guess. */
  readonly revision: 1
  /** Which half of the chest the bundle carries. */
  readonly kind: 'plugin' | 'skill'
  /** Suggested id (folder name) on import. */
  readonly id: string
  /** Human-readable name, for a picker or a log line. */
  readonly name: string
  /** One-line summary. */
  readonly description: string
  /** Export time in epoch millis. */
  readonly createdAt: number
  /** Every file the artifact is made of. */
  readonly files: readonly ChestBundleFile[]
}

/** One settled export. */
export type ChestExportResult =
  | { readonly ok: true; readonly value: ChestBundle }
  | { readonly ok: false; readonly error: ChestFailure }

/** How an import brings a plugin into the chest. */
export interface ChestPluginRequest {
  /** Absolute path of a folder holding the plugin package. */
  readonly path?: string
  /** A bundle body received from another chest. */
  readonly bundle?: ChestBundle
}

/** A skill as authored in the chest dialog. */
export interface ChestSkillDraft {
  /** Frontmatter `name`; also the id source for a new skill. */
  readonly name: string
  /** Frontmatter `description`. */
  readonly description: string
  /** Frontmatter `whenToUse`, omitted when blank. */
  readonly whenToUse?: string
  /** Markdown body below the frontmatter. */
  readonly body: string
  /** Whether to write `disable-model-invocation: true`. */
  readonly userOnly?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The chest changed: a plugin was (un)installed or reordered, or a skill
     * was written or removed. Observers re-list; the payload carries no
     * projection because the listing itself is the authoritative read.
     * @mode emit
     */
    'pluginShelf/change'(): void
  }
}
