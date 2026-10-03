import { recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import {
  approveAgentAction, buildAgentSendAssetAction, buildAgentSetAbstractionAction, l1ActionHash, l1ActionTypedData, sendToEvmWithDataAction, splitSignature, submitExchange,
  withdrawAction, type L1Action
} from "@/lib/markets/hyperliquid/actions";
import { buildOrderAction } from "@/lib/markets/hyperliquid/orders";
import type { TypedData } from "@/lib/markets/types";
import { VenueError } from "@/lib/markets/types";

// Public test keys from Hyperliquid's Python SDK and the nktkas TypeScript SDK test suites. Never funded.
const PYTHON_SDK_KEY = "0x0123456789012345678901234567890123456789012345678901234567890123";
const NKTKAS_SDK_KEY = "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff";

async function sign(key: Hex, typedData: TypedData) {
  const account = privateKeyToAccount(key);
  const signature = await account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]);
  return splitSignature(signature);
}

/** The Python SDK prints r and s through `to_hex(int)`, which drops leading zeros. */
function expectSignature(actual: { r: string; s: string; v: number }, expected: { r: string; s: string; v: number }) {
  expect(BigInt(actual.r)).toBe(BigInt(expected.r));
  expect(BigInt(actual.s)).toBe(BigInt(expected.s));
  expect(actual.v).toBe(expected.v);
}

