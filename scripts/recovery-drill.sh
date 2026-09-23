#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
drill_dir="$(mktemp -d "${TMPDIR:-/tmp}/aurel-d1-drill.XXXXXX")"
source_dir="$drill_dir/source"
restore_dir="$drill_dir/restored"
backup_file="$drill_dir/evidence-backup.sqlite3"
mkdir -p "$source_dir" "$restore_dir"
trap 'rm -rf "$drill_dir"' EXIT
export WRANGLER_LOG_PATH="${TMPDIR:-/tmp}/aurel-wrangler-recovery.log"

cd "$repo_root/apps/events"
pnpm exec wrangler d1 migrations apply aurel-projections --local --persist-to "$source_dir"
pnpm exec wrangler d1 execute aurel-projections --local --persist-to "$source_dir" --command "INSERT INTO subject_profiles (subject_reference,privy_user_reference,onboarding_state,created_at,updated_at) VALUES ('recovery:test','recovery:test','beta_active','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z'); INSERT INTO security_profiles (subject_reference,updated_at) VALUES ('recovery:test','2026-09-21T00:00:00.000Z'); INSERT INTO beta_access (subject_reference,cohort,country_code,status,transaction_limit_usd,terms_version,terms_accepted_at,activated_at,updated_at) VALUES ('recovery:test','drill','PT','active',1000,'drill-v1','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z'); INSERT INTO consent_receipts (consent_id,subject_reference,document_key,document_version,accepted_at,evidence_reference) VALUES ('recovery-consent','recovery:test','beta','drill-v1','2026-09-21T00:00:00.000Z','recovery-drill');"
pnpm exec wrangler d1 execute aurel-projections --local --persist-to "$source_dir" --command "
INSERT INTO wallet_references (wallet_reference,subject_reference,provider,address,chain_family,control_model,observed_at)
VALUES ('recovery-wallet','recovery:test','privy','0x1111111111111111111111111111111111111111','evm','customer','2026-09-21T00:00:00.000Z');
INSERT INTO transaction_intents (intent_id,subject_reference,wallet_reference,intent_type,chain_id,request_json,policy_result_json,disclosure_version,status,created_at,updated_at,expires_at)
VALUES ('recovery-intent','recovery:test','recovery-wallet','transfer',8453,'{}','{}','drill-v1','reviewed','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z','2026-09-21T00:05:00.000Z');
INSERT INTO intent_prepared_calls (intent_id,step_index,subject_reference,wallet_address,chain_id,target_address,native_value,calldata_hash,call_fingerprint,semantic_action,source_reference,expires_at,expected_effect_json,verification_state,created_at,submission_phase)
VALUES ('recovery-intent',0,'recovery:test','0x1111111111111111111111111111111111111111',8453,'0x2222222222222222222222222222222222222222','1','sha256:data','sha256:call','native_transfer','recovery-review','2026-09-21T00:05:00.000Z',json_object('type','native_transfer','recipient','0x2222222222222222222222222222222222222222','amountRaw','1'),'prepared','2026-09-21T00:00:00.000Z','awaiting_step_up');
INSERT INTO action_passkey_credentials (credential_id,subject_reference,public_key_cose,algorithm,rp_id,status,created_at,activated_at)
VALUES ('recovery-credential','recovery:test',X'A101',-7,'app.aurel.test','active','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z');
INSERT INTO action_passkey_challenges (challenge_id,challenge_digest,subject_reference,session_reference,purpose,intent_id,step_index,call_fingerprint,policy_version,rp_id,origin,expires_at,consumed_at,created_at)
VALUES ('recovery-challenge','sha256:recovery','recovery:test','recovery-session','intent_step','recovery-intent',0,'sha256:call',1,'app.aurel.test','https://app.aurel.test','2026-09-21T00:05:00.000Z','2026-09-21T00:01:00.000Z','2026-09-21T00:00:00.000Z');
INSERT INTO action_passkey_authorizations (authorization_id,challenge_id,credential_id,subject_reference,purpose,intent_id,step_index,call_fingerprint,policy_version,authorized_at,expires_at)
VALUES ('recovery-authorization','recovery-challenge','recovery-credential','recovery:test','intent_step','recovery-intent',0,'sha256:call',1,'2026-09-21T00:01:00.000Z','2026-09-21T00:03:00.000Z');"
source_db="$(find "$source_dir/v3/d1/miniflare-D1DatabaseObject" -type f -name '*.sqlite' ! -name 'metadata.sqlite' -print -quit)"
if [[ -z "$source_db" ]]; then
  echo "Recovery drill failed: local D1 database was not created" >&2
  exit 1
