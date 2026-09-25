#!/bin/bash
# Installs workspace dependencies so lint, typecheck, and tests work in
# Claude Code on the web sessions. Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Migration unit tests shell out to the sqlite3 CLI (present on CI runners).
if ! command -v sqlite3 >/dev/null 2>&1; then
  apt-get install -y -qq sqlite3 >/dev/null 2>&1 \
    || { apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq sqlite3 >/dev/null 2>&1; }
fi

# The web image preinstalls Chromium; stop Playwright from downloading its own.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# `pnpm install` (not --frozen-lockfile) so the cached container state is reused.
pnpm install --prefer-offline
