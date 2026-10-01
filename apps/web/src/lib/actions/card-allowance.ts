import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import type { BuiltAction } from "./types";

/**
 * The card's spending allowance: an ERC-20 approval letting Bridge's card
 * contract pull up to this much USDC from the account, as purchases are
 * authorized. Setting it replaces the previous allowance. The money stays in
 * the account until a purchase. An amount of 0 is `approve(spender, 0)`:
 * card spending off, verified like any other approval.
 */
export function buildCardAllowance(spender: `0x${string}`, amountUsd: string): BuiltAction {
  const amountRaw = parseUnits(amountUsd, 6);
  const off = amountRaw === 0n;
  const amount = off ? "0" : amountUsd;
  return {
    kind: "transfer", chainId: BASE_CHAIN_ID,
    calls: [{ to: BASE_USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amountRaw] }) }],
    effects: [{ type: "erc20_approval", token: BASE_USDC, spender, amountRaw: amountRaw.toString() }],
    summary: { assetId: `${BASE_CHAIN_ID}:${BASE_USDC}`, symbol: "USDC", decimals: 6, amount, amountRaw: amountRaw.toString(), cardAllowance: off ? { spender, off: true } : { spender } },
    // Nothing leaves the account now; each purchase is limited by the card's own daily limit. Turning spending off is valued at 0.
    countsTowardLimit: false,
    valuation: { assetId: `${BASE_CHAIN_ID}:${BASE_USDC}`, amountRaw: amountRaw.toString(), decimals: 6 }
  };
}
