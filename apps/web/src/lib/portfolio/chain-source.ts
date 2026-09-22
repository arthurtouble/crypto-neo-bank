import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import type { AccountId, HistoricalEvent, HistoricalEventSource, HistoryPage } from "@/lib/portfolio/types";

const SOURCE_ID = "blockscout:8453";
const STREAMS = ["transactions", "internal-transactions", "token-transfers"] as const;
type Stream = typeof STREAMS[number];
type Cursor = { version: 1; accountId: AccountId; from: string; through: string; pages: Record<Stream, Record<string, string | number> | null>; seen: string[] };
type VerifyResult = { blockHash: string | null; finalized: boolean; receiptSuccess: boolean };
type Options = { apiKey?: string; fetcher?: (url: string, init?: RequestInit) => Promise<Response>; verify?: (hash: `0x${string}`, blockNumber: bigint) => Promise<VerifyResult>; confirmationDepth?: bigint };
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null; }
function address(value: unknown): string | null { const hash = record(value)?.hash; return typeof hash === "string" && /^0x[a-f0-9]{40}$/i.test(hash) ? hash.toLowerCase() : null; }
function integer(value: unknown): bigint | null { return (typeof value === "string" || typeof value === "number") && /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : null; }
function hash(value: unknown): `0x${string}` | null { return typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() as `0x${string}` : null; }
function iso(value: unknown): string | null { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function tokenDecimals(value: unknown): number | null { const n = Number(value); return Number.isInteger(n) && n >= 0 && n <= 36 ? n : null; }
function cursorEncode(value: Cursor): string { return btoa(JSON.stringify(value)); }
async function digest(value: unknown): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function cursorDecode(value: string, accountId: AccountId, from: string, through: string): Cursor | null {
  try {
    const data = record(JSON.parse(atob(value)));
    if (data?.version !== 1 || data.accountId !== accountId || data.from !== from || data.through !== through || !record(data.pages) || !Array.isArray(data.seen)) return null;
    const pages = data.pages as Record<string, unknown>;
    if (!STREAMS.every((key) => pages[key] === null || record(pages[key]))) return null;
    return data as Cursor;
  } catch { return null; }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error(`Blockscout unavailable (${response.status}).`);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 1_000_000) { await reader.cancel(); throw new Error("Blockscout response exceeds limit."); }
    parts.push(value);
  }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(joined));
}

export class BaseChainSource implements HistoricalEventSource {
  readonly sourceId = SOURCE_ID;
  private readonly options: Options;
  constructor(options: Options = {}) { this.options = options; }

