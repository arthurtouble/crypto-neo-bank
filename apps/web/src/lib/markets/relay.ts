import { decodeFunctionData, encodeFunctionData, erc20Abi, parseAbi } from "viem";
import { z } from "zod";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import { readBoundedJson } from "@/lib/http/bounded";
import { localEdgeUrl } from "@/lib/testing/local-edge";
import { HYPERCORE_CHAIN_ID } from "./funding";
import { VenueError } from "./types";

/**
 * Base USDC into the customer's Hyperliquid perps balance through Relay. The
 * wallet deposits USDC into Relay's depository on Base, tagged with the order
 * Relay quoted, and Relay's solver pays the same amount less its fee into the
 * wallet's perps balance on Hyperliquid within seconds, as a `send` Hyperliquid's
 * ledger shows. If the solver doesn't fill, Relay refunds the deposit on Base.
 */

const RELAY_API_URL = "https://api.relay.link";
const relayUrl = () => localEdgeUrl("RELAY_API_URL") ?? RELAY_API_URL;

/** Relay's depository on Base (its `/chains` list, protocol v2). Every quote must pay into this contract. */
export const RELAY_BASE_DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
/** Relay's name for Hyperliquid's perps USDC. */
const HYPERLIQUID_PERPS_USDC = "0x00000000000000000000000000000000";
/** Hyperliquid's perps USDC has 8 decimals in Relay's amounts; Aura counts USDC in 6. */
const PERPS_DECIMALS_SHIFT = 100n;

const depositoryAbi = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);

export type RelayOptions = { fetcher?: typeof fetch };

