/**
 * Every D1 table that holds customer-scoped data, whether it is in the
 * customer's data export, and why it's kept. `privacy-rights.test.ts` fails
 * when a new table with a subject_reference column is not classified here.
 *
 * Aura doesn't delete a customer's records on request: they are financial,
 * security, and consent evidence. A customer who wants to leave asks
 * support, and an operator closes the account once it holds no funds
 * (`lib/account/closure.ts`).
 *
 * - export false: internal or short-lived records with no customer meaning.
 */
type Handling = { export: boolean; reason: string };

export const subjectDataInventory = {
  subject_profiles: { export: true, reason: "Account record, including whether it is closed" },
  security_profiles: { export: true, reason: "Security controls" },
  address_book_entries: { export: true, reason: "Security control the customer manages in Settings" },
  provider_customer_links: { export: true, reason: "Needed to recover provider records" },
  aura_tags: { export: true, reason: "Public payment tag; closing the account unpublishes it" },
  user_preferences: { export: true, reason: "Notification choices" },
  onboarding_progress: { export: true, reason: "Guide progress; recreated on next sign-in" },
  product_events: { export: true, reason: "Product analytics" },
  customer_feedback: { export: true, reason: "Voluntary feedback" },
  support_cases: { export: true, reason: "Complaint and support evidence" },
  consent_events: { export: true, reason: "Proof of consent and withdrawal" },
  consent_evidence: { export: true, reason: "Proof of accepted terms and disclosures" },
  audit_events: { export: true, reason: "Security and financial audit trail" },
  actions: { export: true, reason: "Financial transaction evidence" },
  notifications: { export: true, reason: "Notices Aura sent you, and whether they were emailed or pushed" },
  push_subscriptions: { export: true, reason: "Browsers you turned on notifications in" },
  incoming_watches: { export: false, reason: "Internal: when Aura last checked your account for money received" },
  step_up_challenges: { export: false, reason: "Short-lived passkey confirmations; the change itself is in the audit trail" },
  route_quotes: { export: false, reason: "Short-lived route quotes; used quotes are summarized on their action" },
  card_account_projections: { export: true, reason: "Rebuildable issuer projection" },
  bank_beneficiary_projections: { export: true, reason: "Rebuildable provider projection" },
  membership_projections: { export: true, reason: "Rebuildable qualification result" },
  benefit_entitlements: { export: true, reason: "Rebuildable provider projection" },
  wallet_policies: { export: true, reason: "Rebuildable wallet-provider projection" },
  command_idempotency: { export: false, reason: "Short-lived retry protection" },
  webhook_receipts: { export: false, reason: "Provider event replay protection" },
  operational_issues: { export: false, reason: "Internal reconciliation exception" }
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
  const section = (rows: unknown[], reason: string) => ({ rows: rows.slice(0, rowLimit), truncated: rows.length > rowLimit, reason });
  return {
    ...Object.fromEntries(exported.map((table, index) => [table, section(results[index].results, subjectDataInventory[table].reason)])),
    action_events: section(results[exported.length].results, "Status history of financial transactions, kept with the actions")
  };
}
