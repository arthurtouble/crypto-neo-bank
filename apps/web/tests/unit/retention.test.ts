import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { purgeDue, purgeExpired, RECEIVED_NOTICE_WINDOW_DAYS, retentionDays } from "@/lib/privacy/retention";
import { subjectDataInventory } from "@/lib/privacy/subject-data";
import { d1 } from "../support/d1";
import { schemaDatabase, schemaSql } from "../support/schema";

const now = new Date("2026-10-01T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const wallet = "0x1111111111111111111111111111111111111111";

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = schemaDatabase();
  db = d1(sqlite);
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't')`);
});
afterEach(() => sqlite.close());

const ids = (table: string, key: string) => (sqlite.prepare(`SELECT ${key} AS id FROM ${table} ORDER BY ${key}`).all() as Array<{ id: string }>).map((row) => row.id);
const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function productEvent(id: string, at: string) {
  sqlite.prepare(`INSERT INTO product_events (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
    VALUES (?, 'alice', 's', 'support_opened', '/app', '{}', ?)`).run(id, at);
}
function notice(id: string, at: string, email = "sent", push = "skipped") {
  sqlite.prepare(`INSERT INTO notifications (notification_id, subject_reference, kind, dedupe_key, title, body, created_at, email_status, push_status)
    VALUES (?, 'alice', 'received', ?, 'Received', 'From', ?, ?, ?)`).run(id, `received:${id}`, at, email, push);
}
function quote(id: string, expiresAt: string, actionId: string | null = null) {
  sqlite.prepare(`INSERT INTO route_quotes (quote_id, subject_reference, wallet_address, from_asset_id, to_asset_id, from_chain_id, to_chain_id,
    from_amount_raw, to_amount_raw, to_amount_min_raw, tool, calls_json, economics_json, created_at, expires_at, action_id)
    VALUES (?, 'alice', ?, 'base-usdc', 'base-eth', 8453, 8453, '1', '1', '1', 'lifi', '[]', '{}', ?, ?, ?)`).run(id, wallet, expiresAt, expiresAt, actionId);
}
function action(id: string, quoteId: string | null) {
  sqlite.prepare(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
    counts_toward_limit, route_quote_id, status, created_at, expires_at, updated_at)
    VALUES (?, 'alice', ?, 'route', 8453, '{}', '[{"to":"${wallet}","value":"0","data":"0x"}]', 'fp', '[]', 0, ?, 'failed', ?, ?, ?)`)
    .run(id, wallet, quoteId, daysAgo(400), daysAgo(400), daysAgo(400));
  sqlite.prepare(`INSERT INTO action_events (event_id, action_id, event_type, evidence_json, occurred_at) VALUES (?, ?, 'prepared', '{}', ?)`)
    .run(`${id}:prepared`, id, daysAgo(400));
}
function receipt(id: string, status: string, receivedAt: string) {
  sqlite.prepare(`INSERT INTO webhook_receipts (event_id, provider, event_type, subject_reference, payload_sha256, provider_created_at, received_at, processing_status)
    VALUES (?, 'stripe', 'card.authorization.created', 'alice', 'hash', ?, ?, ?)`).run(id, receivedAt, receivedAt, status);
}

