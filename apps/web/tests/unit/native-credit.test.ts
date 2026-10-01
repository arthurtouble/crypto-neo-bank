import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi } from "viem";
import { checkAction } from "@/lib/actions/check";
import type { ChainObservation } from "@/lib/actions/chain";
import type { LifiStatusCorroboration } from "@/lib/actions/lifi-status";
import { observeNativeCredit, tracedCredit, type NativeCreditEvidence, type NativeCreditTarget } from "@/lib/actions/native-credit";
import { getAction, listActionEvents } from "@/lib/actions/store";
import { ENTRY_POINT_V07 } from "@/lib/actions/user-operation";
import { verifyAction, type VerifiableAction } from "@/lib/actions/verify";
import { bundler, entryLog, handleOpsV07, kernelBatch, transferLog } from "../support/bundles";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const wallet = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const other = "0x3333333333333333333333333333333333333333";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const diamond = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const hash = `0x${"a".repeat(64)}`;
const destinationHash = `0x${"d".repeat(64)}`;
const block = `0x${"b".repeat(64)}`;
const destinationBlock = `0x${"c".repeat(64)}`;
const now = new Date("2026-10-01T12:00:00.000Z");

describe("reading a native ETH credit from a call trace", () => {
  const call = (to: string, value: bigint, extra: Record<string, unknown> = {}) => ({ type: "CALL", from: diamond, to, value: `0x${value.toString(16)}`, ...extra });

  it("adds every call that reached the recipient, at any depth", () => {
    expect(tracedCredit({ type: "CALL", from: bundler, to: ENTRY_POINT_V07, value: "0x0",
      calls: [call(wallet, 0n, { calls: [call(recipient, 7n), call(other, 100n, { calls: [call(recipient, 3n)] })] })] }, recipient)).toBe(10n);
  });

  it("skips a reverted call and everything under it, and calls that carry no value of their own", () => {
    expect(tracedCredit({ type: "CALL", to: ENTRY_POINT_V07, value: "0x0", calls: [
      call(recipient, 5n, { error: "execution reverted", calls: [call(recipient, 9n)] }),
      { type: "DELEGATECALL", to: recipient, value: "0x63" }, { type: "STATICCALL", to: recipient },
      call(recipient.toUpperCase().replace("0X", "0x"), 2n)] }, recipient)).toBe(2n);
  });

  it("refuses a malformed trace instead of reading it as zero", () => {
    expect(() => tracedCredit({ type: "CALL", calls: "nope" }, recipient)).toThrow();
    expect(() => tracedCredit({ calls: [] }, recipient)).toThrow();
    expect(() => tracedCredit(call(recipient, 0n, { value: "12" }), recipient)).toThrow();
  });
});

