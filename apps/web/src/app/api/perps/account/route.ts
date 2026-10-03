import { env } from "cloudflare:workers";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { marketReader } from "@/lib/markets/guard";
import { perpsAccount } from "@/lib/markets/perps";

/** The customer's Hyperliquid account as Hyperliquid reports it now, and whether Aura's trading key is approved. */
export const GET = route("perps.account", { unavailable: "perps_unavailable" }, async (request, { traceId }) => {
  const { subject } = await marketReader(env.PROJECTION_DB, request, "perps");
  const owner = await requireActionWallet(subject);
  return Response.json({ owner, ...await perpsAccount(env.PROJECTION_DB, subject, owner), traceId });
});
