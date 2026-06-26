#!/bin/sh
# Self-healing launcher for the vibetasks MCP server.
#
# better-sqlite3 ships a native addon that is ABI-locked to one Node major version.
# When the repo's deps get (re)built under a different Node than the one launching the
# MCP — common on a machine with nvm + Homebrew node side by side, where `npm install`
# may run under a different `node` than Claude Code uses — the addon fails to load with
# ERR_DLOPEN_FAILED ("NODE_MODULE_VERSION X ... requires Y") and the MCP appears "down".
#
# This wrapper detects that mismatch and rebuilds the addon ONCE for the *launching*
# Node before starting the server, so an ABI drift self-heals instead of crash-looping.
# All diagnostic output goes to stderr/dev-null — stdout is the JSON-RPC stream and must
# stay clean.
# The DURABLE fix for the ABI thrash is to launch the server under ONE pinned Node,
# independent of whatever Node a given Claude session's PATH resolves to. Set
# VIBETASKS_NODE (e.g. in the `claude mcp add --env` registration) to an absolute node
# binary — ideally Node 22 LTS (the version this server is pinned to and tested against), not an
# EOL release and not Homebrew node (which `brew upgrade` silently major-bumps, re-breaking the
# ABI). Falls back to PATH `node`.
set -e
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE="${VIBETASKS_NODE:-node}"
NPM_BIN_DIR=$(dirname -- "$NODE")

if ! "$NODE" -e 'require("better-sqlite3")' >/dev/null 2>&1; then
  echo "vibetasks: better-sqlite3 ABI mismatch for $("$NODE" -v); rebuilding…" >&2
  # Rebuild with the pinned Node first on PATH, so the addon targets ITS ABI.
  ( cd "$DIR/.." && PATH="$NPM_BIN_DIR:$PATH" npm rebuild better-sqlite3 >/dev/null 2>&1 ) \
    || echo "vibetasks: rebuild failed — run 'npm rebuild better-sqlite3' under the pinned Node." >&2
fi

exec "$NODE" "$DIR/dist/server.js"
