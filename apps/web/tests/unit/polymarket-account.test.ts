import { decodeFunctionData, encodeFunctionResult, erc20Abi, hashTypedData, maxUint256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { VenueError, type TypedData } from "@/lib/markets/types";
import {
  approvalCalls, assertOwnerSignature, deployDepositWallet, depositWalletAddress, fetchWalletNonce, relayerTransaction, staleBatchNonce,
  submitWalletBatch, tradingApprovalsState, walletBatchTypedData, TRADING_APPROVALS
} from "@/lib/markets/polymarket/account";
import { hmacSignature, POLYMARKET_CONTRACTS } from "@/lib/markets/polymarket/http";
import { MULTICALL3 } from "@/lib/markets/polymarket/chain";

// Hardhat's public test key #1; never a real account.
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const wallet = "0x4Fe2CC4925607a473264FA89e7138075695A5F8e";
const credentials = { key: "builder-key", secret: btoa("secret-key-for-tests-only"), passphrase: "builder-pass" };

const signable = (typedData: TypedData) => {
  const types = Object.fromEntries(Object.entries(typedData.types).filter(([name]) => name !== "EIP712Domain"));
  return { ...typedData, types } as unknown as Parameters<typeof owner.signTypedData>[0];
};

describe("Deposit Wallet address", () => {
  it("matches the SDK's beacon derivation vectors", () => {
    // From the SDK's wallet.test.ts.
    expect(depositWalletAddress("0x0000000000000000000000000000000000000001").toLowerCase()).toBe("0x94bf330955a0b957662feaf878de77bf25f76cd9");
    // From the SDK's deriveBeaconDepositWalletAddress for the test owner.
    expect(depositWalletAddress(owner.address)).toBe(wallet);
    expect(depositWalletAddress(owner.address.toLowerCase())).toBe(wallet);
    expect(() => depositWalletAddress("0x123")).toThrow(VenueError);
  });
});

describe("Relayer requests", () => {
  it("deploys through WALLET-CREATE signed with the builder key", async () => {
    const fetcher = vi.fn(async () => Response.json({ transactionID: "tx-1", state: "STATE_NEW" })) as unknown as typeof fetch;
    const now = new Date(1_791_000_000_000);
    await expect(deployDepositWallet(owner.address, { credentials, fetcher, now })).resolves.toEqual({ transactionId: "tx-1", state: "STATE_NEW", transactionHash: null });
    const [url, init] = vi.mocked(fetcher).mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://relayer-v2.polymarket.com/submit");
    expect(JSON.parse(init.body as string)).toEqual({ type: "WALLET-CREATE", from: owner.address, to: POLYMARKET_CONTRACTS.depositWalletFactory, metadata: "Deploy Deposit Wallet" });
    expect(init.headers.POLY_BUILDER_API_KEY).toBe("builder-key");
    expect(init.headers.POLY_BUILDER_TIMESTAMP).toBe("1791000000");
    expect(init.headers.POLY_BUILDER_SIGNATURE).toBe(await hmacSignature(credentials.secret, 1791000000, "POST", "/submit", init.body as string));
  });

  it("reads a nonce and a transaction's outcome", async () => {
    const nonceFetch = vi.fn(async () => Response.json({ address: owner.address, nonce: "7" })) as unknown as typeof fetch;
    await expect(fetchWalletNonce(owner.address, { credentials, fetcher: nonceFetch })).resolves.toBe("7");
    expect(vi.mocked(nonceFetch).mock.calls[0]?.[0]).toBe(`https://relayer-v2.polymarket.com/v1/account/transactions/params?address=${owner.address}&type=WALLET`);
    const hash = `0x${"c".repeat(64)}`;
    const txFetch = vi.fn(async () => Response.json({ transaction_id: "tx-1", transaction_hash: hash, state: "STATE_CONFIRMED", error_msg: null })) as unknown as typeof fetch;
    await expect(relayerTransaction("tx-1", { credentials, fetcher: txFetch })).resolves.toMatchObject({ outcome: "confirmed", transactionHash: hash });
    const failed = vi.fn(async () => Response.json({ transaction_id: "tx-2", transaction_hash: "", state: "STATE_FAILED", error_msg: "reverted" })) as unknown as typeof fetch;
    await expect(relayerTransaction("tx-2", { credentials, fetcher: failed })).resolves.toMatchObject({ outcome: "failed", transactionHash: null, error: "reverted" });
  });
});

describe("Wallet batches", () => {
  const calls = approvalCalls().slice(0, 2);
  const batch = { wallet, nonce: "7", deadline: "1791000600", calls };

  it("hashes the same as the SDK's bigint payload", () => {
    const typed = walletBatchTypedData(batch);
    const sdkShape = {
      domain: { chainId: 137, name: "DepositWallet", verifyingContract: wallet, version: "1" },
      primaryType: "Batch" as const,
      types: {
        Batch: [{ name: "wallet", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "calls", type: "Call[]" }],
        Call: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }]
      },
      message: { wallet, nonce: 7n, deadline: 1791000600n, calls: calls.map((call) => ({ target: call.target, value: 0n, data: call.data })) }
    } as const;
    expect(hashTypedData(signable(typed))).toBe(hashTypedData(sdkShape));
  });

  it("submits an owner-signed batch in the relayer's WALLET shape", async () => {
    const typed = walletBatchTypedData(batch);
    const signature = await owner.signTypedData(signable(typed));
    const fetcher = vi.fn(async () => Response.json({ transactionID: "tx-9", state: "STATE_NEW" })) as unknown as typeof fetch;
    await submitWalletBatch({ ...batch, owner: owner.address, signature, metadata: "Trading setup approvals" }, { credentials, fetcher });
    const body = JSON.parse((vi.mocked(fetcher).mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      type: "WALLET", from: owner.address, to: POLYMARKET_CONTRACTS.depositWalletFactory, nonce: "7", signature: signature.toLowerCase(),
      metadata: "Trading setup approvals",
      depositWalletParams: { depositWallet: wallet, deadline: "1791000600", calls: calls.map((call) => ({ target: call.target, value: "0", data: call.data })) }
    });
  });

  it("refuses a signature from anyone but the owner, or for another wallet", async () => {
    const typed = walletBatchTypedData(batch);
    const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const signature = await stranger.signTypedData(signable(typed));
    await expect(assertOwnerSignature(typed, signature, owner.address)).rejects.toMatchObject({ code: "invalid_signature" });
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(submitWalletBatch({ ...batch, owner: owner.address, signature }, { credentials, fetcher })).rejects.toBeInstanceOf(VenueError);
    const ownSignature = await owner.signTypedData(signable(walletBatchTypedData({ ...batch, wallet: stranger.address })));
    await expect(submitWalletBatch({ ...batch, wallet: stranger.address, owner: owner.address, signature: ownSignature }, { credentials, fetcher })).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("recognises a stale batch nonce rejection", () => {
    expect(staleBatchNonce(new VenueError("polymarket", "rejected", "batch nonce 3 does not match on-chain nonce 5"))).toBe("5");
    expect(staleBatchNonce(new VenueError("polymarket", "rejected", "wallet busy"))).toBeNull();
    expect(staleBatchNonce(new Error("batch nonce 3 does not match on-chain nonce 5"))).toBeNull();
  });
});

describe("Trading approvals", () => {
  it("lists the SDK's approvals except Polymarket perps", () => {
    const calls = approvalCalls();
    expect(calls).toHaveLength(16);
    const first = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data });
    expect(first).toEqual({ functionName: "approve", args: [POLYMARKET_CONTRACTS.standardExchange, maxUint256] });
    const operators = parseAbi(["function setApprovalForAll(address operator, bool approved)"]);
    const last = decodeFunctionData({ abi: operators, data: calls[15]!.data });
    expect(last).toEqual({ functionName: "setApprovalForAll", args: [POLYMARKET_CONTRACTS.autoRedeemOperator, true] });
    expect(calls[15]!.target).toBe(POLYMARKET_CONTRACTS.positionManager);
    expect(calls.every((call) => call.value === "0")).toBe(true);
  });

  it("reads what is missing from Polygon in one multicall", async () => {
    const aggregate = parseAbi(["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"]);
    const results = TRADING_APPROVALS.map((approval, index) => ({
      success: true,
      returnData: approval.kind === "erc20"
        ? encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: index === 1 ? 0n : maxUint256 })
        : encodeFunctionResult({ abi: parseAbi(["function isApprovedForAll(address, address) view returns (bool)"]), functionName: "isApprovedForAll", result: index !== 9 })
    }));
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string) as { method: string; params: [{ to: string; data: `0x${string}` }] };
      expect(request.method).toBe("eth_call");
      expect(request.params[0].to).toBe(MULTICALL3);
      expect(decodeFunctionData({ abi: aggregate, data: request.params[0].data }).args[0]).toHaveLength(16);
      return Response.json({ jsonrpc: "2.0", id: 1, result: encodeFunctionResult({ abi: aggregate, functionName: "aggregate3", result: results }) });
    }) as unknown as typeof fetch;
    const state = await tradingApprovalsState(wallet, { fetcher });
    expect(state.ready).toBe(false);
    expect(state.missing).toEqual([approvalCalls()[1], approvalCalls()[9]]);
  });
});
