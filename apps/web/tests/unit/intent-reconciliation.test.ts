import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { encodeEventTopics, erc20Abi } from "viem";
import { verifyExpectedEffect } from "@/lib/transactions/effects";
import type { ChainObservation } from "@/lib/transactions/chain-observation";
import { normalizePreparedCall } from "@/lib/transactions/evidence";

const routeState = vi.hoisted(() => ({
  subject: "subject-a",
  intents: [] as Array<Record<string, unknown>>,
  steps: [] as Array<Record<string, unknown>>,
  observation: null as unknown,
  observations: {} as Record<string, unknown>,
  issues: [] as string[],
  events: [] as string[],
  candidates: [] as Array<Record<string, unknown>>,
  candidateChecks: [] as Array<{ reportId: string; evidence: Record<string, unknown> }>
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  async batch(statements: Array<{ run: () => Promise<unknown> }>) {
    const results = [];
    for (const item of statements) results.push(await item.run());
    return results;
  },
  prepare(query: string) {
    return { bind(...args: unknown[]) {
      return {
        async all() {
          if (query.includes("FROM intent_observation_candidates")) return { results: routeState.candidates.filter((item) => item.subject_reference === args[0]).map((item) => ({ ...item,
            intent_status: routeState.intents.find((intent) => intent.intent_id === item.intent_id)?.status,
            intent_type: routeState.intents.find((intent) => intent.intent_id === item.intent_id)?.intent_type })) };
          if (query.includes("FROM transaction_intents")) {
            const db = new DatabaseSync(":memory:");
            try {
              db.exec("CREATE TABLE transaction_intents (intent_id TEXT, subject_reference TEXT, chain_id INTEGER, transaction_hash TEXT, status TEXT, updated_at TEXT, intent_type TEXT); CREATE TABLE intent_prepared_calls (intent_id TEXT, reported_hash TEXT, updated_at TEXT)");
              const insertIntent = db.prepare("INSERT INTO transaction_intents VALUES (?, ?, ?, ?, ?, ?, ?)");
              const insertStep = db.prepare("INSERT INTO intent_prepared_calls VALUES (?, ?, ?)");
              for (const intent of routeState.intents) insertIntent.run(String(intent.intent_id), String(intent.subject_reference), Number(intent.chain_id), intent.transaction_hash == null ? null : String(intent.transaction_hash), String(intent.status), String(intent.updated_at ?? "2026-09-01T00:00:00.000Z"), String(intent.intent_type ?? "transfer"));
              for (const step of routeState.steps) insertStep.run(String(step.intent_id), step.reported_hash == null ? null : String(step.reported_hash), String(step.updated_at ?? "2026-09-01T00:00:00.000Z"));
              return { results: db.prepare(query).all(String(args[0])).map((row) => ({ ...row })) };
            } finally { db.close(); }
          }
          if (query.includes("FROM intent_prepared_calls")) return { results: routeState.steps.filter((step) => step.intent_id === args[0]).map((step) => ({ ...step })) };
          return { results: [] };
        },
        async run() {
          if (query.includes("UPDATE intent_observation_candidates")) {
            const candidate = routeState.candidates.find((item) => item.report_id === args[4]);
            if (candidate) { candidate.verification_state = args[0]; candidate.canonical_block_hash = args[1]; candidate.effect_reason = args[2]; candidate.last_checked_at = args[3]; }
            return { meta: { changes: candidate ? 1 : 0 } };
          }
          if (query.includes("INSERT INTO intent_observation_checks")) { routeState.candidateChecks.push({ reportId: String(args[1]), evidence: JSON.parse(String(args[5])) as Record<string, unknown> }); return { meta: { changes: 1 } }; }
          if (query.includes("UPDATE intent_prepared_calls SET updated_at = ?")) {
            const steps = routeState.steps.filter((step) => step.intent_id === args[1] && step.subject_reference === args[2] && step.reported_hash);
            for (const step of steps) step.updated_at = args[0];
            return { meta: { changes: steps.length } };
          }
          if (query.includes("UPDATE intent_prepared_calls")) {
            const step = routeState.steps.find((item) => item.intent_id === args.at(-2) && item.step_index === args.at(-1));
            if (step) { step.verification_state = args[0]; step.updated_at = args[2]; }
            return { meta: { changes: step ? 1 : 0 } };
          }
          if (query.includes("UPDATE transaction_intents")) {
            const intent = routeState.intents.find((item) => item.intent_id === (query.includes("transaction_hash = ?") ? args[2] : args.at(-1)));
            if (intent && query.includes("SET status = 'confirmed'")) {
              const db = new DatabaseSync(":memory:");
              try {
                db.exec("CREATE TABLE transaction_intents (intent_id TEXT, intent_type TEXT, status TEXT, confirmed_at TEXT, updated_at TEXT); CREATE TABLE intent_prepared_calls (intent_id TEXT, step_index INTEGER, semantic_action TEXT, verification_state TEXT)");
                db.prepare("INSERT INTO transaction_intents (intent_id, intent_type, status) VALUES (?, ?, ?)")
                  .run(String(intent.intent_id), String(intent.intent_type), String(intent.status));
                for (const step of routeState.steps.filter((item) => item.intent_id === intent.intent_id))
                  db.prepare("INSERT INTO intent_prepared_calls VALUES (?, ?, ?, ?)").run(String(step.intent_id), Number(step.step_index), String(step.semantic_action), String(step.verification_state));
                if (db.prepare(query).run(...args.map(String)).changes !== 1) return { meta: { changes: 0 } };
              } finally { db.close(); }
              intent.status = "confirmed";
            }
            if (intent && query.includes("SET status = 'submitted'")) {
              if (query.includes("transaction_hash = ?") && !(intent.status === "reviewed" && !intent.transaction_hash || intent.status === "submitted" && String(intent.transaction_hash).toLowerCase() === String(args[4]).toLowerCase())) return { meta: { changes: 0 } };
              intent.status = "submitted";
              if (query.includes("transaction_hash = ?")) intent.transaction_hash = args[0];
            }
            return { meta: { changes: intent ? 1 : 0 } };
          }
          if (query.includes("INSERT INTO operational_issues")) routeState.issues.push(String(args[0]));
          if (query.includes("INSERT INTO intent_events")) routeState.events.push(query.includes("'settlement_confirmed'") ? "settlement_confirmed" : String(args[3]));
          return { meta: { changes: 1 } };
        }
      };
    } };
  }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class AuthenticationError extends Error {}, requireVerifiedSubject: async () => ({ subjectReference: routeState.subject }) }));
