#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export WRANGLER_LOG_PATH="${TMPDIR:-/tmp}/aurel-wrangler-recovery-status.log"
cd "$repo_root/apps/events"

echo "Remote migration status"
pnpm exec wrangler d1 migrations list aurel-projections --remote
echo "Current Time Travel bookmark"
pnpm exec wrangler d1 time-travel info aurel-projections
echo "This command is read-only. Use the incident runbook before any restore."
