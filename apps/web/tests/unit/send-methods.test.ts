import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const state = vi.hoisted(() => ({ db: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
const { GET } = await import("@/app/api/send/methods/route");

const read = async () => (await GET(new Request("https://aura.test/api/send/methods"))).json();

describe("what Send can do now", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); });

  it("follows the send and other-network switches", async () => {
    expect(await read()).toMatchObject({ sending: false, otherNetworks: false });
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'direct_transfers'");
    expect(await read()).toMatchObject({ sending: true, otherNetworks: false });
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'cross_chain'");
    expect(await read()).toMatchObject({ sending: true, otherNetworks: true });
  });

  it("says what the customer's own controls and paused assets would stop, before anything is filled in", async () => {
    expect(await read()).toMatchObject({ accountLocked: false, savedRecipientsOnly: false, dailyLimitUsd: null, leftTodayUsd: null, pausedAssets: [] });
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'privy-alice', ?, ?)").run(now, now);
    sqlite.prepare("INSERT INTO security_profiles (subject_reference, account_locked, enforce_address_book, daily_limit_cents, updated_at) VALUES ('alice', 1, 1, 10000, ?)").run(now);
    sqlite.prepare(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint,
        effects_json, counts_toward_limit, usd_cents, status, created_at, expires_at, updated_at)
      VALUES ('a1', 'alice', '0x1111111111111111111111111111111111111111', 'transfer', 8453, '{}', '[{"to":"0x1","value":"0","data":"0x"}]', 'f', '[]', 1, 2550, 'confirmed', ?, ?, ?)`).run(now, now, now);
    sqlite.prepare("INSERT INTO asset_pauses (asset_id, reason, paused_at, paused_by) VALUES ('8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'Issuer incident', ?, 'ops')").run(now);
    expect(await read()).toMatchObject({ accountLocked: true, savedRecipientsOnly: true, dailyLimitUsd: 100, leftTodayUsd: 74.5,
      pausedAssets: ["8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"] });
    // A recent send with no value can't be counted, so what's left isn't known.
    sqlite.prepare(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint,
        effects_json, counts_toward_limit, usd_cents, status, created_at, expires_at, updated_at)
      VALUES ('a2', 'alice', '0x1111111111111111111111111111111111111111', 'transfer', 8453, '{}', '[{"to":"0x1","value":"0","data":"0x"}]', 'g', '[]', 1, NULL, 'confirmed', ?, ?, ?)`).run(now, now, now);
    expect(await read()).toMatchObject({ dailyLimitUsd: 100, leftTodayUsd: null });
  });
});