  async page(input: { accountId: AccountId; cursor: string | null; from: string; through: string; limit: number }): Promise<HistoryPage> {
    const empty = (events: HistoricalEvent[] = []): HistoryPage => ({ events, nextCursor: null, coveredThrough: input.from, complete: false, sourceId: SOURCE_ID });
    if (!/^8453:0x[a-f0-9]{40}$/.test(input.accountId) || !this.options.apiKey || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || !iso(input.from) || !iso(input.through) || input.from >= input.through) return empty();
    const prior = input.cursor ? cursorDecode(input.cursor, input.accountId, input.from, input.through) : null;
    if (input.cursor && !prior) return empty();
    const initial = !prior;
    const pages = prior?.pages ?? { transactions: {}, "internal-transactions": {}, "token-transfers": {} };
    const seen = new Set(prior?.seen ?? []);
    const next: Cursor["pages"] = { ...pages };
    const all: HistoricalEvent[] = [];
    let valid = true;
    const wallet = input.accountId.slice(5);
    const fetcher = this.options.fetcher ?? fetch;
    for (const stream of STREAMS) {
      if (!initial && pages[stream] === null) continue;
      const url = new URL(`https://api.blockscout.com/8453/api/v2/addresses/${wallet}/${stream}`);
      url.searchParams.set("items_count", String(input.limit));
      for (const [key, value] of Object.entries(pages[stream] ?? {})) url.searchParams.set(key, String(value));
      let payload: RecordValue | null;
      try { payload = record(await boundedJson(await fetcher(url.toString(), { headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(8_000) }))); }
      catch { valid = false; continue; }
      if (!payload || payload.partial === true || !Array.isArray(payload.items) || !("next_page_params" in payload) || (payload.next_page_params !== null && !record(payload.next_page_params))) { valid = false; continue; }
      if (payload.items.length > input.limit) { valid = false; continue; }
      const continuation = payload.next_page_params === null ? null : payload.next_page_params as Record<string, string | number>;
      if (continuation && (!Object.keys(continuation).length || JSON.stringify(continuation) === JSON.stringify(pages[stream]))) { valid = false; continue; }
      next[stream] = continuation;
      for (const item of payload.items) {
        const raw = record(item);
        if (!raw) { valid = false; continue; }
        const txHash = hash(stream === "transactions" ? raw.hash : raw.transaction_hash);
        const blockNumber = integer(raw.block_number);
        const occurredAt = iso(raw.timestamp);
        const sourceRecordId = stream === "transactions" ? `${txHash}:native` : stream === "internal-transactions" ? `${txHash}:trace:${raw.index}` : `${txHash}:log:${raw.log_index}`;
        const value = integer(stream === "token-transfers" ? record(raw.total)?.value ?? raw.value : raw.value);
        const from = address(raw.from); const to = address(raw.to);
        const token = stream === "token-transfers" ? record(raw.token) : null;
        const contract = stream === "token-transfers" ? token?.address_hash : null;
        const decimals = stream === "token-transfers" ? tokenDecimals(token?.decimals) : 18;
        if (!txHash || blockNumber === null || !occurredAt || value === null || !from || !to || decimals === null || (stream === "token-transfers" && (raw.token_type !== "ERC-20" || typeof contract !== "string" || !/^0x[a-f0-9]{40}$/i.test(contract)))) { valid = false; continue; }
        if (stream === "internal-transactions" && (!Number.isInteger(raw.index) || raw.success !== true)) { valid = false; continue; }
        if (stream === "token-transfers" && !Number.isInteger(raw.log_index)) { valid = false; continue; }
        if (stream === "transactions" && raw.status !== "ok") { valid = false; continue; }
        if (seen.has(sourceRecordId)) { valid = false; continue; }
        seen.add(sourceRecordId);
        let verification: VerifyResult;
        try { verification = await (this.options.verify ?? ((h, n) => this.verifyRpc(h, n)))(txHash, blockNumber); }
        catch { valid = false; continue; }
        const indexedHash = hash(raw.block_hash);
        const rpcHash = hash(verification.blockHash);
        const changed = indexedHash !== null && rpcHash !== indexedHash;
        const finalized = !changed && Boolean(rpcHash && verification.finalized && verification.receiptSuccess);
        if (!finalized) valid = false;
        const providerDigest = await digest(raw);
        const identities: Array<{ suffix: string; delta: bigint }> = [];
        if (from === wallet) identities.push({ suffix: "out", delta: -value });
        if (to === wallet) identities.push({ suffix: "in", delta: value });
        const assetId = stream === "token-transfers" ? `8453:${String(contract).toLowerCase()}` : "8453:native";
        for (const identity of identities) {
          const sourceEventId = `${sourceRecordId}:${identity.suffix}`;
          all.push({ sourceId: SOURCE_ID, sourceName: "Blockscout Pro Base", sourceEventId, ingestionVersion: 1, accountId: input.accountId, assetId, rawDelta: identity.delta.toString(), decimals, kind: "unknown", occurredAt, chainId: 8453, blockNumber: blockNumber.toString(), blockHash: rpcHash, txHash, logIndex: stream === "token-transfers" ? raw.log_index as number : null, finality: changed ? "reorged" : finalized ? "finalized" : "pending", completeness: changed ? "partial" : finalized ? "complete" : "unfinalized", groupId: txHash, counterpartyAccountId: null, evidenceJson: JSON.stringify({ stream, providerDigest, indexedBlockHash: indexedHash, receiptSuccess: verification.receiptSuccess }) });
        }
        if (stream === "transactions" && from === wallet) {
          const gasUsed = integer(raw.gas_used);
          const gasPrice = integer(raw.gas_price);
          const fee = gasUsed !== null && gasPrice !== null ? gasUsed * gasPrice : null;
          if (fee === null) valid = false;
          else if (fee > 0n) all.push({ sourceId: SOURCE_ID, sourceName: "Blockscout Pro Base", sourceEventId: `${txHash}:fee`, ingestionVersion: 1, accountId: input.accountId, assetId: "8453:native", rawDelta: (-fee).toString(), decimals: 18, kind: "fee", occurredAt, chainId: 8453, blockNumber: blockNumber.toString(), blockHash: rpcHash, txHash, logIndex: null, finality: changed ? "reorged" : finalized ? "finalized" : "pending", completeness: finalized ? "complete" : "partial", groupId: txHash, counterpartyAccountId: null, evidenceJson: JSON.stringify({ stream, providerDigest, receiptSuccess: verification.receiptSuccess }) });
        }
      }
    }
    const bounded = all.filter((event) => event.occurredAt >= input.from && event.occurredAt < input.through);
    if (!valid) return empty(bounded);
    const complete = STREAMS.every((stream) => next[stream] === null);
    return { events: bounded, nextCursor: complete ? null : cursorEncode({ version: 1, accountId: input.accountId, from: input.from, through: input.through, pages: next, seen: [...seen].slice(-200) }), coveredThrough: complete ? input.through : input.from, complete, sourceId: SOURCE_ID };
  }

  private async verifyRpc(txHash: `0x${string}`, blockNumber: bigint): Promise<VerifyResult> {
    const client = createPublicClient({ chain: base, transport: http() });
    const [receipt, block, tip] = await Promise.all([client.getTransactionReceipt({ hash: txHash }), client.getBlock({ blockNumber }), client.getBlockNumber()]);
    return { blockHash: block.hash, receiptSuccess: receipt.status === "success" && receipt.blockHash === block.hash, finalized: tip >= blockNumber + (this.options.confirmationDepth ?? 20n) };
  }
}
