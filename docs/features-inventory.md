# Vibe Tasks Feature Inventory

**Audit date:** 2026-06-08
**Purpose:** Source material for a future website section covering built and planned features.
**Scope:** Desktop app, local data model, MCP server, CLI, phone snapshot, install utilities,
documentation, tests, git history, and the live Task Manager board.

This document distinguishes features that exist in the current source tree from roadmap ideas.
It is intentionally stricter than marketing copy: a feature is marked Built only when its
implementation was verified in code, documentation, or tests.

## Audit method and assumptions

The audit used five evidence sources:

1. Current desktop, Rust, MCP, CLI, schema, script, and documentation source.
2. Production builds and automated test results.
3. Git history and release tags for implementation timing.
4. A read-only `audit_board` packet over the live Task Manager board and repository.
5. A reviewed `apply_board_audit` cleanup that previewed changes before applying them atomically.

Assumptions and limits:

- Built means present in the current source tree; it does not guarantee the installed
  `/Applications` bundle has been refreshed.
- Planned status reflects the live board on 2026-06-08 and can change without this document
  changing automatically.
- This was a source, behavior-contract, and build audit. It was not a fresh usability study or a
  manual test of every interaction in the packaged desktop app.
- Board refs are included for traceability and can be removed from final website copy.

## Status vocabulary

- **Built** - implemented in the current source tree.
- **Built with caveat** - implemented, but distribution, platform, or verification limits should
  be stated publicly.
- **Planned** - represented by an active board card with a reasonably concrete direction.
- **Exploratory** - a brainstorm or design direction, not a committed delivery promise.
- **Internal** - reliability, release, or maintenance work that usually should not appear as a
  customer-facing website feature.

## Website-ready overview

### Suggested headline

**A local project board that you and Claude can work from together.**

### Suggested product summary

Vibe Tasks is a local-first macOS project manager built for AI-assisted development. Organize
work across a five-stage Kanban board, capture task context and code scope, visualize
dependencies, and let Claude read or update the same board through MCP. Project state stays in a
local SQLite database, so the desktop app remains the visual command center while Claude uses the
board as durable project memory.

### Suggested feature-card copy

#### Local-first project memory

Projects, tasks, links, notes, and session recaps live in one local SQLite database. The desktop
app and MCP server share the same data without requiring a hosted backend.

#### A board designed for real work state

Move work through Now, Next, Later, Complete, and Dropped. Drag cards between columns, reorder
cards, preserve abandoned ideas without deleting history, and flag work that was reopened.

#### Rich task context

Give every task a title, Brief, Details, priority, type, release version, code paths, symbols,
subtasks, and relationships. Short project-scoped `#N` references make tasks easy to discuss with
both people and agents.

#### Claude works from the same board

The MCP server lets Claude read active work, create and update tasks, manage projects and spaces,
follow dependencies, and write a walk-away recap. Compact reads keep full Details focused on
current work instead of replaying the whole project every turn.

#### Start Claude from a task

Set a repository path once, then launch Claude from a task detail window. Vibe Tasks opens a
terminal session with the task reference and project already in context, then moves the card to
Now.

#### See the shape of the project

Switch from the board to a dependency graph with automatic layered layout. Dependencies, related
work, and parent-subtask relationships use distinct visual styles.

#### Return without reconstructing context

Each project includes autosaving notes and a dated Last session recap. Claude can write the recap
at wrap-up, while the live board remains the source of truth for what is currently open.

#### Organize many projects

Group projects into collapsible, reorderable spaces such as Current projects, Finished projects,
or Open Sourcer. Create, rename, move, and delete projects from the desktop workspace.

#### Audit and reorganize the board safely

Claude can run a read-only board audit that compares active work with closed history,
relationships, metadata, and bounded repository evidence. Reorganizations preview first and apply
as one transaction only after confirmation.

#### Glance from your phone

Export a read-only offline board snapshot to iCloud as HTML and JSON. It remains viewable on a
phone even when the Mac is asleep.

## Recommended website structure

