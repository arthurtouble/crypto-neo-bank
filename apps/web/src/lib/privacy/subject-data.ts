/**
 * Every D1 table that holds customer-scoped data, and what a data-rights
 * request does with it. `api-route-inventory`-style tests fail when a new
 * table with a subject_reference column is not classified here.
 *
 * - erase: removed by a deletion request (preferences, analytics, feedback,
 *   and projections that can be rebuilt from providers or chains).
 * - retain: kept as security, financial, consent, or complaint evidence, or
 *   because the customer manages it directly (saved addresses).
 * - export false: internal or short-lived records with no customer meaning.
 */
type Handling = { export: boolean; erase: boolean; reason: string };

export const subjectDataInventory = {
  subject_profiles: { export: true, erase: false, reason: "Account record; closing an account is handled separately" },
  security_profiles: { export: true, erase: false, reason: "Security controls must survive a data request" },
  address_book_entries: { export: true, erase: false, reason: "Security control the customer manages in Settings" },
  provider_customer_links: { export: true, erase: false, reason: "Needed to recover provider records" },
  aura_tags: { export: true, erase: true, reason: "Public payment tag; erasing unpublishes it" },
  user_preferences: { export: true, erase: true, reason: "Notification choices" },
  onboarding_progress: { export: true, erase: true, reason: "Guide progress; recreated on next sign-in" },
  product_events: { export: true, erase: true, reason: "Product analytics" },
  customer_feedback: { export: true, erase: true, reason: "Voluntary feedback" },
  support_cases: { export: true, erase: false, reason: "Complaint and support evidence" },
  consent_events: { export: true, erase: false, reason: "Proof of consent and withdrawal" },
  consent_evidence: { export: true, erase: false, reason: "Proof of accepted terms and disclosures" },
  data_requests: { export: true, erase: false, reason: "Record of data-rights requests" },
  audit_events: { export: true, erase: false, reason: "Security and financial audit trail" },
  actions: { export: true, erase: false, reason: "Financial transaction evidence" },
  route_quotes: { export: false, erase: true, reason: "Short-lived route quotes; used quotes are summarized on their action" },
  card_account_projections: { export: true, erase: true, reason: "Rebuildable issuer projection" },
  bank_beneficiary_projections: { export: true, erase: true, reason: "Rebuildable provider projection" },
  membership_projections: { export: true, erase: true, reason: "Rebuildable qualification result" },
  benefit_entitlements: { export: true, erase: true, reason: "Rebuildable provider projection" },
  wallet_policies: { export: true, erase: true, reason: "Rebuildable wallet-provider projection" },
  command_idempotency: { export: false, erase: true, reason: "Short-lived retry protection" },
  webhook_receipts: { export: false, erase: false, reason: "Provider event replay protection" },
  operational_issues: { export: false, erase: false, reason: "Internal reconciliation exception" }
} satisfies Record<string, Handling>;

export type SubjectTable = keyof typeof subjectDataInventory;
const tables = Object.keys(subjectDataInventory) as SubjectTable[];
const rowLimit = 5_000;

/** Everything exportable about one customer, table by table, with the retention reason. */
export async function exportSubjectData(db: D1Database, subjectReference: string) {
  const exported = tables.filter((table) => subjectDataInventory[table].export);
  const results = await db.batch([...exported.map((table) =>
    db.prepare(`SELECT * FROM ${table} WHERE subject_reference = ? LIMIT ${rowLimit + 1}`).bind(subjectReference)),
  // An action's status history has no subject column of its own; it belongs to the customer through the action.
  db.prepare(`SELECT e.* FROM action_events e JOIN actions a ON a.action_id = e.action_id WHERE a.subject_reference = ? LIMIT ${rowLimit + 1}`).bind(subjectReference)]);
  const section = (rows: unknown[], erase: boolean, reason: string) => ({ rows: rows.slice(0, rowLimit), truncated: rows.length > rowLimit, erasedOnDeletion: erase, reason });
  return {
    ...Object.fromEntries(exported.map((table, index) => [table, section(results[index].results, subjectDataInventory[table].erase, subjectDataInventory[table].reason)])),
    action_events: section(results[exported.length].results, false, "Status history of financial transactions, kept with the actions")
  };
}

/** Delete every erasable row in one batch; retained evidence is listed with its reason. */
export async function eraseSubjectData(db: D1Database, subjectReference: string) {
  const erasable = tables.filter((table) => subjectDataInventory[table].erase);
  const results = await db.batch(erasable.map((table) => db.prepare(`DELETE FROM ${table} WHERE subject_reference = ?`).bind(subjectReference)));
  return {
    erased: Object.fromEntries(erasable.map((table, index) => [table, results[index].meta.changes ?? 0])),
    retained: Object.fromEntries(tables.filter((table) => !subjectDataInventory[table].erase).map((table) => [table, subjectDataInventory[table].reason]))
  };
}
