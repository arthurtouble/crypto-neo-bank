import { describe, expect, it } from "vitest";
import { observeTransaction, RPC_BY_CHAIN } from "@/lib/actions/chain";

const hash = `0x${"ab".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const [first, second] = RPC_BY_CHAIN[8453];

function fetcher(refuseReceiptAt: string | null): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    if (method === "eth_getTransactionReceipt" && url === refuseReceiptAt) {
      return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Archive requests require a personal token." } }, { status: 403 });
    }
    const results: Record<string, unknown> = {
      eth_chainId: "0x2105",
      eth_getTransactionByHash: { hash, from: "0x4337015333e7c8a3c5af4acd2c4aa4befb0d663c", to: "0x0000000071727de22e5e9d8baf0edac6f37da032",
        input: "0x", value: "0x0", chainId: "0x2105", blockHash },
      eth_getTransactionReceipt: { transactionHash: hash, blockHash, blockNumber: "0x10", status: "0x1", logs: [] },
      eth_getBlockByNumber: { hash: blockHash, number: "0x10" },
      eth_blockNumber: "0x12"
    };
    return Response.json({ jsonrpc: "2.0", id: 1, result: results[method] });
  }) as typeof fetch;
}

describe("observing a transaction on Base", () => {
  it("reads the receipt from the next endpoint when the first refuses it", async () => {
    const observation = await observeTransaction(8453, hash, fetcher(first));
    expect(observation).toMatchObject({ status: "found", confirmations: 3, receipt: { status: "success", blockNumber: 16n } });
  });

  it("fails only when every endpoint refuses", async () => {
    const refuseAll = (async (url: string, init?: RequestInit) =>
      fetcher(url === first || url === second ? url : null)(url, init)) as typeof fetch;
    await expect(observeTransaction(8453, hash, refuseAll)).rejects.toThrow("403");
  });
});
