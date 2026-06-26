# Vibe Tasks — desktop app

The Tauri desktop app (Rust backend + React/Vite frontend) for **Vibe Tasks**. See the
repository root [`README.md`](../README.md) for what it is, how to run it (`npm run app`),
and how the board pairs with the installable MCP server.

For the Claude Code token-reduction workflow, see
[`docs/token-reduction.md`](../docs/token-reduction.md). The app is the human-readable side of
that workflow: Claude keeps project state on the board, and the MCP reads compact snapshots instead
of replaying the whole project in chat.

## Layout

- `src/` — React frontend: the dnd-kit Kanban board (Now / Next / Later / Complete / Dropped,
  each column scrolls its own cards), the React Flow dependency graph, the centered floating
  task-detail and **New task** windows (a shared `.modal-*` shell — see `TaskDetail.tsx` /
  `NewTaskModal.tsx`), command palette, a space-grouped/collapsible project rail, and the Zustand
  store.
- `src-tauri/` — Rust backend (`rusqlite`) that opens the shared `~/.vibetasks/vibetasks.db`
  and exposes Tauri commands; embeds a copy of `shared/src/schema.sql` (keep the two in sync).

## Notes

- Window size + position persist across launches via `tauri-plugin-window-state`.
- Panel sizes (sidebar / right) and last project/view/filter persist in
  `localStorage`.
- **Board search + last-viewed highlight** — a transient store `search` field drives an in-place
  board filter (`matchesSearch` in `Board.tsx`: ref-prefix, title, and brief+details body, AND-combined
  with the All/Mine/Claude filter) fed by the titlebar `SearchBar` (⌘F to focus, Esc to clear); matched
  title substrings are bolded. Selection is split into `selectedTaskId` (drives the modal) and
  `highlightedTaskId` (the board's last-viewed mark): opening a card sets both, closing the modal leaves
  the mark, opening another card moves it, and a click on empty board space (the `board-shell` handler in
  `Board.tsx`) clears it via `clearHighlight`. Both are client UI state — not persisted, not
  snapshot-derived.
- Creating a project with an existing exact name returns the existing project; renames that would
  duplicate another board are refused.
- Projects are grouped into persistent spaces. Migration v7 seeds **Current projects**,
  **Finished projects**, and **Open Sourcer**, and assigns every existing project to Current.
  The rail supports space create/rename, empty-space delete, project creation within a space, and
  project moves. The default Current space cannot be deleted.
- Task text uses **Brief / Details** in the UI. These are compatibility labels over the existing
  SQLite `summary` / `description` columns, so reverting the label/tool patch does not require a
  database migration.
- The optional `vibetasks` CLI is an additive shell facade over the same MCP `repo.ts` logic. It
  can read compact board lines and perform ref-first writes, but it adds no app surface and no
  schema migration; remove the CLI file/bin/script/docs to roll it back without touching board data.
- `audit_board` and `apply_board_audit` are MCP-only orchestration tools over the existing task,
  link, ordering, and recap tables. They add no app UI or schema migration; confirmed batches
  appear through the existing `data_version` live refresh like any other MCP write.
- Token savings depend on keeping only active work in **Now**, filling task code refs, and letting
  Claude use `get_board`, `resume`, `get_map`, and `get_task` progressively through the MCP.
- Distribution status lives in the root README: the macOS `.dmg` is unsigned and not notarized
  today (so first launch needs a one-time Gatekeeper bypass — see the root README's *Installing from
  the `.dmg`* section; a signed/notarized build is planned once an Apple Developer cert is
  available), and the repo is licensed under PolyForm Noncommercial 1.0.0 (noncommercial use only).
- First launch compiles the Rust backend (~30s); after that it's fast.
- **Start button** — the task detail panel shows **▶ Start in \<terminal\>** for tasks that are not complete. Clicking it opens the terminal at the project's repo path with Claude Code pre-loaded with a task prompt, then moves the card to Now. The launch prompt is built by `build_start_prompt` (in `commands.rs`): the base is the minimal `work task #N on the '<project>' Vibe Tasks board`, but when the card's `paths` contain a committed plan file (`plan_path_in` matches any `…/plans/*.md`, tool-agnostic), it appends a pointer telling the session to read and execute that existing plan instead of re-planning. Phrased without naming a specific skill (e.g. executing-plans) so it degrades gracefully when that skill isn't installed. Requires the project's `repo_path` to be set (📁 button in the sidebar project row); disabled + tooltip when unset. A 5 s per-session cooldown prevents double-clicks; a 120 s per-task guard refuses a second launch within the window. Empty-details tasks ask for confirmation first. All outcomes (success / pre-validation error / launch failure) surface as toasts (bottom-right, auto-dismiss on success/info, persist until clicked on error). Schema v8 adds a nullable `project.repo_path` column via ALTER TABLE in both the Node and Rust migration layers. `set_project_repo_path` validates the path is a directory; `start_task` validates the claude binary is executable, then `resolve_launch_args` picks a per-terminal recipe: **Ghostty / Terminal.app / iTerm2** each run via `osascript` against a self-deleting `/tmp` launcher script (`#!/bin/zsh --login`; Terminal/iTerm `cd` into the repo, Ghostty sets cwd via AppleScript), and any other value is treated as a **Custom** app via the generic `open -na <app> --args …` fallback. Spawned as an argv vector, never a shell. Settings (terminal, claude binary path) live in `localStorage` and are set from the **⚙ Settings** block at the bottom of the sidebar (`SidebarSettings.tsx`) — a terminal `<select>` (Ghostty / Terminal.app / iTerm2 / Custom…) plus a Claude-binary field; the legacy ⌘K → "Set terminal app…" / "Set Claude binary…" palette commands still work.
- **Open Claude button** — a titlebar **Open Claude** button next to the 📁 repo control, rendered only when the active project's `repo_path` is set. Reuses the same launch path as Start (`open_claude` Tauri command → shared `resolve_launch_args` recipes) but runs `exec <claude>` with **no task prompt**, does **not** move any card, and uses the project name as the tab title. Validates `repo_path` is a directory and the claude binary is executable, reuses the 120 s launch guard keyed `open_claude:<projectId>`, and surfaces success/error as toasts.
