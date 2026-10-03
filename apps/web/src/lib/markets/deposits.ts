import { parseUnits } from "viem";
import type { BuiltAction } from "@/lib/actions/types";
import { ActionInputError } from "@/lib/actions/transfer";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import { requireSwapBalance } from "@/lib/swap/balance";
import { HYPERCORE_CHAIN_ID, HYPERLIQUID_MINIMUM_DEPOSIT_RAW, HYPERLIQUID_USDC } from "./funding";
import { cctpDepositCalls, cctpDepositFee } from "./hyperliquid/cctp";

export const BASE_USDC_ID = `${BASE_CHAIN_ID}:${BASE_USDC}`;

/**
 * Move Base USDC from the account into the same wallet's Hyperliquid perps
 * balance with Circle's CCTP: a fast burn on Base whose hook tells Circle's
 * forwarder to credit HyperCore, in seconds. The customer signs it like any
 * route; it settles when Circle's message names their account and
 * Hyperliquid's ledger shows the credit. Circle's fee comes out of the amount;
 * Aura takes none.
 */
export async function buildPerpsDeposit(owner: `0x${string}`, amount: string,
  dependencies: { fee?: typeof cctpDepositFee; balance?: typeof requireSwapBalance } = {}): Promise<BuiltAction> {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new ActionInputError("invalid_amount", "Enter an amount with up to 6 decimal places.");
  const raw = parseUnits(amount, 6);
  if (raw < HYPERLIQUID_MINIMUM_DEPOSIT_RAW + 1_000_000n) throw new ActionInputError("amount_too_small", "Add at least 6 USDC.");
  await (dependencies.balance ?? requireSwapBalance)({ chainId: BASE_CHAIN_ID, address: BASE_USDC, symbol: "USDC", decimals: 6 }, owner, raw);
  const fee = await (dependencies.fee ?? cctpDepositFee)(raw.toString());
  if (BigInt(fee.minimumCreditRaw) < HYPERLIQUID_MINIMUM_DEPOSIT_RAW) throw new ActionInputError("amount_too_small", "Add a bit more: Hyperliquid needs at least 5 USDC to arrive.");
  const calls = cctpDepositCalls({ owner, amountRaw: raw.toString(), maxFeeRaw: fee.maxFeeRaw })
    .map((call) => ({ to: call.to.toLowerCase() as `0x${string}`, value: call.value, data: call.data }));
  return {
    kind: "route", chainId: BASE_CHAIN_ID, calls,
    effects: [{ type: "erc20_debit", token: BASE_USDC, amountRaw: raw.toString() },
      { type: "delivery", tool: "cctp", destinationChainId: HYPERCORE_CHAIN_ID, token: HYPERLIQUID_USDC.address as `0x${string}`, to: owner,
        minimumRaw: fee.minimumCreditRaw }],
    summary: { from: { id: BASE_USDC_ID, symbol: "USDC", decimals: 6 }, to: { id: HYPERLIQUID_USDC.id, symbol: "USDC", decimals: 6 },
      fromAmountRaw: raw.toString(), toAmountRaw: (raw - BigInt(fee.protocolFeeRaw) - BigInt(fee.forwardFeeRaw)).toString(),
      toAmountMinRaw: fee.minimumCreditRaw, tool: "cctp", recipient: owner, external: false, market: "hyperliquid",
      providerFeeRaw: (BigInt(fee.protocolFeeRaw) + BigInt(fee.forwardFeeRaw)).toString() },
    countsTowardLimit: false,
    valuation: { assetId: BASE_USDC_ID, amountRaw: raw.toString(), decimals: 6 },
    destinationChainId: HYPERCORE_CHAIN_ID
  };
}
