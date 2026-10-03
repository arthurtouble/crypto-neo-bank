import type { Venue } from "./types";

/**
 * How a customer's wallet is connected to a venue, and what Aura sent there
 * for them. Neither is a balance: positions and money are read from the venue.
 */
export type MarketAccount = {
  venue: Venue;
  ownerAddress: `0x${string}`;
  tradingWalletId: string | null;
  tradingWalletAddress: `0x${string}` | null;
  venueWalletAddress: `0x${string}` | null;
  credentialsCiphertext: string | null;
  status: "pending" | "ready";
  approvedAt: string | null;
};

type AccountRow = { venue: Venue; owner_address: string; trading_wallet_id: string | null; trading_wallet_address: string | null;
  venue_wallet_address: string | null; credentials_ciphertext: string | null; status: "pending" | "ready"; approved_at: string | null };

const toAccount = (row: AccountRow): MarketAccount => ({
  venue: row.venue, ownerAddress: row.owner_address as `0x${string}`, tradingWalletId: row.trading_wallet_id,
  tradingWalletAddress: row.trading_wallet_address as `0x${string}` | null, venueWalletAddress: row.venue_wallet_address as `0x${string}` | null,
  credentialsCiphertext: row.credentials_ciphertext, status: row.status, approvedAt: row.approved_at
});

/**
 * The customer's connection to `venue`, for the wallet they use now. A row for another owner (an account that moved
 * to a new wallet) doesn't count: that venue account belongs to the old wallet.
 */
export async function readMarketAccount(db: D1Database, subject: string, venue: Venue, owner: string): Promise<MarketAccount | null> {
  const row = await db.prepare(`SELECT venue, owner_address, trading_wallet_id, trading_wallet_address, venue_wallet_address, credentials_ciphertext,
      status, approved_at FROM market_accounts WHERE subject_reference = ? AND venue = ?`).bind(subject, venue).first<AccountRow>();
  return row && row.owner_address === owner.toLowerCase() ? toAccount(row) : null;
}

/** Record a connection waiting for the customer's approval, replacing one for another wallet. */
export async function savePendingAccount(db: D1Database, subject: string, input: { venue: Venue; owner: string; tradingWalletId?: string | null;
  tradingWalletAddress?: string | null; venueWalletAddress?: string | null }, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await db.prepare(`INSERT INTO market_accounts (subject_reference, venue, owner_address, trading_wallet_id, trading_wallet_address, venue_wallet_address,
      status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT (subject_reference, venue) DO UPDATE SET owner_address = excluded.owner_address, trading_wallet_id = excluded.trading_wallet_id,
      trading_wallet_address = excluded.trading_wallet_address, venue_wallet_address = excluded.venue_wallet_address,
      credentials_ciphertext = NULL, status = 'pending', approved_at = NULL, updated_at = excluded.updated_at`)
    .bind(subject, input.venue, input.owner.toLowerCase(), input.tradingWalletId ?? null, input.tradingWalletAddress?.toLowerCase() ?? null,
      input.venueWalletAddress?.toLowerCase() ?? null, at, at).run();
}

/** Mark the connection ready once the venue accepted the customer's approval. */
export async function markAccountReady(db: D1Database, subject: string, venue: Venue, owner: string,
  update: { credentialsCiphertext?: string | null; venueWalletAddress?: string | null } = {}, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await db.prepare(`UPDATE market_accounts SET status = 'ready', approved_at = ?, updated_at = ?,
      credentials_ciphertext = COALESCE(?, credentials_ciphertext), venue_wallet_address = COALESCE(?, venue_wallet_address)
    WHERE subject_reference = ? AND venue = ? AND owner_address = ?`)
    .bind(at, at, update.credentialsCiphertext ?? null, update.venueWalletAddress?.toLowerCase() ?? null, subject, venue, owner.toLowerCase()).run();
}

export type MarketOperationKind = "setup" | "order" | "cancel" | "leverage" | "withdraw" | "redeem";
export type MarketOperationStatus = "submitted" | "accepted" | "rejected" | "failed";

/** Keep what Aura sent to a venue and the venue's answer, as evidence of the request. */
export async function recordOperation(db: D1Database, subject: string, input: { venue: Venue; kind: MarketOperationKind; summary: Record<string, unknown>;
  externalId?: string | null; status: MarketOperationStatus; reason?: string | null }, now = new Date()): Promise<string> {
  const id = crypto.randomUUID();
  const at = now.toISOString();
  await db.prepare(`INSERT INTO market_operations (operation_id, subject_reference, venue, kind, summary_json, external_id, status, status_reason, source,
      created_at, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, subject, input.venue, input.kind, JSON.stringify(input.summary), input.externalId ?? null, input.status, input.reason ?? null,
      input.venue === "hyperliquid" ? "Hyperliquid exchange API" : "Polymarket API", at, at).run();
  return id;
}

export type MarketOperation = { id: string; venue: Venue; kind: MarketOperationKind; summary: Record<string, unknown>; externalId: string | null;
  status: MarketOperationStatus; reason: string | null; source: string; createdAt: string; observedAt: string };

/** The customer's latest operations at a venue, newest first. */
export async function listOperations(db: D1Database, subject: string, venue: Venue, limit = 50): Promise<MarketOperation[]> {
  const { results } = await db.prepare(`SELECT operation_id, venue, kind, summary_json, external_id, status, status_reason, source, created_at, observed_at
    FROM market_operations WHERE subject_reference = ? AND venue = ? ORDER BY created_at DESC LIMIT ?`).bind(subject, venue, limit)
    .all<{ operation_id: string; venue: Venue; kind: MarketOperationKind; summary_json: string; external_id: string | null; status: MarketOperationStatus;
      status_reason: string | null; source: string; created_at: string; observed_at: string }>();
  return results.map((row) => ({ id: row.operation_id, venue: row.venue, kind: row.kind, summary: JSON.parse(row.summary_json) as Record<string, unknown>,
    externalId: row.external_id, status: row.status, reason: row.status_reason, source: row.source, createdAt: row.created_at, observedAt: row.observed_at }));
}
