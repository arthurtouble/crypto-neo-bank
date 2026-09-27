import { env } from "cloudflare:workers";
import { isAddress } from "viem";
import { z } from "zod";
import { quoteRoute, RouteQuoteError } from "@/lib/actions/lifi";
import { saveRouteQuote } from "@/lib/actions/route";
import { refuseTokenContract } from "@/lib/actions/transfer";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { featureEnabled, type FeatureKey } from "@/lib/features/flags";
import { errorResponse, route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { requireCatalogAsset } from "@/lib/swap/catalog";
import { chainlinkUsd } from "@/lib/assets/prices";
import { registeredAsset } from "@/lib/assets/registry";

/**
 * Chainlink reference prices for feed-priced assets (stocks, gold, the euro),
 * with when they were published. A swap's price comes from the token's market;
 * outside market hours the reference holds the last close, so the review shows
 * both. An unavailable reference is simply left out.
 */
async function referencePrices(ids: readonly string[], now: Date) {
  const priced = ids.map((id) => registeredAsset(id)).filter((asset) => asset?.price.kind === "chainlink");
  const results = await Promise.all(priced.map(async (asset) => {
    const price = asset!.price.kind === "chainlink" ? await chainlinkUsd(asset!.price, now) : null;
    return price ? { assetId: asset!.id, usd: price.usd, observedAt: price.observedAt } : null;
  }));
  return results.filter((item) => item !== null);
}

const schema = z.object({
  from: z.string().max(80),
  to: z.string().max(80),
  amount: z.string().regex(/^\d+(\.\d+)?$/).max(40),
  recipient: z.string().refine(isAddress).optional(),
  slippageBps: z.coerce.number().int().min(1).max(300).default(50)
});

/** A server-held LI.FI quote for a swap or cross-chain move. */
export const GET = route("routes.quote", { invalid: "invalid_quote_request", unavailable: "quote_unavailable",
  onError: (error, context) => error instanceof RouteQuoteError
    ? errorResponse(error.code === "provider_unavailable" ? 503 : 422, error.code, context, { message: error.message }) : undefined },
async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "route_quote", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
  const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  // Only registered, unpaused assets can be quoted; anything else is refused before LI.FI is asked.
  const [from, to] = await Promise.all([requireCatalogAsset(env.PROJECTION_DB, input.from), requireCatalogAsset(env.PROJECTION_DB, input.to)]);
  // The account can only pay with what it holds: an asset on Base, or Tether Gold on Ethereum.
  if (!registeredAsset(from.id)?.uses.includes("hold"))
    return Response.json({ error: "unsupported_asset", message: `Your account doesn't hold ${from.symbol} on this network.`, traceId }, { status: 422 });
  const crossChain = from.chainId !== to.chainId;
  const wallet = await requireActionWallet(subject.subjectReference);
  const recipient = (input.recipient ?? wallet).toLowerCase();
  const external = recipient !== wallet.toLowerCase();
  // Paying someone else is a send: the send switch applies as well.
  const features: FeatureKey[] = [crossChain ? "cross_chain" : "swaps", ...(external ? ["direct_transfers" as const] : [])];
  for (const key of features)
    if (!await featureEnabled(env.PROJECTION_DB, key)) return Response.json({ error: "feature_unavailable", traceId }, { status: 503 });
  if (external) refuseTokenContract(recipient);
  const now = new Date();
  const quoted = await quoteRoute({ from, to, amount: input.amount, wallet, recipient, slippageBps: input.slippageBps });
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference, now);
  const references = await referencePrices([from.id, to.id], now);
  const quoteId = await saveRouteQuote(env.PROJECTION_DB, { subject: subject.subjectReference, wallet, from, to, recipient, route: quoted }, now);
  return Response.json({ quote: {
    id: quoteId, from, to, recipient, tool: quoted.tool, fromAmountRaw: quoted.fromAmountRaw, toAmountRaw: quoted.toAmountRaw,
    toAmountMinRaw: quoted.toAmountMinRaw, expiresAt: quoted.expiresAt, ...quoted.economics, references
  }, traceId });
});
