#!/usr/bin/env bash
# Run the checks from .github/workflows/ci.yml and security.yml on this machine,
# for when GitHub Actions can't run (for example, when the month's minutes are
# used up). Pass --e2e to also run both Playwright projects.
# gitleaks and CodeQL run only if they're installed; the summary says when they're skipped.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
run_e2e=false
[[ "${1:-}" == "--e2e" ]] && run_e2e=true
skipped=()

step() { echo; echo "==> $*"; "$@"; }

step pnpm install --frozen-lockfile
step pnpm lint
step pnpm typecheck:all
step pnpm test:unit
step pnpm build
step pnpm --filter @aurel/ops build
step pnpm test:recovery
step pnpm audit --audit-level high

if command -v gitleaks >/dev/null; then step gitleaks detect --source . --no-banner
else skipped+=("gitleaks (secrets): not installed"); fi
if command -v codeql >/dev/null; then
  db="$(mktemp -d "${TMPDIR:-/tmp}/aura-codeql.XXXXXX")"
  trap 'rm -rf "$db"' EXIT
  step codeql database create "$db/db" --language=javascript-typescript --overwrite
  step codeql database analyze "$db/db" --format=sarif-latest --output="$db/results.sarif"
  count=$(jq '[.runs[].results[]] | length' "$db/results.sarif")
  echo "CodeQL findings: $count"
  test "$count" -eq 0
else skipped+=("CodeQL: not installed"); fi

if $run_e2e; then
  step pnpm test:e2e --project=desktop-chromium
  step pnpm test:e2e --project=mobile-chromium
else skipped+=("e2e: pass --e2e to run it"); fi

echo
echo "Local CI passed."
for item in "${skipped[@]}"; do echo "Skipped: $item"; done
