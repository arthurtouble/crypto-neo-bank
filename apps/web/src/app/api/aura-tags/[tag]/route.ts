import { env } from "cloudflare:workers";
import { normalizeAuraTag, publicTagResponse, type AuraTagRow } from "@/lib/aura-tags";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { RateLimitError } from "@/lib/http/errors";
import { activeBridgeCustomer, bridgeClient, getUsdAccount } from "@/lib/providers/bridge";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const unavailable = () => Response.json({ error: "tag_unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });

/** A public payment page. Every failure looks the same, so tags cannot be probed. */
export async function GET(request: Request, { params }: { params: Promise<{ tag: string }> }) {
  try {
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "aura_tag_public", subject: request.headers.get("cf-connecting-ip") ?? "unknown",
      limit: 60, windowSeconds: 60 });
  } catch (error) {
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store", ...error.headers } });
    return unavailable();
  }
  try {
    const tag = normalizeAuraTag((await params).tag);
    const row = await env.PROJECTION_DB.prepare("SELECT tag, subject_reference, receiving_address, display_name, public_bank_enabled FROM aura_tags WHERE tag = ? AND active = 1 AND public_enabled = 1")
      .bind(tag).first<AuraTagRow>();
    if (!row) return unavailable();
    await requireLinkedEvmWallet(row.subject_reference, row.receiving_address);
    let bank;
    const bridge = row.public_bank_enabled === 1 ? await bridgeClient(env.PROJECTION_DB) : null;
    if (bridge) {
      const customerId = await activeBridgeCustomer(env.PROJECTION_DB, row.subject_reference);
      // A Bridge outage leaves crypto available and bank instructions hidden.
      if (customerId) bank = await getUsdAccount(bridge, customerId).catch(() => undefined);
    }
    return Response.json(publicTagResponse(row, bank), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}
