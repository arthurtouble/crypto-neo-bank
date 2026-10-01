import { normalizeAuraTag, publicTagResponse, type AuraTagRow } from "@/lib/aura-tags";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { RateLimitError } from "@/lib/http/errors";
import { activeBridgeCustomer, bridgeClient, getUsdAccount } from "@/lib/providers/bridge";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export type PublicTagLookup =
  | { status: "available"; payment: ReturnType<typeof publicTagResponse> }
  | { status: "rate_limited"; headers: Record<string, string> }
  | { status: "unavailable" };

/**
 * An Aura tag's public payment details, shared by the payment page and its
 * API. Each visitor is limited on their own, by the address Cloudflare saw
 * (`cf-connecting-ip`); every other failure looks the same, so tags can't be probed.
 */
export async function lookupPublicTag(db: D1Database, tagInput: string, clientIp: string | null): Promise<PublicTagLookup> {
  try {
    await enforceRateLimit(db, { namespace: "aura_tag_public", subject: clientIp || "unknown", limit: 60, windowSeconds: 60 });
  } catch (error) {
    if (error instanceof RateLimitError) return { status: "rate_limited", headers: error.headers };
    return { status: "unavailable" };
  }
  try {
    const tag = normalizeAuraTag(tagInput);
    const row = await db.prepare("SELECT tag, subject_reference, receiving_address, display_name, public_bank_enabled FROM aura_tags WHERE tag = ? AND active = 1 AND public_enabled = 1")
      .bind(tag).first<AuraTagRow>();
    if (!row) return { status: "unavailable" };
    await requireLinkedEvmWallet(row.subject_reference, row.receiving_address);
    let bank;
    const bridge = row.public_bank_enabled === 1 ? await bridgeClient(db) : null;
    if (bridge) {
      const customerId = await activeBridgeCustomer(db, row.subject_reference);
      // A Bridge outage leaves crypto available and bank instructions hidden.
      if (customerId) bank = await getUsdAccount(bridge, customerId).catch(() => undefined);
    }
    return { status: "available", payment: publicTagResponse(row, bank) };
  } catch {
    return { status: "unavailable" };
  }
}
