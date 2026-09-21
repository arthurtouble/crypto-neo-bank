import { ensureSubjectProfile } from "@/lib/profile/ensure";

export const BETA_TERMS_VERSION = "private-beta-2026-09";
export type BetaMode = "preview" | "invite";

export class BetaAccessError extends Error {
  constructor(public code: "invite_required" | "access_suspended" | "country_unavailable", message: string) {
    super(message);
    this.name = "BetaAccessError";
  }
}

export type BetaAccess = {
  allowed: boolean;
  mode: BetaMode;
  status: "preview" | "active" | "suspended" | "closed" | "not_enrolled";
  cohort: string;
  countryCode?: string;
  transactionLimitUsd: number;
  termsVersion: string;
};

export function betaMode(): BetaMode {
  return process.env.BETA_ACCESS_MODE === "invite" ? "invite" : "preview";
}

export function configuredCountries(): string[] {
  return (process.env.BETA_ALLOWED_COUNTRIES ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
}

export async function getBetaAccess(database: D1Database, subjectReference: string): Promise<BetaAccess> {
  const mode = betaMode();
  if (mode === "preview") return { allowed: true, mode, status: "preview", cohort: "public-preview", transactionLimitUsd: 25_000, termsVersion: BETA_TERMS_VERSION };
  const row = await database.prepare(`SELECT cohort, country_code, status, transaction_limit_usd, terms_version
    FROM beta_access WHERE subject_reference = ?`).bind(subjectReference).first<{
      cohort: string; country_code: string; status: "active" | "suspended" | "closed"; transaction_limit_usd: number; terms_version: string;
    }>();
  if (!row) return { allowed: false, mode, status: "not_enrolled", cohort: "", transactionLimitUsd: 0, termsVersion: BETA_TERMS_VERSION };
  return { allowed: row.status === "active", mode, status: row.status, cohort: row.cohort, countryCode: row.country_code, transactionLimitUsd: row.transaction_limit_usd, termsVersion: row.terms_version };
}

export async function requireBetaAccess(database: D1Database, subjectReference: string): Promise<BetaAccess> {
  const access = await getBetaAccess(database, subjectReference);
  if (!access.allowed) throw new BetaAccessError(access.status === "suspended" ? "access_suspended" : "invite_required", access.status === "suspended" ? "This beta account is paused. Contact Aurel support." : "A valid private-beta invitation is required.");
  return access;
}

export async function redeemBetaInvite(database: D1Database, input: { subjectReference: string; code: string; countryCode: string }): Promise<BetaAccess> {
  const countryCode = input.countryCode.trim().toUpperCase();
  const globallyAllowed = configuredCountries();
  if (globallyAllowed.length && !globallyAllowed.includes(countryCode)) throw new BetaAccessError("country_unavailable", "The private beta is not available in this country yet.");
  await ensureSubjectProfile(database, input.subjectReference);
  const existing = await database.prepare("SELECT status FROM beta_access WHERE subject_reference = ?").bind(input.subjectReference).first<{ status: string }>();
  if (existing?.status === "active") return getBetaAccess(database, input.subjectReference);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.code.trim().toUpperCase()));
  const codeHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  const invite = await database.prepare(`SELECT code_hash, cohort, max_redemptions, redemption_count, allowed_countries_json, expires_at
    FROM beta_invites WHERE code_hash = ? AND status = 'active'`).bind(codeHash).first<{
      code_hash: string; cohort: string; max_redemptions: number; redemption_count: number; allowed_countries_json: string; expires_at: string | null;
    }>();
  if (!invite || invite.redemption_count >= invite.max_redemptions || (invite.expires_at && invite.expires_at <= now)) throw new BetaAccessError("invite_required", "This invitation is invalid, expired, or fully used.");
  const countries = JSON.parse(invite.allowed_countries_json) as string[];
  if (countries.length && !countries.includes(countryCode)) throw new BetaAccessError("country_unavailable", "This invitation is not available in the selected country.");
  const [claimed] = await database.batch([
    database.prepare(`UPDATE beta_invites SET redemption_count = redemption_count + 1
      WHERE code_hash = ? AND status = 'active' AND redemption_count < max_redemptions AND (expires_at IS NULL OR expires_at > ?)
      AND NOT EXISTS (SELECT 1 FROM beta_access WHERE subject_reference = ? AND status = 'active')`)
      .bind(codeHash, now, input.subjectReference),
    database.prepare(`INSERT INTO beta_access
      (subject_reference, invite_hash, cohort, country_code, status, transaction_limit_usd, terms_version, terms_accepted_at, activated_at, updated_at)
      SELECT ?, ?, ?, ?, 'active', 25000, ?, ?, ?, ? WHERE changes() = 1
      ON CONFLICT(subject_reference) DO UPDATE SET invite_hash = excluded.invite_hash, cohort = excluded.cohort, country_code = excluded.country_code,
      status = 'active', terms_version = excluded.terms_version, terms_accepted_at = excluded.terms_accepted_at, updated_at = excluded.updated_at`)
      .bind(input.subjectReference, codeHash, invite.cohort, countryCode, BETA_TERMS_VERSION, now, now, now),
    database.prepare(`UPDATE subject_profiles SET country_code = ?, onboarding_state = 'beta_active', updated_at = ?
      WHERE subject_reference = ? AND EXISTS (SELECT 1 FROM beta_access WHERE subject_reference = ? AND invite_hash = ? AND status = 'active')`)
      .bind(countryCode, now, input.subjectReference, input.subjectReference, codeHash)
  ]);
  if (!claimed.meta.changes) throw new BetaAccessError("invite_required", "This invitation was already used or is no longer available.");
  return getBetaAccess(database, input.subjectReference);
}