async function relayJson(path: string, init: RequestInit, maxBytes: number, options: RelayOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${relayUrl()}${path}`, { ...init, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  } catch {
    throw new VenueError("hyperliquid", "unavailable", "Relay did not answer.", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new VenueError("hyperliquid", "unavailable", `Relay answered HTTP ${response.status}.`, 503);
  }
  return readBoundedJson(response, maxBytes).catch(() => {
    throw new VenueError("hyperliquid", "invalid_response", "Relay sent an unreadable answer.");
  });
}

const hex = z.string().regex(/^0x[\da-fA-F]*$/);
const stepSchema = z.object({
  id: z.string(),
  items: z.array(z.object({ data: z.object({ to: hex, value: z.string().regex(/^\d+$/), chainId: z.number(), data: hex }) })).min(1)
});
const quoteSchema = z.object({
  steps: z.array(stepSchema).min(1).max(3),
  details: z.object({
    recipient: z.string(),
    currencyIn: z.object({ amount: z.string().regex(/^\d+$/), currency: z.object({ address: z.string(), chainId: z.number() }) }),
    currencyOut: z.object({ amount: z.string().regex(/^\d+$/), minimumAmount: z.string().regex(/^\d+$/),
      currency: z.object({ address: z.string(), chainId: z.number() }) })
  })
});

export type RelayPerpsQuote = {
  calls: Array<{ to: `0x${string}`; value: "0"; data: `0x${string}` }>;
  /** Expected and guaranteed credit in the perps balance, 6-decimal USDC. */
  creditRaw: string;
  minimumCreditRaw: string;
};

/**
 * A Relay quote for `amountRaw` Base USDC into `owner`'s perps balance, checked
 * call by call: an exact approval to Relay's depository, then a deposit into it
 * from this wallet, for this amount, of Base USDC. Anything else is refused.
 */
export async function quoteRelayPerpsDeposit(owner: `0x${string}`, amountRaw: string, options: RelayOptions = {}): Promise<RelayPerpsQuote> {
  const body = await relayJson("/quote", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: owner, recipient: owner, originChainId: BASE_CHAIN_ID, destinationChainId: HYPERCORE_CHAIN_ID,
      originCurrency: BASE_USDC, destinationCurrency: HYPERLIQUID_PERPS_USDC, amount: amountRaw, tradeType: "EXACT_INPUT", slippageTolerance: "50" }) },
  200_000, options);
  const parsed = quoteSchema.safeParse(body);
  const refuse = () => new VenueError("hyperliquid", "invalid_response", "Relay sent a quote Aura can't use.");
  if (!parsed.success) throw refuse();
  const { steps, details } = parsed.data;
  if (details.recipient.toLowerCase() !== owner || details.currencyIn.amount !== amountRaw
    || details.currencyIn.currency.chainId !== BASE_CHAIN_ID || details.currencyIn.currency.address.toLowerCase() !== BASE_USDC
    || details.currencyOut.currency.chainId !== HYPERCORE_CHAIN_ID || details.currencyOut.currency.address !== HYPERLIQUID_PERPS_USDC) throw refuse();
  const items = steps.flatMap((step) => step.items.map((item) => item.data));
  if (items.some((item) => item.chainId !== BASE_CHAIN_ID || item.value !== "0")) throw refuse();
  const deposit = items.at(-1)!;
  if (deposit.to.toLowerCase() !== RELAY_BASE_DEPOSITORY) throw refuse();
  let args: readonly [`0x${string}`, `0x${string}`, bigint, `0x${string}`];
  try {
    const decoded = decodeFunctionData({ abi: depositoryAbi, data: deposit.data as `0x${string}` });
    args = decoded.args;
  } catch { throw refuse(); }
  if (args[0].toLowerCase() !== owner || args[1].toLowerCase() !== BASE_USDC || args[2] !== BigInt(amountRaw)) throw refuse();
  // Aura writes the approval itself, exactly for this amount, rather than taking Relay's.
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [RELAY_BASE_DEPOSITORY, BigInt(amountRaw)] });
  return {
    calls: [{ to: BASE_USDC, value: "0", data: approve }, { to: RELAY_BASE_DEPOSITORY, value: "0", data: deposit.data.toLowerCase() as `0x${string}` }],
    creditRaw: (BigInt(details.currencyOut.amount) / PERPS_DECIMALS_SHIFT).toString(),
    minimumCreditRaw: (BigInt(details.currencyOut.minimumAmount) / PERPS_DECIMALS_SHIFT).toString()
  };
}

const requestsSchema = z.object({ requests: z.array(z.object({
  status: z.string(),
  recipient: z.string().optional(),
  data: z.object({
    inTxs: z.array(z.object({ hash: z.string(), chainId: z.number() })).optional(),
    outTxs: z.array(z.object({ hash: z.string(), chainId: z.number() })).optional()
  }).passthrough()
}).passthrough()).max(10) });

export type RelayDelivery =
  | { state: "pending" }
  | { state: "failed"; reason: "refunded" | "delivery_failed" }
  | { state: "mismatch" }
  | { state: "delivered"; hyperliquidHash: string };

/** What Relay says became of the deposit in Base transaction `sourceTxHash`, and the Hyperliquid hash it paid out under. */
export async function relayDeliveryStatus(sourceTxHash: string, owner: string, options: RelayOptions = {}): Promise<RelayDelivery> {
  if (!/^0x[\da-fA-F]{64}$/.test(sourceTxHash)) throw new VenueError("hyperliquid", "invalid_request", "The transaction is not valid.", 400);
  const parsed = requestsSchema.safeParse(await relayJson(`/requests/v2?hash=${sourceTxHash}`, { method: "GET" }, 200_000, options));
  if (!parsed.success) throw new VenueError("hyperliquid", "invalid_response", "Relay sent an unexpected answer.");
  const request = parsed.data.requests.find((item) => item.data.inTxs?.some((tx) => tx.hash.toLowerCase() === sourceTxHash.toLowerCase() && tx.chainId === BASE_CHAIN_ID));
  if (!request) return { state: "pending" };
  if (request.recipient && request.recipient.toLowerCase() !== owner.toLowerCase()) return { state: "mismatch" };
  if (request.status === "refund" || request.status === "refunded") return { state: "failed", reason: "refunded" };
  if (request.status === "failure") return { state: "failed", reason: "delivery_failed" };
  if (request.status !== "success") return { state: "pending" };
  const out = request.data.outTxs?.find((tx) => tx.chainId === HYPERCORE_CHAIN_ID);
  return out ? { state: "delivered", hyperliquidHash: out.hash } : { state: "mismatch" };
}
