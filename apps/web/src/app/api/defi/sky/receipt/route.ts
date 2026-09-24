import { getAddress, isAddress, parseUnits } from "viem";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { buildSkyCall } from "@/lib/defi/sky-call-policy";
import { observeTransaction } from "@/lib/transactions/chain-observation";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { verifyExpectedEffect } from "@/lib/transactions/effects";

const schema = z.strictObject({ action: z.enum(["deposit", "withdraw"]), sender: z.string().refine(isAddress),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/).max(40), hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) });
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers });

/** Only the matching finalized wrapper call and token/vault events confirm a Sky action. */
export async function POST(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const input = schema.parse(await request.json());
    const wallet = await requireLinkedEvmWallet(subject.subjectReference, input.sender);
    if (wallet.toLowerCase() !== input.sender.toLowerCase()) return reply({ error: "wallet_not_linked" }, 403);
    if ((input.amount.split(".")[1]?.length ?? 0) > 6) return reply({ error: "invalid_amount" }, 400);
    const amountRaw = parseUnits(input.amount, 6);
    if (amountRaw <= 0n) return reply({ error: "invalid_amount" }, 400);
    const call = await normalizePreparedCall(buildSkyCall({ action: input.action, wallet: getAddress(wallet), amountRaw }));
    const observed = await observeTransaction(1, input.hash);
    const effect = await verifyExpectedEffect({ chainId: 1, walletAddress: wallet,
      targetAddress: call.to, nativeValue: call.value, calldataHash: call.dataHash,
      semanticAction: input.action === "deposit" ? "sky_deposit" : "sky_withdraw",
      expectedEffect: { type: input.action === "deposit" ? "sky_deposit" : "sky_withdraw", amountRaw: amountRaw.toString() },
      reportedHash: input.hash, observedBlockHash: null }, observed);
    return reply({ status: effect.status, reason: "reason" in effect ? effect.reason : undefined,
      hash: input.hash, chainId: 1 }, effect.status === "pending" ? 202 : 200);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized" }, 401);
    if (error instanceof WalletOwnershipError) return reply({ error: "wallet_not_linked" }, 403);
    if (error instanceof z.ZodError) return reply({ error: "invalid_receipt_request" }, 400);
    console.error(JSON.stringify({ level: "warn", event: "sky.receipt.unavailable",
      message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "receipt_unavailable" }, 503);
  }
}
