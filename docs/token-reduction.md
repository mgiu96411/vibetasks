# Token Reduction Guide

Vibe Tasks reduces Claude Code token use by moving project state out of the chat transcript and into a compact, queryable board. Claude reads only the level of detail it needs: compact cards first, a relationship map with capped Briefs only when needed, and one full Details body at a time.

## Measured Payload Reduction

This measurement uses the current MCP response shapes with a synthetic 100-task project:

- 100 total tasks
- 2 tasks in **Now**
- long Details bodies on every task
- summaries and code refs on every task

Payload sizes are JSON bytes, which are a stable proxy for relative token cost. Actual token counts vary by tokenizer and surrounding tool/schema overhead.

| Read path | Payload | Approx tokens | Reduction vs full task dump |
| --- | ---: | ---: | ---: |
| Full task dump | 202 KB | ~50.6k | baseline |
| `resume()` | 11 KB | ~2.8k | ~94% smaller |
| `get_board()` | 23 KB | ~5.7k | ~89% smaller |
| `get_map()` | 30 KB | ~7.6k | ~85% smaller |
| `resume({ include_map:true })` | 41 KB | ~10.4k | ~80% smaller |
| `get_task(id)` for one task | 2 KB | ~500 | ~99% smaller |

## Expected Net Savings

The fixed MCP/tool-schema overhead means Vibe Tasks is not always cheaper for tiny one-off chats. It is designed for real project work where Claude would otherwise reread files, replay status, or summarize old conversation.

Typical expectation:

- **Tiny one-off task:** roughly break-even, sometimes more tokens.
- **Medium coding session:** about **20-50% total token reduction** when Claude follows the protocol.
- **Long or multi-session project:** about **40-70% total token reduction**, especially after `/clear` or when returning to a project later.
- **State/context reads specifically:** often **80-95% smaller** than dumping all task bodies.

## How To Access The Savings

Install and build the MCP server:

```bash
npm install
npm -w mcp run build
claude mcp add vibetasks -- sh "/abs/path/to/vibe-tasks/mcp/launch.sh"
```

Register via `sh …/launch.sh`, not `node …/dist/server.js`: the launcher self-heals `better-sqlite3`'s
ABI-locked native addon, and `--env VIBETASKS_NODE=/abs/path/to/node` pins the Node so a stray
bare-`node` registration can't crash the MCP with `ERR_DLOPEN_FAILED`.

For each repo, optionally pin the board name so worktrees or temp directories do not create wrong boards:

```bash
claude mcp add vibetasks --env VIBETASKS_PROJECT="Your Board Name" -- sh "/abs/path/to/vibe-tasks/mcp/launch.sh"
```

Then make sure Claude has the operating protocol. Use the shareable protocol in:

```text
docs/vibetasks-claude-protocol.md
```

Paste it into *your* project's `CLAUDE.md` (or `AGENTS.md` for Codex), or your global Claude instructions. The MCP server also ships compact runtime instructions, but the shareable protocol gives Claude the full habit loop.

## Optional Local CLI

After `npm run mcp:build`, the MCP package also exposes a reversible shell facade:

```bash
npm run vibetasks -- board --project "Your Board Name"
npm run vibetasks -- task "#42" --project "Your Board Name"
npm run vibetasks -- add "Fix launch crash" --project "Your Board Name" --kind fix --priority high
npm run vibetasks -- move "#42" complete --project "Your Board Name"
```

This does not replace the MCP protocol. It reuses the same `mcp/src/repo.ts` logic as the MCP tools,
so writes keep the same project guards, `#ref` lookup, reopened handling, and tiny acknowledgements.
It adds no schema migration and no hook automation; rollback is deleting the CLI file/bin/script
entries, tests, and docs. For safe trials, pass `--db /tmp/vibetasks-scratch.db`.

Bash is not free context: read output still costs tokens when it is shown to Claude/Codex. The CLI
only helps when agents use its compact line output, tiny `ok #N` acks, or a scratch DB for
experiments instead of printing full JSON/state.

## Token-Lean Usage Pattern

Use these habits to actually get the reduction:

1. Start task work with `get_board(project)`.
   This returns compact cards for all tasks, full detail only for **Now**, and the reopened list.

2. Use `resume(project)` after `/clear` or in a fresh session.
   It does **not** include the map by default.

3. Pass `include_map:true` only when relationships or code refs are immediately needed.

4. Use `get_map(project)` when dependencies, subtasks, summaries, paths, or symbols matter.
   Map summaries and refs are capped.

5. Use `get_task(id)` for one full Details body.
   Avoid pulling full Details for many tasks at once; `get_map` exposes capped Briefs and
   `has_details` so Claude can tell whether a task has a body worth loading.

6. Keep only active work in **Now**.
   Now is the full-detail column, so speculative or future work belongs in **Next** or **Later**.

7. Fill `paths` and `symbols` on tasks.
   These are the biggest code-reading lever: Claude can open the relevant files instead of scanning the repo.

8. Write progress to the board, not long chat updates.
   Move tasks through **Now**, **Complete**, and **Dropped**; write a short `set_recap` at wrap-up.

## What Still Grows

`get_board()` still grows with the number of task cards, including old Complete/Dropped cards. It is much smaller than loading full bodies, but very large boards may eventually need an archive filter or active-only read. Until then, keep stale work in **Dropped**, use versions to group completed work, and avoid storing long prose in titles/summaries.