describe("scheduled retention cleanup", () => {
  it("deletes analytics events and delivered notices past 180 days, and keeps recent or undelivered ones", async () => {
    productEvent("old", daysAgo(181));
    productEvent("recent", daysAgo(179));
    notice("old-sent", daysAgo(181));
    notice("old-failed", daysAgo(200), "failed", "failed");
    notice("old-email-pending", daysAgo(400), "pending", "sent");
    notice("old-push-pending", daysAgo(400), "sent", "pending");
    notice("recent", daysAgo(10));
    const counts = await purgeExpired(db, now);
    expect(counts).toMatchObject({ product_events: 1, notifications: 2 });
    expect(ids("product_events", "event_id")).toEqual(["recent"]);
    expect(ids("notifications", "notification_id")).toEqual(["old-email-pending", "old-push-pending", "recent"]);
  });

  it("deletes used-up passkey confirmations, rate-limit counters, and idempotency claims only after their grace period", async () => {
    const challenge = sqlite.prepare(`INSERT INTO step_up_challenges (challenge_id, subject_reference, purpose, payload_hash, message, created_at, expires_at, used_at)
      VALUES (?, 'alice', 'security_policy', 'h', 'm', ?, ?, ?)`);
    challenge.run("expired-used", daysAgo(3), daysAgo(3), daysAgo(3));
    challenge.run("expired-unused", daysAgo(2), daysAgo(2), null);
    challenge.run("expired-today", daysAgo(0.5), daysAgo(0.5), null);
    challenge.run("live", now.toISOString(), new Date(now.getTime() + 300_000).toISOString(), null);
    const window = sqlite.prepare("INSERT INTO rate_limit_windows (bucket_key, hits, reset_at) VALUES (?, 1, ?)");
    window.run("old", now.getTime() - 2 * 86_400_000);
    window.run("reset-an-hour-ago", now.getTime() - 3_600_000);
    window.run("open", now.getTime() + 60_000);
    const claim = sqlite.prepare(`INSERT INTO command_idempotency (idempotency_key, subject_reference, command_type, provider, status, created_at, expires_at)
      VALUES (?, 'alice', 'bank_payout', 'bridge', 'completed', ?, ?)`);
    claim.run("old", daysAgo(40), daysAgo(31));
    claim.run("recent", daysAgo(5), daysAgo(4));
    claim.run("live", now.toISOString(), daysAgo(-1));

    expect(await purgeExpired(db, now)).toMatchObject({ step_up_challenges: 2, rate_limit_windows: 1, command_idempotency: 1 });
    expect(ids("step_up_challenges", "challenge_id")).toEqual(["expired-today", "live"]);
    expect(ids("rate_limit_windows", "bucket_key")).toEqual(["open", "reset-an-hour-ago"]);
    expect(ids("command_idempotency", "idempotency_key")).toEqual(["live", "recent"]);
  });

  it("deletes expired, unused route quotes, and never a quote an action used, even one not yet marked used", async () => {
    quote("unused-old", daysAgo(2));
    quote("unused-fresh", daysAgo(0.5));
    quote("live", daysAgo(-0.01));
    action("a-marked", "used-marked");
    quote("used-marked", daysAgo(400), "a-marked");
    // The action was recorded but the quote not yet marked used (markQuoteUsed runs after the action is saved).
    action("a-unmarked", "used-unmarked");
    quote("used-unmarked", daysAgo(400));

    expect(await purgeExpired(db, now)).toMatchObject({ route_quotes: 1 });
    expect(ids("route_quotes", "quote_id")).toEqual(["live", "unused-fresh", "used-marked", "used-unmarked"]);
  });

  it("deletes processed webhook receipts after two years, and keeps unfinished or failed ones for reconciliation", async () => {
    receipt("processed-old", "processed", daysAgo(731));
    receipt("processed-recent", "processed", daysAgo(100));
    receipt("failed-old", "failed", daysAgo(800));
    receipt("received-old", "received", daysAgo(800));
    receipt("enqueued-old", "enqueued", daysAgo(800));
    expect(await purgeExpired(db, now)).toMatchObject({ webhook_receipts: 1 });
    expect(ids("webhook_receipts", "event_id")).toEqual(["enqueued-old", "failed-old", "processed-recent", "received-old"]);
  });

  it("deletes at most the limit from each table per run, and catches up on later runs", async () => {
    for (let index = 0; index < 5; index++) productEvent(`old-${index}`, daysAgo(200));
    expect((await purgeExpired(db, now, 2)).product_events).toBe(2);
    expect((await purgeExpired(db, now, 2)).product_events).toBe(2);
    expect((await purgeExpired(db, now, 2)).product_events).toBe(1);
    expect((await purgeExpired(db, now, 2)).product_events).toBe(0);
  });

  it("never touches financial, consent, audit, account, or projection records, however old", async () => {
    const old = daysAgo(5000);
    action("a-old", null);
    sqlite.exec(`
      INSERT INTO consent_evidence (consent_id, subject_reference, document_key, document_version, accepted_at, evidence_json) VALUES ('c', 'alice', 'terms', 'v1', '${old}', '{}');
      INSERT INTO consent_events (consent_event_id, subject_reference, purpose, action, notice_version, occurred_at) VALUES ('ce', 'alice', 'marketing', 'granted', 'v1', '${old}');
      INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, evidence_json, occurred_at) VALUES ('au', 'alice', 'customer', 'alice', 'x', 'y', '{}', '${old}');
      INSERT INTO operational_issues (issue_id, issue_type, severity, source_name, summary, status, opened_at, resolved_at) VALUES ('oi', 't', 'high', 's', 's', 'resolved', '${old}', '${old}');
      INSERT INTO incoming_observations (transfer_id, subject_reference, wallet_address, chain_id, transaction_hash, from_address, asset_id, symbol, decimals, amount_raw, amount, final, source, received_at, observed_at)
        VALUES ('io', 'alice', '${wallet}', 8453, '0x${"b".repeat(64)}', '${wallet}', 'base-usdc', 'USDC', 6, '1', '1', 1, 'alchemy', '${old}', '${old}');
      INSERT INTO card_observations (activity_id, subject_reference, kind, status, amount_usd, occurred_at, observed_at) VALUES ('co', 'alice', 'payment', 'completed', '1.00', '${old}', '${old}');
      INSERT INTO incoming_watches (subject_reference, wallet_address, watched_since, last_active_at) VALUES ('alice', '${wallet}', '${old}', '${old}');
      INSERT INTO push_subscriptions (endpoint, subject_reference, p256dh, auth, created_at, failures) VALUES ('https://push.test/1', 'alice', 'k', 'a', '${old}', 500);
    `);
    const tables = ["actions", "action_events", "consent_evidence", "consent_events", "audit_events", "operational_issues", "incoming_observations",
      "card_observations", "incoming_watches", "push_subscriptions", "subject_profiles", "feature_flags"];
    const before = Object.fromEntries(tables.map((table) => [table, count(table)]));
    await purgeExpired(db, now);
    expect(Object.fromEntries(tables.map((table) => [table, count(table)]))).toEqual(before);
    expect(before.actions).toBe(1);
  });

  it("only purges tables that exist, are classified, and keep received notices longer than they can be announced", () => {
    const schema = schemaSql();
    for (const table of Object.keys(retentionDays)) {
      expect(schema).toMatch(new RegExp(`CREATE TABLE ${table} \\(`));
      if (table !== "rate_limit_windows") expect(Object.keys(subjectDataInventory)).toContain(table);
    }
    expect(retentionDays.notifications).toBeGreaterThan(RECEIVED_NOTICE_WINDOW_DAYS);
  });

  it("runs on the cron tick at the top of each hour", () => {
    expect(purgeDue(new Date("2026-10-01T12:00:00.000Z"))).toBe(true);
    expect(purgeDue(new Date("2026-10-01T12:02:00.000Z"))).toBe(false);
  });
});
