import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recheckOpenActions } from "@/lib/actions/recheck";
import type { verifyAction } from "@/lib/actions/verify";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const now = new Date("2026-09-26T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

describe("the background re-check of open actions", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => {
    sqlite = schemaDatabase();
    const action = (id: string, status: string, checkedAt: string | null, expiresAt = minutesAgo(-5)) => `INSERT INTO actions (action_id, subject_reference,
      wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json, counts_toward_limit, status, transaction_hash,
      checked_at, created_at, expires_at, updated_at) VALUES ('${id}', 'alice', '0x1111111111111111111111111111111111111111', 'transfer', 8453, '{}',
      '[{"to":"0x2222222222222222222222222222222222222222","value":"0","data":"0x"}]', 'fp', '[]', 1, '${status}',
      ${status === "prepared" ? "NULL" : `'0x${id.repeat(64).slice(0, 64)}'`}, ${checkedAt ? `'${checkedAt}'` : "NULL"}, '${minutesAgo(30)}', '${expiresAt}', '${minutesAgo(30)}');`;
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
      ${action("a", "submitted", null)}
      ${action("b", "settling", minutesAgo(5))}
      ${action("c", "submitted", minutesAgo(0.5))}
      ${action("d", "confirmed", null)}
      ${action("e", "prepared", null, minutesAgo(1))}
      ${action("f", "submitted", null)}`);
  });
  afterEach(() => sqlite.close());

  it("checks due submitted and settling actions, records each outcome, and expires stale prepared ones", async () => {
    const seen: string[] = [];
    const verify: typeof verifyAction = async (action) => {
      seen.push(action.transactionHash.slice(2, 3));
      if (action.transactionHash.startsWith("0xa")) return { status: "settling", reason: "finality" };
      if (action.transactionHash.startsWith("0xb")) return { status: "confirmed" };
      throw new Error("rpc down");
    };
    const summary = await recheckOpenActions(d1(sqlite), now, { verify });
    // "c" was checked 30 seconds ago and "d" is already settled.
    expect(seen.sort()).toEqual(["a", "b", "f"]);
    expect(summary).toEqual({ checked: 3, advanced: 2, failedChecks: 1, expired: 1 });
    const rows = sqlite.prepare("SELECT action_id, status, checked_at FROM actions ORDER BY action_id").all() as Array<{ action_id: string; status: string; checked_at: string | null }>;
    expect(Object.fromEntries(rows.map((row) => [row.action_id, row.status]))).toEqual({ a: "settling", b: "confirmed", c: "submitted", d: "confirmed", e: "expired", f: "submitted" });
    // A failed check still counts as checked, so the next run moves on to other actions first.
    expect(rows.find((row) => row.action_id === "f")?.checked_at).toBe(now.toISOString());
  });
});
