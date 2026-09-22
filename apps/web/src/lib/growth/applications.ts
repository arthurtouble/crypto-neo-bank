import { z } from "zod";
import { encryptEmail, emailLookupHmac, growthSecrets, normalizeEmail } from "./crypto";

const walletOptions = ["base", "ethereum", "arbitrum", "optimism", "polygon", "external_wallet", "exchange", "custodian", "none"] as const;

export const attributionSchema = z.object({
  anonymousSessionId: z.string().uuid(),
  utmSource: z.string().trim().max(100).nullable().optional(),
  utmMedium: z.string().trim().max(100).nullable().optional(),
  utmCampaign: z.string().trim().max(120).nullable().optional(),
  utmContent: z.string().trim().max(120).nullable().optional(),
  utmTerm: z.string().trim().max(120).nullable().optional(),
  referrerHost: z.string().trim().max(253).regex(/^[a-z0-9.-]+$/i).nullable().optional(),
  landingPath: z.string().trim().max(300).regex(/^\/(?!\/)/),
  partnerCode: z.string().trim().regex(/^[a-z0-9-]{2,80}$/).nullable().optional(),
  contentId: z.string().trim().regex(/^[a-z0-9-]{2,120}$/).nullable().optional()
  ,referralCode: z.string().trim().regex(/^AUREL-[A-Z0-9]+$/).max(80).nullable().optional()
}).strict();

export const growthApplicationSchema = z.object({
  email: z.string().trim().email().max(254),
  countryCode: z.string().trim().refine((value) => /^[A-Za-z]{2}$/.test(value) || value === "OTHER", "Choose a valid country.").transform((value) => value === "OTHER" ? "ZZ" : value.toUpperCase()),
  primaryJob: z.enum(["receive", "see", "protect", "earn", "spend", "move", "treasury", "other"]),
  workflowFrequency: z.enum(["daily", "weekly", "monthly", "occasional", "not_yet"]),
  assetBand: z.enum(["under_25k", "25k_100k", "100k_500k", "over_500k", "prefer_not_to_say"]).nullable().optional(),
  relationshipType: z.enum(["individual", "family", "company"]),
  walletsChains: z.array(z.enum(walletOptions)).max(9),
  desiredOutcome: z.string().trim().min(10).max(500),
  betaContactConsent: z.literal(true),
  marketingConsent: z.boolean().default(false),
  privacyNoticeVersion: z.string().trim().min(1).max(40),
  applicationVersion: z.string().trim().min(1).max(60),
  attribution: attributionSchema,
  turnstileToken: z.string().max(2048).optional()
}).strict();

export type GrowthApplicationInput = z.infer<typeof growthApplicationSchema>;

export async function persistGrowthApplication(database: D1Database, input: GrowthApplicationInput, now = new Date()) {
  const { encryptionKey, lookupKey } = growthSecrets();
  const normalizedEmail = normalizeEmail(input.email);
  const lookup = await emailLookupHmac(normalizedEmail, lookupKey);
  const existing = await database.prepare("SELECT application_id FROM growth_applications WHERE email_lookup_hmac = ?").bind(lookup).first<{ application_id: string }>();
  const timestamp = now.toISOString();

  if (existing) {
    await database.prepare(`UPDATE growth_applications SET country_code = ?, primary_job = ?, workflow_frequency = ?, asset_band = ?, relationship_type = ?, wallets_chains_json = ?, updated_at = ? WHERE application_id = ?`)
      .bind(input.countryCode, input.primaryJob, input.workflowFrequency, input.assetBand ?? null, input.relationshipType, JSON.stringify(input.walletsChains), timestamp, existing.application_id).run();
    return { applicationId: existing.application_id, created: false };
  }

  const applicationId = crypto.randomUUID();
  const encrypted = await encryptEmail(normalizedEmail, encryptionKey);
  const attributionStatements = (["first", "last", "conversion"] as const).map((touchType) => database.prepare(`INSERT INTO growth_attribution
    (attribution_id, application_id, subject_reference, anonymous_session_id, touch_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer_host, landing_path, partner_code, content_id, captured_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), applicationId, input.attribution.anonymousSessionId, touchType, input.attribution.utmSource ?? null, input.attribution.utmMedium ?? null, input.attribution.utmCampaign ?? null, input.attribution.utmContent ?? null, input.attribution.utmTerm ?? null, input.attribution.referrerHost ?? null, input.attribution.landingPath, input.attribution.partnerCode ?? null, input.attribution.contentId ?? null, timestamp));

  await database.batch([
    database.prepare(`INSERT INTO growth_applications
      (application_id, email_ciphertext, email_nonce, email_lookup_hmac, country_code, primary_job, workflow_frequency, asset_band, relationship_type, wallets_chains_json, desired_outcome, status, fit_band, assigned_to, decision_reason, source_application_version, privacy_notice_version, beta_contact_consent, marketing_consent, submitted_at, reviewed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', NULL, NULL, NULL, ?, ?, 1, ?, ?, NULL, ?)`)
      .bind(applicationId, encrypted.ciphertext, encrypted.nonce, lookup, input.countryCode, input.primaryJob, input.workflowFrequency, input.assetBand ?? null, input.relationshipType, JSON.stringify(input.walletsChains), input.desiredOutcome, input.applicationVersion, input.privacyNoticeVersion, input.marketingConsent ? 1 : 0, timestamp, timestamp),
    ...attributionStatements,
    database.prepare(`INSERT INTO growth_events (event_id, application_id, subject_reference, anonymous_session_id, event_name, surface, campaign_id, content_id, properties_json, occurred_at)
      VALUES (?, ?, NULL, ?, 'application_submitted', '/apply', NULL, ?, '{}', ?)`)
      .bind(crypto.randomUUID(), applicationId, input.attribution.anonymousSessionId, input.attribution.contentId ?? null, timestamp),
    database.prepare(`INSERT INTO growth_consent_events (consent_event_id, application_id, subject_reference, purpose, action, notice_version, occurred_at) VALUES (?, ?, NULL, 'beta_operational', 'granted', ?, ?)`)
      .bind(crypto.randomUUID(), applicationId, input.privacyNoticeVersion, timestamp),
    ...(input.marketingConsent ? [database.prepare(`INSERT INTO growth_consent_events (consent_event_id, application_id, subject_reference, purpose, action, notice_version, occurred_at) VALUES (?, ?, NULL, 'marketing', 'granted', ?, ?)`)
      .bind(crypto.randomUUID(), applicationId, input.privacyNoticeVersion, timestamp)] : []),
    database.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at) VALUES (?, NULL, 'system', 'public-application', 'growth_application_received', 'growth_application', ?, ?, ?)`)
      .bind(crypto.randomUUID(), applicationId, JSON.stringify({ privacyNoticeVersion: input.privacyNoticeVersion, betaContactConsent: true, marketingConsent: input.marketingConsent }), timestamp)
  ]);
  if (input.attribution.referralCode) {
    const { hashInviteCode } = await import("./invitations");
    const inviteHash = await hashInviteCode(input.attribution.referralCode);
    await database.prepare(`UPDATE growth_invite_links SET application_id = ? WHERE invite_hash = ? AND application_id IS NULL AND invitation_type = 'customer_referral' AND EXISTS (SELECT 1 FROM growth_referrals gr WHERE gr.invite_hash = ? AND gr.status = 'active' AND gr.expires_at > ?)`)
      .bind(applicationId, inviteHash, inviteHash, timestamp).run();
  }
  return { applicationId, created: true };
}

export function redactEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.min(3, Math.max(1, local.length - 1)))}@${domain}`;
}
