import { env } from "cloudflare:workers";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { marketReader } from "@/lib/markets/guard";
import { predictionsAccount } from "@/lib/markets/predictions";

/** The customer's Polymarket wallet: balance, positions, and open orders, read now. */
export const GET = route("predictions.account", { unavailable: "predictions_unavailable" }, async (request, { traceId }) => {
  const { subject } = await marketReader(env.PROJECTION_DB, request, "predictions");
  const owner = await requireActionWallet(subject);
  return Response.json({ owner, ...await predictionsAccount(env.PROJECTION_DB, subject, owner), traceId });
});