1. **Hero:** lead with the local board shared by the human and Claude.
2. **Primary feature row:** five-stage board, rich task context, Claude through MCP, and
   Start-from-task.
3. **Workflow section:** Board -> task detail -> graph -> Last session recap.
4. **Trust section:** local SQLite, no required cloud account, bounded agent reads, and
   preview-before-confirm board audits.
5. **Secondary utilities:** spaces, command palette, CLI, and phone snapshot.
6. **Roadmap strip:** signed distribution, richer task interaction, notifications, live phone
   view, and easier terminal/repository onboarding.

For the first public page, avoid presenting every implementation utility as an equal feature.
Lead with the board, shared project memory, task launch, graph, and local-first model. Keep CLI,
migrations, Stop hooks, and ABI recovery in a technical or "Built for reliability" section.

## Built feature catalog

### Desktop workspace

| Feature | What is built | Audit status |
| --- | --- | --- |
| Five-stage Kanban | Now, Next, Later, Complete, and Dropped columns with per-column counts. | Built |
| Drag and drop | Cross-column moves, within-column reordering, empty-column drops, and a drag overlay that follows the pointer. | Built |
| Quick task capture | Inline task entry at the foot of every column. | Built |
| Full task capture | Centered New task window with column, priority, type, Brief, and Details; opened by `+ New` or Command-N. | Built |
| Rich task detail | Editable title, Brief, Details, priority, type, version, code paths, symbols, subtasks, and relationships. | Built |
| Safe detail editing | Dirty-field tracking and close-time flushing prevent live refreshes or closing the modal from erasing edits. | Built |
| Task references | Project-scoped `#N` identifiers appear on cards and in agent/CLI reads. | Built |
| Task metadata | Priority, type, source, version, subtask progress, link count, and reopened state appear as card badges. | Built |
| Subtasks | Add subtasks, show completion progress, and toggle subtask completion from the parent detail window. | Built |
| Relationships | Create and remove Depends on and Related links; Blocks is derived automatically. | Built |
| Reopen tracking | Moving work out of Complete stamps it as reopened until it is completed again. | Built |
| Versioned archive | Complete tasks can be grouped into collapsible release/version sections. | Built |
| Completion indicator | The Complete column shows completion progress excluding Dropped work. | Built |
| Source filtering | Filter the board and graph by All, Mine, or Claude's tasks. | Built |

### Projects and organization

| Feature | What is built | Audit status |
| --- | --- | --- |
| Multiple projects | Create, switch, rename, and delete project boards. | Built |
| Project spaces | Create, rename, collapse, reorder, and delete empty project spaces. | Built |
| Project movement | Move a project between spaces without changing its tasks. | Built |
| Duplicate-name guards | Exact duplicate project and space names are prevented or reused safely. | Built |
| Default organization | New databases seed Current projects, Finished projects, and Open Sourcer. | Built |
| Persistent workspace state | Last project, view, filter, panel widths, and window geometry persist locally. | Built |
| Off-screen recovery | Restored windows are clamped and recentered when monitor layouts change. | Built |

### Graph and navigation

| Feature | What is built | Audit status |
| --- | --- | --- |
| Dependency graph | React Flow graph containing tasks, task links, and parent-subtask edges. | Built |
| Automatic graph layout | Dagre produces a top-down layered layout. | Built |
| Relationship edge styles | Dependencies use solid arrows, related links use dashed lines, and subtasks use dotted edges. | Built |
| Graph interaction | Zoom controls, fit-to-view, source filters, and click-to-open task detail. | Built |
| Command palette | Fuzzy command search with keyboard navigation. | Built |
| Palette actions | Switch projects, jump to tasks, create a task, change Board/Graph view, and configure terminal/Claude paths. | Built |

### Notes, recaps, and live updates

| Feature | What is built | Audit status |
| --- | --- | --- |
| Project notes | Per-project freeform notes with debounced autosave. | Built |
| Last session recap | Separate, dated, read-only recap shown above Notes and written through MCP. | Built |
| Live MCP refresh | The app polls SQLite `data_version` and refreshes when another process writes. | Built |
| Optimistic movement | Task and space reordering update immediately before the backend refresh completes. | Built |
| Toast feedback | Launch success, information, and persistent error messages appear in-app. | Built |

