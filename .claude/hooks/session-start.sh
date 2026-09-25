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

# The image's preinstalled Chromium can be older than the revision this repo's
# Playwright expects, and downloads are blocked. Alias the installed headless
# shell under the expected revision so `pnpm test:e2e` can launch it.
pw_json=$(ls node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json 2>/dev/null | head -1 || true)
browsers="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
if [ -n "$pw_json" ] && [ -d "$browsers" ]; then
  want=$(node -e 'const b=require(require("path").resolve(process.argv[1])).browsers.find(x=>x.name==="chromium-headless-shell");process.stdout.write(b?b.revision:"")' "$pw_json")
  have=$(ls -d "$browsers"/chromium_headless_shell-* 2>/dev/null | grep -v -- "-$want\$" | sort -V | tail -1 || true)
  target="$browsers/chromium_headless_shell-$want/chrome-headless-shell-linux64"
  if [ -n "$want" ] && [ -n "$have" ] && [ ! -e "$target/chrome-headless-shell" ] && [ -x "$have/chrome-linux/headless_shell" ]; then
    mkdir -p "$target"
    for f in "$have"/chrome-linux/*; do ln -sf "$f" "$target/$(basename "$f")"; done
    ln -sf "$have/chrome-linux/headless_shell" "$target/chrome-headless-shell"
    touch "$browsers/chromium_headless_shell-$want/INSTALLATION_COMPLETE"
  fi
fi
