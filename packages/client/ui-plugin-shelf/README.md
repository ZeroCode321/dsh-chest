# @deepseek-ai/dsh-client-ui-plugin-shelf

The **chest** in the DeepSeek Harness web GUI sidebar: a `plugin` group and a
`skill` group over one scroll region, each row opening a dialog that carries
every action for that artifact — install or uninstall, move up or down, export,
delete. No copy in this section carries emoji; every glyph is an icon atom.

The data lives on the Host (`@deepseek-ai/dsh-host-plugin-shelf`); this package
holds a client-side snapshot refreshed from the `pluginShelf` Remote on load, on
`pluginShelf/change` notifications, on connection resets, and from the listing
every mutation returns. The snapshot is published to the section through the
inject `hooks` compartment (`useChest`), together with the module names the
plugin inventory reports as active — that is how a row distinguishes "installed
and running" from "installed, restart to apply". The `@` source reads the same
snapshot synchronously, so candidate filtering never issues an RPC per keystroke.

## Sidebar section

The `sidebar.plugins` hole is declared by `@deepseek-ai/dsh-client-ui-sidebar`
between the workspace browser and the sidebar foot. The section is wide-only: the
56px rail hides it. The header is the fold control: the chest opens on a click and
otherwise stays one row, with the entry count beside the label and a
pending-restart line kept visible even while folded. The fold is a browser
preference persisted in `localStorage` (`dsh.chest.expanded`), so a folded chest
stays folded across reloads. Each group header carries its own `+` (add a plugin
folder or import a `.chest` file; author a skill or import a shared one), and the
header keeps a refresh affordance.

## '@' invocation

Typing `@` in the composer opens the trigger menu; the chest group lists skills
and plugins filtered by the typed query. The two kinds pick differently because
they are different things:

- a **skill** pick lands `/<name> `, the reference the skill pipeline already
  understands, so the chest only shortens the trip to a skill's name;
- a **plugin** pick lands the package name and its directory, because a plugin is
  code the agent works *on* rather than text it acts out.

The source also provides a lexicon, so a manually typed name is decorated in the
draft the way the subagent reference source is.

## Export and import

Export asks the Host for a `.chest` document and hands it to the browser as a
download (`<id>.chest`). Import reads a picked file and sends it back over the
same Remote, which is how a shared plugin or skill arrives. Neither path adds a
prompt section or a tool.

## Model Experience

### Text the chest lands in the user draft

#### What the model sees

An `@` pick inserts ordinary user draft text (a `/name` reference for a skill, a package name and directory for a plugin); the model sees whatever the user actually sends. The sidebar listing, the dialogs, and the export/import helpers add no prompt section and register no tools or schemas.

#### Token effect

Conditional and append-only: a picked reference adds tokens only to the new user message it is sent in. Browsing, reordering, installing, exporting, and importing add zero model tokens.

#### KV Cache effect

Append-only. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

- **Whitespace in names** — the `@` trigger token cannot span whitespace, so a
  multi-word skill or package name must be picked from the filtered menu rather
  than typed to completion.
- **Install state is a two-part truth** — the listing says what the profile
  records and the inventory says what the process loaded; a mismatch is shown as
  "restart to apply" rather than resolved, because only a restart resolves it.
- **No drag-and-drop ordering** — order moves one slot at a time through the
  dialog's move actions.
