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
INSERT INTO security_profiles (subject_reference,daily_limit_usd,updated_at)
VALUES ('recovery:test',1000,'2026-09-21T00:00:00.000Z');
INSERT INTO consent_evidence (consent_id,subject_reference,document_key,document_version,accepted_at,evidence_json)
VALUES ('recovery-consent','recovery:test','terms','drill-v1','2026-09-21T00:00:00.000Z','{}');
INSERT INTO wallet_references (wallet_reference,subject_reference,provider,address,chain_family,control_model,observed_at)
VALUES ('recovery-wallet','recovery:test','privy','0x1111111111111111111111111111111111111111','evm','customer','2026-09-21T00:00:00.000Z');
INSERT INTO transaction_intents (intent_id,subject_reference,wallet_reference,intent_type,chain_id,request_json,policy_result_json,disclosure_version,status,created_at,updated_at,expires_at)
VALUES ('recovery-intent','recovery:test','recovery-wallet','transfer',8453,'{}','{}','drill-v1','reviewed','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z','2026-09-21T00:05:00.000Z');
INSERT INTO intent_prepared_calls (intent_id,step_index,subject_reference,wallet_address,chain_id,target_address,native_value,calldata_hash,call_fingerprint,semantic_action,source_reference,expires_at,expected_effect_json,verification_state,created_at,submission_phase)
VALUES ('recovery-intent',0,'recovery:test','0x1111111111111111111111111111111111111111',8453,'0x2222222222222222222222222222222222222222','1','sha256:data','sha256:call','native_transfer','recovery-review','2026-09-21T00:05:00.000Z',json_object('type','native_transfer','recipient','0x2222222222222222222222222222222222222222','amountRaw','1'),'prepared','2026-09-21T00:00:00.000Z','legacy');
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
SELECT subject_reference || ':' || CAST(daily_limit_usd AS INTEGER) || ':' || account_locked AS security_profile FROM security_profiles WHERE subject_reference='recovery:test';
SELECT consent_id FROM consent_evidence WHERE consent_id='recovery-consent';
SELECT intent_id || ':' || verification_state AS prepared FROM intent_prepared_calls WHERE intent_id='recovery-intent';
SELECT audit_id FROM audit_events WHERE audit_id='recovery-audit';
SELECT COUNT(*) AS flags FROM feature_flags;")"
for expected in "recovery:test:1000:0" "recovery-consent" "recovery-intent:prepared" "recovery-audit"; do
  [[ "$evidence" == *"$expected"* ]] || fail "retained evidence missing: $expected"
done

echo "Recovery drill passed: schema applied, and security, consent, intent, and audit evidence survived backup and restore in isolated D1 stores. Production was not accessed."
