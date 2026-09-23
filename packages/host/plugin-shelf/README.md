# @deepseek-ai/dsh-host-plugin-shelf

The **chest**: the Host half of the sidebar's plugin-and-skill vault. Everything
a person downloads, authors, or develops for this harness lands here, in two
groups that are both real artifacts on disk rather than text a model is asked to
pretend with.

## What a chest holds

- **plugin** — a directory holding a DSH plugin package: `package.json`, a
  `cordis.patch.yml` patch layer, and optionally a browser half. The chest owns a
  store under `$DSH_HOME/chest/plugins` and can also register a folder in place
  (a plugin someone is developing). Installing one means three concrete profile
  edits — a `link:` dependency, the bundle name in `dsh.profile.bundles`, and the
  `node_modules` link — so install, uninstall, and reorder are real composition
  changes that apply on the next restart. The chest reports that pending restart
  instead of pretending the running process already changed.
- **skill** — a `SKILL.md` under the user skill root (`$DSH_HOME/skills`), the
  same file the `skill` tool and the `/name` composer reference discover. A skill
  authored here is therefore immediately a real skill, and a skill someone shares
  drops into any skill root.

Either kind exports to one `.chest` document: a single JSON file carrying every
byte of the artifact, which this gateway imports back.

## Where the files live

| path | owner | what it is |
| ---- | ----- | ---------- |
| `$DSH_HOME/chest/chest.json` | this package | bookkeeping: registered external folders, presentation order, pending restart |
| `$DSH_HOME/chest/plugins/<id>/` | this package | plugin packages the chest owns |
| `$DSH_HOME/skills/<id>/SKILL.md` | this package (writes), `dsh-skill-filesystem` (reads) | authored skills |
| `$DSH_HOME/profiles/<name>/package.json` | the deployment (this package edits it on install) | the bundle layer order an install changes |

## Remote surface

The service registers itself as `ctx.pluginShelf` and publishes the
`pluginShelf` namespace:

| method | request | response |
| ------ | ------- | -------- |
| `list` | — | `ChestSnapshot` (plugins, skills, booted profile, pending restart) |
| `importPlugin` | `ChestPluginRequest` (folder path or `.chest` bundle) | `ChestResult` |
| `installPlugin` | `id` | `ChestResult` (profile dependency + bundle layer + link) |
| `uninstallPlugin` | `id` | `ChestResult` |
| `deletePlugin` | `id` | `ChestResult` (uninstalls first; deletes a store copy's bytes) |
| `reorderPlugins` | `ids` | `ChestResult` (also reorders the profile's bundle slots) |
| `exportPlugin` | `id` | `ChestExportResult` (one `.chest` document) |
| `createSkill` | `ChestSkillDraft` | `ChestResult` |
| `importSkill` | `ChestBundle` | `ChestResult` |
| `updateSkill` | `id` + `ChestSkillDraft` | `ChestResult` (keeps the shape the scan found) |
| `deleteSkill` | `id` | `ChestResult` |
| `reorderSkills` | `ids` | `ChestResult` (presentation order only; skills have no composition order) |
| `exportSkill` | `id` | `ChestExportResult` (entry file plus resources) |

Every mutating method answers with the whole listing afresh, so a client needs
one round trip per action. Mutations are serialized behind one queue and emit
`pluginShelf/change`; a chokidar watcher over the plugin store, the skill root,
and the profile manifest emits the same event (debounced) for edits made outside
the chest.

## A bundle is the sharing format

A `.chest` document is `{ format: 'dsh-chest', revision: 1, kind, id, name,
description, createdAt, files }`, where each file carries a forward-slashed
relative path and either `utf8` or `base64` content. Import refuses a document
that is not that shape, and refuses any path that would escape the target
directory, so a shared file can never write outside the chest.

## Configuration

| key | type | default | description |
| --- | ---- | ------- | ----------- |
| `root` | `string` | `dshHomePath('chest')` | Chest root holding the store and bookkeeping |
| `skillRoot` | `string` | `dshHomePath('skills')` | User skill root the chest manages |

## Model Experience

### Skill files the chest writes

#### What the model sees

Nothing from this package directly: it registers no tool, prompt section, or catalog. What it writes is a `SKILL.md` in the user skill root, and `dsh-skill-filesystem` discovers that file for whichever preset mounts it, so a skill authored here reaches the model through that provider's catalog rather than through any surface of the chest.

#### Token effect

None from the chest itself: listing, reordering, exporting, and importing add no tokens to a request. A chest-authored skill costs tokens only when the agent loads it or a `/name` pick injects its body, and that cost belongs to the skill pipeline.

#### KV Cache effect

None. This package never edits earlier request tokens; it only reads and writes files on disk.

## Known Limitations and Deferred Work

- **A restart applies plugin changes** — the Loader composes its bundle layers at
  boot and caches each package's client metadata for the process lifetime, so
  installing, uninstalling, or reordering a plugin becomes visible only after
  `dsh web` restarts. The chest says so rather than implying otherwise.
- **No dependency resolution** — an install records a `link:` dependency and
  creates the `node_modules` link itself; it never runs a package manager, so a
  plugin that needs its own dependencies must ship them or be installed by hand.
- **Store plugins are one level deep** — the store holds package directories
  directly; a nested folder is not scanned.
- **Skills are managed at the user root only** — project roots
  (`.dsh/skills`, `.agents/skills`) and `~/.agents/skills` stay read-only for the
  chest even though the provider reads them.
