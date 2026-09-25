import { env } from "cloudflare:workers";
import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { previewAaveBaseAction } from "@/lib/defi/aave-preview";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.strictObject({
  action: z.enum(["supply", "withdraw", "borrow", "repay"]),
  sender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  symbol: z.enum(["USDC", "WETH"]),
  amount: z.string().min(1).max(40)
});

export const POST = route("defi.aave.preview", {
  invalid: "invalid_preview", unavailable: "preview_unavailable",
  unavailableStatus: 422, unavailableMessage: "Current Aave risk could not be confirmed. Try again later."
}, async (request: Request) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "aave_preview", subject: subject.subjectReference, limit: 20, windowSeconds: 60 });
  const input = schema.parse(await request.json());
  await requireLinkedEvmWallet(subject.subjectReference, input.sender);
  const client = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com", { retryCount: 0, timeout: 12_000 }) }) as PublicClient;
  return Response.json(await previewAaveBaseAction(client, input));
});
