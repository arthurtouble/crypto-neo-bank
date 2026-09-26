import { env } from "cloudflare:workers";
import { base } from "viem/chains";
import { z } from "zod";
import { LifiStatusError, readLifiTransferStatus } from "@/lib/actions/lifi-status";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  chainId: z.coerce.number().int().positive(),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  tool: z.string().regex(/^[\w-]{1,80}$/)
});

/**
 * Progress of a bridged deposit, as LI.FI reports it. This is only progress:
 * the Aura balance comes from Base itself.
 */
export const GET = route("deposits.status", { invalid: "invalid_deposit_status", unavailable: "deposit_status_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "deposit_status", subject: subject.subjectReference, limit: 120, windowSeconds: 3600 });
  const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  try {
    const status = await readLifiTransferStatus({ sourceHash: input.hash, sourceChainId: input.chainId, destinationChainId: base.id, toolId: input.tool });
    return Response.json({ status: status.status, destinationHash: status.destinationHash, traceId });
  } catch (error) {
    if (error instanceof LifiStatusError) return Response.json({ status: "UNKNOWN", destinationHash: null, traceId });
    throw error;
  }
});
