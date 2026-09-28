import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

vi.mock("@/lib/auth/privy", () => ({ privyClient: () => { throw new Error("no Privy in unit tests"); }, privyEmail: async () => null }));

const { actionEntry, incomingEntry, entryCategory, entryDirection } = await import("@/lib/activity/entries");
const { BridgeClient } = await import("@/lib/providers/bridge/client");
const { listBankDeposits, payoutStateText, readTransferState } = await import("@/lib/providers/bridge/transfers");
const { refreshBankPayouts } = await import("@/lib/money/bank-activity");
const { getAction } = await import("@/lib/actions/store");

const wallet = "0x1111111111111111111111111111111111111111";
const hash = (digit: string) => `0x${digit.repeat(64)}`;

describe("Bridge transfer and deposit reads", () => {
  const client = (routes: Record<string, unknown>) => new BridgeClient("key", "https://bridge.test/v0", (async (url: string) => {
    const path = new URL(url).pathname.replace("/v0", "") + new URL(url).search;
    const body = routes[path];
    return body === undefined ? new Response("{}", { status: 404 }) : Response.json(body);
  }) as unknown as typeof fetch);

  it("reads a payout's state", async () => {
    expect(await readTransferState(client({ "/transfers/tr_1": { id: "tr_1", state: "payment_submitted" } }), "tr_1")).toBe("payment_submitted");
  });

  it("finds bank deposits delivered to the account, keyed by the delivering transaction, ignoring other accounts and unfinished ones", async () => {
    const deposits = await listBankDeposits(client({
      "/customers/cus_1/virtual_accounts?limit=10": { data: [
        { id: "va_usd", source_deposit_instructions: { currency: "usd" } }, { id: "va_eur", source_deposit_instructions: { currency: "eur" } }] },
      "/customers/cus_1/virtual_accounts/va_usd/history?event_type=payment_processed&limit=50": { data: [
        { id: "e1", type: "payment_processed", destination_tx_hash: hash("A"), source: { payment_rail: "ach_push", sender_name: " Jane Customer ", bank_name: "Chase" } },
        { id: "e2", type: "payment_processed", destination_tx_hash: null },
        { id: "e3", type: "funds_received", destination_tx_hash: hash("b") }] }
    }), "cus_1");
    expect([...deposits.values()]).toEqual([{ transactionHash: hash("a"), senderName: "Jane Customer", bankName: "Chase", rail: "ach_push" }]);
  });

  it("describes every payout state in plain words", () => {
    expect(payoutStateText("payment_processed")).toBe("Arrived at your bank");
    expect(payoutStateText("returned")).toMatch(/returned/);
    expect(payoutStateText("something_new")).toBe("Bridge is processing this payout");
  });
});

describe("bank entries in Transactions", () => {
  const payout = (status: string, bankState: string | null) => ({ id: "a1", kind: "transfer" as const, chainId: 8453, status, usdCents: 2500,
    summary: { symbol: "USDC", amount: "25", bankPayout: { provider: "bridge", transferId: "tr_1", bankName: "Chase", lastFour: "6789" } },
    transactionHash: hash("c"), destinationChainId: null, destinationTransactionHash: null, failureReason: null, createdAt: "2026-09-28T12:00:00.000Z", bankState });

  it("keeps a payout pending until Bridge says the bank has it, and fails it if the bank returns it", () => {
    expect(actionEntry(payout("submitted", null))).toMatchObject({ type: "bank_payout", status: "pending", bankStatus: undefined, counterparty: "Chase ending 6789" });
    expect(actionEntry(payout("settling", null))).toMatchObject({ status: "pending", bankStatus: "Waiting for your USDC to reach Bridge" });
    expect(actionEntry(payout("confirmed", "payment_submitted"))).toMatchObject({ status: "pending", bankStatus: "Sent to your bank" });
    expect(actionEntry(payout("confirmed", "payment_processed"))).toMatchObject({ status: "completed", final: true, bankStatus: "Arrived at your bank" });
    expect(actionEntry(payout("confirmed", "returned"))).toMatchObject({ status: "failed" });
    // If the funding itself failed on chain, Bridge never got anything.
    expect(actionEntry(payout("failed", null))).toMatchObject({ status: "failed", bankStatus: undefined });
    expect(entryCategory("bank_payout")).toBe("Sent");
    expect(entryDirection("bank_payout")).toBe("out");
  });

  it("shows a bank deposit as from the sender, not from Bridge's address", () => {
    const transfer = { id: "t1", chainId: 8453, transactionHash: hash("a"), from: "0x00000000000000000000000000000000b41d6e01", assetId: "base-usdc", symbol: "USDC",
      decimals: 6, amountRaw: "25000000", amount: "25", blockNumber: 1, receivedAt: "t", status: "completed" as const, final: true, source: "Alchemy" };
    expect(incomingEntry(transfer, 100, { senderName: "Jane Customer", bankName: "Chase" }))
      .toMatchObject({ type: "bank_deposit", counterparty: "Jane Customer", source: "Alchemy · Bridge", estimatedUsd: 25 });
    expect(incomingEntry(transfer, 100, { senderName: null, bankName: null })).toMatchObject({ counterparty: "Bank transfer" });
    expect(incomingEntry(transfer)).toMatchObject({ type: "received", counterparty: transfer.from });
    expect(entryDirection("bank_deposit")).toBe("in");
  });
});

