import { getAddress, isAddress, parseUnits } from "viem";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { AAVE_BASE_ASSETS } from "@/lib/defi/aave";
import { buildAaveBaseCall } from "@/lib/defi/aave-call-policy";
import { observeTransaction } from "@/lib/transactions/chain-observation";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { verifyExpectedEffect } from "@/lib/transactions/effects";
import { route } from "@/lib/http/route";

const schema = z.strictObject({
  action: z.enum(["supply", "withdraw", "borrow", "repay"]),
  sender: z.string().refine(isAddress), symbol: z.enum(["USDC", "WETH"]),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/).max(40),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
});
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers });

/** The chain receipt and governed Pool event, not a browser report, determine status. */
export const POST = route("defi.aave.receipt", { unavailable: "receipt_unavailable", invalid: "invalid_receipt_request" }, async (request: Request) => {
  const subject = await requireVerifiedSubject(request);
  const input = schema.parse(await request.json());
  const wallet = await requireLinkedEvmWallet(subject.subjectReference, input.sender);
  if (wallet.toLowerCase() !== input.sender.toLowerCase()) return reply({ error: "wallet_not_linked" }, 403);
  const decimals = input.symbol === "USDC" ? 6 : 18;
  if ((input.amount.split(".")[1]?.length ?? 0) > decimals) return reply({ error: "invalid_amount" }, 400);
  const amountRaw = parseUnits(input.amount, decimals);
  if (amountRaw <= 0n) return reply({ error: "invalid_amount" }, 400);
  const asset = AAVE_BASE_ASSETS[input.symbol];
  const call = await normalizePreparedCall(buildAaveBaseCall({
    action: input.action, wallet: getAddress(wallet), asset, amountRaw
  }));
  const observed = await observeTransaction(8453, input.hash);
  const effect = await verifyExpectedEffect({
    chainId: 8453, walletAddress: wallet, targetAddress: call.to, nativeValue: call.value,
    calldataHash: call.dataHash, semanticAction: input.action === "supply" ? "earn_supply"
      : input.action === "withdraw" ? "earn_withdraw" : input.action,
    expectedEffect: { type: input.action === "supply" ? "earn_supply"
      : input.action === "withdraw" ? "earn_withdraw" : input.action,
      asset, amountRaw: amountRaw.toString() },
    reportedHash: input.hash, observedBlockHash: null
  }, observed);
  return reply({ status: effect.status, reason: "reason" in effect ? effect.reason : undefined,
    hash: input.hash, chainId: 8453 }, effect.status === "pending" ? 202 : 200);
});