const nktkasOrder: L1Action = {
  type: "order",
  orders: [{ a: 0, b: true, p: "30000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na"
};

describe("Hyperliquid L1 action hash", () => {
  it("matches the nktkas SDK vectors with and without vault and expiry", () => {
    const vault = "0x1234567890123456789012345678901234567890";
    expect(l1ActionHash(nktkasOrder, 1234567890)).toBe("0x25367e0dba84351148288c2233cd6130ed6cec5967ded0c0b7334f36f957cc90");
    expect(l1ActionHash(nktkasOrder, 1234567890, vault)).toBe("0x214e2ea3270981b6fd18174216691e69f56872663139d396b10ded319cb4bb1e");
    expect(l1ActionHash(nktkasOrder, 1234567890, undefined, 1234567890))
      .toBe("0xc30b002ba3775e4c31c43c1dfd3291dfc85c6ae06c6b9f393991de86cad5fac7");
    expect(l1ActionHash(nktkasOrder, 1234567890, vault, 1234567890))
      .toBe("0x2d62412aa0fc57441b5189841d81554a6a9680bf07204e1454983a9ca44f0744");
  });

  it("matches the Python SDK phantom agent for a production order", () => {
    const action = buildOrderAction({
      market: { assetIndex: 4, szDecimals: 4, midPx: "1670" }, side: "buy", size: "0.0147", type: "limit", limitPrice: "1670.1"
    });
    action.orders[0].t = { limit: { tif: "Ioc" } };
    expect(l1ActionHash(action, 1677777606040)).toBe("0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908");
  });

  it("depends on key order, as Hyperliquid's msgpack hash does", () => {
    const reordered = { grouping: "na", type: "order", orders: nktkasOrder.orders } as L1Action;
    expect(l1ActionHash(reordered, 1234567890)).not.toBe(l1ActionHash(nktkasOrder, 1234567890));
  });

  it("refuses floats, which would hash differently from what Hyperliquid verifies", () => {
    expect(() => l1ActionHash({ type: "dummy", num: 1.5 }, 0)).toThrow(VenueError);
  });
});

describe("Hyperliquid L1 signatures", () => {
  it("reproduces the Python SDK signatures, including a uint64 field and a vault", async () => {
    // float_to_int_for_hashing(1000) = 1000 * 1e8, which msgpack must encode as uint64, not float64.
    const dummy: L1Action = { type: "dummy", num: 100_000_000_000 };
    expectSignature(await sign(PYTHON_SDK_KEY, l1ActionTypedData(dummy, 0)), {
      r: "0x53749d5b30552aeb2fca34b530185976545bb22d0b3ce6f62e31be961a59298",
      s: "0x755c40ba9bf05223521753995abb2f73ab3229be8ec921f350cb447e384d8ed8", v: 27
    });
    expectSignature(await sign(PYTHON_SDK_KEY, l1ActionTypedData(dummy, 0, "0x1719884eb866cb12b2287399b15f7db5e7d775ea")), {
      r: "0x3c548db75e479f8012acf3000ca3a6b05606bc2ec0c29c50c515066a326239",
      s: "0x4d402be7396ce74fbba3795769cda45aec00dc3125a984f2a9f23177b190da2c", v: 28
    });
    const order = buildOrderAction({ market: { assetIndex: 1, szDecimals: 0, midPx: "100" }, side: "buy", size: "100",
      type: "limit", limitPrice: "100" });
    expectSignature(await sign(PYTHON_SDK_KEY, l1ActionTypedData(order, 0)), {
      r: "0xd65369825a9df5d80099e513cce430311d7d26ddf477f5b3a33d2806b100d78e",
      s: "0x2b54116ff64054968aa237c20ca9ff68000f977c93289157748a3162b6ea940e", v: 28
    });
  });

  it("reproduces the nktkas SDK mainnet order signature", async () => {
    expectSignature(await sign(NKTKAS_SDK_KEY, l1ActionTypedData(nktkasOrder, 1234567890)), {
      r: "0x61078d8ffa3cb591de045438a1ae2ed299b271891d1943a33901e7cfb3a31ed8",
      s: "0x0e91df4f9841641d3322dad8d932874b74d7e082cdb5b533f804964a6963aef9", v: 28
    });
  });

  it("builds the phantom agent typed data for mainnet", () => {
    const typedData = l1ActionTypedData(nktkasOrder, 1234567890);
    expect(typedData).toEqual({
      domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
      primaryType: "Agent",
      message: { source: "a", connectionId: "0x25367e0dba84351148288c2233cd6130ed6cec5967ded0c0b7334f36f957cc90" }
    });
  });
});

describe("Hyperliquid user-signed actions", () => {
  const owner = privateKeyToAccount(PYTHON_SDK_KEY);

  it("builds approveAgent with Arbitrum signing, a lowercase agent, and an optional expiry", async () => {
    const { action, typedData } = approveAgentAction({ agentAddress: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
      agentName: "Aura", nonce: 1_790_000_000_000, validUntil: 1_800_000_000_000 });
    expect(Object.keys(action)).toEqual(["type", "signatureChainId", "hyperliquidChain", "agentAddress", "agentName", "nonce"]);
    expect(action).toMatchObject({ type: "approveAgent", signatureChainId: "0xa4b1", hyperliquidChain: "Mainnet",
      agentAddress: "0xabcdef0123456789abcdef0123456789abcdef01", agentName: "Aura valid_until 1800000000000" });
    expect(typedData.domain).toEqual({ name: "HyperliquidSignTransaction", version: "1", chainId: 42161,
      verifyingContract: "0x0000000000000000000000000000000000000000" });
    expect(typedData.types["HyperliquidTransaction:ApproveAgent"].map((field) => `${field.type} ${field.name}`))
      .toEqual(["string hyperliquidChain", "address agentAddress", "string agentName", "uint64 nonce"]);
    const signature = await owner.signTypedData(typedData as Parameters<typeof owner.signTypedData>[0]);
    await expect(recoverTypedDataAddress({ ...(typedData as Parameters<typeof owner.signTypedData>[0]), signature }))
      .resolves.toBe(owner.address);
  });

  it("refuses agent names Hyperliquid would reject", () => {
    expect(() => approveAgentAction({ agentAddress: owner.address, agentName: "x".repeat(17), nonce: 1 })).toThrow(VenueError);
    expect(() => approveAgentAction({ agentAddress: owner.address, agentName: "a valid_until 1", nonce: 1 })).toThrow(VenueError);
    expect(() => approveAgentAction({ agentAddress: "0x12", agentName: "Aura", nonce: 1 })).toThrow(VenueError);
  });

  it("builds withdraw3 whose types reproduce the Python SDK signature", async () => {
    const { action, typedData } = withdrawAction({ destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a",
      amount: "1", time: 1687816341423 });
    expect(action).toEqual({ type: "withdraw3", signatureChainId: "0xa4b1", hyperliquidChain: "Mainnet",
      destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "1", time: 1687816341423 });
    // The Python vector signs for testnet with chain 0x66eee; swap only those two values.
    const vector = { ...typedData, domain: { ...typedData.domain, chainId: 0x66eee },
      message: { ...typedData.message, hyperliquidChain: "Testnet" } };
    expectSignature(await sign(PYTHON_SDK_KEY, vector), {
      r: "0x8363524c799e90ce9bc41022f7c39b4e9bdba786e5f9c72b20e43e1462c37cf9",
      s: "0x58b1411a775938b83e29182e8ef74975f9054c8e97ebf5ec2dc8d51bfc893881", v: 28
    });
    expect(withdrawAction({ destination: owner.address, amount: "002.500", time: 1 }).action.amount).toBe("2.5");
    expect(() => withdrawAction({ destination: owner.address, amount: "0", time: 1 })).toThrow(VenueError);
    expect(() => withdrawAction({ destination: owner.address, amount: "1.1234567", time: 1 })).toThrow(VenueError);
  });

  it("builds sendToEvmWithData to Base per Circle's guide", async () => {
    const { action, typedData } = sendToEvmWithDataAction({ amount: "10.50", destinationRecipient: owner.address,
      nonce: 1_790_000_000_000 });
    expect(action).toEqual({ type: "sendToEvmWithData", signatureChainId: "0xa4b1", hyperliquidChain: "Mainnet",
      token: "USDC", amount: "10.5", sourceDex: "", destinationRecipient: owner.address.toLowerCase(),
      addressEncoding: "hex", destinationChainId: 6, gasLimit: 200_000, data: "0x", nonce: 1_790_000_000_000 });
    expect(typedData.primaryType).toBe("HyperliquidTransaction:SendToEvmWithData");
    expect(typedData.types["HyperliquidTransaction:SendToEvmWithData"].map((field) => `${field.type} ${field.name}`)).toEqual([
      "string hyperliquidChain", "string token", "string amount", "string sourceDex", "string destinationRecipient",
      "string addressEncoding", "uint32 destinationChainId", "uint64 gasLimit", "bytes data", "uint64 nonce"
    ]);
    const signature = await owner.signTypedData(typedData as Parameters<typeof owner.signTypedData>[0]);
    await expect(recoverTypedDataAddress({ ...(typedData as Parameters<typeof owner.signTypedData>[0]), signature }))
      .resolves.toBe(owner.address);
    expect(() => sendToEvmWithDataAction({ amount: "1", destinationRecipient: owner.address, data: "0x1", nonce: 1 }))
      .toThrow(VenueError);
  });
});

describe("Hyperliquid HIP-3 margin actions", () => {
  it("moves USDC between the owner's own dexes with sendAsset's key order", () => {
    const action = buildAgentSendAssetAction({ owner: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", sourceDex: "",
      destinationDex: "xyz", amount: "25.50", nonce: 1_790_000_000_000 });
    expect(action).toEqual({ type: "agentSendAsset", destination: "0xabcdef0123456789abcdef0123456789abcdef01", sourceDex: "",
      destinationDex: "xyz", token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", amount: "25.5", fromSubAccount: "", nonce: 1_790_000_000_000 });
    expect(Object.keys(action)).toEqual(["type", "destination", "sourceDex", "destinationDex", "token", "amount", "fromSubAccount", "nonce"]);
    expect(() => buildAgentSendAssetAction({ owner: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", sourceDex: "xyz",
      destinationDex: "xyz", amount: "1", nonce: 1 })).toThrow(VenueError);
    expect(() => buildAgentSendAssetAction({ owner: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", sourceDex: "",
      destinationDex: "XYZ!", amount: "1", nonce: 1 })).toThrow(VenueError);
  });

  it("sets the account mode from the agent", () => {
    expect(buildAgentSetAbstractionAction("i")).toEqual({ type: "agentSetAbstraction", abstraction: "i" });
    expect(() => buildAgentSetAbstractionAction("x" as "i")).toThrow(VenueError);
  });
});

describe("Hyperliquid /exchange submit", () => {
  const signature = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;
  const order = buildOrderAction({ market: { assetIndex: 0, szDecimals: 5, midPx: "90000" }, side: "buy", size: "0.001",
    type: "market" });

  function exchange(payload: unknown, status = 200) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input; void init;
      return Response.json(payload, { status });
    });
  }

  it("posts the action with a split signature and returns statuses", async () => {
    const fetcher = exchange({ status: "ok", response: { type: "order", data: { statuses: [
      { filled: { totalSz: "0.001", avgPx: "90010.0", oid: 77 } }] } } });
    const result = await submitExchange({ action: order, nonce: 1_790_000_000_000, signature }, { fetcher });
    expect(result).toEqual({ type: "order", statuses: [{ kind: "filled", oid: 77, totalSz: "0.001", avgPx: "90010.0" }] });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.hyperliquid.xyz/exchange");
    expect(JSON.parse(String(init?.body))).toEqual({ action: order, nonce: 1_790_000_000_000,
      signature: { r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: 27 } });
  });

  it("maps resting, success, and partial batches without throwing", async () => {
    const result = await submitExchange({ action: order, nonce: 1, signature }, { fetcher: exchange({ status: "ok",
      response: { type: "order", data: { statuses: [{ resting: { oid: 5 } }, { error: "Order has invalid size." }] } } }) });
    expect(result.statuses).toEqual([{ kind: "resting", oid: 5 }, { kind: "error", message: "Order has invalid size." }]);
    const cancel = await submitExchange({ action: { type: "cancel", cancels: [{ a: 0, o: 5 }] }, nonce: 1, signature },
      { fetcher: exchange({ status: "ok", response: { type: "cancel", data: { statuses: ["success"] } } }) });
    expect(cancel.statuses).toEqual([{ kind: "success" }]);
    const approve = await submitExchange({ action: order, nonce: 1, signature },
      { fetcher: exchange({ status: "ok", response: { type: "default" } }) });
    expect(approve).toEqual({ type: "default", statuses: [] });
  });

  it.each([
    [{ status: "err", response: "User or API Wallet 0xabc does not exist." }, "account_not_found"],
    [{ status: "err", response: "Must deposit before performing actions. User: 0xabc" }, "account_not_funded"],
    [{ status: "err", response: "Something new" }, "rejected"],
    [{ status: "ok", response: { type: "order", data: { statuses: [{ error: "Insufficient margin to place order. asset=0" }] } } },
      "insufficient_margin"],
    [{ status: "ok", response: { type: "order", data: { statuses: [{ error: "Order must have minimum value of $10." }] } } },
      "below_minimum"]
  ])("throws VenueError with the venue's message for %j", async (payload, code) => {
    const error = await submitExchange({ action: order, nonce: 1, signature }, { fetcher: exchange(payload) })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VenueError);
    expect((error as VenueError).code).toBe(code);
    expect((error as VenueError).message).toContain(payload.status === "err" ? String(payload.response) : "");
  });

  it("treats transport failures and odd answers as unavailable or invalid", async () => {
    const failing = vi.fn(async () => { throw new TypeError("network"); });
    await expect(submitExchange({ action: order, nonce: 1, signature }, { fetcher: failing }))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(submitExchange({ action: order, nonce: 1, signature }, { fetcher: exchange({ nope: true }) }))
      .rejects.toMatchObject({ code: "invalid_response" });
    await expect(submitExchange({ action: order, nonce: 1, signature }, { fetcher: exchange({}, 422) }))
      .rejects.toMatchObject({ code: "malformed_request" });
    await expect(submitExchange({ action: order, nonce: 1, signature: "0x12" }, { fetcher: exchange({}) }))
      .rejects.toMatchObject({ code: "invalid_request" });
  });

  it("normalizes a 0/1 recovery byte to 27/28", () => {
    expect(splitSignature(`0x${"11".repeat(64)}01`).v).toBe(28);
  });
});