describe("refreshing payouts from Bridge", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  const now = new Date("2026-09-28T12:00:00.000Z");
  beforeEach(() => {
    sqlite = schemaDatabase();
    db = d1(sqlite);
    const insert = (id: string, status: string, transferId: string | null) => sqlite.exec(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id,
      summary_json, calls_json, calls_fingerprint, effects_json, counts_toward_limit, status, transaction_hash, created_at, expires_at, updated_at)
      VALUES ('${id}', 'alice', '${wallet}', 'transfer', 8453, '${JSON.stringify({ symbol: "USDC", amount: "25", ...(transferId ? { bankPayout: { transferId, bankName: "Chase", lastFour: "6789" } } : {}) })}',
      '[{"to":"${wallet}","value":"0","data":"0x"}]', 'fp', '[]', 1, '${status}', '${hash(id)}', '2026-09-28T11:00:00.000Z', '2026-09-28T11:05:00.000Z', '2026-09-28T11:00:00.000Z')`);
    sqlite.exec("INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't')");
    insert("a", "confirmed", "tr_a");
    insert("b", "submitted", "tr_b");
    insert("c", "confirmed", null);
  });
  afterEach(() => sqlite.close());

  it("records each new state once for payouts that reached Base, skips finished ones, and tells the customer when the bank has it", async () => {
    const reads: string[] = [];
    let state = "payment_submitted";
    const read = async (id: string) => { reads.push(id); return state; };
    expect(await refreshBankPayouts(db, { now, read })).toBe(1);
    // "b" hasn't reached Base yet and "c" isn't a payout.
    expect(reads).toEqual(["tr_a"]);
    expect(await refreshBankPayouts(db, { now, read })).toBe(0);
    expect((await getAction(db, "alice", "a"))?.bankState).toBe("payment_submitted");

    state = "payment_processed";
    expect(await refreshBankPayouts(db, { now: new Date(now.getTime() + 1000), read })).toBe(1);
    expect((await getAction(db, "alice", "a"))?.bankState).toBe("payment_processed");
    expect(sqlite.prepare("SELECT kind, title FROM notifications").all()).toEqual([{ kind: "completed", title: "25 USDC arrived at your bank" }]);
    // Finished: not read again.
    reads.length = 0;
    await refreshBankPayouts(db, { now: new Date(now.getTime() + 2000), read });
    expect(reads).toEqual([]);
  });

  it("tells the customer when a payout comes back, and ignores a Bridge read that fails", async () => {
    await refreshBankPayouts(db, { now, read: async () => { throw new Error("Bridge down"); } });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM action_events WHERE event_type = 'bank_payout'").get()).toEqual({ n: 0 });
    await refreshBankPayouts(db, { now, read: async () => "returned" });
    expect(sqlite.prepare("SELECT kind, title, body FROM notifications").get())
      .toEqual({ kind: "failed", title: "25 USDC didn't reach your bank", body: "Your bank returned it. Bridge is sending the money back." });
  });

  it("does nothing while bank accounts are off", async () => {
    expect(await refreshBankPayouts(db, { now })).toBe(0);
  });
});