### Start-from-task workflow

| Feature | What is built | Audit status |
| --- | --- | --- |
| Per-project repository path | A project can store a validated local directory used for task launch. | Built |
| Start button | Launch Claude from a non-complete task and move that task to Now after the launch request is accepted. | Built |
| Open Claude button | Titlebar button (next to the repo control, shown when `repo_path` is set) that opens a bare Claude session in the project's repo — same terminal launch as Start, but no task, no prompt, and no board change. | Built |
| Ghostty integration | Open tasks as tabs in an existing Ghostty window when possible, with `Project #ref` tab titles. | Built with caveat |
| Generic terminal fallback | Launch through macOS `open` with an argument vector and a safely quoted login-shell command. | Built with caveat |
| Launch validation | Validate repository path and Claude executable before launch. | Built |
| Duplicate-launch protection | UI cooldown plus a 120-second backend guard reduce accidental double launches. | Built |
| Empty-details warning | Ask for confirmation before starting a task that has no Details. | Built |
| Launch settings | Configure terminal application and Claude binary through the command palette. | Built |

The current launch flow confirms that macOS accepted the launch request. It does not yet confirm
that Claude fully started and connected to the intended task.

### Claude and MCP integration

| Feature | What is built | Audit status |
| --- | --- | --- |
| Shared local data | MCP and the desktop app open the same WAL-mode SQLite database. | Built |
| Board reads | Compact board, map, task list, one-task detail, notes, and resume tools. | Built |
| Task writes | Add, bulk-add, update, move, reorder, delete, scope, subtask, and link operations. | Built |
| Project management | List/create/rename/delete projects, reassign tasks between projects, and manage spaces. | Built |
| Board identity guards | Read tools never create a board; typed write targets cannot silently create a duplicate beside existing boards. | Built |
| Project repair | Rename a board, move all tasks between boards, and guard non-empty deletion. | Built |
| Reopened awareness | Compact reads surface tasks moved back out of Complete. | Built |
| Token-focused reads | Now carries capped task detail; map and resume are progressively disclosed and bounded. | Built |
| Walk-away recap | Claude can write a dated recap separately from human notes. | Built |
| Board audit | Read-only audit of active work, closed context, relationships, stale metadata, and bounded Git/path evidence. | Built |
| Atomic audit apply | Preview updates, additions, links, ordering, and recap changes; confirm to apply all changes in one transaction. | Built |
| Self-healing launcher | `mcp/launch.sh` detects `better-sqlite3` ABI mismatch and rebuilds for the selected Node runtime. | Built with caveat |
| Runtime protocol | The MCP server ships concise instructions for board-first agent behavior. | Built |

The measured token reductions documented in `docs/token-reduction.md` are based on a synthetic
100-task project and current response shapes. They are evidence for the access pattern, not a
guarantee for every conversation.

### CLI, phone, and operational utilities

| Feature | What is built | Audit status |
| --- | --- | --- |
| Local CLI | `projects`, `list`, `board`, `now`, `task`, `add`, and `move` commands over the same repository logic. | Built |
| Ref-first shell workflow | CLI reads and writes accept project-scoped `#N` references and return compact output. | Built |
| Scratch database support | CLI accepts an alternate DB path for safe trials. | Built |
| Phone snapshot | Read-only `board.html` and `board.json` export with all projects, spaces, columns, badges, and recaps. | Built |
| Offline phone access | Default iCloud output remains readable after the Mac sleeps. | Built with caveat |
| Automatic snapshot refresh | The project Stop hook regenerates the snapshot in the background. | Built |
| Board hygiene reminder | Print-only Stop hook nudges card capture, status updates, and stale-card pruning. | Built |
| Install helpers | Build/install, fast reinstall, and installed-app staleness check scripts. | Built |
| Local migrations | Node and Rust migration layers preserve existing databases through schema version 9. | Built |
| Per-project refs | Schema version 9 scopes task reference numbers to each project. | Built |