vi.mock("@/lib/transactions/chain-observation", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/transactions/chain-observation")>(), observeTransaction: async (_chainId: number, transactionHash: string) => {
  const observation = routeState.observations[transactionHash] ?? routeState.observation;
  if (observation instanceof Error) throw observation;
  return observation;
} }));

import { POST as reconcile } from "@/app/api/intents/reconcile/route";

const sender = "0x000000000000000000000000000000000000dEaD";
const recipient = "0x0000000000000000000000000000000000000001";
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const destinationToken = "0x4200000000000000000000000000000000000006";
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;

const nativePrepared = { chainId: 8453, walletAddress: sender, targetAddress: recipient, nativeValue: "100", calldataHash: "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", semanticAction: "native_transfer", expectedEffect: { type: "native_transfer", recipient, amountRaw: "100" }, reportedHash: hash, observedBlockHash: null };
const nativeObservation: ChainObservation = { status: "found", call: { chainId: 8453, from: sender, to: recipient, value: "100", data: "0x" }, receipt: { status: "success", transactionHash: hash, blockHash, blockNumber: 100n, logs: [] }, blockHash, canonicalBlockHash: blockHash, confirmations: 3, finalizedBlockNumber: 100n };

describe("settlement evidence", () => {
  it("keeps a missing transaction or receipt pending", async () => {
    expect(await verifyExpectedEffect(nativePrepared, { status: "pending" })).toMatchObject({ status: "pending" });
    expect(await verifyExpectedEffect(nativePrepared, { ...nativeObservation, receipt: null })).toMatchObject({ status: "pending" });
  });

  it("rejects another sender, target, value, or calldata", async () => {
    for (const call of [
      { ...nativeObservation.call, from: token },
      { ...nativeObservation.call, to: token },
      { ...nativeObservation.call, value: "101" },
      { ...nativeObservation.call, data: "0x1234" }
    ]) expect(await verifyExpectedEffect(nativePrepared, { ...nativeObservation, call })).toMatchObject({ status: "inconsistent" });
  });

  it("does not confirm a reverted receipt, unmined transaction, or shallow block", async () => {
    expect(await verifyExpectedEffect(nativePrepared, { ...nativeObservation, receipt: { ...nativeObservation.receipt!, status: "reverted" } })).toMatchObject({ status: "failed" });
    expect(await verifyExpectedEffect(nativePrepared, { ...nativeObservation, receipt: { ...nativeObservation.receipt!, status: "reverted" }, finalizedBlockNumber: 99n })).toMatchObject({ status: "pending", reason: "finality" });
    expect(await verifyExpectedEffect(nativePrepared, { ...nativeObservation, blockHash: null })).toMatchObject({ status: "inconsistent" });
    expect(await verifyExpectedEffect(nativePrepared, { ...nativeObservation, confirmations: 1 })).toMatchObject({ status: "pending" });
    expect(await verifyExpectedEffect(nativePrepared, { ...nativeObservation, finalizedBlockNumber: 99n })).toMatchObject({ status: "pending", reason: "finality" });
  });

  it("keeps changed or noncanonical block hashes inconsistent", async () => {
    expect(await verifyExpectedEffect({ ...nativePrepared, observedBlockHash: `0x${"c".repeat(64)}` }, nativeObservation)).toMatchObject({ status: "inconsistent", reason: "reorg" });
    expect(await verifyExpectedEffect(nativePrepared, { ...nativeObservation, canonicalBlockHash: `0x${"c".repeat(64)}` })).toMatchObject({ status: "inconsistent", reason: "reorg" });
  });

  it("confirms only a finalized exact native transfer", async () => {
    expect(await verifyExpectedEffect(nativePrepared, nativeObservation)).toEqual({ status: "confirmed" });
  });

  it("requires an exact ERC-20 Transfer log, not receipt success alone", async () => {
    const topics = encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: sender, to: recipient } });
    const tokenPrepared = { ...nativePrepared, targetAddress: token, nativeValue: "0", semanticAction: "erc20_transfer", expectedEffect: { type: "erc20_transfer", token, recipient, amountRaw: "100" } };
    const tokenObservation = { ...nativeObservation, call: { ...nativeObservation.call, to: token, value: "0" }, receipt: { ...nativeObservation.receipt!, logs: [] } };
    expect(await verifyExpectedEffect(tokenPrepared, tokenObservation)).toMatchObject({ status: "inconsistent" });
    expect(await verifyExpectedEffect(tokenPrepared, { ...tokenObservation, receipt: { ...tokenObservation.receipt, logs: [{ address: token, topics: topics.flat().filter((topic): topic is `0x${string}` => typeof topic === "string"), data: `0x${(100n).toString(16).padStart(64, "0")}` }] } })).toEqual({ status: "confirmed" });
  });

  it("requires an exact ERC-20 Approval log for a governed approval", async () => {
    const spender = recipient;
    const topics = encodeEventTopics({ abi: erc20Abi, eventName: "Approval", args: { owner: sender, spender } });
    const prepared = { ...nativePrepared, targetAddress: token, nativeValue: "0", semanticAction: "erc20_approval", expectedEffect: { type: "erc20_approval", token, spender, amountRaw: "100" } };
    const observation = { ...nativeObservation, call: { ...nativeObservation.call, to: token, value: "0" }, receipt: { ...nativeObservation.receipt!, logs: [] } };
    expect(await verifyExpectedEffect(prepared, observation)).toMatchObject({ status: "inconsistent" });
    expect(await verifyExpectedEffect(prepared, { ...observation, receipt: { ...observation.receipt, logs: [{ address: token, topics: topics.flat().filter((topic): topic is `0x${string}` => typeof topic === "string"), data: `0x${(100n).toString(16).padStart(64, "0")}` }] } })).toEqual({ status: "confirmed" });
  });
});

