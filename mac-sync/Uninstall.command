#!/bin/bash
set -euo pipefail
/bin/launchctl bootout "gui/$(id -u)/com.a1vip.skybox-sync" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/com.a1vip.skybox-sync.plist"
/usr/bin/security delete-generic-password -a dashboard-sync -s com.a1vip.skybox-sync.session >/dev/null 2>&1 || true
echo 'Automatic sync stopped and the saved login session was removed. Your skyexport files, dashboard documents, and local logs were kept.'
read -r -p 'Press Return to close.'
