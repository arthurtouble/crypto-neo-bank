import { afterEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

// The cron runs without injected dependencies, so it uses the real chain check; here it can't reach the chain.
vi.mock("@/lib/actions/verify", () => ({ verifyAction: vi.fn(async () => { throw new Error("rpc down"); }) }));
const { recheckOpenActions } = await import("@/lib/actions/recheck");

const now = new Date("2026-09-26T12:00:00.000Z");
const sqlite = schemaDatabase();
afterEach(() => vi.restoreAllMocks());

describe("the background re-check in production", () => {
  it("counts checks that couldn't read the chain, without injected dependencies", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
      INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
        counts_toward_limit, status, transaction_hash, created_at, expires_at, updated_at)
      VALUES ('a', 'alice', '0x1111111111111111111111111111111111111111', 'transfer', 8453, '{}',
        '[{"to":"0x2222222222222222222222222222222222222222","value":"0","data":"0x"}]', 'fp', '[]', 1, 'submitted', '0x${"a".repeat(64)}',
        '2026-09-26T11:00:00.000Z', '2026-09-26T11:10:00.000Z', '2026-09-26T11:00:00.000Z');`);
    expect(await recheckOpenActions(d1(sqlite), now)).toEqual({ checked: 1, advanced: 0, failedChecks: 1, expired: 0 });
    expect(sqlite.prepare("SELECT status, checked_at FROM actions").get()).toEqual({ status: "submitted", checked_at: now.toISOString() });
  });
});