## Planned user-facing features

These items come from active board cards. They are roadmap inputs, not dated commitments.

### Distribution and onboarding

| Planned feature | Website-friendly description | Board |
| --- | --- | --- |
| Signed and notarized macOS release | Install the DMG without Gatekeeper workarounds. | `#28`, Next |
| npm-distributed MCP | Install the MCP package without cloning and building the repository locally. | `#14`, Later |
| First-run terminal setup | Choose a terminal once and use a tested launch recipe for that terminal. | `#62`, Later |
| Native repository folder picker | Replace manual path typing with a macOS folder chooser. | `#66`, Later |
| Verified launch handshake | Confirm that Claude actually started, rather than only confirming that macOS accepted the launch request. | `#65`, Later |

### Richer task interaction

| Planned feature | Website-friendly description | Board |
| --- | --- | --- |
| Task-detail redesign | Improve the task and subtask editing experience beyond the current centered modal. | `#19`, Next, exploratory |
| Conversations on cards | Attach request-and-response discussion to a task. | `#23`, Next, exploratory |
| Faster creation gestures | Explore click and double-click shortcuts for quick versus detailed capture. | `#24`, Next, exploratory |
| Project macro-state | Show what each project is and its lifecycle stage across the workspace. | `#40`, Next, exploratory |

### Session and launch enhancements

| Planned feature | Website-friendly description | Board |
| --- | --- | --- |
| Session notifications | Notify when an agent session needs input and deep-link back to the terminal. | `#17`, Next, exploratory |
| Repository auto-detection | Safely suggest or fill a project's repository path from session context. | `#63`, Later |
| Start from the card | Explore a hover Start affordance without interfering with drag interactions. | `#64`, Later |

### Phone and remote access

| Planned feature | Website-friendly description | Board |
| --- | --- | --- |
| Live read-only phone view | Optional PWA over Tailscale when the offline iCloud snapshot is not fresh enough. | `#54`, Later |

## Internal roadmap and release work

These board items matter to quality and distribution but are usually not website feature cards.

| Work item | Why it matters | Board |
| --- | --- | --- |
| Fail-closed wrong-board writes | Strengthen board identity protection when a write falls back to a folder-derived project. | `#38`, Later |
| One-Node MCP bootstrap | Make every launch path use one pinned Node runtime so ABI drift cannot return. | `#77`, Later |
| Pin development/test Node | Stop tests and the runtime rebuilding `better-sqlite3` for different Node ABIs. | `#60`, Later |
| Version synchronization | Align root, app, MCP, Cargo, and lockfile versions with the Tauri app version. | `#68`, Next |
| Public-history decision | Decide whether to publish current history or create a clean public branch. | `#48`, Next |
| Schema parity rule | Keep `app/src-tauri/schema.sql` byte-identical to `shared/src/schema.sql`. | `#15`, standing rule |
| Website domain | Purchase and configure the eventual landing-page domain. | `#8`, Next |

## Claims not to publish as built

- **No npm/npx installation yet.** MCP installation currently requires a local clone/build.
- **No signed or notarized DMG yet.** The current macOS bundle can trigger Gatekeeper warnings.
- **No live phone editing.** Phone access is a read-only last-synced snapshot.
- **No cloud synchronization or multi-user collaboration.** The product is local-first and
  single-database by design.
- **No launch completion handshake.** Start confirms request acceptance, not a fully running Claude
  session.
- **No native folder picker yet.** Repository paths are entered as text and validated.
- **No session-needs-input notifications yet.**
- **No card conversation/thread model yet.**
- **No npm-hosted public MCP package yet.**
- **No Windows or Linux desktop release is currently documented.** The implemented distribution
  and launch workflows are macOS-focused, with the README currently calling out Apple Silicon.

## Current audit caveats

1. **Version metadata is unified at `1.0.0`** across root, app, MCP, shared, `package-lock.json`,
   Cargo, and `app/src-tauri/tauri.conf.json` for the public launch.