describe("intent reconciliation route", () => {
  const intentId = "00000000-0000-4000-8000-000000000001";
  const request = () => reconcile(new Request("https://aurel.test/api/intents/reconcile", { method: "POST" }));
  beforeEach(() => {
    routeState.subject = "subject-a"; routeState.issues.length = 0; routeState.events.length = 0; routeState.observations = {}; routeState.candidates = []; routeState.candidateChecks = [];
    routeState.intents = [{ intent_id: intentId, subject_reference: "subject-a", chain_id: 8453, transaction_hash: hash, status: "submitted", intent_type: "transfer" }];
    routeState.steps = [{ intent_id: intentId, step_index: 0, subject_reference: "subject-a", wallet_address: sender.toLowerCase(), chain_id: 8453, target_address: recipient.toLowerCase(), native_value: "100", calldata_hash: nativePrepared.calldataHash, semantic_action: "native_transfer", expected_effect_json: JSON.stringify(nativePrepared.expectedEffect), reported_hash: hash, observed_block_hash: null, verification_state: "reported" }];
    routeState.observation = nativeObservation;
  });

  it("leaves a submitted legacy intent unverified without prepared records", async () => {
    routeState.steps = [];
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "unverified_legacy" }] });
    expect(routeState.intents[0].status).toBe("submitted");
  });

  it("confirms only a prepared call with matched final settlement", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "confirmed" }] });
    expect(routeState.intents[0].status).toBe("confirmed");
  });

  it("settles an exact late observation without confirming its cancelled intent", async () => {
    routeState.intents[0].status = "cancelled";
    routeState.intents[0].transaction_hash = null;
    routeState.steps[0].reported_hash = null;
    routeState.candidates = [{ report_id: "report-1", subject_reference: "subject-a", intent_id: intentId, step_index: 0,
      chain_id: 8453, transaction_hash: hash, verification_state: "unindexed", wallet_address: sender.toLowerCase(),
      target_address: recipient.toLowerCase(), native_value: "100", calldata_hash: nativePrepared.calldataHash,
      semantic_action: "native_transfer", expected_effect_json: JSON.stringify(nativePrepared.expectedEffect) }];
    const body = await (await request()).json() as Record<string, unknown>;
    expect(body).toMatchObject({ observations: [{ reportId: "report-1", verificationState: "settled" }] });
    expect(routeState.intents[0].status).toBe("cancelled");
    expect(routeState.intents[0].transaction_hash).toBeNull();
    expect(routeState.candidateChecks).toHaveLength(1);
    expect(routeState.candidateChecks[0]).toMatchObject({ reportId: "report-1", evidence: { canonicalBlockHash: blockHash, confirmations: 3, receipt: { status: "success", blockNumber: "100" } } });
  });

  it.each([
    ["settled", nativeObservation, "settled"],
    ["unindexed", { status: "pending" }, "unindexed"],
    ["mismatch", { ...nativeObservation, call: { ...nativeObservation.call, from: token } }, "identity_mismatch"],
    ["reverted", { ...nativeObservation, receipt: { ...nativeObservation.receipt!, status: "reverted" } }, "reverted"],
    ["rpc failure", new Error("RPC offline"), "check_failed"],
    ["reorg", { ...nativeObservation, canonicalBlockHash: `0x${"c".repeat(64)}` }, "check_failed"]
  ] as const)("keeps a late %s outside normal submission", async (_case, observation, expected) => {
    routeState.intents[0].status = "reviewed";
    routeState.intents[0].transaction_hash = null;
    routeState.steps[0].reported_hash = null;
    routeState.candidates = [{ report_id: "report-1", subject_reference: "subject-a", intent_id: intentId, step_index: 0,
      chain_id: 8453, transaction_hash: hash, verification_state: "unindexed", wallet_address: sender.toLowerCase(),
      target_address: recipient.toLowerCase(), native_value: "100", calldata_hash: nativePrepared.calldataHash,
      semantic_action: "native_transfer", expected_effect_json: JSON.stringify(nativePrepared.expectedEffect) }];
    routeState.observation = observation;
    const body = await (await request()).json() as { observations: Array<{ verificationState: string }> };
    expect(body.observations[0].verificationState).toBe(expected);
    expect(routeState.intents[0]).toMatchObject({ status: "reviewed", transaction_hash: null });
    expect(routeState.candidateChecks).toHaveLength(1);
    if (expected === "settled") expect(routeState.issues).toHaveLength(1);
  });

  it("never marks a swap or bridge complete from source-chain evidence alone", async () => {
    for (const type of ["swap", "bridge"]) {
      routeState.intents[0].intent_type = type;
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "source_confirmed_pending_settlement" }] });
      expect(routeState.intents[0].status).toBe("submitted");
      expect(routeState.events).not.toContain("settlement_confirmed");
    }
  });

  async function swapEvidence(receivedRaw: bigint) {
    const diamond = recipient;
    const call = { chainId: 8453, from: sender, to: diamond, value: "0", data: "0x12345678" };
    const normalized = await normalizePreparedCall(call);
    const transferLog = (asset: string, from: string, to: string, amount: bigint) => ({
      address: asset,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as `0x${string}`, to: to as `0x${string}` } }) as string[],
      data: `0x${amount.toString(16).padStart(64, "0")}`
    });
    routeState.intents[0].intent_type = "swap";
    routeState.steps[0] = { ...routeState.steps[0], target_address: diamond.toLowerCase(), native_value: "0",
      calldata_hash: normalized.dataHash, semantic_action: "swap", expected_effect_json: JSON.stringify({
        type: "swap", wallet: sender, sourceAssetId: `8453:${token.toLowerCase()}`,
        destinationAssetId: `8453:${destinationToken.toLowerCase()}`, sourceAmountRaw: "100",
        minimumOutputRaw: "80", recipient: sender
      }) };
    const baseObservation = nativeObservation as Extract<ChainObservation, { status: "found" }>;
    routeState.observation = { ...baseObservation, call, receipt: { ...baseObservation.receipt!, logs: [
      transferLog(token, sender, diamond, 100n),
      ...(receivedRaw > 0n ? [transferLog(destinationToken, diamond, sender, receivedRaw)] : [])
    ] } };
  }

  it.each([[80n, "settled"], [79n, "identity_matched"]] as const)(
    "tracks a late swap with %s destination units as %s without submitting it", async (received, expectedState) => {
      await swapEvidence(received);
      routeState.intents[0].status = "cancelled";
      routeState.intents[0].transaction_hash = null;
      routeState.steps[0].reported_hash = null;
      routeState.candidates = [{ report_id: "swap-report", subject_reference: "subject-a", intent_id: intentId,
        step_index: 0, chain_id: 8453, transaction_hash: hash, verification_state: "unindexed",
        wallet_address: sender.toLowerCase(), target_address: recipient.toLowerCase(), native_value: "0",
        calldata_hash: routeState.steps[0].calldata_hash, semantic_action: "swap",
        expected_effect_json: routeState.steps[0].expected_effect_json }];
      const body = await (await request()).json() as { observations: Array<{ verificationState: string }> };
      expect(body.observations).toMatchObject([{ reportId: "swap-report", verificationState: expectedState }]);
      expect(routeState.intents[0]).toMatchObject({ status: "cancelled", transaction_hash: null });
      expect(routeState.steps[0].reported_hash).toBeNull();
      expect(routeState.candidateChecks).toHaveLength(1);
      if (received === 79n) expect(routeState.candidates[0]).toMatchObject({ effect_reason: "minimum_not_met" });
    }
  );

  it("confirms an exact same-chain swap only after finalized source debit and minimum destination credit", async () => {
    await swapEvidence(80n);
    const body = await (await request()).json();
    expect(body).toMatchObject({ results: [{ intentId, status: "confirmed", verificationState: "confirmed" }] });
    expect(routeState.intents[0].status).toBe("confirmed");
    expect(routeState.events).toContain("settlement_confirmed");
  });

  it.each([[0n, "inconsistent"], [79n, "partial"]])("does not settle swap with only %s destination units", async (received, state) => {
    await swapEvidence(received);
    const body = await (await request()).json();
    expect(body).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: state }] });
    expect(routeState.intents[0].status).toBe("submitted");
    expect(routeState.events).not.toContain("settlement_confirmed");
  });

  it("does not settle a swap whose transaction differs from the prepared calldata", async () => {
    await swapEvidence(100n);
    routeState.observation = { ...(routeState.observation as Extract<ChainObservation, { status: "found" }>),
      call: { ...(routeState.observation as Extract<ChainObservation, { status: "found" }>).call, data: "0xdeadbeef" } };
    const body = await (await request()).json();
    expect(body).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "inconsistent" }] });
    expect(routeState.events).not.toContain("settlement_confirmed");
  });

  it("downgrades a previously confirmed swap after a reorg", async () => {
    await swapEvidence(100n);
    routeState.intents[0].status = "confirmed";
    routeState.steps[0].observed_block_hash = `0x${"c".repeat(64)}`;
    const body = await (await request()).json();
    expect(body).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "reorged" }] });
    expect(routeState.intents[0].status).toBe("submitted");
  });

  it("downgrades a previously confirmed routed intent that has only source evidence", async () => {
    routeState.intents[0].intent_type = "bridge";
    routeState.intents[0].status = "confirmed";
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "source_confirmed_pending_settlement" }] });
    expect(routeState.intents[0].status).toBe("submitted");
  });

  it("revisits a reported hash saved before RPC indexed it", async () => {
    routeState.intents[0].status = "reviewed";
    routeState.intents[0].transaction_hash = null;
    routeState.steps[0].verification_state = "pending";
    routeState.observation = { status: "pending" };
    const pending = await request();
    expect(await pending.json()).toMatchObject({ results: [{ intentId, verificationState: "pending" }] });
    expect(routeState.intents[0].status).toBe("reviewed");
    routeState.observation = nativeObservation;
    const settled = await request();
    expect(await settled.json()).toMatchObject({ results: [{ intentId, status: "confirmed", verificationState: "confirmed" }] });
    expect(routeState.intents[0]).toMatchObject({ status: "confirmed", transaction_hash: hash });
  });

  it("binds an indexed exact hash while receipt evidence is still pending", async () => {
    routeState.intents[0].status = "reviewed";
    routeState.intents[0].transaction_hash = null;
    routeState.steps[0].verification_state = "pending";
    routeState.observation = { ...nativeObservation, receipt: null };
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "pending" }] });
    expect(routeState.intents[0]).toMatchObject({ status: "submitted", transaction_hash: hash });
  });

  it("does not bind a reviewed intent to a mismatched transaction", async () => {
    routeState.intents[0].status = "reviewed";
    routeState.intents[0].transaction_hash = null;
    routeState.steps[0].verification_state = "pending";
    routeState.observation = { ...nativeObservation, call: { ...nativeObservation.call, from: token } };
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "reviewed", verificationState: "inconsistent" }] });
    expect(routeState.intents[0]).toMatchObject({ status: "reviewed", transaction_hash: null });
  });

  it("keeps multi-step intent pending until every step is verified", async () => {
    routeState.steps.push({ ...routeState.steps[0], step_index: 1, reported_hash: null, verification_state: "prepared" });
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted" }] });
    expect(routeState.intents[0].status).toBe("submitted");
  });

  it("advances a submitted multi-step intent to the later exact hash", async () => {
    const laterHash = `0x${"c".repeat(64)}`;
    routeState.steps.push({ ...routeState.steps[0], step_index: 1, reported_hash: laterHash, verification_state: "pending" });
    routeState.observations[laterHash] = { status: "pending" };
    const first = await request();
    expect(await first.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "pending" }] });
    expect(routeState.intents[0].transaction_hash).toBe(hash);
    routeState.observations[laterHash] = { ...nativeObservation, receipt: null };
    const second = await request();
    expect(await second.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "pending" }] });
    expect(routeState.intents[0].transaction_hash).toBe(laterHash);
    routeState.observations[laterHash] = { ...nativeObservation, receipt: { ...nativeObservation.receipt!, transactionHash: laterHash } };
    const third = await request();
    expect(await third.json()).toMatchObject({ results: [{ intentId, status: "confirmed", verificationState: "confirmed" }] });
  });

  it("keeps the earlier hash when the later step does not match its prepared call", async () => {
    const laterHash = `0x${"c".repeat(64)}`;
    routeState.steps.push({ ...routeState.steps[0], step_index: 1, reported_hash: laterHash, verification_state: "pending" });
    routeState.observations[laterHash] = { ...nativeObservation, call: { ...nativeObservation.call, from: token }, receipt: { ...nativeObservation.receipt!, transactionHash: laterHash } };
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "inconsistent" }] });
    expect(routeState.intents[0].transaction_hash).toBe(hash);
  });

  it("retries an older reviewed hash despite 20 newer confirmed intents", async () => {
    const reviewed = { ...routeState.intents[0], status: "reviewed", transaction_hash: null, updated_at: "2026-09-01T00:00:00.000Z" };
    const reviewedStep = { ...routeState.steps[0], updated_at: "2026-09-01T00:00:00.000Z" };
    const confirmed = Array.from({ length: 20 }, (_, index) => ({ ...routeState.intents[0], intent_id: `00000000-0000-4000-8000-${(index + 2).toString(16).padStart(12, "0")}`, status: "confirmed", updated_at: "2026-09-22T00:00:00.000Z" }));
    routeState.intents = [reviewed, ...confirmed];
    routeState.steps = [reviewedStep, ...confirmed.map((intent) => ({ ...reviewedStep, intent_id: intent.intent_id, updated_at: "2026-09-22T00:00:00.000Z" }))];
    routeState.observation = { status: "pending" };
    const response = await request();
    const body = await response.json() as { results: Array<{ intentId: string }> };
    expect(body.results).toHaveLength(20);
    expect(body.results.some((result) => result.intentId === intentId)).toBe(true);
    expect(routeState.intents[0].status).toBe("reviewed");
  });

  it("retries all 25 pending reported hashes across successive batches", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T10:00:00.000Z"));
    try {
      routeState.intents = Array.from({ length: 25 }, (_, index) => ({ intent_id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`, subject_reference: "subject-a", chain_id: 8453, transaction_hash: null, status: "reviewed", updated_at: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }));
      routeState.steps = routeState.intents.map((intent, index) => ({ ...routeState.steps[0], intent_id: intent.intent_id, reported_hash: `0x${(index + 1).toString(16).padStart(64, "0")}`, verification_state: "pending", updated_at: "2026-09-01T00:00:00.000Z" }));
      routeState.observation = { status: "pending" };
      const first = await (await request()).json() as { results: Array<{ intentId: string; status: string }> };
      vi.setSystemTime(new Date("2026-09-23T10:00:01.000Z"));
      const second = await (await request()).json() as { results: Array<{ intentId: string; status: string }> };
      expect(first.results).toHaveLength(20);
      expect(new Set([...first.results, ...second.results].map((result) => result.intentId)).size).toBe(25);
      expect(routeState.intents.every((intent) => intent.status === "reviewed" && intent.transaction_hash === null)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("moves past 20 RPC failures to retry a healthy newer reported hash", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T10:00:00.000Z"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      routeState.intents = Array.from({ length: 21 }, (_, index) => ({ intent_id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`, subject_reference: "subject-a", chain_id: 8453, transaction_hash: null, status: "reviewed", updated_at: "2026-09-01T00:00:00.000Z" }));
      routeState.steps = routeState.intents.map((intent, index) => ({ ...routeState.steps[0], intent_id: intent.intent_id, reported_hash: `0x${(index + 1).toString(16).padStart(64, "0")}`, verification_state: "pending", updated_at: index < 20 ? "2026-09-01T00:00:00.000Z" : "2026-09-02T00:00:00.000Z" }));
      for (const step of routeState.steps.slice(0, 20)) routeState.observations[String(step.reported_hash)] = new Error("RPC unavailable");
      routeState.observation = { status: "pending" };
      const first = await (await request()).json() as { results: Array<{ intentId: string; status: string; verificationState: string }> };
      expect(first.results).toHaveLength(20);
      expect(first.results.every((result) => result.status === "reviewed" && result.verificationState === "check_failed")).toBe(true);
      expect(errorSpy).toHaveBeenCalledTimes(20);
      vi.setSystemTime(new Date("2026-09-23T10:00:01.000Z"));
      const second = await (await request()).json() as { results: Array<{ intentId: string; status: string; verificationState: string }> };
      expect(second.results).toContainEqual({ intentId: routeState.intents[20].intent_id, status: "reviewed", verificationState: "pending" });
      expect(routeState.intents.every((intent) => intent.status === "reviewed" && intent.transaction_hash === null)).toBe(true);
      expect(routeState.steps.every((step) => step.verification_state === "pending")).toBe(true);
    } finally { errorSpy.mockRestore(); vi.useRealTimers(); }
  });

  it("does not confirm a receipt missing the expected effect", async () => {
    routeState.steps[0].expected_effect_json = JSON.stringify({ type: "erc20_transfer", token, recipient, amountRaw: "100" });
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted" }] });
    expect(routeState.intents[0].status).toBe("submitted");
  });

  it("does not confirm a matched transaction without a receipt", async () => {
    routeState.observation = { ...nativeObservation, receipt: null };
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted" }] });
    expect(routeState.intents[0].status).toBe("submitted");
  });

  it("marks a changed block as reorged while leaving the intent submitted", async () => {
    routeState.steps[0].observed_block_hash = `0x${"c".repeat(64)}`;
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "reorged" }] });
    expect(routeState.intents[0].status).toBe("submitted");
  });

  it("downgrades a previously confirmed intent when its observed block reorgs", async () => {
    routeState.intents[0].status = "confirmed";
    routeState.steps[0].verification_state = "confirmed";
    routeState.steps[0].observed_block_hash = `0x${"c".repeat(64)}`;
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted", verificationState: "reorged" }] });
    expect(routeState.intents[0].status).toBe("submitted");
  });

  it("reports a reviewed intent as reviewed when its chain check throws", async () => {
    routeState.intents[0].status = "reviewed";
    routeState.intents[0].transaction_hash = null;
    routeState.observations[hash] = new Error("RPC unavailable");
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "reviewed", verificationState: "check_failed" }] });
  });
});
