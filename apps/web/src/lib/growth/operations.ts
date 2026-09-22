import { decryptEmail, growthSecrets } from "./crypto";
import { redactEmail } from "./applications";

export const applicationStatuses = ["received", "reviewing", "qualified", "waitlisted", "invited", "declined", "withdrawn"] as const;
export type ApplicationStatus = typeof applicationStatuses[number];

export const allowedTransitions: Record<ApplicationStatus, ApplicationStatus[]> = {
  received: ["reviewing", "withdrawn"],
  reviewing: ["qualified", "waitlisted", "declined", "withdrawn"],
  qualified: ["waitlisted", "invited", "declined", "withdrawn"],
  waitlisted: ["qualified", "invited", "declined", "withdrawn"],
  invited: ["withdrawn"],
  declined: ["reviewing", "withdrawn"],
  withdrawn: []
};

type ApplicationRow = {
  application_id: string; email_ciphertext: string; email_nonce: string; country_code: string; primary_job: string; workflow_frequency: string; asset_band: string | null; relationship_type: string; wallets_chains_json: string; desired_outcome: string; status: ApplicationStatus; fit_band: string | null; assigned_to: string | null; decision_reason: string | null; source_application_version: string; privacy_notice_version: string; beta_contact_consent: number; marketing_consent: number; submitted_at: string; reviewed_at: string | null; updated_at: string;
};

export async function applicationDetail(database: D1Database, applicationId: string) {
  const row = await database.prepare("SELECT * FROM growth_applications WHERE application_id = ?").bind(applicationId).first<ApplicationRow>();
  if (!row) return null;
  const email = await decryptEmail(row.email_ciphertext, row.email_nonce, growthSecrets().encryptionKey);
  const [attribution, audit] = await database.batch([
    database.prepare("SELECT touch_type, utm_source, utm_medium, utm_campaign, utm_content, referrer_host, landing_path, partner_code, content_id, captured_at FROM growth_attribution WHERE application_id = ? ORDER BY captured_at, touch_type").bind(applicationId),
    database.prepare("SELECT action, actor_type, actor_reference, evidence_json, occurred_at FROM audit_events WHERE target_type = 'growth_application' AND target_reference = ? ORDER BY occurred_at DESC LIMIT 100").bind(applicationId)
  ]);
  return { applicationId: row.application_id, email, countryCode: row.country_code, primaryJob: row.primary_job, workflowFrequency: row.workflow_frequency, assetBand: row.asset_band, relationshipType: row.relationship_type, walletsChains: JSON.parse(row.wallets_chains_json), desiredOutcome: row.desired_outcome, status: row.status, fitBand: row.fit_band, assignedTo: row.assigned_to, decisionReason: row.decision_reason, applicationVersion: row.source_application_version, privacyNoticeVersion: row.privacy_notice_version, betaContactConsent: Boolean(row.beta_contact_consent), marketingConsent: Boolean(row.marketing_consent), submittedAt: row.submitted_at, reviewedAt: row.reviewed_at, updatedAt: row.updated_at, attribution: attribution.results, audit: audit.results };
}

export async function listApplications(database: D1Database, filters: { status?: string; country?: string; primaryJob?: string; source?: string; campaign?: string; ageDays?: number; cursor?: string; limit: number }) {
  const clauses: string[] = []; const values: unknown[] = [];
  if (filters.status) { clauses.push("a.status = ?"); values.push(filters.status); }
  if (filters.country) { clauses.push("a.country_code = ?"); values.push(filters.country); }
  if (filters.primaryJob) { clauses.push("a.primary_job = ?"); values.push(filters.primaryJob); }
  if (filters.source) { clauses.push("EXISTS (SELECT 1 FROM growth_attribution gs WHERE gs.application_id = a.application_id AND gs.touch_type = 'conversion' AND gs.utm_source = ?)"); values.push(filters.source); }
  if (filters.cursor) { clauses.push("a.submitted_at < ?"); values.push(filters.cursor); }
  if (filters.ageDays) { clauses.push("a.submitted_at <= ?"); values.push(new Date(Date.now() - filters.ageDays * 86_400_000).toISOString()); }
  if (filters.campaign) { clauses.push("EXISTS (SELECT 1 FROM growth_attribution ga WHERE ga.application_id = a.application_id AND ga.utm_campaign = ?)"); values.push(filters.campaign); }
  values.push(filters.limit + 1);
  const rows = await database.prepare(`SELECT a.application_id, a.email_ciphertext, a.email_nonce, a.country_code, a.primary_job, a.workflow_frequency, a.asset_band, a.relationship_type, a.status, a.fit_band, a.assigned_to, a.decision_reason, a.submitted_at, a.updated_at,
    (SELECT ga.utm_source FROM growth_attribution ga WHERE ga.application_id = a.application_id AND ga.touch_type = 'conversion' LIMIT 1) AS source,
    (SELECT ga.utm_campaign FROM growth_attribution ga WHERE ga.application_id = a.application_id AND ga.touch_type = 'conversion' LIMIT 1) AS campaign
    FROM growth_applications a ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY a.submitted_at DESC LIMIT ?`).bind(...values).all<ApplicationRow & { source: string | null; campaign: string | null }>();
  const encryptionKey = growthSecrets().encryptionKey;
  const page = rows.results.slice(0, filters.limit);
  return { applications: await Promise.all(page.map(async (row) => ({ applicationId: row.application_id, emailLabel: redactEmail(await decryptEmail(row.email_ciphertext, row.email_nonce, encryptionKey)), countryCode: row.country_code, primaryJob: row.primary_job, workflowFrequency: row.workflow_frequency, assetBand: row.asset_band, relationshipType: row.relationship_type, status: row.status, fitBand: row.fit_band, assignedTo: row.assigned_to, decisionReason: row.decision_reason, source: row.source, campaign: row.campaign, submittedAt: row.submitted_at, updatedAt: row.updated_at }))), nextCursor: rows.results.length > filters.limit ? page.at(-1)?.submitted_at ?? null : null };
}

export function canTransition(from: ApplicationStatus, to: ApplicationStatus) { return allowedTransitions[from].includes(to); }
