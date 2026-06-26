#!/bin/zsh
# Rebuild Vibe Tasks (release) and (re)install it into /Applications, so the
# installed app always reflects the latest source.
#
#   npm run app:install        # build + install (the normal path)
#   npm run app:install:fast   # install the existing build without rebuilding
#                              # (use right after `npm run app:build`)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source "$HOME/.cargo/env" 2>/dev/null || true

APP_NAME="Vibe Tasks.app"
SRC="$ROOT/app/src-tauri/target/release/bundle/macos/$APP_NAME"
DEST="/Applications/$APP_NAME"

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "▶ Building Vibe Tasks (release)…"
  npm run app:build
fi

if [[ ! -d "$SRC" ]]; then
  echo "✗ No release build found at: $SRC" >&2
  echo "  Run 'npm run app:build' first (or drop --skip-build)." >&2
  exit 1
fi

echo "▶ Installing → $DEST"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

VER="$(/usr/bin/mdls -name kMDItemVersion -raw "$DEST" 2>/dev/null || echo '?')"
echo "✓ Installed Vibe Tasks $VER into /Applications"
