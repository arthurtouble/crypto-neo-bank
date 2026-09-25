import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";

const controls = ["freeze", "spending_limits", "allowed_countries", "pin", "digital_wallet", "terminate"] as const;

export const GET = route("cards.get", { unavailable: "card_unavailable" }, async (request: Request, { traceId }) => {
  await requireVerifiedSubject(request);
  return Response.json({ state: "setup_required", card: null, controls: Object.fromEntries(controls.map((key) => [key, "setup_required"])), authority: "No issuer-backed card account is connected", traceId }, { headers: { "Cache-Control": "private, no-store" } });
});
