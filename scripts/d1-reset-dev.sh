#!/usr/bin/env bash
# Drop every table in the development D1 and apply the current schema.
# Development data is disposable; D1 never owns money. Refuses production.
# Feature switches that were on stay on, and the applied baseline's hash is
# recorded so a deploy can tell whether the schema changed.
#
#   bash scripts/d1-reset-dev.sh                     # remote aura-dev-projections (--env dev)
#   bash scripts/d1-reset-dev.sh --if-schema-changed # reset only if the baseline changed since the last reset
#   bash scripts/d1-reset-dev.sh --local DIR         # a local store persisted in DIR, for testing
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/apps/web"

only_if_changed=false
if [[ "${1:-}" == "--local" ]]; then
  [[ -n "${2:-}" ]] || { echo "Usage: $0 --local DIR" >&2; exit 1; }
  database="aurel-projections"
  target=(--local --persist-to "$2")
else
  [[ "${1:-}" == "--if-schema-changed" ]] && only_if_changed=true
  database="aura-dev-projections"
  target=(--remote --env dev)
fi

d1() { pnpm exec wrangler d1 execute "$database" "${target[@]}" "$@"; }
# Print the given column of every result row, one per line.
column() { node -e 'const out = JSON.parse(require("fs").readFileSync(0, "utf8")); for (const row of out[0].results) console.log(row[process.argv[1]])' "$1"; }
has_table() { [[ -n "$(d1 --json --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '$1'" | column name)" ]]; }

schema_hash="$(sha256sum "$repo_root/infra/d1/migrations/0001_baseline.sql" | cut -d' ' -f1)"

if $only_if_changed && has_table dev_schema_state; then
  applied="$(d1 --json --command "SELECT schema_sha256 FROM dev_schema_state" | column schema_sha256)"
  if [[ "$applied" == "$schema_hash" ]]; then
    echo "$database already has the current baseline; not resetting."
    exit 0
  fi
fi

enabled_flags=""
if has_table feature_flags; then
  enabled_flags="$(d1 --json --command "SELECT flag_key FROM feature_flags WHERE enabled = 1" | column flag_key)"
fi

# Newest tables first, so children drop before the tables they reference.
tables="$(d1 --json --command "SELECT name FROM sqlite_master WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC" | column name)"

if [[ -n "$tables" ]]; then
  statements="PRAGMA defer_foreign_keys = true;"
  while IFS= read -r table; do statements+=" DROP TABLE IF EXISTS \"$table\";"; done <<< "$tables"
  d1 --command "$statements"
fi

pnpm exec wrangler d1 migrations apply "$database" "${target[@]}"

restore=""
while IFS= read -r flag; do
  [[ "$flag" =~ ^[a-z0-9_]+$ ]] && restore+="'$flag',"
done <<< "$enabled_flags"
if [[ -n "$restore" ]]; then
  d1 --command "UPDATE feature_flags SET enabled = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'd1-reset-dev'
    WHERE flag_key IN (${restore%,})"
  echo "Turned back on: $(echo $enabled_flags)"
fi

d1 --command "CREATE TABLE dev_schema_state (schema_sha256 TEXT NOT NULL); INSERT INTO dev_schema_state VALUES ('$schema_hash')"
echo "Reset $database and applied the current schema."