describe("observing a native credit on the chain", () => {
  const target: NativeCreditTarget = { chainId: 8453, transactionHash: hash, blockNumber: 100n, blockHash: block, to: recipient };
  /** A JSON-RPC fake per endpoint host: which methods it serves, and the balances it holds at blocks 99 and 100. */
  function node(hosts: Record<string, { trace?: unknown; balances?: [bigint, bigint]; blockHash?: string; chainId?: number }>) {
    const calls: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const host = new URL(url).host;
      const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      calls.push(`${host} ${method}`);
      const answer = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
      const refuse = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "not supported" } }));
      const config = hosts[host];
      if (!config) return new Response("down", { status: 503 });
      if (method === "eth_chainId") return answer(`0x${(config.chainId ?? 8453).toString(16)}`);
      if (method === "debug_traceTransaction") return config.trace ? answer(config.trace) : refuse();
      if (method === "eth_getBalance" && config.balances) return answer(`0x${config.balances[params[1] === "0x63" ? 0 : 1].toString(16)}`);
      if (method === "eth_getBlockByNumber") return answer({ number: params[0], hash: config.blockHash ?? block });
      return refuse();
    }) as typeof fetch;
    return { fetcher, calls };
  }

  it("prefers a trace, and records where and when it was read", async () => {
    const { fetcher } = node({ "mainnet.base.org": { trace: { type: "CALL", to: recipient, value: "0x2a" }, balances: [0n, 1n] } });
    expect(await observeNativeCredit(target, { fetcher, now })).toEqual({ status: "observed", evidence: { method: "trace", source: "mainnet.base.org",
      chainId: 8453, transactionHash: hash, blockNumber: "100", blockHash: block, to: recipient, creditedRaw: "42", observedAt: now.toISOString() } });
  });

  it("falls back to the balance change across the block, which can be negative", async () => {
    expect(await observeNativeCredit(target, { fetcher: node({ "mainnet.base.org": { balances: [1_000n, 1_500n] } }).fetcher, now }))
      .toMatchObject({ status: "observed", evidence: { method: "balance", creditedRaw: "500" } });
    expect(await observeNativeCredit(target, { fetcher: node({ "mainnet.base.org": { balances: [1_000n, 400n] } }).fetcher, now }))
      .toMatchObject({ status: "observed", evidence: { method: "balance", creditedRaw: "-600" } });
  });

  it("skips an endpoint on another chain or another block, and reports unavailable when none can say", async () => {
    const { fetcher, calls } = node({ "mainnet.base.org": { chainId: 1, balances: [0n, 9n] }, "base.drpc.org": { balances: [0n, 9n], blockHash: `0x${"e".repeat(64)}` },
      "1rpc.io": { balances: [0n, 5n] } });
    expect(await observeNativeCredit(target, { fetcher, now })).toMatchObject({ status: "observed", evidence: { method: "balance", source: "1rpc.io", creditedRaw: "5" } });
    expect(calls.filter((call) => call.startsWith("mainnet.base.org"))).toEqual(["mainnet.base.org eth_chainId"]);
    // No history kept for the block, and no trace: unavailable, never zero.
    expect(await observeNativeCredit(target, { fetcher: node({ "mainnet.base.org": {} }).fetcher, now })).toEqual({ status: "unavailable", reason: "native_credit_unavailable" });
  });
});

const evidence = (credited: bigint, method: NativeCreditEvidence["method"] = "balance", overrides: Partial<NativeCreditEvidence> = {}): NativeCreditEvidence => ({
  method, source: "mainnet.base.org", chainId: 8453, transactionHash: hash, blockNumber: "100", blockHash: block, to: recipient,
  creditedRaw: credited.toString(), observedAt: now.toISOString(), ...overrides });

