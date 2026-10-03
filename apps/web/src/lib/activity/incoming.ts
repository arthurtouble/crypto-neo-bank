import { formatUnits, getAddress } from "viem";
import { assetFor, BASE_CHAIN_ID, networkName, type RegisteredAsset } from "@/lib/assets/registry";
import { jsonRpc, rpcEndpoints } from "@/lib/chain/rpc";
import { localEdgeUrl } from "@/lib/testing/local-edge";

/**
 * Money that arrived in the account without an Aura action: a deposit from an
 * exchange, a payment from someone else, or a transfer from a connected
 * wallet. Read on demand from Alchemy's transfer index for the account's
 * address, on the networks where it holds funds (Base, and Ethereum for Tether
 * Gold). Nothing is stored: these are display records, never balances.
 *
 * Only registered assets the account holds are listed, so unsolicited spam
 * tokens never show. Transfers that belong to one of the account's own actions
 * (a swap's output, an Earn withdrawal, a delivery from another network) are
 * left out; the action already shows them. Like mainstream wallets, a
 * transfer is complete once it is in a block (Base's sequencer gives a near
 * zero chance of reversal after about 2 seconds), and marked final once its
 * block is final (about 20 minutes on Base).
 */
const INCOMING_NETWORKS = [BASE_CHAIN_ID, 1] as const;
const PAGE = 100;

export type IncomingTransfer = {
  id: string;
  chainId: number;
  transactionHash: string;
  from: string;
  assetId: string;
  symbol: string;
  decimals: number;
  amountRaw: string;
  amount: string;
  blockNumber: number;
  receivedAt: string;
  status: "completed";
  /** Whether the block is final on its network. Until then a reorg could, very rarely, remove it. */
  final: boolean;
  source: string;
};

export type IncomingRead = {
  transfers: IncomingTransfer[];
  /** unavailable: a network couldn't be read, so the list may be missing deposits. partial: older deposits weren't read. */
  status: "available" | "unavailable";
  partial: boolean;
  observedAt: string;
};

type RawTransfer = { blockNum?: string; uniqueId?: string; hash?: string; from?: string; to?: string; category?: string;
  rawContract?: { value?: string | null; address?: string | null }; metadata?: { blockTimestamp?: string } };

/** The node that serves Alchemy's transfer index for a network: the local fake in tests, or a configured Alchemy URL. */
function transferIndexEndpoint(chainId: number): string | null {
  const local = localEdgeUrl(`RPC_URL_${chainId}`);
  if (local) return local;
  return rpcEndpoints(chainId).find((url) => {
    try { return new URL(url).hostname.endsWith(".alchemy.com"); } catch { return false; }
  }) ?? null;
}

const hex = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value) : null;

/** One transfer from the index, if it is a registered asset the account holds, arriving from someone else. */
export function parseTransfer(raw: RawTransfer, chainId: number, wallet: string, finalized: bigint): IncomingTransfer | null {
  const block = hex(raw.blockNum);
  const value = hex(raw.rawContract?.value);
  if (block === null || value === null || value === 0n || typeof raw.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(raw.hash)) return null;
  if (typeof raw.to !== "string" || raw.to.toLowerCase() !== wallet.toLowerCase()) return null;
  if (typeof raw.from !== "string" || !/^0x[0-9a-f]{40}$/i.test(raw.from) || raw.from.toLowerCase() === wallet.toLowerCase()) return null;
  const contract = raw.category === "external" ? null : raw.rawContract?.address;
  if (raw.category !== "external" && (typeof contract !== "string" || !/^0x[0-9a-f]{40}$/i.test(contract))) return null;
  const asset: RegisteredAsset | null = assetFor(`${chainId}:${contract ? contract.toLowerCase() : "native"}`, "hold");
  if (!asset) return null;
  const receivedAt = raw.metadata?.blockTimestamp && Number.isFinite(Date.parse(raw.metadata.blockTimestamp)) ? new Date(raw.metadata.blockTimestamp).toISOString() : null;
  if (!receivedAt) return null;
  return {
    id: `incoming:${chainId}:${raw.uniqueId ?? `${raw.hash}:${asset.id}`}`.toLowerCase(), chainId, transactionHash: raw.hash.toLowerCase(),
    from: getAddress(raw.from), assetId: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountRaw: value.toString(),
    amount: formatUnits(value, asset.decimals), blockNumber: Number(block), receivedAt,
    status: "completed", final: block <= finalized, source: `Alchemy, ${networkName(chainId)}`
  };
}

/**
 * Incoming transfers to `wallet`, newest first, received at or after `since`
 * (default: the latest page per network). With `until` and no `since`, an
 * older page: up to a page per network received at or before `until`. `exclude` holds the transaction
 * hashes of the account's own actions.
 */
export async function readIncoming(wallet: string, options: { exclude?: Iterable<string>; since?: Date; until?: Date; maxPages?: number;
  fetcher?: typeof fetch; now?: Date } = {}): Promise<IncomingRead> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const exclude = new Set([...(options.exclude ?? [])].map((hash) => hash.toLowerCase()));
  // A month (since) or an older page (until only) pages back through the index; the latest page needs one read.
  const maxPages = options.since || options.until ? options.maxPages ?? 10 : 1;
  let status: IncomingRead["status"] = "available";
  let partial = false;
  const transfers: IncomingTransfer[] = [];
  await Promise.all(INCOMING_NETWORKS.map(async (chainId) => {
    const endpoint = transferIndexEndpoint(chainId);
    if (!endpoint) { status = "unavailable"; return; }
    try {
      const finalizedBlock = await jsonRpc<{ number?: string } | null>(fetcher, endpoint, "eth_getBlockByNumber", ["finalized", false]);
      const finalized = hex(finalizedBlock?.number) ?? 0n;
      let pageKey: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        const result = await jsonRpc<{ transfers?: RawTransfer[]; pageKey?: string }>(fetcher, endpoint, "alchemy_getAssetTransfers", [{
          fromBlock: "0x0", toBlock: "latest", toAddress: wallet.toLowerCase(), category: ["external", "erc20"], withMetadata: true,
          excludeZeroValue: true, order: "desc", maxCount: `0x${PAGE.toString(16)}`, ...(pageKey ? { pageKey } : {})
        }]);
        const rows = Array.isArray(result.transfers) ? result.transfers : [];
        for (const raw of rows) {
          const transfer = parseTransfer(raw, chainId, wallet, finalized);
          if (transfer && !exclude.has(transfer.transactionHash)) transfers.push(transfer);
        }
        pageKey = typeof result.pageKey === "string" && result.pageKey ? result.pageKey : undefined;
        const oldest = rows.at(-1)?.metadata?.blockTimestamp;
        const reachedStart = options.since && oldest && Date.parse(oldest) < options.since.getTime();
        // An older page without a start stops once it holds a full page from before `until`.
        const filledOlder = !options.since && options.until
          && transfers.filter((transfer) => transfer.chainId === chainId && Date.parse(transfer.receivedAt) <= options.until!.getTime()).length >= PAGE;
        if (!pageKey || reachedStart || filledOlder) break;
        if (page === maxPages - 1) partial = true;
      }
      if (!options.since && pageKey) partial = true;
    } catch { status = "unavailable"; }
  }));
  const inRange = transfers.filter((transfer) => (!options.since || Date.parse(transfer.receivedAt) >= options.since.getTime())
    && (!options.until || (options.since ? Date.parse(transfer.receivedAt) < options.until.getTime() : Date.parse(transfer.receivedAt) <= options.until.getTime())));
  inRange.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return { transfers: inRange, status, partial, observedAt: now.toISOString() };
}
