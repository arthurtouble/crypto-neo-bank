import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics, erc20Abi } from "viem";
import { verifyExpectedEffect } from "@/lib/transactions/effects";
import type { ChainObservation } from "@/lib/transactions/chain-observation";

const routeState = vi.hoisted(() => ({
  subject: "subject-a",
  intents: [] as Array<Record<string, unknown>>,
  steps: [] as Array<Record<string, unknown>>,
  observation: null as unknown,
  issues: [] as string[],
  events: [] as string[]
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(query: string) {
    return { bind(...args: unknown[]) {
      return {
        async all() {
          if (query.includes("FROM transaction_intents")) return { results: routeState.intents.filter((intent) => intent.subject_reference === args[0] && ["submitted", "confirmed"].includes(String(intent.status))) };
          if (query.includes("FROM intent_prepared_calls")) return { results: routeState.steps.filter((step) => step.intent_id === args[0]) };
          return { results: [] };
        },
        async run() {
          if (query.includes("UPDATE intent_prepared_calls")) {
            const step = routeState.steps.find((item) => item.intent_id === args.at(-2) && item.step_index === args.at(-1));
            if (step) step.verification_state = query.includes("'confirmed'") ? "confirmed" : query.includes("'reorged'") ? "reorged" : query.includes("'failed'") ? "failed" : "inconsistent";
            return { meta: { changes: step ? 1 : 0 } };
          }
          if (query.includes("UPDATE transaction_intents")) {
            const intent = routeState.intents.find((item) => item.intent_id === args.at(-1));
            if (intent && query.includes("SET status = 'confirmed'")) intent.status = "confirmed";
            if (intent && query.includes("SET status = 'submitted'")) intent.status = "submitted";
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
vi.mock("@/lib/transactions/chain-observation", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/transactions/chain-observation")>(), observeTransaction: async () => routeState.observation }));

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
    routeState.subject = "subject-a"; routeState.issues.length = 0; routeState.events.length = 0;
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

  it("keeps multi-step intent pending until every step is verified", async () => {
    routeState.steps.push({ ...routeState.steps[0], step_index: 1, reported_hash: null, verification_state: "prepared" });
    const response = await request();
    expect(await response.json()).toMatchObject({ results: [{ intentId, status: "submitted" }] });
    expect(routeState.intents[0].status).toBe("submitted");
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
});
