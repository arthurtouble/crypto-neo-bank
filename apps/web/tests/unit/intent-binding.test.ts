import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";

const state = vi.hoisted(() => ({
  subject: "subject-a",
  walletLinked: true,
  betaAllowed: true,
  featureAllowed: true,
  accountLocked: false,
  dailyLimitUsd: 25_000,
  stepUpThresholdUsd: 10_000,
  spentTodayUsd: 0,
  spentMissing: false,
  atomicReservationExceeded: false,
  lastInsert: null as null | { query: string; args: unknown[] },
  valuationFails: false,
  valuationCents: "1",
  valuations: [] as Array<unknown>,
  addressBook: [] as Array<{ address: string; available_at: string }>,
  intentUpdateAllowed: true,
  intent: null as null | Record<string, unknown>,
  prepared: new Map<number, Record<string, unknown>>(),
  events: [] as string[],
  issues: [] as string[]
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  async batch(statements: Array<{ query: string }>) {
    return statements.map((statement) => ({ results: statement.query.includes("security_profiles") ? [{ account_locked: state.accountLocked ? 1 : 0, enforce_address_book: 0, daily_limit_usd: state.dailyLimitUsd, new_address_threshold_usd: 1_000, step_up_threshold_usd: state.stepUpThresholdUsd, new_address_delay_seconds: 86_400 }] : statement.query.includes("address_book_entries") ? state.addressBook : [{ spent_cents: state.spentTodayUsd * 100, missing: state.spentMissing ? 1 : 0 }] }));
  },
  prepare(query: string) {
    return { bind(...args: unknown[]) {
      return {
        query,
        async first() {
          if (query.includes("FROM intent_prepared_calls")) {
            if (state.intent?.intent_id !== args[0] || state.intent?.subject_reference !== args[2]) return null;
            return state.prepared.get(Number(args[1])) ?? null;
          }
          if (query.includes("FROM transaction_intents") && !query.includes("intent_prepared_calls")) return state.intent?.intent_id === args[0] && state.intent?.subject_reference === args[1] ? state.intent : null;
          if (query.includes("FROM security_profiles")) return { account_locked: state.accountLocked ? 1 : 0 };
          return null;
        },
        async run() {
          if (query.includes("INSERT INTO intent_valuations")) { state.valuations.push(args); return { meta: { changes: 1 } }; }
          if (query.includes("INSERT INTO intent_prepared_calls")) {
            state.lastInsert = { query, args };
            const step = Number(args[0]);
            if (state.atomicReservationExceeded && query.includes("reserved_spend")) return { meta: { changes: 0 } };
            if (state.intent?.status !== "reviewed" || state.accountLocked || state.prepared.has(step) || (step > 0 && state.prepared.get(step - 1)?.verification_state !== "confirmed")) return { meta: { changes: 0 } };
            state.prepared.set(step, { intent_id: args[12], step_index: step, subject_reference: args[13], wallet_address: args[1], chain_id: args[2], target_address: args[3], native_value: args[4], calldata_hash: args[5], call_fingerprint: args[6], semantic_action: args[7], source_reference: args[8], expected_effect_json: args[9], expires_at: state.intent.expires_at, verification_state: "prepared", reported_hash: null });
            return { meta: { changes: 1 } };
          }
          if (query.includes("INSERT INTO intent_events")) { state.events.push(String(args[3])); return { meta: { changes: 1 } }; }
          if (query.includes("INSERT INTO operational_issues")) { state.issues.push(String(args[0])); return { meta: { changes: 1 } }; }
          if (query.includes("UPDATE intent_prepared_calls")) {
            const step = Number(query.includes("'inconsistent'") ? args[2] : args[3]); const row = state.prepared.get(step);
            if (!row) return { meta: { changes: 0 } };
            if (query.includes("SET reported_hash") && row.reported_hash && String(row.reported_hash).toLowerCase() !== String(args[0]).toLowerCase()) return { meta: { changes: 0 } };
            if (query.includes("SET reported_hash")) row.reported_hash = args[0];
            row.verification_state = query.includes("verification_state = 'inconsistent'") ? "inconsistent" : query.includes("verification_state = 'reported'") ? "reported" : "pending";
            return { meta: { changes: 1 } };
          }
          if (query.includes("UPDATE transaction_intents")) { if (!state.intentUpdateAllowed) return { meta: { changes: 0 } }; if (state.intent) state.intent.status = "submitted"; return { meta: { changes: 1 } }; }
          return { meta: { changes: 1 } };
        }
      };
    } };
  }
} } }));

vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class AuthenticationError extends Error {}, requireVerifiedSubject: async () => ({ subjectReference: state.subject, sessionReference: "session-a" }) }));
vi.mock("@/lib/beta/access", () => ({ BetaAccessError: class BetaAccessError extends Error {}, requireBetaAccess: async () => { if (!state.betaAllowed) throw new Error("Beta denied"); return { transactionLimitUsd: 25_000 }; } }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: class FeatureUnavailableError extends Error {}, requireFeature: async () => { if (!state.featureAllowed) throw new Error("Feature denied"); } }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class RateLimitError extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/auth/wallet", () => {
  class WalletOwnershipError extends Error {}
  return { WalletOwnershipError, requireLinkedEvmWallet: async (_subject: string, address: string) => { if (!state.walletLinked) throw new WalletOwnershipError("Wallet denied"); return address.toLowerCase(); } };
});
vi.mock("@/lib/transactions/valuation", () => {
  class ValuationError extends Error {}
  return { ValuationError, valueTransfer: async () => {
    if (state.valuationFails) throw new ValuationError("Price unavailable");
    return { assetId: "eip155:8453/slip44:60", rawUnits: "100", decimals: 18, priceUsd: "2000", marketPriceUsd: "2000", priceSource: "kraken:ETHUSD:1m:high", priceObservedAt: new Date().toISOString(), valuedAt: new Date().toISOString(), usdCents: state.valuationCents, policyVersion: 1, depegUncertainty: false };
  } };
});

import { POST as prepare, validatePreparedAction } from "@/app/api/intents/prepare/route";
import { observeTransaction, observeTransactionIdentity } from "@/lib/transactions/chain-observation";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { POST as reportStatus } from "@/app/api/intents/status/route";

const sender = "0x000000000000000000000000000000000000dEaD";
const recipient = "0x0000000000000000000000000000000000000001";
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const txHash = `0x${"a".repeat(64)}`;
afterEach(() => vi.unstubAllGlobals());

