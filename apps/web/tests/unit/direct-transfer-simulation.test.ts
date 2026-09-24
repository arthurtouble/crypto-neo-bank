import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi, type PublicClient } from "viem";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { simulateBaseDirectTransfer } from "@/lib/transactions/direct-transfer-simulation";

const from = "0x000000000000000000000000000000000000dEaD";
const recipient = "0x0000000000000000000000000000000000000001";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const hash = `0x${"a".repeat(64)}` as const;
const block = { number: 42n, hash, timestamp: 1_000_000n };
const nowMs = 1_000_002_000;
const truthy = `0x${"0".repeat(63)}1` as const;

function rpc() {
  const client = {
    getChainId: vi.fn(async () => 8453),
    getBlock: vi.fn(async () => block),
    getBalance: vi.fn(async () => 2_000n),
    call: vi.fn(async ({ data }: { data: string }): Promise<{ data: string }> =>
      ({ data: data.startsWith("0x70a08231") ? `0x${(2_000n).toString(16).padStart(64, "0")}` : truthy }))
  };
  return client;
}

async function native() {
  return normalizePreparedCall({ chainId: 8453, from, to: recipient, value: "1000", data: "0x" });
}

async function token() {
  return normalizePreparedCall({ chainId: 8453, from, to: usdc, value: "0", data: encodeFunctionData({
    abi: erc20Abi, functionName: "transfer", args: [recipient, 1_000n]
  }) });
}

