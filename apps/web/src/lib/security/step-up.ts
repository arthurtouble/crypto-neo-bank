import { PRIVY_APP_ID } from "@/config/client";
import { personalSignRequest, relayPersonalSign, type AuthorizationRequest, type PersonalSignBody } from "@/lib/actions/privy-relay";
import { privyClient } from "@/lib/auth/privy";
import type { ActionAccount } from "@/lib/auth/wallet";
import { HttpError } from "@/lib/http/errors";

/**
 * A fresh passkey check for a sensitive change, verified on the server.
 *
 * Aura asks for the change, gets back a one-time challenge, and the customer
 * signs Privy's request to sign that challenge with their wallet. Privy only
 * signs for a valid authorization signature, and the customer's passkey
 * unlocks their authorization key, so Privy's answer proves the passkey was
 * used moments ago for exactly this change. A session token alone can't.
 */
export type StepUpPurpose = "security_policy";
export type StepUpChallenge = { challengeId: string; request: AuthorizationRequest<PersonalSignBody> };
export type Confirmation = { challengeId: string; signature: string };

const TTL_MS = 5 * 60_000;

async function hash(payload: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const requestFor = (account: ActionAccount, challengeId: string, message: string, expiresAt: Date) =>
  personalSignRequest({ appId: PRIVY_APP_ID, walletId: account.walletId, message, idempotencyKey: `aura-step-up-${challengeId}`, expiresAt });

/** Start a confirmation for `payload`, described to the customer by `summary`. */
export async function createStepUp(db: D1Database, subject: string, account: ActionAccount, purpose: StepUpPurpose, payload: unknown,
  summary: string, now = new Date()): Promise<StepUpChallenge> {
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const message = `Aura: ${summary}\nReference: ${challengeId}\nExpires: ${expiresAt.toISOString()}`;
  await db.prepare(`INSERT INTO step_up_challenges (challenge_id, subject_reference, purpose, payload_hash, message, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(challengeId, subject, purpose, await hash(payload), message, now.toISOString(), expiresAt.toISOString()).run();
  return { challengeId, request: requestFor(account, challengeId, message, expiresAt) };
}

type ChallengeRow = { purpose: string; payload_hash: string; message: string; expires_at: string; used_at: string | null };

/**
 * Check a confirmation for exactly this change and use it up. Throws when it
 * is unknown, for another change, expired, already used, or refused by Privy.
 */
export async function completeStepUp(db: D1Database, subject: string, account: ActionAccount, purpose: StepUpPurpose, payload: unknown,
  confirmation: Confirmation, now = new Date(), sign: typeof relayPersonalSign = relayPersonalSign): Promise<void> {
  const row = await db.prepare(`SELECT purpose, payload_hash, message, expires_at, used_at FROM step_up_challenges
    WHERE challenge_id = ? AND subject_reference = ?`).bind(confirmation.challengeId, subject).first<ChallengeRow>();
  const expired = new HttpError(409, "confirmation_expired", "This confirmation expired. Try the change again.");
  if (!row || row.purpose !== purpose || row.payload_hash !== await hash(payload)) throw new HttpError(409, "confirmation_mismatch", "This confirmation was for a different change. Try again.");
  if (row.used_at || row.expires_at <= now.toISOString()) throw expired;
  // Claim it first, so two requests can't both apply one confirmation.
  const claimed = await db.prepare("UPDATE step_up_challenges SET used_at = ? WHERE challenge_id = ? AND used_at IS NULL").bind(now.toISOString(), confirmation.challengeId).run();
  if ((claimed.meta.changes ?? 0) !== 1) throw expired;
  try { await sign(privyClient(), account.walletId, requestFor(account, confirmation.challengeId, row.message, new Date(row.expires_at)), confirmation.signature); }
  catch (error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) throw new HttpError(403, "confirmation_rejected", "Your passkey confirmation wasn't accepted. Nothing changed.");
    throw error;
  }
}
