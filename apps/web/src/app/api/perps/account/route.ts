import { env } from "cloudflare:workers";
import { loadControls } from "@/lib/actions/controls";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { providerPlaceNotice } from "@/lib/legal/places";
import { marketReader } from "@/lib/markets/guard";
import { perpsAccount } from "@/lib/markets/perps";

/**
 * The customer's Hyperliquid account as Hyperliquid reports it now, whether Aura's trading key is approved, and what
 * would stop them before they fill anything in: a locked account stops every trade, add, and withdrawal; a place
 * Hyperliquid doesn't serve stops anything new but leaves closing and withdrawing open. The action routes check both again.
 */
export const GET = route("perps.account", { unavailable: "perps_unavailable" }, async (request, { traceId }) => {
  const { subject } = await marketReader(env.PROJECTION_DB, request, "perps");
  const owner = await requireActionWallet(subject);
  const [account, controls] = await Promise.all([perpsAccount(env.PROJECTION_DB, subject, owner), loadControls(env.PROJECTION_DB, subject, null, new Date())]);
  const place = providerPlaceNotice(request, "perps");
  const blocked = controls.accountLocked ? { reason: "locked", message: "Your account is locked. Unlock it in Settings to trade, add money, or withdraw." }
    : place ? { reason: "place", message: place } : null;
  return Response.json({ owner, ...account, blocked, traceId });
});
