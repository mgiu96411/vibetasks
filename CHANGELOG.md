# Changelog

Human-readable list of what changed in each release of Vibe Tasks.

## v1.2.0 — 2026-06-27

### Added
- **Project Guardrails** — per-project standing rules pinned at the top of the right column and surfaced to Claude on every board read, so the rules ride along automatically. Numbered, inline-editable rows with length caps; readable and writable over MCP (`get_guardrails` / `set_guardrails`).

### Fixed
- **The window reliably remembers its size and position** across launches, including multi-monitor setups that mix Retina and standard displays — a window last used on a 2× display no longer reopens half-size on a 1× display.
- **No launch-size flash** — the window now opens straight at your last size and position instead of briefly appearing at the default size and snapping into place.

## v1.1.0 — 2026-06-26

### Added
- **Board search bar** — filter cards across every column as you type, with a persistent highlight on the last card you opened so you never lose your place.
- **Native folder picker** for a project's repo path — pick the directory from the OS dialog instead of typing the path by hand.
- **Installed-terminal auto-detection** — first-class support for **Terminal.app** and **iTerm2** alongside Ghostty, selectable from the sidebar.
- **▶ Start executes a linked plan** — when a task has a plan file linked, Start runs that plan instead of re-planning from scratch.

### Changed
- **MCP writes are fail-closed** — the server refuses directory writes outside the configured repo, and `repo_path` auto-fills when you create a task.
- **License changed** from MIT to **PolyForm Noncommercial 1.0.0**.
- **Pinned to Node 22** (`.nvmrc` + launcher wrapper); fixed `app:check` staleness detection.

### Fixed
- Reliable drag-and-drop **into the Complete column**.
- **Live cross-column insertion gap** — cards now drop at the position you're hovering, not the end of the column.
- Fixed a blank-screen crash when dropping into Complete, and smoothed out up-reordering.

## v1.0.0 — Initial public release

- Local-first **5-column Kanban board** (Now / Next / Later / Complete / Dropped) as a dark Tauri desktop app.
- **Notes**, a **walk-away recap**, and a **dependency graph** for tasks.
- Backed by a shared **SQLite** store.
- **TypeScript MCP server** that lets Claude Code drive the board — externalizing project state to cut token usage.
