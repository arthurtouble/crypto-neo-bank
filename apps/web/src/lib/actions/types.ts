import { isAddress, isHex } from "viem";
import { z } from "zod";
import { sha256Hex } from "@/lib/platform/encoding";

const address = z.string().refine(isAddress, "Invalid address.").transform((value) => value.toLowerCase() as `0x${string}`);
const rawAmount = z.string().regex(/^[1-9]\d{0,77}$/, "Invalid amount.");
/** Zero or more. Only an approval may be zero: approving 0 turns the spender's allowance off. */
const approvalAmount = z.string().regex(/^(0|[1-9]\d{0,77})$/, "Invalid amount.");

/** One call the smart wallet executes. The wallet batches every call of an action into one operation. */
export const callSchema = z.strictObject({
  to: address,
  value: z.string().regex(/^(0|[1-9]\d{0,77})$/),
  data: z.string().refine((value) => isHex(value, { strict: true }) && value.length % 2 === 0, "Invalid calldata.")
    .transform((value) => value.toLowerCase() as `0x${string}`)
});
export type Call = z.infer<typeof callSchema>;

/** What must be observable in the operation's logs, or at the destination, for an action to be confirmed. */
export const effectSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("erc20_transfer"), token: address, to: address, amountRaw: rawAmount }),
  z.strictObject({ type: z.literal("aave_supply"), asset: address, amountRaw: rawAmount }),
  z.strictObject({ type: z.literal("aave_withdraw"), asset: address, amountRaw: rawAmount }),
  // Withdraw all: at least the balance read before signing, since interest keeps adding to it.
  z.strictObject({ type: z.literal("aave_withdraw_all"), asset: address, minimumRaw: rawAmount }),
  // Morpho ERC-4626 vaults: an exact deposit, an exact withdrawal, or a redemption of every share.
  z.strictObject({ type: z.literal("morpho_deposit"), vault: address, assetsRaw: rawAmount }),
  z.strictObject({ type: z.literal("morpho_withdraw"), vault: address, assetsRaw: rawAmount }),
  z.strictObject({ type: z.literal("morpho_redeem"), vault: address, sharesRaw: rawAmount }),
  z.strictObject({ type: z.literal("erc20_debit"), token: address, amountRaw: rawAmount }),
  // An ERC-20 approval from the account, for exactly this spender and amount (the card spending allowance; "0" turns it off).
  z.strictObject({ type: z.literal("erc20_approval"), token: address, spender: address, amountRaw: approvalAmount }),
  z.strictObject({ type: z.literal("erc20_credit_min"), token: address, to: address, minimumRaw: rawAmount }),
  // At least this much native ETH reaching the recipient in the operation's block (a same-chain route paying out ETH; see native-credit.ts).
  z.strictObject({ type: z.literal("native_credit_min"), to: address, minimumRaw: rawAmount }),
  z.strictObject({ type: z.literal("delivery"), tool: z.string().min(1).max(80), destinationChainId: z.number().int().positive(),
    token: address.nullable(), to: address, minimumRaw: rawAmount })
]);
export type Effect = z.infer<typeof effectSchema>;

export type ActionKind = "transfer" | "earn" | "route";

/** What a builder hands to the pipeline. */
export type BuiltAction = {
  kind: ActionKind;
  chainId: number;
  calls: Call[];
  effects: Effect[];
  /** Customer-facing review: assets, amounts, counterparty, provider. Stored verbatim. */
  summary: Record<string, unknown>;
  /** Outgoing value counts toward the daily limit; moves between the customer's own positions do not. */
  countsTowardLimit: boolean;
  /** Source asset and amount to value for limits. */
  valuation: { assetId: string; amountRaw: string; decimals: number; quotedUsd?: string | null };
  /** For transfers: the recipient checked against saved-recipient rules. */
  recipient?: `0x${string}`;
  routeQuoteId?: string;
  destinationChainId?: number;
};

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export async function callsFingerprint(chainId: number, calls: readonly Call[]): Promise<`0x${string}`> {
  return `0x${await sha256Hex(JSON.stringify([chainId, calls.map((call) => [call.to, call.value, call.data])]))}`;
}
