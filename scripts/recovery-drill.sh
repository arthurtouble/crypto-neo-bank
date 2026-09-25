#!/usr/bin/env bash
# Apply the D1 schema to an isolated local store, write durable evidence, back
# it up, restore it into a freshly migrated store, and check the evidence
# survived. Production is never accessed.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
drill_dir="$(mktemp -d "${TMPDIR:-/tmp}/aura-d1-drill.XXXXXX")"
source_dir="$drill_dir/source"
restore_dir="$drill_dir/restored"
backup_file="$drill_dir/evidence-backup.sqlite3"
mkdir -p "$source_dir" "$restore_dir"
trap 'rm -rf "$drill_dir"' EXIT
export WRANGLER_LOG_PATH="${TMPDIR:-/tmp}/aura-wrangler-recovery.log"

local_db() {
  find "$1/v3/d1/miniflare-D1DatabaseObject" -type f -name '*.sqlite' ! -name 'metadata.sqlite' -print -quit
}
fail() { echo "Recovery drill failed: $1" >&2; exit 1; }

cd "$repo_root/apps/events"
pnpm exec wrangler d1 migrations apply aurel-projections --local --persist-to "$source_dir"
pnpm exec wrangler d1 execute aurel-projections --local --persist-to "$source_dir" --command "
INSERT INTO subject_profiles (subject_reference,privy_user_reference,created_at,updated_at)
VALUES ('recovery:test','recovery:test','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z');
INSERT INTO security_profiles (subject_reference,daily_limit_cents,updated_at)
VALUES ('recovery:test',100000,'2026-09-21T00:00:00.000Z');
INSERT INTO consent_evidence (consent_id,subject_reference,document_key,document_version,accepted_at,evidence_json)
VALUES ('recovery-consent','recovery:test','terms','drill-v1','2026-09-21T00:00:00.000Z','{}');
INSERT INTO actions (action_id,subject_reference,wallet_address,kind,chain_id,summary_json,calls_json,calls_fingerprint,effects_json,counts_toward_limit,usd_cents,status,transaction_hash,created_at,expires_at,submitted_at,updated_at)
VALUES ('recovery-action','recovery:test','0x1111111111111111111111111111111111111111','transfer',8453,'{}',json_array(json_object('to','0x2222222222222222222222222222222222222222','value','1','data','0x')),'sha256:calls','[]',1,100,'submitted','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-09-21T00:00:00.000Z','2026-09-21T00:10:00.000Z','2026-09-21T00:01:00.000Z','2026-09-21T00:01:00.000Z');
INSERT INTO audit_events (audit_id,subject_reference,actor_type,actor_reference,action,target_type,target_reference,evidence_json,occurred_at)
VALUES ('recovery-audit','recovery:test','customer','recovery:test','security_policy_updated','security_profile','recovery:test','{}','2026-09-21T00:01:00.000Z');"

source_db="$(local_db "$source_dir")"
[[ -n "$source_db" ]] || fail "local D1 database was not created"
sqlite3 "$source_db" ".backup '$backup_file'"

pnpm exec wrangler d1 migrations apply aurel-projections --local --persist-to "$restore_dir"
restore_db="$(local_db "$restore_dir")"
[[ -n "$restore_db" ]] || fail "restore D1 database was not created"
sqlite3 "$restore_db" ".restore '$backup_file'"
[[ "$(sqlite3 "$restore_db" 'PRAGMA integrity_check;')" == "ok" ]] || fail "restored database did not pass SQLite integrity checks"

evidence="$(pnpm exec wrangler d1 execute aurel-projections --local --persist-to "$restore_dir" --command "
SELECT subject_reference || ':' || daily_limit_cents || ':' || account_locked AS security_profile FROM security_profiles WHERE subject_reference='recovery:test';
SELECT consent_id FROM consent_evidence WHERE consent_id='recovery-consent';
SELECT action_id || ':' || status AS action_state FROM actions WHERE action_id='recovery-action';
SELECT audit_id FROM audit_events WHERE audit_id='recovery-audit';
SELECT COUNT(*) AS flags FROM feature_flags;")"
for expected in "recovery:test:100000:0" "recovery-consent" "recovery-action:submitted" "recovery-audit"; do
  [[ "$evidence" == *"$expected"* ]] || fail "retained evidence missing: $expected"
done

echo "Recovery drill passed: schema applied, and security, consent, action, and audit evidence survived backup and restore in isolated D1 stores. Production was not accessed."
