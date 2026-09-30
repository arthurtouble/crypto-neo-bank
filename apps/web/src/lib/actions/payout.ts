import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import type { Payout } from "@/lib/providers/bridge/payouts";
import type { BuiltAction } from "./types";

/**
 * The transfer that funds a Bridge bank payout: exactly the USDC amount Bridge
 * asked for, to the Base address Bridge returned. Saved-address rules do not
 * apply to that address; the bank account is what the customer saved.
 */
export function buildPayoutFunding(payout: Payout, bank: { id: string; displayName: string; lastFour: string | null }): BuiltAction {
  const amountRaw = parseUnits(payout.amount, 6);
  return {
    kind: "transfer", chainId: BASE_CHAIN_ID,
    calls: [{ to: BASE_USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payout.depositAddress, amountRaw] }) }],
    effects: [{ type: "erc20_transfer", token: BASE_USDC, to: payout.depositAddress, amountRaw: amountRaw.toString() }],
    summary: { assetId: `${BASE_CHAIN_ID}:${BASE_USDC}`, symbol: "USDC", decimals: 6, amount: payout.amount, amountRaw: amountRaw.toString(),
      to: payout.depositAddress, bankPayout: { provider: "bridge", transferId: payout.transferId, bankAccountId: bank.id,
        bankName: bank.displayName, lastFour: bank.lastFour } },
    countsTowardLimit: true,
    valuation: { assetId: `${BASE_CHAIN_ID}:${BASE_USDC}`, amountRaw: amountRaw.toString(), decimals: 6 }
  };
}
