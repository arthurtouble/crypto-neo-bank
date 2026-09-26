import { env } from "cloudflare:workers";
import { isAddress } from "viem";
import { z } from "zod";
import { quoteRoute, RouteQuoteError } from "@/lib/actions/lifi";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { requireAsset } from "@/lib/assets/pauses";
import { depositDestination, depositSource } from "@/lib/deposits/networks";
import { catalogAsset } from "@/lib/swap/catalog";
import { featureEnabled } from "@/lib/features/flags";
import { errorResponse, route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  chainId: z.number().int().positive(),
  symbol: z.string().min(1).max(32),
  amount: z.string().regex(/^\d+(\.\d+)?$/).max(40),
  from: z.string().refine(isAddress)
}).strict();

/**
 * A route that bridges a deposit from another network to the same asset on
 * Base, into the customer's Aura account. The customer's own linked wallet
 * signs and pays for it; bridge fees come out of the amount that arrives.
 */
export const POST = route("deposits.quote", { invalid: "invalid_deposit", unavailable: "deposit_quote_unavailable",
  onError: (error, context) => error instanceof RouteQuoteError
    ? errorResponse(error.code === "provider_unavailable" ? 503 : 422, error.code, context, { message: error.message }) : undefined },
async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "deposit_quote", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
  const input = schema.parse(await request.json());
  const source = depositSource(input.chainId, input.symbol);
  const destination = depositDestination(input.symbol);
  if (!source || !destination || source.chainId === destination.chainId) throw new RouteQuoteError("invalid_request", "Choose another network to deposit from.");
  if (!await featureEnabled(env.PROJECTION_DB, "cross_chain")) return Response.json({ error: "feature_unavailable",
    message: "Deposits from other networks aren't available right now. You can still add money on Base.", traceId }, { status: 503 });
  // The sender must be a wallet the customer linked; the recipient is always their Aura account.
  const [from, account] = await Promise.all([
    requireLinkedEvmWallet(subject.subjectReference, input.from),
    requireActionWallet(subject.subjectReference)
  ]);
  // Registered isn't enough: a paused source or destination asset takes no new deposits.
  const [fromAsset, toAsset] = await Promise.all([requireAsset(env.PROJECTION_DB, source.id, "deposit"), requireAsset(env.PROJECTION_DB, destination.id, "hold")]);
  const quoted = await quoteRoute({ from: catalogAsset(fromAsset), to: catalogAsset(toAsset), amount: input.amount,
    wallet: from, recipient: account, slippageBps: 50 });
  return Response.json({ quote: {
    chainId: source.chainId, symbol: input.symbol, tool: quoted.tool, calls: quoted.calls,
    fromAmountRaw: quoted.fromAmountRaw, toAmountRaw: quoted.toAmountRaw, toAmountMinRaw: quoted.toAmountMinRaw,
    decimals: destination.decimals, expiresAt: quoted.expiresAt, ...quoted.economics
  }, traceId });
});
