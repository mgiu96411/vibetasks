#!/bin/zsh
# Print-only: is the /Applications build behind the source? NEVER builds.
# Compares the installed app's build time against the latest commit that
# touched app/ (the buildable source). Run via: npm run app:check
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DEST="/Applications/Vibe Tasks.app"

if [[ ! -d "$DEST" ]]; then
  echo "ℹ Vibe Tasks is not installed in /Applications — run 'npm run app:install'."
  exit 0
fi

# The executable in Contents/MacOS is named after the bundle (e.g. "vibe-tasks"),
# not "app" — stat the newest file there so a rename can't silently zero the mtime
# (the epoch-0 / "1969" bug that made every check report STALE).
installed_epoch="$(stat -f %m "$DEST/Contents/MacOS/"* 2>/dev/null | sort -rn | head -1 || echo 0)"
src_epoch="$(git log -1 --format=%ct -- app 2>/dev/null || echo 0)"
installed_ver="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$DEST/Contents/Info.plist" 2>/dev/null || echo '?')"
conf_ver="$(grep -m1 '"version"' app/src-tauri/tauri.conf.json | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')"

fmt() { date -r "$1" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?'; }

if (( src_epoch > installed_epoch )); then
  echo "⚠ /Applications/Vibe Tasks.app may be STALE."
  echo "  installed build:    $(fmt "$installed_epoch")  (v$installed_ver)"
  echo "  latest app/ commit: $(fmt "$src_epoch")  (tauri.conf v$conf_ver)"
  echo "  → run 'npm run app:install' to refresh."
  if [[ "$installed_ver" == "$conf_ver" ]]; then
    echo "  note: version string is unchanged ($conf_ver) — bump tauri.conf.json on release so freshness is verifiable by version, not just timestamps."
  fi
  exit 0
fi

echo "✓ /Applications/Vibe Tasks.app is up to date (v$installed_ver, built $(fmt "$installed_epoch"))."
