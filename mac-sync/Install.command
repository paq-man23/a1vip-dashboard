#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SYNC_SOURCE_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
SYNC_INSTALL_DIR="$HOME/Library/Application Support/A1VIP-Skybox-Sync"
if ! command -v node >/dev/null 2>&1 || ! node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' >/dev/null 2>&1; then
  echo 'Install the current Node.js LTS from https://nodejs.org/en/download, then run this installer again.'
  open 'https://nodejs.org/en/download'
  read -r -p 'Press Return to close.'
  exit 1
fi
/bin/launchctl bootout "gui/$(id -u)/com.a1vip.skybox-sync" >/dev/null 2>&1 || true
umask 077
mkdir -p "$SYNC_INSTALL_DIR"
chmod 700 "$SYNC_INSTALL_DIR"
for SYNC_FILE in package.json package-lock.json core.mjs sync.mjs skybox-import.cjs supabase-config.js; do
  cp "$SYNC_SOURCE_DIR/$SYNC_FILE" "$SYNC_INSTALL_DIR/$SYNC_FILE"
done
cd "$SYNC_INSTALL_DIR"
npm ci --ignore-scripts --omit=dev
node sync.mjs --setup
echo 'Your export folder is ~/skyexport. The dashboard does not need to stay open.'
read -r -p 'Press Return to close.'
