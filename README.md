# Vibe Tasks

A local-first desktop **project manager for vibe coders** — Kanban board, notes, a walk-away
recap, and a task-dependency graph — that **Claude Code can drive directly**. Your hand-made
projects and Claude's live side by side in one workspace.

Its defining idea: the board is **external memory for your AI**. Claude reads a compact
snapshot of what's in flight instead of re-reading files and re-narrating status, so a long
session burns far fewer tokens.

See [`docs/token-reduction.md`](docs/token-reduction.md) for measured payload reductions and the
Claude Code usage pattern that unlocks them.
See [`docs/features-inventory.md`](docs/features-inventory.md) for the audited, website-ready
catalog of built features, planned features, internal roadmap work, and public-claim caveats.

---

## Why use it

- **Local-first project memory** — project state lives in your SQLite database, not in a long chat
  transcript or a cloud service.
- **Claude can work the board directly** — the MCP server gives Claude tools to create, move,
  link, recap, and read tasks while the desktop app stays your visual command center.
- **Board-wide audits with review gates** — Claude can inspect active and closed work,
  relationships, stale metadata, and repository evidence, then preview an atomic reorganization
  before anything changes.
- **Token-lean context** — Claude reads compact cards first, relationship maps only when needed,
  and one full task body at a time.
- **Reversible local CLI** — optional `vibetasks` commands reuse the same MCP repo logic for
  compact reads and ref-first writes; no raw SQLite write scripts or schema changes.
- **Human-readable status** — the app is the status surface, so Claude can stop narrating every
  detail in chat.
- **Portable protocol** — copy `docs/vibetasks-claude-protocol.md` into another repo's
  `CLAUDE.md` to teach Claude the same board habits.

## What it does

- **Kanban board** — Now / Next / Later / Complete / Dropped, drag-and-drop cards (the dragged
  card follows your cursor across columns), per-column counts, a completion bar on Complete. The
  board scrolls sideways and each column scrolls its own cards when space is tight.
- **Notes & "Last session" recap** — an auto-saving notes pad per project, plus a read-only, dated recap of where you left off (Claude writes it at wrap-up via `set_recap`).
- **Multiple projects** — switch in the left rail. Claude-made and hand-made items coexist: a
  **✦** marks Claude's, and an **All / Mine / Claude's** filter narrows everything.
- **Project spaces** — group boards into collapsible, user-defined sections in the left rail.
  New databases start with **Current projects**, **Finished projects**, and **Open Sourcer**;
  create/rename/delete empty spaces, add projects directly inside one, or move a project between
  spaces without changing its tasks.
- **Task detail** — a centered floating window with **Brief** (one-line handle), **Details** (full body), priority, **type** (fix / feature / chore / rule / docs), **code refs** (the files/symbols a task touches),
  **subtasks**, and **dependency links** (depends-on / blocks / related). Click any card to open it; Esc or click-away to close.
