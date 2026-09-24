import { env } from "cloudflare:workers";
import { normalizeAuraTag, publicTagResponse, type AuraTagRow } from "@/lib/aura-tags";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";

export async function GET(_request: Request, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const tag = normalizeAuraTag((await params).tag);
    const row = await env.PROJECTION_DB.prepare("SELECT tag, subject_reference, receiving_address, display_name FROM aura_tags WHERE tag = ? AND active = 1 AND public_enabled = 1")
      .bind(tag).first<AuraTagRow>();
    if (!row) return Response.json({ error: "tag_unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    await requireLinkedEvmWallet(row.subject_reference, row.receiving_address);
    return Response.json(publicTagResponse(row), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "tag_unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
