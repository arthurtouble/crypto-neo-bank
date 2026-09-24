import { env } from "cloudflare:workers";
import { getAddress, isAddress, parseUnits } from "viem";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { AAVE_BASE_ASSETS } from "@/lib/defi/aave";
import { buildAaveBaseCall } from "@/lib/defi/aave-call-policy";

const schema = z.strictObject({
  action: z.enum(["supply", "withdraw", "borrow", "repay"]),
  sender: z.string().refine(isAddress),
  symbol: z.enum(["USDC", "WETH"]),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/).max(40)
});
const headers = { "Cache-Control": "no-store" };
const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers });

/** Privy wallet signs these exact calls. Aave and the chain decide their result. */
export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "aave_action", subject: subject.subjectReference, limit: 20, windowSeconds: 60 });
    const input = schema.parse(await request.json());
    const wallet = await requireLinkedEvmWallet(subject.subjectReference, input.sender);
    if (wallet.toLowerCase() !== input.sender.toLowerCase()) return reply({ error: "wallet_not_linked", traceId }, 403);
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const profile = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?")
      .bind(subject.subjectReference).first<{ account_locked: number }>();
    if (!profile || profile.account_locked) return reply({ error: "account_locked", traceId }, 403);
    const decimals = input.symbol === "USDC" ? 6 : 18;
    if ((input.amount.split(".")[1]?.length ?? 0) > decimals) return reply({ error: "invalid_amount", traceId }, 400);
    const amountRaw = parseUnits(input.amount, decimals);
    if (amountRaw <= 0n) return reply({ error: "invalid_amount", traceId }, 400);
    const asset = AAVE_BASE_ASSETS[input.symbol];
    const identity = { wallet: getAddress(wallet), asset, amountRaw };
    return reply({
      action: input.action, symbol: input.symbol, amount: input.amount, amountRaw: amountRaw.toString(),
      chainId: 8453, assetAddress: asset,
      approvalCall: input.action === "supply" || input.action === "repay"
        ? buildAaveBaseCall({ action: "approve", ...identity }) : null,
      poolCall: buildAaveBaseCall({ action: input.action, ...identity }),
      executionAvailable: true, traceId
    }, 200);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", traceId }, 401);
    if (error instanceof BetaAccessError) return reply({ error: error.code, traceId }, 403);
    if (error instanceof RateLimitError) return reply({ error: "rate_limited", traceId }, 429);
    if (error instanceof WalletOwnershipError) return reply({ error: "wallet_not_linked", traceId }, 403);
    if (error instanceof z.ZodError) return reply({ error: "invalid_action", traceId }, 400);
    console.error(JSON.stringify({ level: "warn", event: "aave.action.unavailable", traceId,
      message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "action_unavailable", traceId }, 503);
  }
}