describe("prepared action semantics", () => {
  const native = {
    intentType: "transfer",
    semanticAction: "native_transfer",
    reviewedAsset: "ETH",
    reviewedAmount: "0.0000000000000001",
    reviewedDestination: recipient,
    call: { chainId: 8453, from: sender, to: recipient, value: "100", data: "0x" },
    expectedEffect: { type: "native_transfer", recipient, amountRaw: "100" }
  };

  it("accepts an exact native transfer", () => {
    expect(validatePreparedAction(native)).toEqual(native.expectedEffect);
  });

  it.each([
    ["destination", { call: { ...native.call, to: token } }],
    ["value", { call: { ...native.call, value: "101" } }],
    ["calldata", { call: { ...native.call, data: "0x1234" } }],
    ["effect amount", { expectedEffect: { ...native.expectedEffect, amountRaw: "101" } }],
    ["extra effect field", { expectedEffect: { ...native.expectedEffect, unreviewed: true } }],
    ["wrong intent type", { intentType: "swap" }]
  ] as const)("rejects native transfer with changed %s", (_label, change) => {
    expect(() => validatePreparedAction({ ...native, ...change })).toThrow();
  });

  it("rejects an opaque swap call with client-supplied effect", () => {
    expect(() => validatePreparedAction({ intentType: "swap", semanticAction: "swap", call: { chainId: 8453, from: sender, to: token, value: "0", data: "0x1234" }, expectedEffect: { type: "contract_event", contract: token, topic0: txHash } })).toThrow();
  });

  it("rejects approvals until a server-validated quote or protocol plan binds the spender", () => {
    const spender = "0x0000000000000000000000000000000000000002";
    const data = `0x095ea7b3${spender.slice(2).padStart(64, "0")}${(100n).toString(16).padStart(64, "0")}`;
    const approval = { intentType: "swap", semanticAction: "erc20_approval", call: { chainId: 8453, from: sender, to: token, value: "0", data }, expectedEffect: { type: "erc20_approval", token, spender, amountRaw: "100" } };
    expect(() => validatePreparedAction(approval)).toThrow();
    expect(() => validatePreparedAction({ ...approval, expectedEffect: { ...approval.expectedEffect, spender: recipient } })).toThrow();
  });

  it("rejects a larger native value or a different reviewed asset", () => {
    expect(() => validatePreparedAction({ ...native, reviewedAmount: "0.000000000000001" })).toThrow();
    expect(() => validatePreparedAction({ ...native, reviewedAsset: "USDC" })).toThrow();
  });

  it("requires the transfer destination to have been reviewed", () => {
    expect(() => validatePreparedAction({ ...native, reviewedDestination: undefined })).toThrow();
  });

  it("binds a USDC transfer to the trusted Base contract and six-decimal reviewed amount", () => {
    const data = `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${(1_000_000n).toString(16).padStart(64, "0")}`;
    const transfer = { intentType: "transfer", semanticAction: "erc20_transfer", reviewedAsset: "USDC", reviewedAmount: "1", reviewedDestination: recipient, call: { chainId: 8453, from: sender, to: token, value: "0", data }, expectedEffect: { type: "erc20_transfer", token, recipient, amountRaw: "1000000" } };
    expect(validatePreparedAction(transfer)).toEqual(transfer.expectedEffect);
    expect(() => validatePreparedAction({ ...transfer, reviewedAmount: "0.1" })).toThrow();
    expect(() => validatePreparedAction({ ...transfer, reviewedAsset: "WETH" })).toThrow();
  });
});

describe("chain transaction identity observation", () => {
  it("returns pending when the chain has not indexed the hash", async () => {
    const fetcher = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const method = JSON.parse(String(init.body)).method;
      return Response.json({ jsonrpc: "2.0", id: 1, result: method === "eth_chainId" ? "0x2105" : null });
    });
    expect(await observeTransactionIdentity(8453, txHash, fetcher)).toEqual({ status: "pending" });
  });

  it("returns the chain call only after RPC chain identity agrees", async () => {
    const fetcher = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const method = JSON.parse(String(init.body)).method;
      return Response.json({ jsonrpc: "2.0", id: 1, result: method === "eth_chainId" ? "0x2105" : { hash: txHash, from: sender, to: recipient, value: "0x64", input: "0x", chainId: "0x2105", blockHash: null } });
    });
    expect(await observeTransactionIdentity(8453, txHash, fetcher)).toMatchObject({ status: "found", call: { chainId: 8453, from: sender, to: recipient, value: "100", data: "0x" } });
  });

  it("rejects a mismatched RPC network", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    await expect(observeTransactionIdentity(8453, txHash, fetcher)).rejects.toThrow(/chain/i);
  });

  it("reads receipt, canonical block, head, and finalized height independently", async () => {
    const blockHash = `0x${"b".repeat(64)}`;
    const fetcher = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body));
      const result = method === "eth_chainId" ? "0x2105"
        : method === "eth_getTransactionByHash" ? { hash: txHash, from: sender, to: recipient, value: "0x64", input: "0x", chainId: "0x2105", blockHash }
        : method === "eth_getTransactionReceipt" ? { transactionHash: txHash, blockHash, blockNumber: "0x64", status: "0x1", logs: [] }
        : method === "eth_getBlockByNumber" && params[0] === "finalized" ? { number: "0x64", hash: blockHash }
        : method === "eth_getBlockByNumber" ? { number: "0x64", hash: blockHash }
        : method === "eth_blockNumber" ? "0x66" : null;
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    });
    expect(await observeTransaction(8453, txHash, fetcher)).toMatchObject({ status: "found", canonicalBlockHash: blockHash, confirmations: 3, finalizedBlockNumber: 100n });
  });

  it("rejects receipt evidence from an RPC on the wrong chain", async () => {
    let chainChecks = 0;
    const fetcher = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const { method } = JSON.parse(String(init.body));
      const result = method === "eth_chainId" ? (++chainChecks === 1 ? "0x2105" : "0x1")
        : method === "eth_getTransactionByHash" ? { hash: txHash, from: sender, to: recipient, value: "0x64", input: "0x", chainId: "0x2105", blockHash: null } : null;
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    });
    await expect(observeTransaction(8453, txHash, fetcher)).rejects.toThrow(/wrong chain/i);
  });
});

