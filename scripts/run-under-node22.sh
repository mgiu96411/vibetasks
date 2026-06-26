#!/bin/sh
# Run a command under the pinned Node (22 LTS), matching the MCP server runtime,
# so better-sqlite3's native ABI stays consistent and `npm run mcp:test` doesn't
# rebuild the addon for a newer Node and break the running MCP server
# (the NODE_MODULE_VERSION ABI ping-pong this repo kept hitting).
#
# Resolution mirrors mcp/launch.sh: VIBETASKS_NODE → a Node 22 LTS install → PATH node.
# This honors a *floor* of Node 22 (see "engines" in package.json), not an exact patch.
set -e
NODE="${VIBETASKS_NODE:-/usr/local/bin/node}"
[ -x "$NODE" ] || NODE="$(command -v node)"
exec env PATH="$(dirname -- "$NODE"):$PATH" "$@"
