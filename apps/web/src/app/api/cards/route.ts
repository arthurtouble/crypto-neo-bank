import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

type CardRow = { card_reference: string; provider: string; status: string; form_factor: string | null; network: string | null; last_four: string | null; daily_limit: string | null; monthly_limit: string | null; currency: string; observed_at: string };

const controls = ["freeze", "spending_limits", "allowed_countries", "pin", "digital_wallet", "terminate"] as const;

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const card = await env.PROJECTION_DB.prepare(`SELECT card_reference, provider, status, form_factor, network, last_four, daily_limit, monthly_limit, currency, observed_at
      FROM card_account_projections WHERE subject_reference = ? AND status != 'closed' ORDER BY observed_at DESC LIMIT 1`).bind(subject.subjectReference).first<CardRow>();
    if (!card) return Response.json({ state: "setup_required", card: null, controls: Object.fromEntries(controls.map((key) => [key, "setup_required"])), nextAction: { label: "Add card" }, authority: "No issuer-backed card account is connected", traceId }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ state: card.status, card: { cardReference: card.card_reference, provider: card.provider, status: card.status, formFactor: card.form_factor, network: card.network, lastFour: card.last_four, dailyLimit: card.daily_limit, monthlyLimit: card.monthly_limit, currency: card.currency, observedAt: card.observed_at }, controls: Object.fromEntries(controls.map((key) => [key, "locked"])), authority: `${card.provider} card projection; control mutations require an enabled issuer adapter`, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    return Response.json({ error: "card_unavailable", traceId }, { status: 503 });
  }
}
