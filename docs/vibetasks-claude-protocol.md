# Vibe Tasks — Claude operating protocol

Copy this into your `CLAUDE.md` (per-project, or the global `~/.claude/CLAUDE.md`) after
installing the Vibe Tasks MCP server, so Claude drives the board efficiently and token-leanly.

## Install

```bash
npm run mcp:build
claude mcp add vibetasks -- sh "/abs/path/to/vibe-tasks/mcp/launch.sh"
```

`launch.sh` is a self-healing wrapper: `better-sqlite3` ships a native addon ABI-locked to one
Node major, so if the addon was built under a different Node than the one launching the server
(common with nvm + Homebrew node side by side) it would fail to load and the MCP would appear
"down". The wrapper detects that mismatch and rebuilds the addon once before starting.

For a hard guarantee on a multi-Node machine, **pin the Node** the server runs under with
`VIBETASKS_NODE` (an absolute path to a maintained LTS — not an EOL release, and not Homebrew node,
whose path's binary changes major on `brew upgrade`). This decouples the server from whatever Node
a given session's PATH resolves to:

```bash
claude mcp add vibetasks --env VIBETASKS_NODE=/abs/path/to/node -- sh "/abs/path/to/vibe-tasks/mcp/launch.sh"
```

The desktop app and the MCP server share one SQLite DB at `~/.vibetasks/vibetasks.db`
(override with `VIBETASKS_DB`). The app doesn't need to be open for Claude to manage the board.

Optional shell facade after `npm run mcp:build`:

```bash
npm run vibetasks -- board --project "Your Board Name"
npm run vibetasks -- task "#42" --project "Your Board Name"
npm run vibetasks -- add "Fix launch crash" --project "Your Board Name" --kind fix --priority high --brief "Crash on launch" --details "Full repro, constraints, and acceptance criteria."
npm run vibetasks -- move "#42" complete --project "Your Board Name"
```

This CLI is reversible and additive: it calls the same `mcp/src/repo.ts` logic as the MCP tools,
adds no schema migration, and is safe to remove without touching board data. Use it for local shell
workflows, scratch-DB trials (`--db /tmp/vibetasks-scratch.db`), or compact line output. For normal
Claude Code board work, prefer the MCP tools below because they keep the protocol typed and explicit.

**Pin the board name per project** with `VIBETASKS_PROJECT`, so a session always targets the right
board regardless of its working directory — important for git worktrees / temp dirs whose folder
name isn't the board name:

```bash
claude mcp add vibetasks --env VIBETASKS_PROJECT="Your Board Name" -- sh "/abs/path/to/vibe-tasks/mcp/launch.sh"
```

> ⚠️ **`VIBETASKS_PROJECT` is a per-project override — never a machine-wide default.** Set it with
> *project-scoped* config (a repo's `.mcp.json`, or a project-scoped `claude mcp add`) to **that
> repo's** board name. A **global** pin (e.g. one written into `~/.claude.json`) silently forces
> *every* session in *every* directory onto that single board — so Claude faithfully cards work onto
> a board the human isn't looking at, and their real board looks empty. Only pin per-project, and
> only where the folder name ≠ the board name (git worktrees / temp dirs).

Project for a call resolves as: explicit `project` arg → `VIBETASKS_PROJECT` → current directory
name. The directory fallback will *match* an existing board but **refuses to auto-create** one from
a uuid-looking worktree/temp dir (set the env, pass `project=`, or `create_project` first) — this
prevents stray boards named after a session's working directory.

**Writes fail closed on a directory-fallback miss.** When the project was resolved *only* by the
current-directory name (no `project=`, no `VIBETASKS_PROJECT`) and that name matches no existing
board *while other boards exist*, write tools (`add_task`, `add_tasks`, `move_task`, …) refuse with
an error naming the inferred string and listing the real boards — so a mistyped/strayed cwd can
never silently spawn or target the wrong board. An empty database still bootstraps its first board
on first use. When a board *is* created — whether bootstrapped by a write or made explicitly with
`create_project` — its `repo_path` is seeded from the session's working directory if you didn't set
one, so a board created from a Claude Code session keeps that session's path for the Start button —
never overwriting an existing path, and never from a uuid/temp dir.

**Reads never create; typed names beside existing boards never create.** Read tools (`get_board`,
`get_map`, `list_tasks`, `resume`, `get_notes`) never mint a board — an unknown name throws and
lists the boards that exist, so a guessed/mistyped name can't spawn an empty duplicate. When that
happens, **don't retype another guess** — read the listed names and call again with the exact one
(or `resume`/`get_board` with no `project` to use the directory default). Write tools still
bootstrap a brand-new repo's board from the directory name, but **refuse to create a board from a
typed `project` name while other boards already exist** — make a genuinely new board with
`create_project`, never by typing a fresh name into `add_task`.

## Project spaces

Spaces organize projects in the left rail; they do not replace or alter the five task columns
inside a project. New databases seed **Current projects**, **Finished projects**, and
**Open Sourcer**. Existing projects migrate into Current.

- `list_spaces()` — list space ids/names in display order.
- `create_space(name)` / `rename_space(space,name)` — manage user-defined sections.
- `move_project_to_space(project,space)` — move a board without changing any tasks.
- `delete_space(space)` — delete an empty space only; the default Current space is protected.
- `create_project(name,color?,space?,repo_path?)` — create directly in a named/id space, or omit
  `space` to use Current projects. `repo_path` (the Start-button launch dir) auto-fills from the
  session's working directory unless you pass one; a uuid/temp/worktree cwd is skipped (left blank).

Space and project arguments accept an exact id or exact name where documented. Do not infer
project lifecycle from task columns: moving a project to Finished projects is an organizational
choice, while task completion remains represented by the Complete column.

## Accessing the token reduction

The full measurement and GitHub-facing setup guide lives in [`docs/token-reduction.md`](token-reduction.md).
Measured on a synthetic 100-task project, `resume()` was about **94% smaller** than a full task
dump, `get_board()` about **89% smaller**, and `resume({ include_map:true })` about **80% smaller**.

The MCP install alone is not the whole saving. The reduction comes from this access pattern:

- Start task work with **`get_board(project)`**.
- Use **`resume(project)`** after `/clear` or in a fresh session; it omits the map by default.
- Pass **`include_map:true`** only when relationship context is needed immediately.
- Use **`get_map(project)`** for dependencies, Briefs, `has_details`, paths, and symbols; use **`get_task(id)`**
  for one full task body.
- Keep only active work in **Now** and put future work in **Next** or **Later**, because **Now** is
  the full-detail column.
- Fill `paths` and `symbols` on tasks so Claude can read targeted files instead of scanning the
  repo.

## Task prose fields

Use **Title / Brief / Details / Scope**:

- **Title** — short imperative label. Always loaded.
- **Brief** — one short, map-visible sentence/handle, capped at 240 chars. This is not the task
  body and should not contain acceptance criteria.
- **Details** — optional full body: constraints, acceptance criteria, edge cases, decisions, and
  implementation notes. Load it with `get_task(id)` unless the task is already in **Now**.
- **Scope** — `paths` and `symbols`, the code-reading index.

The database columns are still named `summary` and `description` for compatibility; MCP write tools
accept those legacy names, but prefer `brief` and `details`. Never paste a long body into Brief,
and never duplicate Brief into Details. If a task fits in Title + Brief, leave Details empty. If
Details exists, Brief should be a fresh one-line handle, not a compressed copy.

## Columns

- **Now** — actively being worked. Claude loads these in full every turn.
- **Next** — queued, not started yet. New tasks default here.
- **Later** — backlog / someday.
- **Complete** — done.
- **Dropped** — deliberately decided not to do (out of scope; not a failure).

## How Claude should use the board

### Populate & keep the board current — it's part of "done", not a follow-up

**Think on the board, not only in chat.** The board is the record; chat is the summary that points
at it. Don't wait to be asked — before you end any turn in which you proposed, planned, or
brainstormed concrete future work, the board must already reflect it.

**MUST card** (author the card *before* you finish narrating the proposal):
- Any **feature / fix / chore / docs** task you propose pursuing → a card in **Next** (default) or **Later**.
- Any **brainstorm** you put real thought into → title it `[Brainstorm] X` and park it in **Later**
  (or **Next** if the human wants it soon). Brainstorms never go straight to **Now**.
- Any **multi-step plan** → a parent card now, sub-tasks as you scope them. (A proposed "paid tier
  + 8 features" plan is 1 parent + ~8 cards — not a chat-only list.)
- A standing **domain/project** rule you propose → a single `kind=rule` card.
- Any **deferred / optional / conditional** improvement you say out loud — *"could later make
  it level-scaled", "a better fix would be a test", "easy to tune this later"* — is real future
  work → a card in **Later** (usually `priority: low`). The words "later" / "optional" downgrade
  the *priority*, never the *capture*: this is exactly the work that silently dies on `/clear`.
- An **open decision you hand the human** (*"drop it to 300 or leave 360?"*) is **not** a card on
  its own — but the **work behind it** almost always is. Card the work and note the open choice in
  its body, or resolve the choice in-turn. Never leave both the decision *and* its work only in chat.
- Set `priority` and `kind` on every card you author — never leave the defaults.

**The test before you end a turn (the `/clear` bar):** would anything you said imply work to be
done later — a deferred fix, an optional improvement, a follow-up, an unresolved decision with work
behind it — that isn't on the board? If yes, card it (or fold it into an existing card) *before you
finish*. The standard to hold: the human can `/clear` this conversation right now and trust the
board lost nothing. (Bare questions, preferences, and analysis with no work behind them are not
cards — see NEVER, below.)

**MUST keep current** (the same turn the state changes):
- Start a card → **Now**; finish → **Complete**; abandon → **Dropped** (one-line why).
- **Prune as you go:** a **Later** card that's stale, superseded, or never happening → **Dropped**
  (one-line why), not left to rot. Populating and pruning are the *same* duty — the board is a
  ledger, not a one-way inbox.

**NEVER card** (carding these is the regress / noise trap):
- **Board mechanics** — adding, moving, reordering, linking, recapping, or "I should card this."
  Acting on the board is plumbing, never itself a proposal.
- **Rules about how the board/carding works** — a proposal to change *how carding works* is not
  domain work. Make the CLAUDE.md edit directly this turn, or raise it in chat — never a card. The
  board holds *domain* work; it never holds rules about how the board is run. *(This clause
  terminates the regress: proposing-to-card and proposing-how-to-card both exit to plumbing/chat,
  never to a card.)*
- Throwaway asides or options you reject in the same breath — if it didn't survive your own next
  sentence, it isn't a proposal.
- Pure questions, explanations, or analysis with **no work behind them** — a bare preference
  (*"dark or light theme?"*) is chat, not a card. *(But a question with real deferred work behind
  it → card the work, per MUST above. The floor stays: the question itself is never the card.)*
- Anything an existing card already covers — update that card, don't duplicate.

**Never auto-promote into Now.** Proposed cards default to **Next** / **Later**. Only the human (a
`source: you` card) or an explicit "start this now" moves a card into **Now** — Now loads in full
every turn, so self-promoting speculative work bloats the very context the board keeps flat.

**Start button (v1.0.0+).** The human can click **▶ Start** in the task detail panel; the app
moves the card to **Now** and opens your terminal at the project's repo with Claude Code pre-loaded.
If you enter a session that way you'll see the task already in **Now** — treat that as your active
task and call `get_task` on it to load the full body before starting work. **If the launch prompt
says a committed plan exists at a path, read and execute that plan — do not re-plan.** (The app
auto-appends that pointer when the card's `paths` carry a plan file; see **Plans → cards**.)

**Plans → cards (link the plan, verified — don't re-plan on the next Start).** When you write a plan
for a card with *any* plan-writing skill/tool (superpowers `writing-plans`, `ecc:planner`, PRP, an
MCP, …), the plan is usually a committed file under a `…/plans/` directory. Before you finish the
turn that wrote it:
- **Add the plan file's path to that card's `paths`** (via `set_refs` or `update_task`). Cards
  already surface `paths` to a Start session, and **▶ Start auto-appends an "execute this plan, do
  not re-plan" pointer to the launch prompt whenever `paths` holds a `…/plans/*.md` file** — so a
  fresh Start session runs the existing plan instead of silently re-deriving a divergent one.
- **Read the link back and confirm it persisted** — call `get_task` and verify the plan path is
  actually in `paths`. A self-reported "I linked it" is not enough: a write that returns null and a
  claim that it succeeded look identical in chat, and the unverified link is exactly how a Start
  session ends up re-planning. Don't trust the write; verify it.
- **Link only — never paste the plan body into the card.** The card holds the *why* (scope,
  decisions) and a pointer; the committed plan file is the *how* and the live execution checklist.
  Duplicating it into the card just creates drift the moment a task gets checked off in the file.

**Wrong-board guard.** If `get_board` / `resume` returns a board that looks wrong for the repo
you're in (unfamiliar cards, or empty when you expect history), **stop and verify the project name
against the repo before writing** — you may be on the wrong board (see `VIBETASKS_PROJECT`). A card
on the wrong board is worse than no card.

- On task work, call **`get_board` first**: it returns a compact card for every task, including
  subtasks and `has_details`, plus capped Brief + Details **only for Now** tasks, and a
  **`reopened`** list.
- Use **`get_map`** only when relationships or code refs matter (Briefs and refs are capped),
  **`get_task`** for one full body, and **`resume(project)`** to rehydrate cheaply after `/clear`.
  Pass **`include_map:true`** to `resume` only when the relationship map is needed immediately.
- Every task has a short `#ref` number (shown on cards). Use **`list_tasks`** to see every task's
  `#ref` + title + status, so when the human says "work on #N" you can map it to the task.
- A task can carry a freeform **`version`** (e.g. "v0.4.0"); the Complete column groups completed
  tasks into collapsible per-version sections. Set it via `update_task` when the human or a release
  context calls for it — it is **not** auto-stamped by default.
- **At wrap-up** (also on "diary this" / after finishing work), call **`set_recap(project, …)`** with a
  short, **dated, past-tense** "where we left off" — what we did, how the open thread resolved, and
  what's next. It shows as the human's **"Last session"** panel and rides `resume()`; it's stored
  separately so it never clobbers the freeform notes. Don't put forward-looking status here — the
  board is the live source of truth.

The MCP server ships a compact `instructions` string so installing the server supplies the core
rules without sending this full document every turn; this file is the canonical, richer copy.

## Auditing and reorganizing a board

Use **`audit_board(project, repo_path?, stale_after_days?, git_log_limit?)`** when the human asks
for a board-wide review of non-complete/non-dropped work. It returns one read-only packet containing:

- full, capped active task bodies plus compact Complete/Dropped context
- parent/child and dependency/related links, active graph components, and isolated active tasks
- hygiene findings for missing metadata/scope, reopened or stale work, active dependencies on
  Dropped tasks, parents whose children are all closed, and duplicate normalized titles
- optional read-only repository evidence from the explicit `repo_path` or the project's configured
  path: `git status`, recent commits/tags, exact `#ref` commit mentions, and scope-path existence

Repository evidence is **not proof of completion**. A matching commit, tag, or existing path is a
lead: inspect the task's targeted files and current behavior before changing status. Likewise,
staleness and isolation are prompts to ask whether a card is still useful, not automatic reasons
to drop it.

Apply the reviewed result with **`apply_board_audit`**:

1. Send `updates`, `additions`, `links`, optional complete per-column `order` lists, and an optional
   recap **without** `confirm`. New tasks get a batch-local `key` and later operations refer to
   them as `$key`; existing tasks use `#ref` or id.
2. Review the returned preview. Each requested order must list every task that will finally occupy
   that column exactly once, preventing silent omissions and position collisions.
3. Repeat the same call with `confirm:true`. The server revalidates and applies the entire plan in
   one SQLite transaction. Any invalid selector, link, or order rejects the batch with no writes.

The batch tool intentionally has no delete operation. Preserve history by moving abandoned or
superseded work to Dropped with a concise explanation in Details. Status changes use the normal
move semantics, including reopened tracking.

## Fixing messy boards

If a board ends up misnamed, duplicated, or holding tasks that belong on another board:

- **`rename_project(project, name)`** — fix a bad/junk board name (target by its exact name or id).
- **`reassign_project_tasks(from, into)`** — move every task (with its subtasks, links and `#ref`s)
  from one board into another. This is the "merge" half.
- **`delete_project(project, confirm?)`** — remove a board; it **refuses a non-empty board unless
  `confirm: true`** (deleting also removes that board's tasks).

**To merge two boards:** `reassign_project_tasks(from=junk, into=real)`, then `delete_project(junk)`.

Project names are guarded against accidental duplication: `create_project` reuses an existing exact
name, and renames that would collide with another board are refused. If old duplicate names already
exist, target the desired board by id, then rename/merge/delete the extras explicitly.

Space names use the same exact-name guard. Move every project out before deleting a custom space;
the default Current space is intentionally undeletable so new projects always have a stable home.

**Before any destructive step, show the human exactly what's affected** — e.g. "that board has N
tasks: …, moving them into <real>", or "deleting <name> (0 tasks)". Never delete or merge on a
vague instruction without naming the exact board and its task count, and target boards by their
explicit name/id (not the working-directory default).
- Before editing code, read only a task's **`paths`/`symbols`**, not the whole repo.
- Write/move/reorder/link via the MCP tools; keep replies terse — the app is the human's status
  channel (board-over-narration).
- New tasks land in **Next** by default; move to **Now** when you start, **Complete** when done,
  **Dropped** if abandoned.
- **Set a `priority` (low/med/high) on every task you create** that reflects its real importance —
  don't leave the default. Priority is the human's at-a-glance importance signal, separate from
  column and order.
- **Set a `kind`** (fix / feature / chore / rule / docs) when the task's type is known — it shows as
  a badge on the card. `kind=rule` is the home for standing rules (no separate "rules" column).
- **User-added cards (`source: you`) are requests from the human.** Pull high-priority ones into
  **Now** and work them in priority order; don't leave a user's high-priority card sitting in Next.
- **Capture your own suggestions as cards** — see *"Populate & keep the board current"* above: every
  proposal/brainstorm/plan you put real thought into lands on the board (the right column) before
  you finish narrating it, and moves across columns as the work moves. Board-over-chat.

## Project Guardrails

**Guardrails** are a per-project list of inviolable standing rules — present-tense facts or constraints Claude should treat as always true for this project.

- **Read:** `get_guardrails(project)` — returns the current list.
- **Set:** `set_guardrails(project, rules[])` — replaces the entire list atomically.
- **Auto-injection:** when non-empty, the list appears as a `guardrails` array in `get_board` and `resume` output. When empty, the field is absent and costs zero tokens.
- **Caps (hard-rejected at the write layer):** max **20** rules, **≤ 200 chars** per rule, **≤ 2 400 chars** total.
- **Distinct from:** Notes (freeform scratch), Goal (forward-looking), Last session/recap (backward-looking). Guardrails are standing present-tense rules, not session summaries or goals.

**Migration guidance — stale `kind=rule` cards in Now.** If you see a never-completing `kind=rule` card sitting in the **Now** column that is really a standing project rule (not a task with a deliverable), **offer to move its text into Guardrails** (`set_guardrails`) and then **Drop the card** with a one-line note. Never bulk-sweep rule cards automatically — offer and confirm for each one.

## The reopened rule

If `get_board` / `resume` lists a task under **`reopened`** (it was moved back out of Complete),
treat that as a signal: **investigate what isn't complete** about it first (read its `paths`/
`symbols`, ask the user if unclear), then either finish it — moving it back to **Complete** clears
the reopened flag — or re-scope/split it. Don't start unrelated work while a task is reopened.
