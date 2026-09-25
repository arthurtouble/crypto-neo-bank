import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import type { Payout } from "@/lib/providers/bridge/payouts";
import type { BuiltAction } from "./types";

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/**
 * The transfer that funds a Bridge bank payout: exactly the USDC amount Bridge
 * asked for, to the Base address Bridge returned. Saved-address rules do not
 * apply to that address; the bank account is what the customer saved.
 */
export function buildPayoutFunding(payout: Payout, bank: { id: string; displayName: string; lastFour: string | null }): BuiltAction {
  const amountRaw = parseUnits(payout.amount, 6);
  return {
    kind: "transfer", chainId: 8453,
    calls: [{ to: BASE_USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payout.depositAddress, amountRaw] }) }],
    effects: [{ type: "erc20_transfer", token: BASE_USDC, to: payout.depositAddress, amountRaw: amountRaw.toString() }],
    summary: { assetId: `8453:${BASE_USDC}`, symbol: "USDC", decimals: 6, amount: payout.amount, amountRaw: amountRaw.toString(),
      to: payout.depositAddress, bankPayout: { provider: "bridge", transferId: payout.transferId, bankAccountId: bank.id,
        bankName: bank.displayName, lastFour: bank.lastFour } },
    countsTowardLimit: true,
    valuation: { assetId: `8453:${BASE_USDC}`, amountRaw: amountRaw.toString(), decimals: 6 }
  };
}
