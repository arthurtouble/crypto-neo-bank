import { z } from "zod";
import { emailLookupHmac, encryptEmail, growthSecrets, normalizeEmail } from "./crypto";

export const waitlistSchema = z.object({
  email: z.string().trim().email().max(254),
  privacyNoticeVersion: z.string().trim().min(1).max(40),
  attribution: z.object({
    utmSource: z.string().trim().max(120).optional(),
    utmCampaign: z.string().trim().max(120).optional(),
    partnerCode: z.string().trim().regex(/^[a-z0-9-]{2,80}$/).optional(),
    referralCode: z.string().trim().regex(/^AUREL-[A-Z0-9]+$/).max(80).optional()
  }).strict().optional(),
  turnstileToken: z.string().max(2048).optional()
}).strict();

export type WaitlistInput = z.infer<typeof waitlistSchema>;
export type CountryHint = { countryCode: string | null; source: "cloudflare" | "unknown" };

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const nonCountryRegions = new Set(["EU", "UN", "UK", "ZZ", "XX"]);

export function countryFromRequest(request: Request): CountryHint {
  const code = (request as Request & { cf?: { country?: string } }).cf?.country?.toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || nonCountryRegions.has(code)) return { countryCode: null, source: "unknown" };
  try {
    const name = regionNames.of(code);
    if (!name || name === code || name === "Unknown Region") return { countryCode: null, source: "unknown" };
    return { countryCode: code, source: "cloudflare" };
  } catch {
    return { countryCode: null, source: "unknown" };
  }
}

export async function persistWaitlist(database: D1Database, input: WaitlistInput, country: CountryHint) {
  const { encryptionKey, lookupKey } = growthSecrets();
  const email = normalizeEmail(input.email);
  const lookup = await emailLookupHmac(email, lookupKey);
  const encrypted = await encryptEmail(email, encryptionKey);
  const waitlistId = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await database.prepare(`INSERT INTO growth_waitlist
    (waitlist_id, email_ciphertext, email_nonce, email_lookup_hmac, country_hint, country_hint_source, privacy_notice_version, attribution_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email_lookup_hmac) DO NOTHING`)
    .bind(waitlistId, encrypted.ciphertext, encrypted.nonce, lookup, country.countryCode, country.source, input.privacyNoticeVersion, JSON.stringify(input.attribution ?? {}), now, now).run();
  const row = await database.prepare("SELECT waitlist_id FROM growth_waitlist WHERE email_lookup_hmac = ?").bind(lookup).first<{ waitlist_id: string }>();
  if (!row) throw new Error("Waitlist write could not be confirmed.");
  return { waitlistId: row.waitlist_id, created: Number(result.meta.changes) > 0 };
}
