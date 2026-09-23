import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { encodeEventTopics, erc20Abi } from "viem";
import { verifyExpectedEffect } from "@/lib/transactions/effects";
import type { ChainObservation } from "@/lib/transactions/chain-observation";

const routeState = vi.hoisted(() => ({
  subject: "subject-a",
  intents: [] as Array<Record<string, unknown>>,
  steps: [] as Array<Record<string, unknown>>,
  observation: null as unknown,
  observations: {} as Record<string, unknown>,
  issues: [] as string[],
  events: [] as string[]
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(query: string) {
    return { bind(...args: unknown[]) {
      return {
        async all() {
          if (query.includes("FROM transaction_intents")) {
            const db = new DatabaseSync(":memory:");
            try {
              db.exec("CREATE TABLE transaction_intents (intent_id TEXT, subject_reference TEXT, chain_id INTEGER, transaction_hash TEXT, status TEXT, updated_at TEXT); CREATE TABLE intent_prepared_calls (intent_id TEXT, reported_hash TEXT, updated_at TEXT)");
              const insertIntent = db.prepare("INSERT INTO transaction_intents VALUES (?, ?, ?, ?, ?, ?)");
              const insertStep = db.prepare("INSERT INTO intent_prepared_calls VALUES (?, ?, ?)");
              for (const intent of routeState.intents) insertIntent.run(String(intent.intent_id), String(intent.subject_reference), Number(intent.chain_id), intent.transaction_hash == null ? null : String(intent.transaction_hash), String(intent.status), String(intent.updated_at ?? "2026-09-01T00:00:00.000Z"));
              for (const step of routeState.steps) insertStep.run(String(step.intent_id), step.reported_hash == null ? null : String(step.reported_hash), String(step.updated_at ?? "2026-09-01T00:00:00.000Z"));
              return { results: db.prepare(query).all(String(args[0])).map((row) => ({ ...row })) };
            } finally { db.close(); }
          }
          if (query.includes("FROM intent_prepared_calls")) return { results: routeState.steps.filter((step) => step.intent_id === args[0]).map((step) => ({ ...step })) };
          return { results: [] };
        },
        async run() {
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
              if (!["submitted", "confirmed"].includes(String(intent.status)) || routeState.steps.some((step) => step.intent_id === intent.intent_id && step.verification_state !== "confirmed")) return { meta: { changes: 0 } };
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
          if (query.includes("INSERT INTO intent_events")) routeState.events.push(String(args[3]));
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
    routeState.subject = "subject-a"; routeState.issues.length = 0; routeState.events.length = 0; routeState.observations = {};
    routeState.intents = [{ intent_id: intentId, subject_reference: "subject-a", chain_id: 8453, transaction_hash: hash, status: "submitted" }];
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
