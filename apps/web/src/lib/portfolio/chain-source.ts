import { createPublicClient, decodeEventLog, erc20Abi, http } from "viem";
import { base } from "viem/chains";
import type { AccountId, HistoricalEvent, HistoricalEventSource, HistoryPage } from "@/lib/portfolio/types";

const SOURCE_ID = "blockscout:8453";
const STREAMS = ["transactions", "internal-transactions", "token-transfers"] as const;
type Stream = typeof STREAMS[number];
type Cursor = { version: 1; accountId: AccountId; from: string; through: string; pages: Record<Stream, Record<string, string | number> | null>; seen: string[] };
type VerifyResult = { blockHash: string | null; blockTimestamp?: bigint; transactionIndex?: number; finalized: boolean; receiptSuccess: boolean; logs?: unknown; tokenDecimals?: unknown;
  transaction?: { hash: string; blockHash: string | null; blockNumber: bigint; from: string; to: string | null; value: bigint };
  fee?: { gasUsed: bigint; effectiveGasPrice: bigint; l1Fee: bigint; operatorFee: bigint } | null };
type Options = { apiKey?: string; fetcher?: (url: string, init?: RequestInit) => Promise<Response>; verify?: (hash: `0x${string}`, blockNumber: bigint) => Promise<VerifyResult>; confirmationDepth?: bigint };
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null; }
function address(value: unknown): string | null { const hash = record(value)?.hash; return typeof hash === "string" && /^0x[a-f0-9]{40}$/i.test(hash) ? hash.toLowerCase() : null; }
function integer(value: unknown): bigint | null { return (typeof value === "string" || typeof value === "number" && Number.isSafeInteger(value)) && /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : null; }
function rpcInteger(value: unknown): bigint | null { return typeof value === "string" && /^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(value) ? BigInt(value) : null; }
function hash(value: unknown): `0x${string}` | null { return typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() as `0x${string}` : null; }
function iso(value: unknown): string | null { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function tokenDecimals(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 36 ? n : null;
}
function matchesTransferLog(logs: unknown, input: { contract: string; from: string; to: string; value: bigint; logIndex: number }): boolean {
  if (!Array.isArray(logs)) return false;
  return logs.some((item) => {
    const log = record(item);
    if (!log || typeof log.address !== "string" || log.address.toLowerCase() !== input.contract.toLowerCase() || log.logIndex !== input.logIndex
      || typeof log.data !== "string" || !/^0x(?:[a-f0-9]{2})*$/i.test(log.data) || !Array.isArray(log.topics)
      || !log.topics.every((topic) => typeof topic === "string" && /^0x[a-f0-9]{64}$/i.test(topic))) return false;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      return decoded.args.from.toLowerCase() === input.from && decoded.args.to.toLowerCase() === input.to && decoded.args.value === input.value;
    } catch { return false; }
  });
}
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
      if (!payload || payload.partial === true || !Array.isArray(payload.items) || !("next_page_params" in payload) || (payload.next_page_params !== null && !record(payload.next_page_params)) || (stream === "internal-transactions" && record(payload.meta)?.status !== 1)) { valid = false; continue; }
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
        const indexedHash = hash(raw.block_hash);
        if (!indexedHash) { valid = false; continue; }
        let verification: VerifyResult;
        try { verification = await (this.options.verify ?? ((h, n) => this.verifyRpc(h, n, indexedHash, stream, stream === "token-transfers" ? contract as `0x${string}` : null)))(txHash, blockNumber); }
        catch { valid = false; continue; }
        const rpcHash = hash(verification.blockHash);
        const changed = rpcHash !== indexedHash;
        const canonicalTime = typeof verification.blockTimestamp === "bigint" && verification.blockTimestamp >= 0n
          && verification.blockTimestamp <= 8_640_000_000_000n ? new Date(Number(verification.blockTimestamp) * 1000).toISOString() : null;
        if (!changed && !canonicalTime) { valid = false; continue; }
        const observedAt = canonicalTime ?? occurredAt;
        const finalized = !changed && Boolean(rpcHash && verification.finalized && verification.receiptSuccess);
        if (!finalized) valid = false;
        const tokenProven = stream === "token-transfers" && !changed && tokenDecimals(verification.tokenDecimals) === decimals
          && matchesTransferLog(verification.logs, { contract: String(contract), from, to, value, logIndex: raw.log_index as number });
        if (stream === "token-transfers" && !changed && !tokenProven) { valid = false; continue; }
        const nativeProven = stream === "transactions" && !changed && verification.receiptSuccess
          && hash(verification.transaction?.hash) === txHash && hash(verification.transaction?.blockHash) === rpcHash
          && verification.transaction?.blockNumber === blockNumber && verification.transaction.from.toLowerCase() === from
          && verification.transaction.to?.toLowerCase() === to && verification.transaction.value === value;
        if (stream === "transactions" && !changed && !nativeProven) { valid = false; continue; }
        // A receipt does not contain internal call values. Until a trace-capable independent source is available,
        // these rows can invalidate old history on reorg but cannot create a completed balance effect.
        if (stream === "internal-transactions" && !changed) { valid = false; continue; }
        const providerDigest = await digest(raw);
        const identities: Array<{ suffix: string; delta: bigint; counterparty: string }> = [];
        if (from === wallet) identities.push({ suffix: "out", delta: -value, counterparty: to });
        if (to === wallet) identities.push({ suffix: "in", delta: value, counterparty: from });
        if (!identities.length) { valid = false; continue; }
        const assetId = stream === "token-transfers" ? `8453:${String(contract).toLowerCase()}` : "8453:native";
        for (const identity of identities) {
          const sourceEventId = `${sourceRecordId}:${identity.suffix}`;
          all.push({ sourceId: SOURCE_ID, sourceName: "Blockscout Pro Base", sourceEventId, ingestionVersion: 1, accountId: input.accountId, assetId, rawDelta: identity.delta.toString(), decimals, kind: "unknown", occurredAt: observedAt, chainId: 8453, blockNumber: blockNumber.toString(), blockHash: rpcHash, txHash, logIndex: stream === "token-transfers" ? raw.log_index as number : null, finality: changed ? "reorged" : finalized ? "finalized" : "pending", completeness: changed ? "partial" : finalized ? "complete" : "unfinalized", groupId: txHash, counterpartyAccountId: tokenProven && finalized ? `8453:${identity.counterparty}` as AccountId : nativeProven && finalized ? `8453:${identity.counterparty}` as AccountId : null, evidenceJson: JSON.stringify({ sourceEvidenceVersion: 3, stream, providerDigest, indexedBlockHash: indexedHash, receiptSuccess: verification.receiptSuccess, transactionIndex: verification.transactionIndex, effectProof: tokenProven && finalized ? "receipt_log_and_onchain_decimals" : nativeProven && finalized ? "canonical_transaction" : null }) });
        }
        if (stream === "transactions" && from === wallet) {
          const proof = verification.fee;
          const fee = proof && [proof.gasUsed, proof.effectiveGasPrice, proof.l1Fee, proof.operatorFee].every((part) => typeof part === "bigint" && part >= 0n)
            ? proof.gasUsed * proof.effectiveGasPrice + proof.l1Fee + proof.operatorFee : null;
          if (fee === null) valid = false;
          else if (fee > 0n) all.push({ sourceId: SOURCE_ID, sourceName: "Blockscout Pro Base", sourceEventId: `${txHash}:fee`, ingestionVersion: 1, accountId: input.accountId, assetId: "8453:native", rawDelta: (-fee).toString(), decimals: 18, kind: "fee", occurredAt: observedAt, chainId: 8453, blockNumber: blockNumber.toString(), blockHash: rpcHash, txHash, logIndex: null, finality: changed ? "reorged" : finalized ? "finalized" : "pending", completeness: finalized ? "complete" : "partial", groupId: txHash, counterpartyAccountId: null, evidenceJson: JSON.stringify({ sourceEvidenceVersion: 3, stream, providerDigest, receiptSuccess: verification.receiptSuccess, effectProof: finalized ? "canonical_base_total_fee" : null }) });
        }
      }
    }
    const bounded = all.filter((event) => event.finality === "reorged" || event.occurredAt >= input.from && event.occurredAt < input.through);
    if (!valid) return empty(bounded);
    const complete = STREAMS.every((stream) => next[stream] === null);
    return { events: bounded, nextCursor: complete ? null : cursorEncode({ version: 1, accountId: input.accountId, from: input.from, through: input.through, pages: next, seen: [...seen].slice(-200) }), coveredThrough: complete ? input.through : input.from, complete, sourceId: SOURCE_ID };
  }

  private async verifyRpc(txHash: `0x${string}`, blockNumber: bigint, indexedHash: `0x${string}`, stream: Stream, tokenContract: `0x${string}` | null): Promise<VerifyResult> {
    const client = createPublicClient({ chain: base, transport: http() });
    const [block, tip] = await Promise.all([client.getBlock({ blockNumber }), client.getBlockNumber()]);
    if (block.hash.toLowerCase() !== indexedHash) return { blockHash: block.hash, blockTimestamp: block.timestamp, receiptSuccess: false, finalized: false };
    const [receipt, transaction, rawReceipt] = await Promise.all([client.getTransactionReceipt({ hash: txHash }),
      stream === "transactions" ? client.getTransaction({ hash: txHash }) : Promise.resolve(null),
      stream === "transactions" ? client.request({ method: "eth_getTransactionReceipt", params: [txHash] }) : Promise.resolve(null)]);
    const raw = record(rawReceipt);
    const gasUsed = rpcInteger(raw?.gasUsed);
    const gasPrice = rpcInteger(raw?.effectiveGasPrice);
    const l1Fee = rpcInteger(raw?.l1Fee);
    const operatorScalar = raw?.operatorFeeScalar == null ? 0n : rpcInteger(raw.operatorFeeScalar);
    const operatorConstant = raw?.operatorFeeConstant == null ? 0n : rpcInteger(raw.operatorFeeConstant);
    const operatorPairComplete = (raw?.operatorFeeScalar == null) === (raw?.operatorFeeConstant == null);
    const jovianMarker = raw?.daFootprintGasScalar == null ? null : rpcInteger(raw.daFootprintGasScalar);
    const rawMatches = raw && hash(raw.transactionHash) === txHash && hash(raw.blockHash) === block.hash
      && rpcInteger(raw.blockNumber) === blockNumber && raw.status === "0x1"
      && gasUsed === receipt.gasUsed && gasPrice === receipt.effectiveGasPrice
      && (receipt.l1Fee == null || receipt.l1Fee === l1Fee);
    // Base charges L2 execution plus L1 data and, when configured, an operator fee.
    // Nonzero operator parameters without an explicit Jovian marker are not enough to select a fork formula.
    const operatorFee = operatorPairComplete && operatorScalar !== null && operatorConstant !== null && gasUsed !== null
      && (operatorScalar === 0n && operatorConstant === 0n || jovianMarker !== null)
      ? gasUsed * operatorScalar * 100n + operatorConstant : null;
    const fee = rawMatches && l1Fee !== null && operatorFee !== null && gasUsed !== null && gasPrice !== null
      ? { gasUsed, effectiveGasPrice: gasPrice, l1Fee, operatorFee } : null;
    const decimals = tokenContract && receipt.status === "success" && receipt.blockHash === block.hash
      ? await client.readContract({ address: tokenContract, abi: erc20Abi, functionName: "decimals", blockNumber }) : null;
    return { blockHash: block.hash, blockTimestamp: block.timestamp, transactionIndex: receipt.transactionIndex,
      receiptSuccess: receipt.status === "success" && receipt.blockHash === block.hash && receipt.blockNumber === blockNumber
      && receipt.transactionHash.toLowerCase() === txHash,
      finalized: tip >= blockNumber + (this.options.confirmationDepth ?? 20n), logs: receipt.logs, tokenDecimals: decimals,
      transaction: transaction ? { hash: transaction.hash, blockHash: transaction.blockHash, blockNumber: transaction.blockNumber!,
        from: transaction.from, to: transaction.to, value: transaction.value } : undefined,
      fee };
  }
}
