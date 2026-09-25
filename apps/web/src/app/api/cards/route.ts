import { env } from "cloudflare:workers";
import { readCurrentCardAccount } from "@aurel/provider-projections";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { featureEnabled } from "@/lib/features/flags";
import { route } from "@/lib/http/route";

const controls = ["freeze", "spending_limits", "allowed_countries", "pin", "digital_wallet", "terminate"] as const;
const setupRequired = Object.fromEntries(controls.map((key) => [key, "setup_required"]));

export const GET = route("cards.get", { unavailable: "card_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  // A stored projection is shown only while the issuer program is switched on.
  const card = await featureEnabled(env.PROJECTION_DB, "payment_cards")
    ? await readCurrentCardAccount(env.PROJECTION_DB, subject.subjectReference) : null;
  if (!card) {
    return Response.json({ state: "setup_required", card: null, controls: setupRequired,
      authority: "No issuer-backed card account is connected", traceId }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json({
    state: card.status,
    card: { status: card.status, formFactor: card.formFactor ?? null, network: card.network ?? null, lastFour: card.lastFour ?? null,
      dailyLimit: card.dailyLimit ?? null, monthlyLimit: card.monthlyLimit ?? null, currency: card.currency },
    // Issuer control APIs are not connected yet; the issuer's own app remains the control surface.
    controls: setupRequired,
    source: { provider: card.provider, observedAt: card.observedAt },
    authority: "Issuer-reported card state; the issuer is authoritative",
    traceId
  }, { headers: { "Cache-Control": "private, no-store" } });
});