describe("verifying a same-network route that pays out native ETH", () => {
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [diamond, 10_000_000n] });
  const calls = [{ to: usdc, value: "0", data: approve }, { to: diamond, value: "0", data: "0x12345678" }] as VerifiableAction["calls"];
  const route: VerifiableAction = { chainId: 8453, walletAddress: wallet, transactionHash: hash, calls,
    effects: [{ type: "erc20_debit", token: usdc, amountRaw: "10000000" }, { type: "native_credit_min", to: recipient, minimumRaw: "1000" }] };
  const source = (finalized = 100n): ChainObservation => ({ status: "found", blockHash: block, canonicalBlockHash: block, confirmations: 5, finalizedBlockNumber: finalized,
    call: { chainId: 8453, from: bundler, to: ENTRY_POINT_V07, value: "0",
      data: handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: usdc, value: 0n, data: approve }, { to: diamond, value: 0n, data: "0x12345678" }]) }]) },
    receipt: { status: "success", transactionHash: hash, blockHash: block, blockNumber: 100n,
      logs: [entryLog(ENTRY_POINT_V07, "before"), transferLog(usdc, wallet, diamond, 10_000_000n), entryLog(ENTRY_POINT_V07, { sender: wallet, success: true })] } });
  const reads: NativeCreditTarget[] = [];
  const credit = (result: NativeCreditEvidence | null) => async (target: NativeCreditTarget) => {
    reads.push(target);
    return result ? { status: "observed" as const, evidence: result } : { status: "unavailable" as const, reason: "native_credit_unavailable" as const };
  };
  beforeEach(() => { reads.length = 0; });

  it("confirms only once the recipient's credit in the operation's block reaches the minimum", async () => {
    expect(await verifyAction(route, { observe: async () => source(), nativeCredit: credit(evidence(1_000n)) }))
      .toEqual({ status: "confirmed", nativeCredit: evidence(1_000n) });
    expect(reads).toEqual([{ chainId: 8453, transactionHash: hash, blockNumber: 100n, blockHash: block, to: recipient }]);
    expect(await verifyAction(route, { observe: async () => source(99n), nativeCredit: credit(evidence(5_000n, "trace")) }))
      .toEqual({ status: "settling", reason: "finality", nativeCredit: evidence(5_000n, "trace") });
  });

  it("is never confirmed on the debit alone: without a reading it stays pending", async () => {
    expect(await verifyAction(route, { observe: async () => source(), nativeCredit: credit(null) })).toEqual({ status: "pending", reason: "native_credit_unavailable" });
  });

  it("fails a traced shortfall at finality, but keeps a balance shortfall open, since other activity in the block can hide a credit", async () => {
    expect(await verifyAction(route, { observe: async () => source(), nativeCredit: credit(evidence(999n, "trace")) }))
      .toMatchObject({ status: "failed", reason: "effect_missing_native_credit_min" });
    expect(await verifyAction(route, { observe: async () => source(99n), nativeCredit: credit(evidence(999n, "trace")) }))
      .toMatchObject({ status: "pending", reason: "finality" });
    expect(await verifyAction(route, { observe: async () => source(), nativeCredit: credit(evidence(-5n)) }))
      .toMatchObject({ status: "pending", reason: "native_credit_below_minimum", nativeCredit: { creditedRaw: "-5" } });
  });

  it("reuses stored evidence for the same canonical block, and reads again after a reorg", async () => {
    const stored = { ...route, nativeEvidence: [evidence(2_000n)] };
    expect(await verifyAction(stored, { observe: async () => source(), nativeCredit: credit(null) })).toEqual({ status: "confirmed", nativeCredit: evidence(2_000n) });
    expect(reads).toHaveLength(0);
    const moved = { ...route, nativeEvidence: [evidence(2_000n, "balance", { blockHash: `0x${"f".repeat(64)}` })] };
    expect(await verifyAction(moved, { observe: async () => source(), nativeCredit: credit(null) })).toEqual({ status: "pending", reason: "native_credit_unavailable" });
    expect(reads).toHaveLength(1);
  });
});