describe("intent preparation route", () => {
  const intentId = "00000000-0000-4000-8000-000000000001";
  const payload = { intentId, stepIndex: 0, call: { chainId: 8453, from: sender, to: recipient, value: "100", data: "0x" }, semanticAction: "native_transfer", sourceReference: "review-1", expectedEffect: { type: "native_transfer", recipient, amountRaw: "100" } };
  async function request(body: unknown) { return prepare(new Request("https://aurel.test/api/intents/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); }

  beforeEach(() => {
    state.subject = "subject-a"; state.walletLinked = true; state.betaAllowed = true; state.featureAllowed = true; state.accountLocked = false; state.dailyLimitUsd = 25_000; state.stepUpThresholdUsd = 10_000; state.spentTodayUsd = 0; state.spentMissing = false; state.atomicReservationExceeded = false; state.lastInsert = null; state.valuationFails = false; state.valuationCents = "1"; state.valuations.length = 0; state.addressBook = []; state.intentUpdateAllowed = true; state.prepared.clear(); state.events.length = 0; state.issues.length = 0;
    state.intent = { intent_id: intentId, subject_reference: "subject-a", intent_type: "transfer", chain_id: 8453, wallet_reference: `wallet:${sender.toLowerCase()}`, request_json: JSON.stringify({ type: "transfer", chainId: 8453, destination: recipient, asset: "ETH", amount: "0.0000000000000001", estimatedUsd: 20 }), policy_result_json: JSON.stringify({ permitted: true }), status: "reviewed", expires_at: new Date(Date.now() + 60_000).toISOString() };
  });

  it("prepares an exact call once and rejects a duplicate", async () => {
    const first = await request(payload);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ intentId, stepIndex: 0 });
    expect(state.prepared.get(0)).toMatchObject({ chain_id: 8453, native_value: "100", semantic_action: "native_transfer" });
    expect(state.valuations).toHaveLength(1);
    expect((await request(payload)).status).toBe(409);
  });

  it("refuses preparation when another request reserves the remaining daily limit before the atomic write", async () => {
    state.atomicReservationExceeded = true;
    expect((await request(payload)).status).toBe(409);
    expect(state.prepared.size).toBe(0);
  });

  it("enforces the reservation cap in SQLite's conditional INSERT, including another prepared intent", async () => {
    expect((await request(payload)).status).toBe(201);
    const captured = state.lastInsert;
    expect(captured).not.toBeNull();
    const bound = [...captured!.args];
    const sql = captured!.query.replace(/\?/g, () => {
      const value = bound.shift();
      return typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
    });
    expect(bound).toHaveLength(0);
    const future = new Date(Date.now() + 60_000).toISOString();
    const current = state.intent!.intent_id as string;
    const schema = (oldPeerIntent: boolean) => `
      CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY, subject_reference TEXT, status TEXT, expires_at TEXT, created_at TEXT);
      CREATE TABLE security_profiles (subject_reference TEXT, account_locked INTEGER);
      CREATE TABLE intent_valuations (valuation_id TEXT, intent_id TEXT, usd_cents TEXT);
      CREATE TABLE intent_prepared_calls (intent_id TEXT, step_index INTEGER, subject_reference TEXT, wallet_address TEXT, chain_id INTEGER, target_address TEXT, native_value TEXT, calldata_hash TEXT, call_fingerprint TEXT, semantic_action TEXT, source_reference TEXT, expires_at TEXT, expected_effect_json TEXT, verification_state TEXT, created_at TEXT);
      INSERT INTO transaction_intents VALUES ('${current}', 'subject-a', 'reviewed', '${future}', datetime('now'));
      INSERT INTO transaction_intents VALUES ('peer', 'subject-a', 'reviewed', '${future}', datetime('now'${oldPeerIntent ? ",'-2 days'" : ""}));
      INSERT INTO security_profiles VALUES ('subject-a', 0);
      INSERT INTO intent_prepared_calls VALUES ('peer', 0, 'subject-a', '${sender.toLowerCase()}', 8453, '${recipient.toLowerCase()}', '100', 'hash', 'fingerprint', 'native_transfer', 'review', '${future}', '{}', 'prepared', datetime('now'));
    `;
    const run = (reservedCents: number, oldPeerIntent = false) => spawnSync("sqlite3", [":memory:"], {
      input: `${schema(oldPeerIntent)} INSERT INTO intent_valuations VALUES ('peer-value','peer','${reservedCents}'); ${sql}; SELECT COUNT(*) FROM intent_prepared_calls WHERE intent_id='${current}';`, encoding: "utf8"
    });
    const within = run(2_499_999);
    expect(within.status, within.stderr).toBe(0);
    expect(within.stdout.trim()).toBe("1");
    const over = run(2_500_000);
    expect(over.status, over.stderr).toBe(0);
    expect(over.stdout.trim()).toBe("0");
    const cooledIntent = run(2_500_000, true);
    expect(cooledIntent.status, cooledIntent.stderr).toBe(0);
    expect(cooledIntent.stdout.trim()).toBe("0");
  });

  it("does not prepare another subject's intent", async () => {
    state.subject = "subject-b";
    expect((await request(payload)).status).toBe(404);
    expect(state.prepared.size).toBe(0);
  });

  it("does not prepare an unlinked wallet or changed chain", async () => {
    state.walletLinked = false;
    expect((await request(payload)).status).toBe(403);
    state.walletLinked = true;
    expect((await request({ ...payload, call: { ...payload.call, chainId: 1 } })).status).toBe(409);
    expect(state.prepared.size).toBe(0);
  });

  it("rejects expired, cooling, or locked intents", async () => {
    state.intent!.expires_at = new Date(Date.now() - 1_000).toISOString();
    expect((await request(payload)).status).toBe(409);
    state.intent!.expires_at = new Date(Date.now() + 60_000).toISOString();
    state.intent!.status = "cooling";
    expect((await request(payload)).status).toBe(409);
    state.intent!.status = "reviewed";
    state.accountLocked = true;
    expect((await request(payload)).status).toBe(403);
  });

  it("rechecks a destination that entered its cooling period since review", async () => {
    state.addressBook = [{ address: recipient, available_at: new Date(Date.now() + 60_000).toISOString() }];
    expect((await request(payload)).status).toBe(403);
    expect(state.prepared.size).toBe(0);
  });

  it("rejects a changed reviewed destination and an opaque effect", async () => {
    expect((await request({ ...payload, expectedEffect: { ...payload.expectedEffect, recipient: token } })).status).toBe(400);
    expect((await request({ ...payload, expectedEffect: { type: "contract_event", topic0: txHash } })).status).toBe(400);
  });

  it("rejects an amount or asset changed since policy review", async () => {
    state.intent!.request_json = JSON.stringify({ destination: recipient, asset: "ETH", amount: "1" });
    expect((await request(payload)).status).toBe(400);
    state.intent!.request_json = JSON.stringify({ asset: "ETH", amount: "0.0000000000000001" });
    expect((await request(payload)).status).toBe(400);
    state.intent!.request_json = JSON.stringify({ destination: recipient, asset: "USDC", amount: "0.0000000000000001" });
    expect((await request(payload)).status).toBe(400);
  });

  it("requires a previous prepared step for a later step", async () => {
    expect((await request({ ...payload, stepIndex: 1 })).status).toBe(409);
    state.prepared.set(0, { verification_state: "reported" });
    expect((await request({ ...payload, stepIndex: 1 })).status).toBe(409);
  });

  it("fails closed when trusted value or prior spending evidence is unavailable", async () => {
    state.valuationFails = true;
    expect((await request(payload)).status).toBe(503);
    state.valuationFails = false;
    state.spentMissing = true;
    expect((await request(payload)).status).toBe(403);
    expect(state.prepared.size).toBe(0);
  });

  it("ignores browser USD estimates when the trusted amount exceeds the policy limit", async () => {
    state.intent!.request_json = JSON.stringify({ type: "transfer", chainId: 8453, destination: recipient, asset: "ETH", amount: "0.0000000000000001", estimatedUsd: 0, availableUsd: 1_000_000 });
    state.valuationCents = "2500001";
    expect((await request(payload)).status).toBe(403);
    expect(state.prepared.size).toBe(0);
  });

  it("blocks a high-value prepare until step-up has server-verifiable attestation", async () => {
    state.valuationCents = "1000001";
    state.addressBook = [{ address: recipient, available_at: new Date(Date.now() - 60_000).toISOString() }];
    const response = await request(payload);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "step_up_unavailable" });
    expect(state.prepared.size).toBe(0);
  });

  it("blocks preparation at the platform floor even with a legacy higher stored threshold", async () => {
    state.stepUpThresholdUsd = 20_000;
    state.valuationCents = "1000000";
    state.addressBook = [{ address: recipient, available_at: new Date(Date.now() - 60_000).toISOString() }];
    const response = await request(payload);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "step_up_unavailable" });
    expect(state.prepared.size).toBe(0);
  });

  it("blocks preparation when a stored step-up threshold is malformed", async () => {
    state.stepUpThresholdUsd = Number.NaN;
    state.valuationCents = "100";
    state.addressBook = [{ address: recipient, available_at: new Date(Date.now() - 60_000).toISOString() }];
    const response = await request(payload);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "step_up_unavailable" });
    expect(state.prepared.size).toBe(0);
  });
});