2. **The installed app check reports the `/Applications` copy as stale.** Source capability was
   audited from the repository; the installed bundle should not be assumed to contain every recent
   source-only change until it is rebuilt and reinstalled.
3. **Launch version is `1.0.0`.** Cut a matching `v1.0.0` Git tag at publish (the latest existing
   tag is `v0.5.0`).
4. **Public repository history remains an owner decision.** Board card `#48` tracks whether to
   publish existing history or create a clean public branch.
5. **Some roadmap items are exploratory.** Brainstorm cards should be presented as directions,
   not promises or scheduled releases.
6. **The frontend production build has a bundle-size warning.** The build passes, but the main
   minified JavaScript chunk is about 554 kB before gzip and is a future performance consideration.

## Deliberate non-features

The current product does not aim to provide:

- custom or unlimited workflow columns
- due dates or calendar scheduling
- cloud accounts, authentication, or team collaboration
- a general-purpose chat client
- native mobile editing
- automatic destructive cleanup of stale tasks
- full task bodies in every agent read

The dormant SQLite `todo` table and Rust todo commands are compatibility remnants. The current
desktop UI and MCP workflow use tasks and subtasks instead of presenting Todos as a product
feature.

## Board audit result

The live board was compared with source code, documentation, git history, and repository evidence.
During this audit:

- `#5`, `#6`, `#7`, `#9`, `#10`, `#30`, and `#69` moved to Complete because their work is
  verifiably present.
- `#15` was retained as a standing `rule` card after confirming both schema files are
  byte-identical.
- Planned cards received missing priority, type, Brief, and scope metadata where the intended
  implementation area was clear.
- Distribution, task-interaction, launch, and reliability items were linked into related groups.
- Next and Later were reordered so high-priority release decisions and concrete fixes precede
  exploratory interaction ideas.
- Initial audit findings fell from 45 to isolation-only informational notices; task links increased
  from 7 to 21.

## Evidence and reproducibility

### Primary implementation sources

- Desktop shell and state: `app/src/App.tsx`, `app/src/store.ts`, `app/src/api.ts`
- Board and cards: `app/src/components/Board.tsx`, `Column.tsx`, `Card.tsx`
- Task editing: `app/src/components/TaskDetail.tsx`, `NewTaskModal.tsx`
- Project organization: `app/src/components/Sidebar.tsx`
- Graph: `app/src/components/GraphView.tsx`
- Commands and task launch: `app/src-tauri/src/commands.rs`
- Window recovery: `app/src-tauri/src/geom.rs`, `app/src-tauri/src/lib.rs`
- Database and migrations: `mcp/src/db.ts`, `app/src-tauri/src/db.rs`, `shared/src/schema.sql`
- MCP contract: `mcp/src/tools.ts`, `mcp/src/server.ts`, `mcp/src/repo.ts`
- Board audit: `mcp/src/audit.ts`
- CLI and phone export: `mcp/src/cli.ts`, `mcp/src/snapshot.ts`
- Operational scripts: `mcp/launch.sh`, `scripts/install-app.sh`, `scripts/app-check.sh`,
  `scripts/stop-reminder.sh`

### Audit commands

Verification completed on 2026-06-08:

- MCP tests: 80 passed.
- Rust tests: 14 passed.
- MCP TypeScript build: passed.
- Frontend TypeScript/Vite production build: passed with the bundle-size warning recorded above.
- Schema parity: `app/src-tauri/schema.sql` and `shared/src/schema.sql` were byte-identical.
- Installed-app check: reported the `/Applications` bundle as stale.

```bash
npm run mcp:test
npm run mcp:build
npm -w app run build
cargo test --manifest-path app/src-tauri/Cargo.toml
npm run app:check
cmp app/src-tauri/schema.sql shared/src/schema.sql
```

### Maintenance guidance

Refresh this document before publishing website claims or cutting a public release. Re-run the
board audit, verify the source paths above, reconcile version metadata, and move any newly shipped
roadmap cards to Complete before changing Planned copy to Built.
