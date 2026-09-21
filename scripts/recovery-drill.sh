#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
drill_dir="$(mktemp -d "${TMPDIR:-/tmp}/aurel-d1-drill.XXXXXX")"
trap 'rm -rf "$drill_dir"' EXIT
export WRANGLER_LOG_PATH="${TMPDIR:-/tmp}/aurel-wrangler-recovery.log"

cd "$repo_root/apps/events"
pnpm exec wrangler d1 migrations apply aurel-projections --local --persist-to "$drill_dir"
tables="$(pnpm exec wrangler d1 execute aurel-projections --local --persist-to "$drill_dir" --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('webhook_receipts','operational_issues','operational_checks') ORDER BY name;")"

for table in operational_checks operational_issues webhook_receipts; do
  if [[ "$tables" != *"$table"* ]]; then
    echo "Recovery drill failed: missing $table" >&2
    exit 1
  fi
done

echo "Recovery drill passed in an isolated temporary D1 store. Production was not accessed or changed."
