import { requireUnlocked } from "@/lib/actions/controls";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireMoneyAccount, type ActionAccount } from "@/lib/auth/wallet";
import { requireFeature, type FeatureKey } from "@/lib/features/flags";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const VENUE_FEATURE = { hyperliquid: "perps", polymarket: "predictions" } as const satisfies Record<string, FeatureKey>;

/**
 * The checks every market request that acts for the customer passes, in
 * order: signed in, rate limit, the venue's switch, a passkey and the
 * account's wallet, and an unlocked account. Reads use `marketReader`.
 */
export async function marketActor(db: D1Database, request: Request, feature: FeatureKey, limit = 30): Promise<{ subject: string; account: ActionAccount }> {
  const { subjectReference: subject } = await requireVerifiedSubject(request);
  await enforceRateLimit(db, { namespace: `markets_${feature}`, subject, limit, windowSeconds: 60 });
  await requireFeature(db, feature);
  const account = await requireMoneyAccount(subject);
  await ensureSubjectProfile(db, subject);
  await requireUnlocked(db, subject);
  return { subject, account };
}

/** Signed in, rate limited, and the venue's switch on: enough to read the customer's own venue account. */
export async function marketReader(db: D1Database, request: Request, feature: FeatureKey): Promise<{ subject: string }> {
  const { subjectReference: subject } = await requireVerifiedSubject(request);
  await enforceRateLimit(db, { namespace: `markets_${feature}_read`, subject, limit: 120, windowSeconds: 60 });
  await requireFeature(db, feature);
  return { subject };
}