describe("verifying a cross-network delivery of native ETH", () => {
  const route: VerifiableAction = { chainId: 8453, walletAddress: wallet, transactionHash: hash,
    calls: [{ to: diamond, value: "1000000000000000", data: "0x12345678" }],
    effects: [{ type: "delivery", tool: "across", destinationChainId: 42161, token: null, to: recipient, minimumRaw: "990000000000000" }] };
  const source: ChainObservation = { status: "found", blockHash: block, canonicalBlockHash: block, confirmations: 5, finalizedBlockNumber: 100n,
    call: { chainId: 8453, from: bundler, to: ENTRY_POINT_V07, value: "0",
      data: handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: diamond, value: 1_000_000_000_000_000n, data: "0x12345678" }]) }]) },
    receipt: { status: "success", transactionHash: hash, blockHash: block, blockNumber: 100n,
      logs: [entryLog(ENTRY_POINT_V07, "before"), entryLog(ENTRY_POINT_V07, { sender: wallet, success: true })] } };
  const destination: ChainObservation = { status: "found", blockHash: destinationBlock, canonicalBlockHash: destinationBlock, confirmations: 5, finalizedBlockNumber: 500n,
    call: { chainId: 42161, from: other, to: other, value: "0", data: "0x" },
    receipt: { status: "success", transactionHash: destinationHash, blockHash: destinationBlock, blockNumber: 500n, logs: [] } };
  const observe = async (chainId: number) => chainId === 8453 ? source : destination;
  const lifi = (overrides: Partial<LifiStatusCorroboration> = {}) => async (): Promise<LifiStatusCorroboration> =>
    ({ status: "DONE", sourceHash: hash, destinationChainId: 42161, destinationHash, toolId: "across", substatus: "COMPLETED", ...overrides });
  const at = (credited: bigint, method: NativeCreditEvidence["method"] = "balance") =>
    evidence(credited, method, { chainId: 42161, transactionHash: destinationHash, blockNumber: "500", blockHash: destinationBlock });
  const reads: NativeCreditTarget[] = [];
  const credit = (result: NativeCreditEvidence | null) => async (target: NativeCreditTarget) => {
    reads.push(target);
    return result ? { status: "observed" as const, evidence: result } : { status: "unavailable" as const, reason: "native_credit_unavailable" as const };
  };
  beforeEach(() => { reads.length = 0; });

  it("confirms from the recipient's credit at LI.FI's receiving transaction's block on the destination network", async () => {
    expect(await verifyAction(route, { observe, lifiStatus: lifi(), nativeCredit: credit(at(995_000_000_000_000n)) }))
      .toEqual({ status: "confirmed", destinationHash, nativeCredit: at(995_000_000_000_000n) });
    expect(reads).toEqual([{ chainId: 42161, transactionHash: destinationHash, blockNumber: 500n, blockHash: destinationBlock, to: recipient }]);
  });

  it("stays settling, never confirmed on LI.FI's DONE alone, while the credit can't be read or looks short", async () => {
    expect(await verifyAction(route, { observe, lifiStatus: lifi(), nativeCredit: credit(null) })).toEqual({ status: "settling", reason: "native_credit_unavailable" });
    expect(await verifyAction(route, { observe, lifiStatus: lifi(), nativeCredit: credit(at(1n)) }))
      .toMatchObject({ status: "settling", reason: "native_credit_below_minimum" });
    expect(await verifyAction(route, { observe, lifiStatus: lifi(), nativeCredit: credit(at(1n, "trace")) }))
      .toMatchObject({ status: "failed", reason: "delivery_below_minimum" });
  });

  it("reads nothing when LI.FI's receiving transaction isn't reported for this source transaction", async () => {
    expect(await verifyAction(route, { observe, lifiStatus: lifi({ sourceHash: `0x${"9".repeat(64)}` }), nativeCredit: credit(at(10n ** 18n)) }))
      .toEqual({ status: "settling", reason: "status_mismatch" });
    expect(await verifyAction(route, { observe, lifiStatus: lifi({ destinationChainId: 10 }), nativeCredit: credit(at(10n ** 18n)) }))
      .toEqual({ status: "settling", reason: "status_mismatch" });
    expect(reads).toHaveLength(0);
  });
});

describe("keeping a native credit reading as the action's evidence", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => {
    sqlite = schemaDatabase();
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
      INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id, summary_json, calls_json, calls_fingerprint, effects_json,
        counts_toward_limit, status, transaction_hash, created_at, expires_at, updated_at) VALUES ('swap', 'alice', '${wallet}', 'route', 8453, '{}',
        '[{"to":"${diamond}","value":"0","data":"0x12345678"}]', 'fp', '[{"type":"native_credit_min","to":"${recipient}","minimumRaw":"1000"}]', 0,
        'submitted', '${hash}', 't', '2026-10-01T13:00:00.000Z', 't');`);
  });
  afterEach(() => sqlite.close());

  it("stores the first reading once and hands it to later checks", async () => {
    const db = d1(sqlite);
    const seen: Array<NativeCreditEvidence[] | undefined> = [];
    const verify: typeof verifyAction = async (action) => {
      seen.push(action.nativeEvidence);
      return action.nativeEvidence?.length ? { status: "confirmed", nativeCredit: action.nativeEvidence[0] } : { status: "settling", reason: "finality", nativeCredit: evidence(1_500n) };
    };
    await checkAction(db, (await getAction(db, "alice", "swap"))!, now, { verify });
    await checkAction(db, (await getAction(db, "alice", "swap"))!, now, { verify });
    expect(seen).toEqual([[], [evidence(1_500n)]]);
    expect((await getAction(db, "alice", "swap"))!.status).toBe("confirmed");
    expect((await listActionEvents(db, "swap")).filter((event) => event.type === "native_credit").map((event) => event.evidence)).toEqual([evidence(1_500n)]);
  });
});