fi
sqlite3 "$source_db" ".backup '$backup_file'"
pnpm exec wrangler d1 migrations apply aurel-projections --local --persist-to "$restore_dir"
restore_db="$(find "$restore_dir/v3/d1/miniflare-D1DatabaseObject" -type f -name '*.sqlite' ! -name 'metadata.sqlite' -print -quit)"
if [[ -z "$restore_db" ]]; then
  echo "Recovery drill failed: restore D1 database was not created" >&2
  exit 1
fi
sqlite3 "$restore_db" ".restore '$backup_file'"
if [[ "$(sqlite3 "$restore_db" 'PRAGMA integrity_check;')" != "ok" ]]; then
  echo "Recovery drill failed: restored database did not pass SQLite integrity checks" >&2
  exit 1
fi
# Historical analytics are deliberately disposable. Rebuild their schema in
# the isolated restore and prove this cannot delete the durable evidence below.
sqlite3 "$restore_db" "DROP TABLE portfolio_rebuild_holds; DROP TABLE portfolio_publications; DROP TABLE portfolio_disposals; DROP TABLE portfolio_lots; DROP TABLE portfolio_daily_results; DROP TABLE portfolio_daily_quantities; DROP TABLE portfolio_price_observations; DROP TABLE portfolio_source_checkpoints; DROP TABLE portfolio_events;"
sqlite3 "$restore_db" < "$repo_root/infra/d1/migrations/0017_portfolio_analytics.sql"
sqlite3 "$restore_db" < "$repo_root/infra/d1/migrations/0019_portfolio_publications.sql"
sqlite3 "$restore_db" < "$repo_root/infra/d1/migrations/0020_portfolio_rebuild_holds.sql"
if [[ "$(sqlite3 "$restore_db" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'portfolio_%';")" != "9" ]]; then
  echo "Recovery drill failed: portfolio analytics schema was not rebuilt" >&2
  exit 1
fi
tables="$(pnpm exec wrangler d1 execute aurel-projections --local --persist-to "$restore_dir" --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('webhook_receipts','operational_issues','operational_checks','beta_access','feature_flags','customer_feedback','incident_updates') ORDER BY name;")"

for table in beta_access customer_feedback feature_flags incident_updates operational_checks operational_issues webhook_receipts; do
  if [[ "$tables" != *"$table"* ]]; then
    echo "Recovery drill failed: missing $table" >&2
    exit 1
  fi
done

evidence="$(pnpm exec wrangler d1 execute aurel-projections --local --persist-to "$restore_dir" --command "SELECT subject_reference,cohort,country_code,status,transaction_limit_usd FROM beta_access WHERE subject_reference='recovery:test'; SELECT consent_id,document_version FROM consent_receipts WHERE consent_id='recovery-consent'; SELECT credential_id FROM action_passkey_credentials WHERE credential_id='recovery-credential'; SELECT challenge_id FROM action_passkey_challenges WHERE challenge_id='recovery-challenge'; SELECT authorization_id FROM action_passkey_authorizations WHERE authorization_id='recovery-authorization'; SELECT submission_phase,reported_hash FROM intent_prepared_calls WHERE intent_id='recovery-intent';")"
if [[ "$evidence" != *"recovery:test"* || "$evidence" != *"recovery-consent"* || "$evidence" != *"recovery-credential"* || "$evidence" != *"recovery-challenge"* || "$evidence" != *"recovery-authorization"* || "$evidence" != *"awaiting_step_up"* ]]; then
  echo "Recovery drill failed: retained beta, consent, or passkey evidence was not restored" >&2
  exit 1
fi

echo "Recovery drill passed: migrations, export, clean restore, beta controls, consent, and passkey evidence verified in isolated D1 stores. Production was not accessed or changed."
