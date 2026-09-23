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
    call: vi.fn(async (): Promise<{ data: string }> => ({ data: truthy }))
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
  it("simulates the exact native call at a canonical Base block without claiming signing readiness", async () => {
    const client = rpc();
    client.call.mockResolvedValueOnce({ data: "0x" });
    const call = await native();
    const proof = await simulateBaseDirectTransfer(client as unknown as PublicClient, {
      call, effect: { type: "native_transfer", recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
    });
    expect(proof).toEqual({ chainId: 8453, blockNumber: 42n, blockHash: hash,
      observedAtMs: 1_000_000_000, fingerprint: call.fingerprint, simulationSucceeded: true,
      balanceAndGasProven: false, signingReady: false });
    expect(client.call).toHaveBeenCalledWith({ account: from, to: recipient, value: 1_000n, data: "0x",
      blockHash: hash, requireCanonical: true });
    expect(client.getBlock).toHaveBeenCalledWith({ blockNumber: 42n });
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
    for (const data of [`0x${"0".repeat(64)}`, "0x", "0x1234"]) {
      client.call.mockResolvedValueOnce({ data });
      await expect(simulateBaseDirectTransfer(client as unknown as PublicClient, {
        call, effect: { type: "erc20_transfer", token: usdc, recipient, amountRaw: "1000" }, nowMs, maxAgeMs: 30_000
      })).rejects.toThrow(/token|result|return/i);
    }
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
