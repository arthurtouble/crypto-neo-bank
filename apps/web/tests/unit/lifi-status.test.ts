import { describe, expect, it, vi } from "vitest";
import { readLifiTransferStatus } from "@/lib/swap/lifi-status";

const sourceHash = `0x${"a".repeat(64)}`;
const destinationHash = `0x${"b".repeat(64)}`;
const expected = { sourceHash, sourceChainId: 1, destinationChainId: 8453, toolId: "across" };

function body(status = "DONE", substatus = "COMPLETED") {
  return { status, substatus, tool: "across", sending: { txHash: sourceHash, chainId: 1 },
    receiving: { txHash: destinationHash, chainId: 8453 } };
}

function fetcher(payload: unknown): typeof fetch {
  return vi.fn(async () => Response.json(payload)) as typeof fetch;
}

describe("LI.FI status corroboration", () => {
  it("requests a source-bound status and returns a destination hash, not a settlement verdict", async () => {
    const fetch = fetcher(body());
    const result = await readLifiTransferStatus(expected, { fetcher: fetch, apiKey: "server-only-key" });
    expect(fetch).toHaveBeenCalledWith(
      `https://li.quest/v1/status?txHash=${sourceHash}&fromChain=1&toChain=8453&bridge=across`,
      expect.objectContaining({ headers: { "x-lifi-api-key": "server-only-key" } })
    );
    expect(result).toEqual({ status: "DONE", sourceHash, destinationChainId: 8453, destinationHash,
      toolId: "across", substatus: "COMPLETED" });
    expect(result).not.toHaveProperty("settled");
  });

  it.each([
    ["PENDING", "WAIT_DESTINATION_TRANSACTION", "PENDING"],
    ["DONE", "PARTIAL", "PARTIAL"],
    ["DONE", "REFUNDED", "REFUNDED"],
    ["FAILED", "UNKNOWN_ERROR", "FAILED"]
  ])("normalizes %s/%s without calling it complete", async (status, substatus, normalized) => {
    const result = await readLifiTransferStatus(expected, { fetcher: fetcher(body(status, substatus)) });
    expect(result.status).toBe(normalized);
  });

  it("keeps HTTP 200 NOT_FOUND as absence of corroboration", async () => {
    const result = await readLifiTransferStatus(expected, { fetcher: fetcher({ status: "NOT_FOUND" }) });
    expect(result).toEqual({ status: "NOT_FOUND", sourceHash: null, destinationChainId: null,
      destinationHash: null, toolId: null, substatus: null });
  });

  it.each([
    { ...body(), sending: { txHash: `0x${"c".repeat(64)}`, chainId: 1 } },
    { ...body(), sending: { txHash: sourceHash, chainId: 10 } },
    { ...body(), receiving: { txHash: destinationHash, chainId: 10 } },
    { ...body(), tool: "relay" }
  ])("fails closed on unrelated or malformed provider linkage", async (payload) => {
    await expect(readLifiTransferStatus(expected, { fetcher: fetcher(payload) })).rejects.toMatchObject({ code: "status_mismatch" });
  });

  it("rejects malformed hash fields as an unavailable provider response", async () => {
    await expect(readLifiTransferStatus(expected, { fetcher: fetcher({ ...body(),
      receiving: { txHash: "not-a-hash", chainId: 8453 } }) }))
      .rejects.toMatchObject({ code: "status_unavailable" });
  });

  it("fails closed on outages, invalid JSON and oversized responses", async () => {
    await expect(readLifiTransferStatus(expected, { fetcher: vi.fn(async () => { throw new Error("offline"); }) }))
      .rejects.toMatchObject({ code: "status_unavailable" });
    await expect(readLifiTransferStatus(expected, { fetcher: vi.fn(async () => new Response("not-json")) }))
      .rejects.toMatchObject({ code: "status_unavailable" });
    await expect(readLifiTransferStatus(expected, { fetcher: vi.fn(async () => new Response("x".repeat(300_000))) }))
      .rejects.toMatchObject({ code: "status_unavailable" });
    await expect(readLifiTransferStatus(expected, { fetcher: vi.fn(async () => new Response("rate limited", { status: 429 })) }))
      .rejects.toMatchObject({ code: "status_unavailable" });
  });
});