describe("reported transaction binding", () => {
  const intentId = "00000000-0000-4000-8000-000000000001";
  const call = { chainId: 8453, from: sender, to: recipient, value: "100", data: "0x" };
  const report = (stepIndex = 0, transactionHash = txHash) => reportStatus(new Request("https://aurel.test/api/intents/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intentId, stepIndex, status: "submitted", transactionHash }) }));

  beforeEach(async () => {
    state.subject = "subject-a"; state.walletLinked = true; state.betaAllowed = true; state.featureAllowed = true; state.accountLocked = false; state.intentUpdateAllowed = true; state.prepared.clear(); state.events.length = 0; state.issues.length = 0;
    state.intent = { intent_id: intentId, subject_reference: "subject-a", intent_type: "transfer", chain_id: 8453, wallet_reference: `wallet:${sender.toLowerCase()}`, request_json: JSON.stringify({ destination: recipient }), policy_result_json: JSON.stringify({ permitted: true }), status: "reviewed", expires_at: new Date(Date.now() + 60_000).toISOString() };
    const normalized = await normalizePreparedCall(call);
    state.prepared.set(0, { intent_id: intentId, step_index: 0, subject_reference: "subject-a", wallet_address: sender.toLowerCase(), chain_id: 8453, target_address: recipient.toLowerCase(), native_value: "100", calldata_hash: normalized.dataHash, call_fingerprint: normalized.fingerprint, semantic_action: "native_transfer", source_reference: "review-1", expected_effect_json: JSON.stringify({ type: "native_transfer", recipient, amountRaw: "100" }), expires_at: state.intent.expires_at, verification_state: "prepared", reported_hash: null });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const method = JSON.parse(String(init.body)).method;
      return Response.json({ jsonrpc: "2.0", id: 1, result: method === "eth_chainId" ? "0x2105" : { hash: txHash, from: sender, to: recipient, value: "0x64", input: "0x", chainId: "0x2105", blockHash: null } });
    }));
  });

  it("rejects a hash without a prepared step", async () => {
    state.prepared.clear();
    expect((await report()).status).toBe(409);
    expect(state.intent?.status).toBe("reviewed");
  });

  it("keeps an unindexed hash pending without submitting the intent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init: RequestInit) => Response.json({ jsonrpc: "2.0", id: 1, result: JSON.parse(String(init.body)).method === "eth_chainId" ? "0x2105" : null })));
    const response = await report();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ verificationState: "pending" });
    expect(state.intent?.status).toBe("reviewed");
  });

  it("accepts the same reported hash after review expiry and feature shutdown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init: RequestInit) => Response.json({ jsonrpc: "2.0", id: 1, result: JSON.parse(String(init.body)).method === "eth_chainId" ? "0x2105" : null })));
    expect((await report()).status).toBe(202);
    state.intent!.expires_at = new Date(Date.now() - 1_000).toISOString();
    state.prepared.get(0)!.expires_at = state.intent!.expires_at;
    state.featureAllowed = false;
    const repeated = await report();
    expect(repeated.status).toBe(202);
    expect(await repeated.json()).toMatchObject({ verificationState: "pending" });
    expect(state.prepared.get(0)!.reported_hash).toBe(txHash);
    expect((await report(0, `0x${"b".repeat(64)}`)).status).toBe(409);
  });

  it("treats a repeat of a confirmed hash as idempotent", async () => {
    state.intent!.status = "confirmed";
    state.prepared.get(0)!.reported_hash = txHash;
    state.prepared.get(0)!.verification_state = "confirmed";
    const response = await report();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verificationState: "confirmed" });
    expect((await report(0, `0x${"b".repeat(64)}`)).status).toBe(409);
  });

  it("requires the linked wallet even for an already reported hash", async () => {
    state.prepared.get(0)!.reported_hash = txHash;
    state.prepared.get(0)!.verification_state = "pending";
    state.walletLinked = false;
    expect((await report()).status).toBe(403);
  });

  it("rejects a different sender's hash and opens an issue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init: RequestInit) => Response.json({ jsonrpc: "2.0", id: 1, result: JSON.parse(String(init.body)).method === "eth_chainId" ? "0x2105" : { hash: txHash, from: token, to: recipient, value: "0x64", input: "0x", chainId: "0x2105", blockHash: null } })));
    expect((await report()).status).toBe(409);
    expect(state.intent?.status).toBe("reviewed");
    expect(state.issues).toHaveLength(1);
  });

  it("submits only an exact chain match and rejects a changed hash", async () => {
    const response = await report();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verificationState: "reported" });
    expect(state.intent?.status).toBe("submitted");
    expect((await report(0, `0x${"b".repeat(64)}`)).status).toBe(409);
  });

  it("rejects an expired step or another subject", async () => {
    state.prepared.get(0)!.expires_at = new Date(Date.now() - 1_000).toISOString();
    expect((await report()).status).toBe(409);
    state.prepared.get(0)!.expires_at = new Date(Date.now() + 60_000).toISOString();
    state.subject = "subject-b";
    expect((await report()).status).toBe(404);
  });

  it("rechecks account lock before accepting a reported hash", async () => {
    state.accountLocked = true;
    expect((await report()).status).toBe(403);
    expect(state.intent?.status).toBe("reviewed");
  });

  it("does not claim submission if the reviewed intent changed during binding", async () => {
    state.intentUpdateAllowed = false;
    const response = await report();
    expect(response.status).toBe(409);
    expect(state.intent?.status).toBe("reviewed");
  });
});
