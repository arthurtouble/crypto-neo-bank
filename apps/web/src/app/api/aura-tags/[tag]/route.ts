import { env } from "cloudflare:workers";
import { normalizeAuraTag, publicTagResponse, type AuraTagRow } from "@/lib/aura-tags";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { BridgeRailAdapter } from "@/lib/providers/bridge";

export async function GET(_request: Request, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const tag = normalizeAuraTag((await params).tag);
    const row = await env.PROJECTION_DB.prepare("SELECT tag, subject_reference, receiving_address, display_name, public_bank_enabled FROM aura_tags WHERE tag = ? AND active = 1 AND public_enabled = 1")
      .bind(tag).first<AuraTagRow>();
    if (!row) return Response.json({ error: "tag_unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    await requireLinkedEvmWallet(row.subject_reference, row.receiving_address);
    let bank;
    if (row.public_bank_enabled === 1 && process.env.BRIDGE_MODE === "live" && process.env.BRIDGE_API_KEY) {
      const link = await env.PROJECTION_DB.prepare("SELECT external_customer_id FROM provider_customer_links WHERE subject_reference = ? AND provider = 'bridge' AND status = 'active'")
        .bind(row.subject_reference).first<{ external_customer_id: string }>();
      if (link) {
        try { bank = await new BridgeRailAdapter(process.env.BRIDGE_API_KEY, process.env.BRIDGE_API_BASE_URL).getUsdAccount(link.external_customer_id); }
        catch { /* A Bridge outage leaves crypto available and bank instructions hidden. */ }
      }
    }
    return Response.json(publicTagResponse(row, bank), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "tag_unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
