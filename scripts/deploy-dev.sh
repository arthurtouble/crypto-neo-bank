#!/usr/bin/env bash
# Deploy the isolated dev environment by hand, with the same steps as
# .github/workflows/deploy-dev.yml, for when GitHub Actions can't run.
# Only from an up-to-date, clean main. Production is never touched: every
# command below targets --env dev.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
fail() { echo "Dev deploy stopped: $1" >&2; exit 1; }

[[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || fail "set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"
[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || fail "check out main first"
[[ -z "$(git status --porcelain)" ]] || fail "the working tree has uncommitted changes"
git fetch --quiet origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || fail "main isn't the same as origin/main; pull first"

step() { echo; echo "==> $*"; "$@"; }
step pnpm install --frozen-lockfile
# Migrations are append-only: new numbered files are applied, and dev keeps its data.
step pnpm --filter @aurel/web exec wrangler d1 migrations apply aura-dev-projections --remote --env dev
step pnpm events:deploy:dev
step pnpm deploy:dev
step pnpm ops:deploy:dev
step pnpm docs:deploy:dev
export AURA_SMOKE_URL=https://aura-dev.aurel-events.workers.dev AURA_SMOKE_DOCS_URL=https://aura-dev-docs.aurel-events.workers.dev
step pnpm test:deployment
echo
echo "Dev is running $(git rev-parse --short HEAD)."