- **Adding tasks** — a fast inline **+ Add a task** at the foot of every column, plus a floating **New task** window for full capture (title, column, priority, type, Brief, Details) opened from the titlebar **+ New** button or **⌘N**.
- **Reference numbers** — every task has a stable `#N` you can use to refer to it ("work on #42"); `list_tasks` (MCP) prints them all.
- **Versioned archive** — tag completed tasks with a `version` (e.g. `v0.4.0`); the Complete column groups them into collapsible per-release sections (newest open, older collapsed) so it never becomes an endless pile.
- **Start button** (macOS) — a **▶ Start** button in the task detail panel. Set the repo path once per project (📁 in the sidebar), then one click opens your terminal at that repo with Claude Code already working the task. The card moves to **Now** the moment the launch request is accepted; every outcome surfaces as an in-app toast. **If the card's paths include a committed plan file** (any `…/plans/*.md`), the launch prompt tells the session to execute that existing plan instead of re-planning — so a plan written in one session is run, not re-derived, on the next Start. **Ghostty, Terminal.app, and iTerm2 are all first-class** (each has a real launch recipe); pick the default from the **⚙ Settings** block at the bottom of the sidebar. Choosing **Custom…** lets you point at any other terminal via a best-effort macOS `open` fallback that isn't guaranteed. The Claude binary path is set in that same Settings block (or ⌘K → "Set Claude binary…").
- **Open Claude button** (macOS) — an **Open Claude** button next to the 📁 repo button in the titlebar (shown once the project's repo path is set). Same launch path as Start (and the same Ghostty / Terminal.app / iTerm2 / Custom terminal choice) — a fresh session/tab at the repo with Claude Code — but with **no task, no prompt, and no board change**; just a fresh Claude session in the project.
- **Graph view** — the whole project as a dependency + subtask graph.
- **Live sync** — when Claude writes via the MCP, the window updates within ~0.6s, no reload.
- **Reopen tracking** — move a task out of **Complete** and it's flagged *reopened*, so Claude
  notices and investigates what's left unfinished before moving on.
- **Remembers its window** — the app reopens at the size and position you left it.

## How it works

One SQLite database (WAL mode) at `~/.vibetasks/vibetasks.db` is the single source of truth.
Two independent clients open it directly:

- **Desktop app** — Tauri (Rust + `rusqlite`) + React. Polls `PRAGMA data_version` to
  live-refresh.
- **MCP server** — Node + `better-sqlite3`. The piece you install into Claude Code.

They never talk to each other — they just share the file. So Claude can manage your board
**whether or not the app is open**; changes show up the next time you open it (or live, if it's
already open).

```
            ┌─────────────────────────┐
 You ──────▶│  Vibe Tasks desktop app │──┐
            └─────────────────────────┘  │      ~/.vibetasks/vibetasks.db
                                          ├────▶  (SQLite / WAL —
            ┌─────────────────────────┐  │        single source of truth)
 Claude ──▶ │  vibetasks MCP server   │──┘
            └─────────────────────────┘
```

---

## Quick start

> **Platform:** macOS on Apple Silicon (arm64). The launcher, packaging, and `/Applications`
> install flow are macOS-only, and the prebuilt `.dmg` is `aarch64`.

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 18, the [Rust toolchain](https://rustup.rs)
(`cargo`, for the Tauri backend), and Xcode Command Line Tools (`xcode-select --install`).

```bash
git clone <repo-url> vibe-tasks
cd vibe-tasks
npm install
npm run mcp:build        # builds mcp/dist/server.js (needed for Claude integration)
```

## Opening the app

Any of these:

- **Double-click `Launch Vibe Tasks.command`** in this folder (easiest).
- `npm run app` — launch in dev mode from a terminal.
- **Build a real installable app:** `npm run app:build`, then `npm run app:open`. The bundle
  lands at `app/src-tauri/target/release/bundle/macos/Vibe Tasks.app` — drag it into
  /Applications and open it like any other app.
- **Build + install into `/Applications` in one shot:** `npm run app:install` (rebuilds, then
  replaces `/Applications/Vibe Tasks.app`). Use `npm run app:install:fast` to install the existing
  build without rebuilding, and `npm run app:check` for a free, print-only "is the installed app
  stale?" check (compares the installed build against the latest `app/` commit — it never builds).
  The Rust release build is slow, so installing is an explicit step, not a commit hook.

A project **Stop hook** (`.claude/settings.json` → `scripts/stop-reminder.sh`) prints a once-per-session,
non-blocking reminder when a Claude session ends: a board-hygiene nudge (*board-over-chat* — do the
cards reflect what was proposed/started/finished?) plus the `app:check` staleness result. It only
reminds — it never builds, blocks, or edits the board.

### Installing from the `.dmg`

`npm run app:build` also produces a disk image at
`app/src-tauri/target/release/bundle/dmg/Vibe Tasks_<version>_aarch64.dmg`. Open it and drag
**Vibe Tasks** into **Applications**.

The build is **not yet code-signed / notarized**, so Gatekeeper will warn on first open. Either:

- **Right-click the app → Open** (then confirm) — only needed once, or
- `xattr -dr com.apple.quarantine "/Applications/Vibe Tasks.app"` to clear the quarantine flag.

To ship a notarized `.dmg` (no warning), set an Apple **Developer ID** signing identity + an
app-specific password and run the standard `codesign`/`notarytool`/`stapler` flow on the bundle
before packaging.

> Your data lives in `~/.vibetasks/vibetasks.db` regardless of where the app is installed — the
> install location never affects which board you see.

First launch compiles the Rust backend (~30s); after that it's fast.

---

## Using it WITH the app open

- Click a project in the left rail, or use **+ Project** inside a space.
- Use the **Spaces** headings to collapse project groups, create another section, rename one, or
  move a project with the row's space picker. Existing projects migrate into **Current projects**.
- Drag cards between **Now / Next / Later / Complete / Dropped**; drag within a column to reorder.
  The card follows your cursor as you drag it across columns.
- Click a card to edit it: Brief, Details, priority, code refs, subtasks, and links.
- Toggle **Board / Graph** in the title bar; filter **All / Mine / Claude's**; press **⌘K** for
  the command palette.
- Type project notes on the right — notes autosave.
- Anything Claude does through the MCP appears live.

## Using it WITHOUT the app open (Claude Code)

This is the main event. Install the MCP server once:

```bash
npm run mcp:build
claude mcp add vibetasks -- sh "/abs/path/to/vibe-tasks/mcp/launch.sh"
```

Register via `sh …/launch.sh`, **not** `node …/dist/server.js`. `launch.sh` is a self-healing
wrapper: `better-sqlite3` ships a native addon ABI-locked to one Node major, so launching the
server under a different Node than its deps were built for fails with `ERR_DLOPEN_FAILED` and the
MCP appears "down".

**The MCP server is pinned to Node 22 (LTS).** That is the version it is developed and tested
against, and the version it should run under. On a multi-Node machine (nvm + Homebrew side by
side), set `VIBETASKS_NODE` to an absolute **Node 22** binary so the server is independent of
whatever a session's `PATH` resolves to — and stable across `brew upgrade`, which silently
major-bumps Homebrew's `node` and re-breaks the addon:

```bash
claude mcp add vibetasks --env VIBETASKS_NODE=/abs/path/to/node22 -- sh "/abs/path/to/vibe-tasks/mcp/launch.sh"
```

> **Why pin instead of "use the latest Node":** the only thing that cares about the Node version
> is the `better-sqlite3` native addon, which must be rebuilt for each Node **major**. Pinning to
> one LTS (Node 22) ends that churn; chasing the newest (non-LTS) Node re-breaks the addon on every
> 6-month major bump and often lacks prebuilt binaries. `launch.sh` auto-rebuilds the addon once if
> it ever detects a mismatch.

Now, in any Claude Code session, Claude can:

- create / rename / delete projects, and reassign all tasks between projects (the "merge" half) —
  so a misnamed or duplicate board is fixable without SQL
- list/create/rename/delete project spaces and move projects between them; `create_project` accepts
  an optional `space`, otherwise new boards land in **Current projects**
- add / move / reorder / delete tasks, update task fields (title, Brief, Details, …) via `update_task`; set priority + kind; add subtasks; set code refs; link tasks
- set project notes, and write the walk-away "Last session" recap (`set_recap`)
- audit non-complete/non-dropped work with `audit_board`, then dry-run and atomically apply a
  reviewed cleanup with `apply_board_audit` (`confirm:true` is required to write)
- read the board compactly (`get_board`), the relationship map (`get_map`), the full detail of
  one task (`get_task`), or cheaply rehydrate after `/clear` (`resume`; pass `include_map:true`
  only when relationships are needed)

**Task prose contract:** product/UI/MCP language is **Title / Brief / Details / Scope**. Brief is
the one-line map-visible handle (capped at 240 chars); Details is the optional full body. The
SQLite columns remain `summary` and `description` for compatibility, and the MCP still accepts
those legacy aliases, but new agent/tool usage should prefer `brief` and `details`. This is
reversible without a schema migration because only labels, validation, and tool aliases changed.

Claude writes straight to `~/.vibetasks/vibetasks.db`. **The app doesn't need to be running** —
open it whenever you want to *see* the state. If it's open, you watch changes happen live.

### Optional local CLI (reversible)

The MCP package also builds a small `vibetasks` CLI for shell workflows. It is a facade over the
same `mcp/src/repo.ts` logic as the MCP tools: writes go through the same project guards,
`#ref` lookup, reopened handling, WAL/busy-timeout setup, and tiny acknowledgements. It does **not**
write raw SQL and it adds **no schema migration**, so backing it out is just removing the CLI file,
bin/script entries, tests, and docs; existing boards are untouched.

```bash
npm run mcp:build
npm run vibetasks -- board --project "Task Manager"
npm run vibetasks -- task "#42" --project "Task Manager"
npm run vibetasks -- add "Fix launch crash" --project "Task Manager" --kind fix --priority high
npm run vibetasks -- move "#42" complete --project "Task Manager"
```

Use `--db /tmp/scratch.db` to test against a throwaway database before touching your real board.
Reads still consume tokens when their stdout is given to an agent; the CLI's token value is compact
line output, ref-first writes, and `ok #N` acks.

By default Claude's tasks land in a project named after your current working-directory folder
(auto-created), so each repo maps to its own board. Pass an explicit `project` to target another.
Creating a project with an existing exact name reuses that project; renames that would duplicate
another board are refused. Space names have the same exact-name guard; non-empty spaces cannot be
deleted, and the default Current space is protected.

**Board-identity safety (no stray empty boards):** read tools (`get_board`, `get_map`,
`list_tasks`, `resume`, `get_notes`) **never create** a board — an unknown name errors and lists
the boards that exist, so a mistyped or guessed name can't silently mint an empty duplicate. Write
tools still bootstrap a fresh repo's board from the directory name, but they **refuse to create a
board from a typed `project` name while other boards already exist** (that's almost always a typo
for one of them) — make a genuinely new board explicitly with `create_project`.

### Teaching your agent the board protocol

Vibe Tasks works best when your coding agent knows the board habits: read the board compactly
(titles for all tasks, full detail only for the **Now** column), read only a task's code refs
before editing, keep replies terse (the board is the status), `resume` after `/clear`, and
**investigate any task that's reopened** (moved back out of Complete).

You get this two ways, and you don't have to do anything for the first:

1. **Automatically** — the MCP server ships a compact runtime version of this protocol in its own
   instructions, so the moment the server is connected your agent has the core habits (no per-turn
   schema cost beyond the tool definitions).
2. **For the full habit loop** — copy
   [`docs/vibetasks-claude-protocol.md`](docs/vibetasks-claude-protocol.md) into your agent's
   instructions file: `CLAUDE.md` for Claude Code / Claude Desktop / Cowork (per-project or the
   global `~/.claude/CLAUDE.md`), or `AGENTS.md` for Codex.

That shareable doc is the canonical protocol. This repository's own `CLAUDE.md` / `AGENTS.md` are
the maintainer's internal working files and are intentionally **not** shipped — copy the shareable
protocol into *your* instructions file instead.

### Using Vibe Tasks in Claude Cowork

[Claude Cowork](https://www.anthropic.com/product/claude-cowork) can't register a local stdio MCP
server directly, but **Claude Desktop bridges it in for you**: configure `vibetasks` in Claude
Desktop (the same local MCP setup as above) and Desktop proxies it into Cowork automatically (it
appears there as an `sdk`-type server). Your board data stays local — Desktop runs the server
process on your Mac. So Vibe Tasks works in **Claude Code, Claude Desktop, and Cowork (via the
Desktop bridge)** today. Fully *native* Cowork / claude.ai web / mobile access would require running
this as a remote MCP server, which is a separate future direction (board `#86`).

---

## Why it saves tokens

- `get_board` returns a compact card for every task, including subtasks and `has_details`, but the
  full Details body only for the **Now** column (capped) — per-turn context stays roughly flat as
  the project grows.
- **Three-tier disclosure:** title/card → `get_map` (capped Briefs + deps + capped code refs +
  `has_details`) → `get_task` (full body). Claude pulls detail only when it actually needs it.
- Write tools return tiny acks — they never re-dump the whole board.
- The app is your read channel, so Claude narrates progress less.
- `resume(project)` rehydrates a fresh session without the relationship map by default; pass
  `include_map:true` only when the map is needed.

Measured on a synthetic 100-task project, `resume()` was about **94% smaller** than a full task
dump, `get_board()` about **89% smaller**, and `resume({ include_map:true })` about **80% smaller**.
These are payload-size measurements, not a guarantee for every session; total savings depend on
project shape and Claude following the board-first protocol.
See the full measurement table and setup instructions in
[`docs/token-reduction.md`](docs/token-reduction.md).

## Status, Safety, And License

- **Status:** personal/local-first project, usable now, still evolving. Expect rough edges around
  packaging, signing, and distribution.
- **Platform:** macOS on Apple Silicon (arm64) only. The desktop app, packaging, `/Applications`
  install, and the ▶ Start / Open Claude launchers are macOS-specific (Tauri bundle + AppleScript);
  there is no Windows or Linux build.
- **Terminal launches:** the ▶ Start and Open Claude buttons support **Ghostty, Terminal.app, and
  iTerm2** as first-class targets (chosen in the sidebar ⚙ Settings block). Pointing them at any
  other terminal via **Custom…** uses a best-effort macOS `open` fallback that isn't guaranteed.
- **Local data:** by default data is stored at `~/.vibetasks/vibetasks.db`. The app does not
  encrypt that database; use normal OS account security and backups for anything sensitive.
- **No cloud sync:** the desktop app and MCP server share one local SQLite file. Nothing is sent to
  a Vibe Tasks service.
- **macOS signing:** release builds are not currently code-signed or notarized, so Gatekeeper will
  warn on first open.
- **MCP distribution:** install from a local build today; no npm/npx package has been published
  yet.
- **Token savings:** measured payload reductions are real for the tested MCP response shapes, but
  total chat savings depend on how Claude uses the protocol. Tiny one-off tasks can be break-even
  or more expensive because MCP tool schemas have fixed overhead.
- **Affiliation:** this project integrates with Claude Code through MCP, but it is not affiliated
  with Anthropic, OpenAI, or any Claude/OpenAI product.
- **License:** **PolyForm Noncommercial 1.0.0** — you may download, use, modify, and share Vibe
  Tasks for any **noncommercial** purpose, but **commercial use is not permitted**. See
  [`LICENSE`](LICENSE).

## Viewing the board on your phone (read-only)

Vibe Tasks is local-first — your board lives in a SQLite file on your Mac, and that's
deliberate. To **glance at the board from your phone** without giving up that model, the
MCP package ships a read-only snapshot exporter:

```
npm run phone:snapshot
```

It opens the database **read-only** (it never writes, never holds a lock — writes stay
Claude-on-Mac) and emits a fully self-contained, offline `board.html` plus a machine-readable
`board.json` into your iCloud Drive (`iCloud Drive/VibeTasks/`). Open `board.html` from the
**Files** app on your phone — it renders every project's columns (Now/Next/Later/Complete/
Dropped) with priority/kind/version badges and the per-project "Last session" recap. Because it
lands in iCloud, it syncs to the phone and stays viewable **even when the Mac is asleep**
(showing the last-synced state).

It refreshes **automatically on every turn-end** via the project's `Stop` hook
(`scripts/stop-reminder.sh`), so what you see on the phone tracks the board as Claude works it.
Override the output directory with `VIBETASKS_SNAPSHOT_DIR`.

> Read-only by design. Editing from the phone (a live server reachable over Tailscale) is a
> deliberate later step, not part of this snapshot — see the design notes under `docs/`.

## Data & configuration

- **Database:** `~/.vibetasks/vibetasks.db`. Override with the `VIBETASKS_DB` env var — set it
  for **both** the app and the MCP server so they share the same board.
- **Board name per project:** set `VIBETASKS_PROJECT` (e.g. `claude mcp add vibetasks --env
  VIBETASKS_PROJECT="My App" -- sh …/launch.sh`) so a session always targets the right board
  regardless of its working directory. Without it, calls fall back to the directory name, and the
  server refuses to auto-create a board from a uuid-looking worktree/temp dir.
- **Schema:** canonical in `shared/src/schema.sql`. The Tauri app embeds a synced copy at
  `app/src-tauri/schema.sql` — keep the two identical.
- **Phone snapshot:** written to `iCloud Drive/VibeTasks/` by default; override with
  `VIBETASKS_SNAPSHOT_DIR`. See "Viewing the board on your phone" above.

## Repo layout

```
shared/   canonical schema.sql + shared TypeScript types
mcp/      MCP server (Node) — CRUD + token-efficient reads
app/      Tauri desktop app (Rust backend + React/Vite frontend)
scripts/  seed-demo.mjs, install/check scripts, stop-reminder.sh (board nudge + phone snapshot)
docs/     token-reduction notes, features inventory, shareable Claude protocol
```

## Scripts

| Script               | Does                                  |
| -------------------- | ------------------------------------- |
| `npm run app`        | Launch the app (Tauri dev)            |
| `npm run app:build`  | Build an installable `.app`           |
| `npm run app:open`   | Open the built `.app`                 |
| `npm run app:install`| Build **and** (re)install into `/Applications` |
| `npm run app:install:fast` | Install the existing build (no rebuild) |
| `npm run app:check`  | Print-only: is the installed app stale? |
| `npm run mcp:build`  | Build the MCP server                  |
| `npm run mcp:test`   | Run the MCP test suite                |
| `npm run vibetasks -- board` | Run the optional local CLI after `mcp:build` |
| `npm run phone:snapshot` | Export a read-only `board.html`/`board.json` to iCloud for phone viewing |
| `npm run seed:demo`  | Seed a demo project into the database |

## Troubleshooting

- **Blank window after editing frontend code:** press **⌘R** in the window to reload the
  frontend from Vite.
- **App and Claude show different data:** ensure both use the same DB path (default
  `~/.vibetasks/vibetasks.db`, or the same `VIBETASKS_DB`).
- **`cargo: command not found` when launching manually:** run `source "$HOME/.cargo/env"`
  first (the double-click launcher already does this).
