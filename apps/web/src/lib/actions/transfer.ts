import { encodeFunctionData, erc20Abi, isAddress, parseUnits } from "viem";
import { z } from "zod";
import { requireAsset } from "@/lib/assets/pauses";
import { ASSETS } from "@/lib/assets/registry";
import { HttpError } from "@/lib/http/errors";
import type { BuiltAction } from "./types";

export const transferInputSchema = z.strictObject({
  kind: z.literal("transfer"),
  assetId: z.string().max(80),
  amount: z.string().regex(/^\d+(\.\d+)?$/).max(40),
  to: z.string().refine(isAddress, "Invalid recipient.").refine((value) => !/^0x0{40}$/i.test(value), "Invalid recipient.")
});
export type TransferInput = z.infer<typeof transferInputSchema>;

/** A request Aura can't turn into an action, with a message the customer can act on. */
export class ActionInputError extends HttpError {
  constructor(code: string, message: string) { super(422, code, message); this.name = "ActionInputError"; }
}

export function rawAmount(amount: string, decimals: number): bigint {
  if ((amount.split(".")[1]?.length ?? 0) > decimals) throw new ActionInputError("invalid_amount", `Use at most ${decimals} decimal places.`);
  const raw = parseUnits(amount, decimals);
  if (raw <= 0n) throw new ActionInputError("invalid_amount", "Enter an amount greater than zero.");
  return raw;
}

/** Send a registered asset on Base from the customer's account to an address. */
export async function buildTransfer(db: D1Database, input: TransferInput, wallet: string): Promise<BuiltAction> {
  const asset = await requireAsset(db, input.assetId, "send");
  if (asset.chainId !== 8453) throw new ActionInputError("unsupported_asset", "Sending is available for assets on Base.");
  const to = input.to.toLowerCase() as `0x${string}`;
  if (to === wallet.toLowerCase()) throw new ActionInputError("invalid_recipient", "This is your own address.");
  // A token's own contract can't use what it receives; sending there loses the funds.
  if (ASSETS.some((item) => item.address === to)) throw new ActionInputError("invalid_recipient", "That's a token contract, not a wallet. Check the address.");
  const amountRaw = rawAmount(input.amount, asset.decimals);
  const valuation = { assetId: asset.id, amountRaw: amountRaw.toString(), decimals: asset.decimals };
  const summary = { assetId: asset.id, symbol: asset.symbol, decimals: asset.decimals, amount: input.amount, amountRaw: amountRaw.toString(), to };
  if (asset.address === null) {
    return { kind: "transfer", chainId: 8453, calls: [{ to, value: amountRaw.toString(), data: "0x" }], effects: [],
      summary, countsTowardLimit: true, valuation, recipient: to };
  }
  return {
    kind: "transfer", chainId: 8453,
    calls: [{ to: asset.address, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountRaw] }) }],
    effects: [{ type: "erc20_transfer", token: asset.address, to, amountRaw: amountRaw.toString() }],
    summary, countsTowardLimit: true, valuation, recipient: to
  };
}
