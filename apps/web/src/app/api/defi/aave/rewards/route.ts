import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features/flags";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";

const requestSchema = z.object({ sender: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });

export const POST = route("defi.aave.rewards.post", { unavailable: "reward_claim_unavailable", invalid: "invalid_reward_claim" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await requireFeature(env.PROJECTION_DB, "defi_actions");
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "aave_reward_claim", subject: subject.subjectReference, limit: 10, windowSeconds: 60 });
  const input = requestSchema.parse(await request.json());
  await requireLinkedEvmWallet(subject.subjectReference, input.sender);
  // Reward distributors and claim effects are not yet independently governed.
  return Response.json({ error: "execution_unavailable", message: "Reward claims aren't available yet.", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
});