describe("disconnected direct-transfer simulation", () => {
  it("samples the freshness clock after retrieving the latest block", async () => {
    const client = rpc();
    const clock = vi.fn(() => nowMs);
    client.getBlock.mockImplementationOnce(async () => {
      expect(clock).not.toHaveBeenCalled();
      return block;
    });
    const call = await native();
    await expect(simulateBaseDirectTransfer(client as unknown as PublicClient, {
      call, effect: { type: "native_transfer", recipient, amountRaw: "1000" }, nowMs: clock, maxAgeMs: 30_000
    })).resolves.toMatchObject({ simulationSucceeded: true });
    expect(clock).toHaveBeenCalledOnce();
  });

  it("simulates the exact native call at a canonical Base block without claiming signing readiness", async () => {
    const client = rpc();
    client.call.mockResolvedValueOnce({ data: "0x" });
    const call = await native();
    const proof = await simulateBaseDirectTransfer(client as unknown as PublicClient, {
      call, effect: { type: "native_transfer", recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    });
    expect(proof).toEqual({ chainId: 8453, blockNumber: 42n, blockHash: hash,
      observedAtMs: 1_000_000_000, fingerprint: call.fingerprint, simulationSucceeded: true,
      assetBalanceRaw: "2000", assetBalanceObserved: true,
      balanceAndGasProven: false, signingReady: false });
    expect(client.call).toHaveBeenCalledWith({ account: from, to: recipient, value: 1_000n, data: "0x",
      blockHash: hash, requireCanonical: true });
    expect(client.getBlock).toHaveBeenCalledWith({ blockNumber: 42n });
    expect(client.getBalance).toHaveBeenCalledWith({ address: from, blockHash: hash, requireCanonical: true });
  });

  it("requires a true ERC20 transfer result at the same canonical block", async () => {
    const client = rpc();
    const call = await token();
    const proof = await simulateBaseDirectTransfer(client as unknown as PublicClient, {
      call, effect: { type: "erc20_transfer", token: usdc, recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    });
    expect(proof.simulationSucceeded).toBe(true);
    expect(client.call).toHaveBeenCalledWith({ account: from, to: usdc, value: 0n, data: call.data,
      blockHash: hash, requireCanonical: true });
    expect(client.call).toHaveBeenCalledWith({ to: usdc, data: encodeFunctionData({ abi: erc20Abi,
      functionName: "balanceOf", args: [from] }), blockHash: hash, requireCanonical: true });
    for (const data of [`0x${"0".repeat(64)}`, "0x", "0x1234"]) {
      client.call.mockResolvedValueOnce({ data });
      await expect(simulateBaseDirectTransfer(client as unknown as PublicClient, {
        call, effect: { type: "erc20_transfer", token: usdc, recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
      })).rejects.toThrow(/token|result|return/i);
    }
  });

  it("rejects insufficient native value or token balance at the simulation block", async () => {
    const nativeCall = await native();
    const nativeClient = rpc();
    nativeClient.getBalance.mockResolvedValueOnce(999n);
    await expect(simulateBaseDirectTransfer(nativeClient as unknown as PublicClient, {
      call: nativeCall, effect: { type: "native_transfer", recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    })).rejects.toThrow(/balance/i);

    const tokenCall = await token();
    const tokenClient = rpc();
    tokenClient.call.mockResolvedValueOnce({ data: truthy }).mockResolvedValueOnce({ data: `0x${(999n).toString(16).padStart(64, "0")}` });
    await expect(simulateBaseDirectTransfer(tokenClient as unknown as PublicClient, {
      call: tokenCall, effect: { type: "erc20_transfer", token: usdc, recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    })).rejects.toThrow(/balance/i);
  });

  it("accepts an exact asset balance without claiming fee coverage", async () => {
    const nativeCall = await native();
    const nativeClient = rpc();
    nativeClient.getBalance.mockResolvedValueOnce(1_000n);
    const nativeProof = await simulateBaseDirectTransfer(nativeClient as unknown as PublicClient, {
      call: nativeCall, effect: { type: "native_transfer", recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    });
    expect(nativeProof).toMatchObject({ assetBalanceRaw: "1000", balanceAndGasProven: false, signingReady: false });

    const tokenCall = await token();
    const tokenClient = rpc();
    tokenClient.call.mockResolvedValueOnce({ data: truthy }).mockResolvedValueOnce({ data: `0x${(1_000n).toString(16).padStart(64, "0")}` });
    const tokenProof = await simulateBaseDirectTransfer(tokenClient as unknown as PublicClient, {
      call: tokenCall, effect: { type: "erc20_transfer", token: usdc, recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    });
    expect(tokenProof).toMatchObject({ assetBalanceRaw: "1000", balanceAndGasProven: false, signingReady: false });
  });

  it("rejects unavailable balance evidence and a changed canonical block after the balance read", async () => {
    const nativeCall = await native();
    const unavailable = rpc();
    unavailable.getBalance.mockRejectedValueOnce(new Error("historical balance unavailable"));
    await expect(simulateBaseDirectTransfer(unavailable as unknown as PublicClient, {
      call: nativeCall, effect: { type: "native_transfer", recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    })).rejects.toThrow(/balance unavailable/i);

    const tokenCall = await token();
    const malformed = rpc();
    malformed.call.mockResolvedValueOnce({ data: truthy }).mockResolvedValueOnce({ data: "0x" });
    await expect(simulateBaseDirectTransfer(malformed as unknown as PublicClient, {
      call: tokenCall, effect: { type: "erc20_transfer", token: usdc, recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    })).rejects.toThrow();

    const offline = rpc();
    offline.call.mockResolvedValueOnce({ data: truthy }).mockRejectedValueOnce(new Error("balanceOf unavailable"));
    await expect(simulateBaseDirectTransfer(offline as unknown as PublicClient, {
      call: tokenCall, effect: { type: "erc20_transfer", token: usdc, recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    })).rejects.toThrow(/balanceOf unavailable/i);

    const changed = rpc();
    changed.getBlock.mockResolvedValueOnce(block).mockResolvedValueOnce({ ...block, hash: `0x${"b".repeat(64)}` });
    await expect(simulateBaseDirectTransfer(changed as unknown as PublicClient, {
      call: nativeCall, effect: { type: "native_transfer", recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    })).rejects.toThrow(/canonical/i);
    expect(changed.getBalance).toHaveBeenCalledOnce();
  });

  it("rejects a changed fingerprint, data hash, recipient, amount, or unsupported token before RPC execution", async () => {
    const client = rpc();
    const call = await token();
    const effect = { type: "erc20_transfer" as const, token: usdc, recipient, amountRaw: "1000" };
    for (const changed of [
      { call: { ...call, fingerprint: hash }, effect },
      { call: { ...call, dataHash: hash }, effect },
      { call, effect: { ...effect, recipient: from } },
      { call, effect: { ...effect, amountRaw: "999" } },
      { call, effect: { ...effect, token: from } }
    ]) {
      await expect(simulateBaseDirectTransfer(client as unknown as PublicClient, {
        ...changed, nowMs, maxAgeMs: 30_000
      })).rejects.toThrow();
    }
    expect(client.call).not.toHaveBeenCalled();
  });

  it("rejects wrong chain, stale or changed blocks, and RPC reverts", async () => {
    const call = await native();
    const input = { call, effect: { type: "native_transfer" as const, recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000 };
    const wrong = rpc();
    wrong.getChainId.mockResolvedValueOnce(1);
    await expect(simulateBaseDirectTransfer(wrong as unknown as PublicClient, input)).rejects.toThrow(/chain/i);
    expect(wrong.call).not.toHaveBeenCalled();
    const stale = rpc();
    await expect(simulateBaseDirectTransfer(stale as unknown as PublicClient, { ...input, nowMs: nowMs + 30_001 })).rejects.toThrow(/stale/i);
    expect(stale.call).not.toHaveBeenCalled();
    const reorg = rpc();
    reorg.call.mockResolvedValue({ data: "0x" });
    reorg.getBlock.mockResolvedValueOnce(block).mockResolvedValueOnce({ ...block, hash: `0x${"b".repeat(64)}` });
    await expect(simulateBaseDirectTransfer(reorg as unknown as PublicClient, input)).rejects.toThrow(/block|canonical/i);
    const reverted = rpc();
    reverted.call.mockRejectedValueOnce(new Error("execution reverted"));
    await expect(simulateBaseDirectTransfer(reverted as unknown as PublicClient, input)).rejects.toThrow(/reverted/i);
    const noCanonicalSupport = rpc();
    noCanonicalSupport.call.mockRejectedValueOnce(new Error("EIP-1898 blockHash unsupported"));
    await expect(simulateBaseDirectTransfer(noCanonicalSupport as unknown as PublicClient, input)).rejects.toThrow(/blockHash unsupported/i);
  });
});
