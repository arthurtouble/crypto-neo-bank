import { z } from "zod";
import { readBoundedJson } from "@/lib/http/bounded";
import type { CatalogAsset } from "@/lib/swap/assets";
import { localEdgeUrl } from "@/lib/testing/local-edge";

/**
 * Moving money between the Aura account on Base and a venue account the
 * customer's wallet owns. Into Hyperliquid, LI.FI routes Base USDC straight
 * to the customer's Hyperliquid account (LI.FI's chain 1337, HyperCore). Out
 * of Hyperliquid, the customer's wallet signs a withdrawal that Circle's CCTP
 * delivers to its own address on Base. Polymarket's bridge takes
 * Base USDC at an address it makes for the customer's deposit wallet, and pays
 * withdrawals out to Base USDC.
 */
export const HYPERCORE_CHAIN_ID = 1337;

/** Hyperliquid's perps USDC as LI.FI names it. Not a contract: HyperCore isn't an EVM chain, and Aura never reads it as one. */
export const HYPERLIQUID_USDC: CatalogAsset = {
  id: `${HYPERCORE_CHAIN_ID}:0xaf88d065e77c8cc2239327c5edb3a432268e5831`, chainId: HYPERCORE_CHAIN_ID,
  address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", symbol: "USDC", name: "USD Coin (Hyperliquid)", decimals: 6,
  logoUrl: null, eligibility: "eligible"
};

/** Hyperliquid credits the first deposit only from 5 USDC. */
export const HYPERLIQUID_MINIMUM_DEPOSIT_RAW = 5_000_000n;

/** Which venue a route into it funds, from its destination network. */
export function marketOfDestination(chainId: number | null | undefined): "hyperliquid" | null {
  return chainId === HYPERCORE_CHAIN_ID ? "hyperliquid" : null;
}

const hyperliquidInfoUrl = () => `${localEdgeUrl("HYPERLIQUID_API_URL") ?? "https://api.hyperliquid.xyz"}/info`;
const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const ledgerSchema = z.array(z.object({
  time: z.number(),
  hash: z.string(),
  delta: z.object({ type: z.string(), usdc: decimal.optional(), amount: decimal.optional(), token: z.string().optional(),
    destination: z.string().optional(), destinationDex: z.string().optional() }).passthrough()
}).passthrough());

export type HyperliquidCredit =
  | { status: "observed"; creditedRaw: string; hash: string; time: number }
  | { status: "missing" }
  | { status: "unavailable"; reason: string };

/** Six-decimal USDC string to raw units, rounding down. */
function usdcRaw(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
}

/**
 * The USDC a delivery credited to the customer's Hyperliquid perps balance,
 * from Hyperliquid's own ledger: the entry with the hash LI.FI reported, a
 * deposit or a send to this user that lands in perps (not spot).
 */
export async function observeHyperliquidCredit(input: { user: string; hash: string; since: number }, fetcher: typeof fetch = fetch): Promise<HyperliquidCredit> {
  let body: unknown;
  try {
    const response = await fetcher(hyperliquidInfoUrl(), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "userNonFundingLedgerUpdates", user: input.user.toLowerCase(), startTime: Math.max(0, input.since) }),
      signal: AbortSignal.timeout(8_000) });
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { status: "unavailable", reason: "hyperliquid_unavailable" }; }
    body = await readBoundedJson(response, 512_000);
  } catch { return { status: "unavailable", reason: "hyperliquid_unavailable" }; }
  const parsed = ledgerSchema.safeParse(body);
  if (!parsed.success) return { status: "unavailable", reason: "hyperliquid_malformed" };
  const entry = parsed.data.find((item) => item.hash.toLowerCase() === input.hash.toLowerCase());
  if (!entry) return { status: "missing" };
  const { delta } = entry;
  const credited = delta.type === "deposit" && delta.usdc ? usdcRaw(delta.usdc)
    : delta.type === "send" && delta.token === "USDC" && delta.amount && delta.destination?.toLowerCase() === input.user.toLowerCase()
      && (delta.destinationDex ?? "") === "" ? usdcRaw(delta.amount) : 0n;
  return { status: "observed", creditedRaw: credited.toString(), hash: entry.hash, time: entry.time };
}
