import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

const controls = ["freeze", "spending_limits", "allowed_countries", "pin", "digital_wallet", "terminate"] as const;

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireVerifiedSubject(request);
    return Response.json({ state: "setup_required", card: null, controls: Object.fromEntries(controls.map((key) => [key, "setup_required"])), authority: "No issuer-backed card account is connected", traceId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    return Response.json({ error: "card_unavailable", traceId }, { status: 503 });
  }
}
