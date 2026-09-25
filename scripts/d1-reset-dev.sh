#!/usr/bin/env bash
# Drop every table in the development D1 and apply the current schema.
# Development data is disposable; D1 never owns money. Refuses production.
#
#   bash scripts/d1-reset-dev.sh             # remote aura-dev-projections (--env dev)
#   bash scripts/d1-reset-dev.sh --local DIR # a local store persisted in DIR, for testing
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/apps/web"

if [[ "${1:-}" == "--local" ]]; then
  [[ -n "${2:-}" ]] || { echo "Usage: $0 --local DIR" >&2; exit 1; }
  database="aurel-projections"
  target=(--local --persist-to "$2")
else
  database="aura-dev-projections"
  target=(--remote --env dev)
fi

d1() { pnpm exec wrangler d1 execute "$database" "${target[@]}" "$@"; }

# Newest tables first, so children drop before the tables they reference.
tables="$(d1 --json --command "SELECT name FROM sqlite_master WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC" \
  | node -e 'const out = JSON.parse(require("fs").readFileSync(0, "utf8")); for (const row of out[0].results) console.log(row.name)')"

if [[ -n "$tables" ]]; then
  statements="PRAGMA defer_foreign_keys = true;"
  while IFS= read -r table; do statements+=" DROP TABLE IF EXISTS \"$table\";"; done <<< "$tables"
  d1 --command "$statements"
fi

pnpm exec wrangler d1 migrations apply "$database" "${target[@]}"
echo "Reset $database and applied the current schema."
