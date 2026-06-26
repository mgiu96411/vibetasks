#!/bin/zsh
# Stop hook — PRINT-ONLY, never blocks (always exits 0). It cannot author cards;
# it only reminds. Two cadences:
#   • EVERY turn-end: refresh the phone snapshot + print a terse latent-task
#     capture nudge (any turn could be the one before a /clear — council
#     2026-06-02: the reliable capture lever is firing the audit at the boundary,
#     not more forceful prose).
#   • ONCE per session: the fuller board-hygiene reminder + /Applications staleness.
input="$(cat 2>/dev/null || true)"
sid="$(printf '%s' "$input" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("session_id",""))
except Exception:
    print("")' 2>/dev/null)"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Phone snapshot (council 2026-06-02, path D): refresh the read-only board.html
# + board.json in iCloud on EVERY turn-end so the phone sees current state.
# Runs above the once-per-session guard (the reminder below fires once; this each
# Stop). Backgrounded, errors swallowed — never delays or blocks the hook. Pinned
# Node keeps the better-sqlite3 ABI aligned (VIBETASKS_NODE, same as launch.sh).
SNAP="$ROOT/mcp/dist/snapshot.js"
if [[ -f "$SNAP" ]]; then
  NODE_BIN="${VIBETASKS_NODE:-/usr/local/bin/node}"
  [[ -x "$NODE_BIN" ]] || NODE_BIN="node"
  ( "$NODE_BIN" "$SNAP" >/dev/null 2>&1 & ) 2>/dev/null || true
fi

# EVERY turn-end: the /clear-safety capture nudge. Terse on purpose.
echo "📋 /clear-safety check: did this turn surface a deferred/optional fix, follow-up, or open decision with work behind it that isn't on the board yet? Card it (→ Later) before you finish. Bare questions/analysis don't count. (board-over-chat — see CLAUDE.md)"

# Fire at most once per session.
marker="${TMPDIR:-/tmp}/vibetasks-stop-${sid:-default}"
[[ -e "$marker" ]] && exit 0
: > "$marker" 2>/dev/null || true

echo "📋 Vibe Tasks board check: does the board reflect what you proposed / started / finished this session? Move state (Now/Complete/Dropped) and prune stale Later cards. (board-over-chat — see CLAUDE.md)"
zsh "$ROOT/scripts/app-check.sh" 2>/dev/null || true
exit 0
