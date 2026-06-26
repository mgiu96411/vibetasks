#!/bin/zsh
# Double-click this file to open Vibe Tasks.
# First launch compiles the Rust backend (~30s); afterwards it's fast.
# Closing this Terminal window quits the app.

cd "$(dirname "$0")"
source "$HOME/.cargo/env" 2>/dev/null

echo "Launching Vibe Tasks…  (close this window to quit the app)"
exec npm run app
