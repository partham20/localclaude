#!/bin/sh
# Starts LocalClaude in server mode under Electron with no display.
set -e
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR"
if [ -z "$LOCALCLAUDE_SECRET" ] && [ -z "$LOCALCLAUDE_SECRET_FILE" ]; then
  echo "LocalClaude: set LOCALCLAUDE_SECRET (openssl rand -base64 32) in .env. It encrypts your data." >&2
  exit 1
fi
# --no-sandbox: Chromium's sandbox needs privileges a locked-down container doesn't give it;
# the container itself is the boundary here.
exec /app/node_modules/electron/dist/electron \
  --no-sandbox --ozone-platform=headless --disable-gpu --disable-dev-shm-usage \
  /app "$@"
