import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import type { BuiltAction } from "./types";

/**
 * The card's spending allowance: an ERC-20 approval letting Bridge's card
 * contract pull up to this much USDC from the account, as purchases are
 * authorized. Setting it replaces the previous allowance. The money stays in
 * the account until a purchase.
 */
export function buildCardAllowance(spender: `0x${string}`, amountUsd: string): BuiltAction {
  const amountRaw = parseUnits(amountUsd, 6);
  return {
    kind: "transfer", chainId: BASE_CHAIN_ID,
    calls: [{ to: BASE_USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amountRaw] }) }],
    effects: [{ type: "erc20_approval", token: BASE_USDC, spender, amountRaw: amountRaw.toString() }],
    summary: { assetId: `${BASE_CHAIN_ID}:${BASE_USDC}`, symbol: "USDC", decimals: 6, amount: amountUsd, amountRaw: amountRaw.toString(), cardAllowance: { spender } },
    // Nothing leaves the account now; each purchase is limited by the card's own daily limit.
    countsTowardLimit: false,
    valuation: { assetId: `${BASE_CHAIN_ID}:${BASE_USDC}`, amountRaw: amountRaw.toString(), decimals: 6 }
  };
}
