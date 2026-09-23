import { z } from "zod";

const MAX_RESPONSE_BYTES = 256_000;
const hash = /^0x[a-f\d]{64}$/i;
const chainId = z.number().int().positive();
const transaction = z.object({ txHash: z.string().regex(hash), chainId }).passthrough();
const responseSchema = z.object({
  status: z.enum(["PENDING", "DONE", "NOT_FOUND", "INVALID", "FAILED"]),
  substatus: z.string().max(80).optional(),
  tool: z.string().min(1).max(80).optional(),
  sending: transaction.optional(),
  receiving: transaction.optional()
}).passthrough();

export type LifiStatusExpectation = {
  sourceHash: string;
  sourceChainId: number;
  destinationChainId: number;
  toolId: string;
};

/** LI.FI is corroboration, not settlement authority. Pass this to an independent chain-evidence verifier. */
export type LifiStatusCorroboration = {
  status: "PENDING" | "DONE" | "PARTIAL" | "REFUNDED" | "FAILED" | "NOT_FOUND";
  sourceHash: string | null;
  destinationChainId: number | null;
  destinationHash: string | null;
  toolId: string | null;
  substatus: string | null;
};

export class LifiStatusError extends Error {
  constructor(readonly code: "status_unavailable" | "status_mismatch") {
    super(code);
    this.name = "LifiStatusError";
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (!response.ok || length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES) || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new LifiStatusError("status_unavailable");
  }
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("oversized");
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new LifiStatusError("status_unavailable");
  }
}

export async function readLifiTransferStatus(
  expected: LifiStatusExpectation,
  options: { fetcher?: typeof fetch; apiKey?: string } = {}
): Promise<LifiStatusCorroboration> {
  if (!hash.test(expected.sourceHash) || !Number.isSafeInteger(expected.sourceChainId) || expected.sourceChainId <= 0
    || !Number.isSafeInteger(expected.destinationChainId) || expected.destinationChainId <= 0
    || !/^[\w-]{1,80}$/.test(expected.toolId)) throw new LifiStatusError("status_mismatch");

  const query = new URLSearchParams({ txHash: expected.sourceHash, fromChain: String(expected.sourceChainId),
    toChain: String(expected.destinationChainId), bridge: expected.toolId });
  const apiKey = options.apiKey ?? process.env.LIFI_API_KEY;
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`https://li.quest/v1/status?${query}`, {
      headers: apiKey ? { "x-lifi-api-key": apiKey } : undefined,
      signal: AbortSignal.timeout(8_000), cache: "no-store"
    });
  } catch { throw new LifiStatusError("status_unavailable"); }
  const parsed = responseSchema.safeParse(await readBoundedJson(response));
  if (!parsed.success) throw new LifiStatusError("status_unavailable");
  const result = parsed.data;
  if (result.status === "NOT_FOUND") {
    if (result.sending || result.receiving) throw new LifiStatusError("status_mismatch");
    return { status: "NOT_FOUND", sourceHash: null, destinationChainId: null,
      destinationHash: null, toolId: null, substatus: null };
  }
  if (result.status === "INVALID" || !result.tool || !result.sending) throw new LifiStatusError("status_unavailable");
  if (result.sending.txHash.toLowerCase() !== expected.sourceHash.toLowerCase()
    || result.sending.chainId !== expected.sourceChainId
    || result.tool.toLowerCase() !== expected.toolId.toLowerCase()
    || result.receiving && result.status !== "DONE" && result.receiving.chainId !== expected.destinationChainId
    || result.receiving && result.status === "DONE" && result.substatus !== "REFUNDED"
      && result.receiving.chainId !== expected.destinationChainId) throw new LifiStatusError("status_mismatch");
  if (result.status === "DONE" && !["COMPLETED", "PARTIAL", "REFUNDED"].includes(result.substatus ?? "")) {
    throw new LifiStatusError("status_unavailable");
  }
  const refunded = result.status === "DONE" && result.substatus === "REFUNDED";
  return {
    status: result.status === "DONE" && result.substatus === "PARTIAL" ? "PARTIAL"
      : refunded ? "REFUNDED" : result.status,
    sourceHash: result.sending.txHash,
    destinationChainId: refunded ? null : result.receiving?.chainId ?? null,
    destinationHash: refunded ? null : result.receiving?.txHash ?? null,
    toolId: result.tool,
    substatus: result.substatus ?? null
  };
}
