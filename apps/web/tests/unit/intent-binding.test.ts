import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({
  subject: "subject-a",
  walletLinked: true,
  featureAllowed: true,
  accountLocked: false,
  dailyLimitUsd: 25_000,
  policyVersion: 1,
  stepUpThresholdUsd: 10_000,
  spentTodayUsd: 0,
  spentMissing: false,
  atomicReservationExceeded: false,
  lastInsert: null as null | { query: string; args: unknown[] },
  lastRecheck: null as null | { query: string; args: unknown[] },
  valuationFails: false,
  valuationCents: "1",
  simulationFails: false,
  feeBudgetFails: false,
  staleDuringFeeBudget: false,
  expireDuringSimulation: false,
  disableDuringSimulation: false,
  tightenPolicyDuringSimulation: false,
  stalePriceDuringSimulation: false,
  valuations: [] as Array<unknown>,
  addressBook: [] as Array<{ address: string; available_at: string }>,
  intentUpdateAllowed: true,
  cancelBeforeClaim: false,
  claimRejectedAtCommit: false,
  terminalAuditFails: false,
  submissionAuditFails: false,
  preparationEventFails: false,
  intent: null as null | Record<string, unknown>,
  prepared: new Map<number, Record<string, unknown>>(),
  events: [] as string[],
  issues: [] as string[],
  candidates: new Map<string, Record<string, unknown>>(),
  candidateInsertFails: false
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  async batch(statements: Array<{ query: string; run?: () => Promise<{ meta: { changes: number } }> }>) {
    if (statements[0]?.query.includes("UPDATE intent_prepared_calls SET verification_state = 'reported'")) {
      const intent = state.intent ? { ...state.intent } : null;
      const prepared = new Map([...state.prepared].map(([step, row]) => [step, { ...row }]));
      const events = [...state.events];
      try {
        const bound = await statements[0].run!();
        if (bound.meta.changes !== 1) return [bound, { meta: { changes: 0 } }, { meta: { changes: 0 } }];
        return [bound, await statements[1].run!(), await statements[2].run!()];
      } catch (error) {
        state.intent = intent;
        state.prepared = prepared;
        state.events = events;
        throw error;
      }
    }
    if (statements[0]?.query.includes("INSERT INTO intent_prepared_calls")) {
      const prepared = new Map(state.prepared);
      const events = [...state.events];
      const valuations = [...state.valuations];
      try {
        const inserted = await statements[0].run?.() ?? { meta: { changes: 0 } };
        if (inserted.meta.changes !== 1) return [inserted, { meta: { changes: 0 } }, { meta: { changes: 0 } }];
        return [inserted, await statements[1].run!(), await statements[2].run!()];
      } catch (error) {
        state.prepared = prepared;
        state.events = events;
        state.valuations = valuations;
        throw error;
      }
    }
    if (statements[0]?.query.includes("UPDATE transaction_intents") && statements[0].query.includes("status = 'reviewed'")) {
      const previousStatus = state.intent?.status;
      const changed = await statements[0].run?.();
      if (state.terminalAuditFails) {
        if (state.intent) state.intent.status = previousStatus;
        throw new Error("audit insertion failed; transaction rolled back");
      }
      return [changed ?? { meta: { changes: 0 } }, { meta: { changes: changed?.meta.changes ?? 0 } }, { meta: { changes: changed?.meta.changes ?? 0 } }];
    }
    return statements.map((statement) => ({ results: statement.query.includes("security_profiles") ? [{ account_locked: state.accountLocked ? 1 : 0, enforce_address_book: 0, daily_limit_usd: state.dailyLimitUsd, new_address_threshold_usd: 1_000, step_up_threshold_usd: state.stepUpThresholdUsd, new_address_delay_seconds: 86_400, policy_version: state.policyVersion }] : statement.query.includes("address_book_entries") ? state.addressBook : [{ spent_cents: state.spentTodayUsd * 100, missing: state.spentMissing ? 1 : 0 }] }));
  },
  prepare(query: string) {
    return { bind(...args: unknown[]) {
      return {
        query,
        async first() {
          if (query.includes("SELECT c.intent_id FROM intent_prepared_calls c")) {
            state.lastRecheck = { query, args };
            const row = state.prepared.get(0);
            return state.intent?.intent_id === args[1] && state.intent?.subject_reference === args[2]
              && state.intent?.status === "reviewed" && row?.reported_hash == null
              && row?.call_fingerprint === args[7] && state.featureAllowed && !state.accountLocked
              && state.policyVersion === args[0] && !state.atomicReservationExceeded
              && state.spentTodayUsd * 100 + Number(state.valuationCents) <= state.dailyLimitUsd * 100
              ? { intent_id: args[1] } : null;
          }
          if (query.includes("FROM intent_observation_candidates")) return state.candidates.get(String(args[1]).toLowerCase()) ?? null;
          if (query.includes("SELECT 1 AS reported FROM intent_prepared_calls")) {
            return [...state.prepared.values()].some((step) => step.intent_id === args[0] && step.subject_reference === args[1] && step.reported_hash) ? { reported: 1 } : null;
          }
          if (query.includes("FROM intent_prepared_calls")) {
            if (state.intent?.intent_id !== args[0] || state.intent?.subject_reference !== args[2]) return null;
            return state.prepared.get(Number(args[1])) ?? null;
          }
          if (query.includes("FROM transaction_intents") && !query.includes("intent_prepared_calls")) return state.intent?.intent_id === args[0] && state.intent?.subject_reference === args[1] ? state.intent : null;
          if (query.includes("FROM security_profiles")) return { account_locked: state.accountLocked ? 1 : 0 };
          return null;
        },
        async run() {
          if (query.includes("INSERT INTO intent_observation_candidates")) {
            if (state.candidateInsertFails) throw new Error("observation database unavailable");
            const hash = String(args[5]).toLowerCase();
            if (state.candidates.has(hash) || state.candidates.size >= 5 || state.prepared.get(Number(args[3]))?.reported_hash) return { meta: { changes: 0 } };
            state.candidates.set(hash, { report_id: args[0], subject_reference: args[1], intent_id: args[2], step_index: args[3], chain_id: args[4], transaction_hash: hash, verification_state: "unindexed" });
            return { meta: { changes: 1 } };
          }
          if (query.includes("INSERT INTO intent_valuations")) { state.valuations.push(args); return { meta: { changes: 1 } }; }
          if (query.includes("INSERT INTO intent_prepared_calls")) {
            state.lastInsert = { query, args };
            const step = Number(args[0]);
            if (state.atomicReservationExceeded && query.includes("reserved_spend")) return { meta: { changes: 0 } };
            if (state.intent?.status !== "reviewed" || state.accountLocked || state.prepared.has(step)
              || String(state.intent.expires_at) <= String(args[13])
              || query.includes("FROM feature_flags") && !state.featureAllowed
              || query.includes("p.policy_version = ?") && state.policyVersion !== args[args.length - 1]
              || query.includes("p.daily_limit_usd * 100") && (state.spentTodayUsd * 100 + Number(state.valuationCents)) > state.dailyLimitUsd * 100
              || (step > 0 && state.prepared.get(step - 1)?.verification_state !== "confirmed")) return { meta: { changes: 0 } };
            state.prepared.set(step, { intent_id: args[11], step_index: step, subject_reference: args[12], wallet_address: args[1], chain_id: args[2], target_address: args[3], native_value: args[4], calldata_hash: args[5], call_fingerprint: args[6], semantic_action: args[7], source_reference: args[8], expected_effect_json: args[9], expires_at: state.intent.expires_at, verification_state: "prepared", submission_phase: query.includes("'awaiting_step_up'") ? "awaiting_step_up" : "legacy", reported_hash: null });
            return { meta: { changes: 1 } };
          }
          if (query.includes("INSERT INTO intent_events")) {
            if (state.preparationEventFails && query.includes("call_prepared")) throw new Error("preparation event unavailable");
            if (state.submissionAuditFails && query.includes("transaction_identity_matched")) throw new Error("submission event unavailable");
            state.events.push(String(args[3])); return { meta: { changes: 1 } };
          }
          if (query.includes("INSERT INTO operational_issues")) { state.issues.push(String(args[0])); return { meta: { changes: 1 } }; }
          if (query.includes("UPDATE intent_prepared_calls")) {
            if (query.includes("SET reported_hash") && state.cancelBeforeClaim) state.intent!.status = "cancelled";
            if (query.includes("SET reported_hash") && state.claimRejectedAtCommit) return { meta: { changes: 0 } };
            if (query.includes("AND EXISTS (SELECT 1 FROM transaction_intents i") && !["reviewed", "submitted"].includes(String(state.intent?.status))) return { meta: { changes: 0 } };
            const step = Number(query.includes("'inconsistent'") ? args[2] : args[3]); const row = state.prepared.get(step);
            if (!row) return { meta: { changes: 0 } };
            if (query.includes("SET reported_hash") && row.reported_hash && String(row.reported_hash).toLowerCase() !== String(args[0]).toLowerCase()) return { meta: { changes: 0 } };
            if (query.includes("SET reported_hash")) row.reported_hash = args[0];
            row.verification_state = query.includes("verification_state = 'inconsistent'") ? "inconsistent" : query.includes("verification_state = 'reported'") ? "reported" : "pending";
            return { meta: { changes: 1 } };
          }
          if (query.includes("UPDATE transaction_intents")) {
            if (!state.intentUpdateAllowed) return { meta: { changes: 0 } };
            if (query.includes("NOT EXISTS (SELECT 1 FROM intent_prepared_calls")) {
              if (state.intent?.status !== "reviewed" || state.intent.transaction_hash || [...state.prepared.values()].some((step) => step.reported_hash)) return { meta: { changes: 0 } };
              state.intent.status = query.includes("SET status = 'cancelled'") ? "cancelled" : "failed";
              return { meta: { changes: 1 } };
            }
            if (state.intent) state.intent.status = "submitted";
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
    } };
  }
} } }));

vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError, requireVerifiedSubject: async () => ({ subjectReference: state.subject, sessionReference: "session-a" }) }));
vi.mock("@/lib/features/flags", () => { const FeatureUnavailableError = httpErrors.FeatureUnavailableError; return { FeatureUnavailableError, requireFeature: async () => { if (!state.featureAllowed) throw new FeatureUnavailableError("Feature denied"); } }; });
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/auth/wallet", () => {
  const WalletOwnershipError = httpErrors.WalletOwnershipError;
  return { WalletOwnershipError, requireLinkedEvmWallet: async (_subject: string, address: string) => { if (!state.walletLinked) throw new WalletOwnershipError("Wallet denied"); return address.toLowerCase(); } };
});
vi.mock("@/lib/transactions/valuation", () => {
  class ValuationError extends Error {}
  return { ValuationError, valueTransfer: async () => {
    if (state.valuationFails) throw new ValuationError("Price unavailable");
    return { assetId: "eip155:8453/slip44:60", rawUnits: "100", decimals: 18, priceUsd: "2000", marketPriceUsd: "2000", priceSource: "kraken:ETHUSD:1m:high", priceObservedAt: new Date(Date.now() - (state.stalePriceDuringSimulation ? 181_000 : 0)).toISOString(), valuedAt: new Date().toISOString(), usdCents: state.valuationCents, policyVersion: 1, depegUncertainty: false };
  } };
});
vi.mock("@/lib/transactions/direct-transfer-simulation", () => ({
  simulateBaseDirectTransfer: async (_client: unknown, input: { call: { fingerprint: string }; effect: { type: string; amountRaw: string } }) => {
    if (state.simulationFails) throw new Error("canonical call unavailable");
    if (input.effect.type !== "native_transfer" || input.effect.amountRaw !== "100") throw new Error("wrong simulation input");
    if (state.expireDuringSimulation) {
      state.intent!.expires_at = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (state.disableDuringSimulation) state.featureAllowed = false;
    if (state.tightenPolicyDuringSimulation) { state.policyVersion++; state.dailyLimitUsd = 0; }
    return { chainId: 8453, blockNumber: 42n, blockHash: `0x${"a".repeat(64)}`, observedAtMs: Date.now(),
      fingerprint: input.call.fingerprint, simulationSucceeded: true, assetBalanceRaw: "1000000", assetBalanceObserved: true };
  }
}));
vi.mock("@/lib/transactions/direct-transfer-fee-budget", () => ({
  observeBaseDirectTransferFeeBudget: async (_client: unknown, input: { amountRaw: string; nativeAsset: boolean; simulation: { observedAtMs: number } }) => {
    if (state.feeBudgetFails) throw new Error("fee reserve unavailable");
    if (input.amountRaw !== "100" || !input.nativeAsset) throw new Error("wrong fee-budget input");
    if (state.staleDuringFeeBudget) input.simulation.observedAtMs = Date.now() - 31_000;
    return { blockHash: `0x${"a".repeat(64)}`, gasLimitRaw: "27250", requiredEthRaw: "546100",
      estimatedReserveSufficient: true };
  }
}));

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
    state.subject = "subject-a"; state.walletLinked = true; state.featureAllowed = true; state.accountLocked = false; state.dailyLimitUsd = 25_000; state.policyVersion = 1; state.stepUpThresholdUsd = 10_000; state.spentTodayUsd = 0; state.spentMissing = false; state.atomicReservationExceeded = false; state.lastInsert = null; state.lastRecheck = null; state.valuationFails = false; state.valuationCents = "1"; state.simulationFails = false; state.feeBudgetFails = false; state.staleDuringFeeBudget = false; state.expireDuringSimulation = false; state.disableDuringSimulation = false; state.tightenPolicyDuringSimulation = false; state.stalePriceDuringSimulation = false; state.valuations.length = 0; state.addressBook = []; state.intentUpdateAllowed = true; state.preparationEventFails = false; state.prepared.clear(); state.events.length = 0; state.issues.length = 0;
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

  it("rechecks the existing exact transfer without preparing another call", async () => {
    expect((await request(payload)).status).toBe(201);
    const checked = await request({ ...payload, recheck: true });
    expect(checked.status).toBe(200);
    expect(await checked.json()).toMatchObject({ intentId, stepIndex: 0,
      fingerprint: (await normalizePreparedCall(payload.call)).fingerprint });
    expect(state.prepared.size).toBe(1);
    expect(state.valuations).toHaveLength(1);
    state.dailyLimitUsd = 0;
    expect((await request({ ...payload, recheck: true })).status).not.toBe(200);
  });

  it("enforces the last transfer gate against live SQLite controls", async () => {
    expect((await request(payload)).status).toBe(201);
    expect((await request({ ...payload, recheck: true })).status).toBe(200);
    const captured = state.lastRecheck!;
    const row = state.prepared.get(0)!;
    const db = new DatabaseSync(":memory:");
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    try {
      db.exec(`CREATE TABLE transaction_intents (intent_id TEXT, subject_reference TEXT, intent_type TEXT,
        status TEXT, wallet_reference TEXT, chain_id INTEGER, expires_at TEXT, created_at TEXT);
        CREATE TABLE intent_prepared_calls (intent_id TEXT, step_index INTEGER, subject_reference TEXT,
        wallet_address TEXT, chain_id INTEGER, target_address TEXT, native_value TEXT, calldata_hash TEXT,
        call_fingerprint TEXT, semantic_action TEXT, source_reference TEXT, expected_effect_json TEXT,
        verification_state TEXT, submission_phase TEXT, reported_hash TEXT, expires_at TEXT, created_at TEXT);
        CREATE TABLE security_profiles (subject_reference TEXT, account_locked INTEGER, policy_version INTEGER, daily_limit_usd REAL);
        CREATE TABLE feature_flags (flag_key TEXT, enabled INTEGER, audience TEXT);
        CREATE TABLE address_book_entries (subject_reference TEXT, chain_family TEXT, address TEXT, available_at TEXT);
        CREATE TABLE intent_valuations (valuation_id TEXT, intent_id TEXT, usd_cents TEXT);`);
      db.prepare("INSERT INTO transaction_intents VALUES (?,?,?,?,?,?,?,?)").run(intentId, "subject-a", "transfer",
        "reviewed", `wallet:${sender.toLowerCase()}`, 8453, future, past);
      db.prepare("INSERT INTO intent_prepared_calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(intentId, 0,
        "subject-a", sender.toLowerCase(), 8453, recipient.toLowerCase(), "100", row.calldata_hash as string,
        row.call_fingerprint as string, "native_transfer", "review-1", JSON.stringify(payload.expectedEffect),
        "prepared", "legacy", null, future, past);
      db.exec(`INSERT INTO security_profiles VALUES ('subject-a',0,1,25000);
        INSERT INTO feature_flags VALUES ('direct_transfers',1,'all');`);
      const args = [...captured.args] as Array<string | number | bigint | null>;
      const check = () => db.prepare(captured.query).get(...args);
      expect(check()).toMatchObject({ intent_id: intentId });
      db.prepare("INSERT INTO address_book_entries VALUES (?,?,?,?)").run("subject-a", "evm", recipient,
        new Date(Date.now() + 86_400_000).toISOString());
      expect(check()).toBeUndefined();
      db.exec("DELETE FROM address_book_entries");
      args[15] = 1; // The reviewed policy required a saved destination.
      db.prepare("INSERT INTO address_book_entries VALUES (?,?,?,?)").run("subject-a", "evm", recipient, past);
      expect(check()).toMatchObject({ intent_id: intentId });
      db.exec("DELETE FROM address_book_entries");
      expect(check()).toBeUndefined();
      args[15] = 0;
      db.exec("UPDATE security_profiles SET account_locked=1");
      expect(check()).toBeUndefined();
      db.exec("UPDATE security_profiles SET account_locked=0, daily_limit_usd=0");
      expect(check()).toBeUndefined();
      db.exec("UPDATE security_profiles SET daily_limit_usd=25000, policy_version=2");
      expect(check()).toBeUndefined();
      db.exec("UPDATE security_profiles SET policy_version=1; UPDATE feature_flags SET enabled=0");
      expect(check()).toBeUndefined();
      db.exec("UPDATE feature_flags SET enabled=1; UPDATE intent_prepared_calls SET reported_hash='0xabc'");
      expect(check()).toBeUndefined();
    } finally { db.close(); }
  });

  it("does not prepare a transfer when the canonical server simulation fails", async () => {
    state.simulationFails = true;
    const response = await request(payload);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "simulation_unavailable" });
    expect(state.prepared.size).toBe(0);
    expect(state.valuations).toHaveLength(0);
  });

  it("does not prepare a transfer when its gas reserve cannot be proven", async () => {
    state.feeBudgetFails = true;
    const response = await request(payload);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "simulation_unavailable" });
    expect(state.prepared.size).toBe(0);
    expect(state.valuations).toHaveLength(0);
  });

  it("does not persist a simulation that becomes stale during fee checks", async () => {
    state.staleDuringFeeBudget = true;
    const response = await request(payload);
    expect(response.status).toBe(503);
    expect(state.prepared.size).toBe(0);
  });

  it("does not prepare an intent that expires during server simulation", async () => {
    state.expireDuringSimulation = true;
    expect((await request(payload)).status).toBe(409);
    expect(state.prepared.size).toBe(0);
  });

  it("does not prepare when the transfer feature is switched off during simulation", async () => {
    state.disableDuringSimulation = true;
    expect((await request(payload)).status).toBe(409);
    expect(state.prepared.size).toBe(0);
  });

  it("does not prepare after the security policy tightens during simulation", async () => {
    state.tightenPolicyDuringSimulation = true;
    expect((await request(payload)).status).toBe(409);
    expect(state.prepared.size).toBe(0);
  });

  it("does not prepare when price evidence is stale at commit", async () => {
    state.stalePriceDuringSimulation = true;
    expect((await request(payload)).status).toBe(503);
    expect(state.prepared.size).toBe(0);
  });

  it("does not retain a prepared call if its event cannot be persisted", async () => {
    state.preparationEventFails = true;
    expect((await request(payload)).status).toBe(503);
    expect(state.prepared.size).toBe(0);
    expect(state.events).toHaveLength(0);
    expect(state.valuations).toHaveLength(0);
  });

  it("refuses preparation when another request reserves the remaining daily limit before the atomic write", async () => {
    state.atomicReservationExceeded = true;
    expect((await request(payload)).status).toBe(409);
    expect(state.prepared.size).toBe(0);
    expect(state.events).toHaveLength(0);
    expect(state.valuations).toHaveLength(0);
  });

  it("enforces the reservation cap in SQLite's conditional INSERT, including another prepared intent", async () => {
    expect((await request(payload)).status).toBe(201);
    const captured = state.lastInsert;
    expect(captured).not.toBeNull();
    expect(captured!.query).toMatch(/submission_phase[\s\S]*'legacy'/);
    expect(captured!.query).toMatch(/unixepoch\(\?\) BETWEEN unixepoch\('now'\) - 180 AND unixepoch\('now'\) \+ 60/);
    const sqlFor = (observedAt?: string) => {
      const bound = [...captured!.args];
      if (observedAt) bound[14] = observedAt;
      const sql = captured!.query.replace(/\?/g, () => {
        const value = bound.shift();
        return typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
      });
      expect(bound).toHaveLength(0);
      return sql;
    };
    const future = new Date(Date.now() + 60_000).toISOString();
    const current = state.intent!.intent_id as string;
    const schema = (oldPeerIntent: boolean) => `
      CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY, subject_reference TEXT, status TEXT, expires_at TEXT, created_at TEXT);
      CREATE TABLE feature_flags (flag_key TEXT PRIMARY KEY, enabled INTEGER, audience TEXT);
      CREATE TABLE security_profiles (subject_reference TEXT, account_locked INTEGER, daily_limit_usd REAL, policy_version INTEGER);
      CREATE TABLE intent_valuations (valuation_id TEXT, intent_id TEXT, usd_cents TEXT);
      CREATE TABLE intent_prepared_calls (intent_id TEXT, step_index INTEGER, subject_reference TEXT, wallet_address TEXT, chain_id INTEGER, target_address TEXT, native_value TEXT, calldata_hash TEXT, call_fingerprint TEXT, semantic_action TEXT, source_reference TEXT, expires_at TEXT, expected_effect_json TEXT, verification_state TEXT, created_at TEXT, submission_phase TEXT);
      INSERT INTO transaction_intents VALUES ('${current}', 'subject-a', 'reviewed', '${future}', datetime('now'));
      INSERT INTO transaction_intents VALUES ('peer', 'subject-a', 'reviewed', '${future}', datetime('now'${oldPeerIntent ? ",'-2 days'" : ""}));
      INSERT INTO security_profiles VALUES ('subject-a', 0, 25000, 1);
      INSERT INTO feature_flags VALUES ('direct_transfers', 1, 'all');
      INSERT INTO intent_prepared_calls VALUES ('peer', 0, 'subject-a', '${sender.toLowerCase()}', 8453, '${recipient.toLowerCase()}', '100', 'hash', 'fingerprint', 'native_transfer', 'review', '${future}', '{}', 'prepared', datetime('now'), 'legacy');
    `;
    const run = (reservedCents: number, oldPeerIntent = false, change = "", observedAt?: string) => spawnSync("sqlite3", [":memory:"], {
      input: `${schema(oldPeerIntent)} INSERT INTO intent_valuations VALUES ('peer-value','peer','${reservedCents}'); ${change} ${sqlFor(observedAt)}; SELECT COUNT(*) FROM intent_prepared_calls WHERE intent_id='${current}';`, encoding: "utf8"
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
    for (const change of [
      "UPDATE security_profiles SET policy_version=2;",
      "UPDATE security_profiles SET daily_limit_usd=0;",
      "UPDATE security_profiles SET account_locked=1;"
    ]) {
      const denied = run(0, false, change);
      expect(denied.status, denied.stderr).toBe(0);
      expect(denied.stdout.trim()).toBe("0");
    }
    const staleAtCommit = run(0, false, "", new Date(Date.now() - 181_000).toISOString());
    expect(staleAtCommit.status, staleAtCommit.stderr).toBe(0);
    expect(staleAtCommit.stdout.trim()).toBe("0");
    const oneCentLimit = run(0, false, "UPDATE security_profiles SET daily_limit_usd=0.01;");
    expect(oneCentLimit.status, oneCentLimit.stderr).toBe(0);
    expect(oneCentLimit.stdout.trim()).toBe("1");
    const belowOneCent = run(0, false, "UPDATE security_profiles SET daily_limit_usd=0.009;");
    expect(belowOneCent.status, belowOneCent.stderr).toBe(0);
    expect(belowOneCent.stdout.trim()).toBe("0");
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

  it("holds a high-value exact call without releasing it for wallet signing", async () => {
    state.valuationCents = "1000001";
    state.addressBook = [{ address: recipient, available_at: new Date(Date.now() - 60_000).toISOString() }];
    const response = await request(payload);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ intentId, status: "awaiting_step_up" });
    expect(body).not.toHaveProperty("fingerprint");
    expect(body).not.toHaveProperty("expiresAt");
    expect(body).not.toHaveProperty("stepIndex");
    expect(state.prepared.get(0)).toMatchObject({ submission_phase: "awaiting_step_up", reported_hash: null });
    expect(state.valuations).toHaveLength(1);
    expect((await request({ ...payload, recheck: true })).status).toBe(403);
  });

  it("does not store a held plan if its saved recipient disappears before the D1 write", async () => {
    state.valuationCents = "1000001";
    state.addressBook = [{ address: recipient, available_at: new Date(Date.now() - 60_000).toISOString() }];
    expect((await request(payload)).status).toBe(202);
    const captured = state.lastInsert!;
    const db = new DatabaseSync(":memory:");
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    try {
      db.exec(`CREATE TABLE transaction_intents (intent_id TEXT, subject_reference TEXT, status TEXT, expires_at TEXT, request_json TEXT, created_at TEXT);
        CREATE TABLE intent_prepared_calls (intent_id TEXT, step_index INTEGER, subject_reference TEXT, wallet_address TEXT, chain_id INTEGER, target_address TEXT, native_value TEXT, calldata_hash TEXT, call_fingerprint TEXT, semantic_action TEXT, source_reference TEXT, expires_at TEXT, expected_effect_json TEXT, verification_state TEXT, created_at TEXT, submission_phase TEXT);
        CREATE TABLE feature_flags (flag_key TEXT, enabled INTEGER, audience TEXT);
        CREATE TABLE security_profiles (subject_reference TEXT, account_locked INTEGER, daily_limit_usd REAL, policy_version INTEGER);
          CREATE TABLE intent_valuations (valuation_id TEXT, intent_id TEXT, usd_cents TEXT);
        CREATE TABLE address_book_entries (subject_reference TEXT, chain_family TEXT, address TEXT, available_at TEXT);`);
      db.prepare("INSERT INTO transaction_intents VALUES (?,?,?,?,?,?)").run(intentId, "subject-a", "reviewed", future,
        JSON.stringify({ destination: recipient }), past);
      db.exec(`INSERT INTO feature_flags VALUES ('direct_transfers',1,'all');
        INSERT INTO security_profiles VALUES ('subject-a',0,25000,1);
`);
      const run = () => db.prepare(captured.query).run(...captured.args as Array<string | number>);
      db.prepare("INSERT INTO address_book_entries VALUES (?,?,?,?)").run("subject-a", "evm", recipient, past);
      expect(run().changes).toBe(1);
      expect(db.prepare("SELECT submission_phase FROM intent_prepared_calls").get()).toMatchObject({ submission_phase: "awaiting_step_up" });
      db.exec("DELETE FROM intent_prepared_calls; DELETE FROM address_book_entries");
      expect(run().changes).toBe(0);
      db.prepare("INSERT INTO address_book_entries VALUES (?,?,?,?)").run("subject-a", "evm", recipient, future);
      expect(run().changes).toBe(0);
    } finally { db.close(); }
  });

  it("rejects a later step for a high-value direct-transfer plan before the database trigger", async () => {
    state.valuationCents = "1000001";
    state.addressBook = [{ address: recipient, available_at: new Date(Date.now() - 60_000).toISOString() }];
    state.prepared.set(0, { verification_state: "confirmed" });
    const response = await request({ ...payload, stepIndex: 1 });
    expect(response.status).toBe(409);
    expect(state.prepared.has(1)).toBe(false);
  });

  it("holds preparation at the platform floor even with a legacy higher stored threshold", async () => {
    state.stepUpThresholdUsd = 20_000;
    state.valuationCents = "1000000";
    state.addressBook = [{ address: recipient, available_at: new Date(Date.now() - 60_000).toISOString() }];
    const response = await request(payload);
    expect(response.status).toBe(202);
    expect(state.prepared.get(0)).toMatchObject({ submission_phase: "awaiting_step_up" });
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
    state.subject = "subject-a"; state.walletLinked = true; state.featureAllowed = true; state.accountLocked = false; state.intentUpdateAllowed = true; state.cancelBeforeClaim = false; state.claimRejectedAtCommit = false; state.terminalAuditFails = false; state.submissionAuditFails = false; state.prepared.clear(); state.events.length = 0; state.issues.length = 0; state.candidates.clear(); state.candidateInsertFails = false;
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

  it("never accepts a browser-reported hash for a step-up plan", async () => {
    state.prepared.get(0)!.submission_phase = "awaiting_step_up";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await report();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ verificationState: "observationPending" });
    expect(state.prepared.get(0)!.reported_hash).toBeNull();
    expect(state.candidates.get(txHash)).toMatchObject({ verification_state: "unindexed" });
    expect(fetcher).not.toHaveBeenCalled();
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

  it("records a late Base transfer hash for observation without submitting the intent", async () => {
    state.intent!.expires_at = new Date(Date.now() - 1_000).toISOString();
    state.prepared.get(0)!.expires_at = state.intent!.expires_at;
    state.featureAllowed = false;
    const response = await report();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ verificationState: "observationPending" });
    expect(state.candidates.get(txHash)).toMatchObject({ intent_id: intentId, verification_state: "unindexed" });
    expect(state.intent?.status).toBe("reviewed");
    expect(state.prepared.get(0)?.reported_hash).toBeNull();
  });

  it("keeps a hash as observation-only when final claim controls change after the route checks", async () => {
    state.claimRejectedAtCommit = true;
    const response = await report();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ verificationState: "observationPending" });
    expect(state.candidates.get(txHash)).toMatchObject({ intent_id: intentId, verification_state: "unindexed" });
    expect(state.prepared.get(0)?.reported_hash).toBeNull();
    expect(state.intent?.status).toBe("reviewed");
  });

  it.each(["review_expired", "account_locked", "feature_disabled"] as const)(
    "records a late prepared Base swap after %s without creating a submission", async (control) => {
      state.intent!.intent_type = "swap";
      state.prepared.get(0)!.semantic_action = "swap";
      state.prepared.get(0)!.submission_phase = "released";
      if (control === "review_expired") state.intent!.expires_at = new Date(Date.now() - 1_000).toISOString();
      if (control === "account_locked") state.accountLocked = true;
      if (control === "feature_disabled") state.featureAllowed = false;
      const response = await report();
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ verificationState: "observationPending" });
      expect(state.candidates.get(txHash)).toMatchObject({ intent_id: intentId, verification_state: "unindexed" });
      expect(state.intent).toMatchObject({ status: "reviewed" });
      expect(state.prepared.get(0)?.reported_hash).toBeNull();
    }
  );

  it.each(["review_expired", "account_locked", "feature_disabled"] as const)(
    "keeps a late released bridge hash as observation only after %s", async (control) => {
      state.intent!.intent_type = "bridge";
      state.prepared.get(0)!.semantic_action = "bridge";
      state.prepared.get(0)!.submission_phase = "released";
      if (control === "review_expired") state.intent!.expires_at = new Date(Date.now() - 1_000).toISOString();
      if (control === "account_locked") state.accountLocked = true;
      if (control === "feature_disabled") state.featureAllowed = false;
      const response = await report();
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ verificationState: "observationPending" });
      expect(state.candidates.get(txHash)).toMatchObject({ intent_id: intentId, verification_state: "unindexed" });
      expect(state.intent).toMatchObject({ status: "reviewed" });
      expect(state.prepared.get(0)?.reported_hash).toBeNull();
    }
  );

  it("refuses late bridge observation for an unreleased or mismatched prepared step", async () => {
    state.intent!.intent_type = "bridge";
    state.intent!.expires_at = new Date(Date.now() - 1_000).toISOString();
    state.prepared.get(0)!.semantic_action = "bridge";
    state.prepared.get(0)!.submission_phase = "awaiting_step_up";
    expect((await report()).status).toBe(409);
    state.prepared.get(0)!.submission_phase = "released";
    state.prepared.get(0)!.chain_id = 42161;
    expect((await report()).status).toBe(409);
    expect(state.candidates.size).toBe(0);
  });

  it("rejects a late swap candidate without an exact swap prepared step", async () => {
    state.intent!.intent_type = "swap";
    state.intent!.expires_at = new Date(Date.now() - 1_000).toISOString();
    expect((await report()).status).toBe(409);
    expect(state.candidates.size).toBe(0);
    state.prepared.get(0)!.semantic_action = "swap";
    state.prepared.get(0)!.submission_phase = "released";
    state.prepared.get(0)!.chain_id = 1;
    expect((await report()).status).toBe(409);
    expect(state.candidates.size).toBe(0);
  });

  it("does not observe a swap step that was never released", async () => {
    state.intent!.intent_type = "swap";
    state.intent!.expires_at = new Date(Date.now() - 1_000).toISOString();
    state.prepared.get(0)!.semantic_action = "swap";
    state.prepared.get(0)!.submission_phase = "awaiting_step_up";
    expect((await report()).status).toBe(409);
    expect(state.candidates.size).toBe(0);
  });

  it("records a held-step hash only as observation", async () => {
    state.prepared.get(0)!.submission_phase = "awaiting_step_up";
    const response = await report();
    expect(response.status).toBe(202);
    expect(state.intent?.status).toBe("reviewed");
    expect(state.prepared.get(0)?.reported_hash).toBeNull();
  });

  it.each(["wallet", "feature"] as const)("records a late hash when %s access closes without creating submission", async (control) => {
    if (control === "wallet") state.walletLinked = false;
    if (control === "feature") state.featureAllowed = false;
    expect((await report()).status).toBe(202);
    expect(state.candidates.size).toBe(1);
    expect(state.prepared.get(0)?.reported_hash).toBeNull();
    expect(state.intent?.status).toBe("reviewed");
  });

  it("makes the same late hash idempotent and caps a prepared step at five candidates", async () => {
    state.accountLocked = true;
    expect((await report()).status).toBe(202);
    expect((await report()).status).toBe(202);
    expect(state.candidates.size).toBe(1);
    for (let index = 1; index < 5; index++) expect((await report(0, `0x${index.toString(16).padStart(64, "0")}`)).status).toBe(202);
    expect((await report(0, `0x${"f".repeat(64)}`)).status).toBe(409);
    expect(state.candidates.size).toBe(5);
  });

  it("returns an unavailable error rather than a hash conflict when observation storage fails", async () => {
    state.accountLocked = true;
    state.candidateInsertFails = true;
    expect((await report()).status).toBe(503);
    expect(state.candidates.size).toBe(0);
    expect(state.prepared.get(0)?.reported_hash).toBeNull();
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

  it("does not submit or report a matched transfer if its audit event fails", async () => {
    state.submissionAuditFails = true;
    expect((await report()).status).toBe(503);
    expect(state.intent?.status).toBe("reviewed");
    expect(state.prepared.get(0)?.verification_state).toBe("pending");
    expect(state.events).toHaveLength(0);
  });

  it("observes an expired step but rejects another subject", async () => {
    state.prepared.get(0)!.expires_at = new Date(Date.now() - 1_000).toISOString();
    expect((await report()).status).toBe(202);
    expect(state.prepared.get(0)?.reported_hash).toBeNull();
    state.prepared.get(0)!.expires_at = new Date(Date.now() + 60_000).toISOString();
    state.subject = "subject-b";
    expect((await report()).status).toBe(404);
  });

  it("rechecks account lock before accepting a reported hash", async () => {
    state.accountLocked = true;
    expect((await report()).status).toBe(202);
    expect(state.intent?.status).toBe("reviewed");
    expect(state.prepared.get(0)?.reported_hash).toBeNull();
  });

  it("does not claim submission if the reviewed intent changed during binding", async () => {
    state.intentUpdateAllowed = false;
    const response = await report();
    expect(response.status).toBe(409);
    expect(state.intent?.status).toBe("reviewed");
  });

  it("does not accept a browser-declared failure after a transaction is submitted", async () => {
    state.intent!.intent_type = "swap";
    state.intent!.status = "submitted";
    const response = await reportStatus(new Request("https://aurel.test/api/intents/status", { method: "POST", body: JSON.stringify({ intentId, status: "failed", failureReason: "I changed my mind" }) }));
    expect(response.status).toBe(409);
    expect(state.intent!.status).toBe("submitted");
  });

  it.each(["swap", "bridge"])("does not accept a browser-declared failure for a reviewed %s", async (intentType) => {
    state.intent!.intent_type = intentType;
    const response = await reportStatus(new Request("https://aurel.test/api/intents/status", { method: "POST", body: JSON.stringify({ intentId, status: "failed", failureReason: "The route looks slow" }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "settlement_evidence_required" });
    expect(state.intent!.status).toBe("reviewed");
  });

  it("does not cancel or fail a reviewed intent with an unindexed reported hash", async () => {
    state.prepared.get(0)!.reported_hash = txHash;
    state.prepared.get(0)!.verification_state = "pending";
    for (const status of ["cancelled", "failed"]) {
      const response = await reportStatus(new Request("https://aurel.test/api/intents/status", { method: "POST", body: JSON.stringify({ intentId, status }) }));
      expect(response.status).toBe(409);
      expect(state.intent!.status).toBe("reviewed");
    }
  });

  it("still lets the customer cancel an unsent reviewed intent", async () => {
    const response = await reportStatus(new Request("https://aurel.test/api/intents/status", { method: "POST", body: JSON.stringify({ intentId, status: "cancelled" }) }));
    expect(response.status).toBe(200);
    expect(state.intent!.status).toBe("cancelled");
  });

  it("rejects a fabricated hash on a cancellation", async () => {
    const response = await reportStatus(new Request("https://aurel.test/api/intents/status", { method: "POST", body: JSON.stringify({ intentId, status: "cancelled", transactionHash: txHash }) }));
    expect(response.status).toBe(400);
    expect(state.intent!.status).toBe("reviewed");
  });

  it("rolls back cancellation when its audit insert fails", async () => {
    state.terminalAuditFails = true;
    const response = await reportStatus(new Request("https://aurel.test/api/intents/status", { method: "POST", body: JSON.stringify({ intentId, status: "cancelled" }) }));
    expect(response.status).toBe(503);
    expect(state.intent!.status).toBe("reviewed");
  });

  it("observes but does not approve a hash when cancellation wins just before the claim", async () => {
    state.cancelBeforeClaim = true;
    const response = await report();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ verificationState: "observationPending" });
    expect(state.intent!.status).toBe("cancelled");
    expect(state.prepared.get(0)!.reported_hash).toBeNull();
    expect(state.candidates.get(txHash)).toMatchObject({ verification_state: "unindexed" });
  });
});
