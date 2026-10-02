import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { depositDestination, depositSource } from "@/lib/deposits/networks";
import { DepositSourceError, readBridgeSource, recordWalletDeposit } from "@/lib/deposits/tracking";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  chainId: z.number().int().positive(),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  tool: z.string().regex(/^[\w-]{1,80}$/),
  symbol: z.string().min(1).max(32),
  expectedAmountRaw: z.string().regex(/^\d{1,78}$/)
}).strict();

/**
 * Keep a deposit the customer just bridged from their connected wallet, so
 * Transactions shows it while it's on its way. Only a landed transaction to
 * the LI.FI Diamond, sent from a wallet Privy shows is the customer's, is
 * kept. Nothing here moves money or says it arrived; Base does.
 */
export const POST = route("deposits.record", { invalid: "invalid_deposit", unavailable: "deposit_record_unavailable",
  onError: (error, context) => error instanceof DepositSourceError ? errorResponse(error.code === "source_not_found" ? 404 : 422, error.code, context) : undefined },
async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "deposit_record", subject: subject.subjectReference, limit: 30, windowSeconds: 3600 });
  const input = schema.parse(await readJsonBody(request));
  const source = depositSource(input.chainId, input.symbol);
  const destination = depositDestination(input.symbol);
  if (!source || !destination || source.chainId === destination.chainId) throw new DepositSourceError("source_mismatch");
  const from = await requireLinkedEvmWallet(subject.subjectReference, await readBridgeSource(input.chainId, input.hash));
  const kept = await recordWalletDeposit(env.PROJECTION_DB, subject.subjectReference, { sourceHash: input.hash, sourceChainId: input.chainId,
    fromAddress: from, tool: input.tool, symbol: destination.symbol, decimals: destination.decimals, expectedAmountRaw: input.expectedAmountRaw });
  if (!kept) throw new DepositSourceError("source_mismatch");
  return Response.json({ recorded: true, traceId }, { status: 201 });
});
