import { parseUnits } from "viem";
import type { BuiltAction } from "@/lib/actions/types";
import { ActionInputError } from "@/lib/actions/transfer";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import { requireSwapBalance } from "@/lib/swap/balance";
import { HYPERCORE_CHAIN_ID, HYPERLIQUID_MINIMUM_DEPOSIT_RAW, HYPERLIQUID_USDC } from "./funding";
import { cctpDepositCalls, cctpDepositFee } from "./hyperliquid/cctp";
import { quoteRelayPerpsDeposit } from "./relay";

export const BASE_USDC_ID = `${BASE_CHAIN_ID}:${BASE_USDC}`;

/**
 * Move Base USDC from the account into the same wallet's Hyperliquid perps
 * balance. Relay goes first: its solver pays into the perps balance in about a
 * second for a few cents, and Relay refunds on Base if it can't. If Relay can't
 * quote, Circle's CCTP does it: a fast burn on Base whose hook tells Circle's
 * forwarder to credit HyperCore, in seconds, for about 25 cents. Either way the
 * customer signs it like any route and it settles when Hyperliquid's ledger
 * shows the credit. Aura takes no fee.
 */
export async function buildPerpsDeposit(owner: `0x${string}`, amount: string,
  dependencies: { fee?: typeof cctpDepositFee; balance?: typeof requireSwapBalance; relay?: typeof quoteRelayPerpsDeposit } = {}): Promise<BuiltAction> {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new ActionInputError("invalid_amount", "Enter an amount with up to 6 decimal places.");
  const raw = parseUnits(amount, 6);
  if (raw < HYPERLIQUID_MINIMUM_DEPOSIT_RAW + 1_000_000n) throw new ActionInputError("amount_too_small", "Add at least 6 USDC.");
  await (dependencies.balance ?? requireSwapBalance)({ chainId: BASE_CHAIN_ID, address: BASE_USDC, symbol: "USDC", decimals: 6 }, owner, raw);
  const relay = await (dependencies.relay ?? quoteRelayPerpsDeposit)(owner, raw.toString()).catch(() => null);
  if (relay && BigInt(relay.minimumCreditRaw) >= HYPERLIQUID_MINIMUM_DEPOSIT_RAW) {
    return perpsDepositAction(owner, raw, { tool: "relay_direct", calls: relay.calls, creditRaw: relay.creditRaw, minimumCreditRaw: relay.minimumCreditRaw });
  }
  const fee = await (dependencies.fee ?? cctpDepositFee)(raw.toString());
  if (BigInt(fee.minimumCreditRaw) < HYPERLIQUID_MINIMUM_DEPOSIT_RAW) throw new ActionInputError("amount_too_small", "Add a bit more: Hyperliquid needs at least 5 USDC to arrive.");
  const calls = cctpDepositCalls({ owner, amountRaw: raw.toString(), maxFeeRaw: fee.maxFeeRaw })
    .map((call) => ({ to: call.to.toLowerCase() as `0x${string}`, value: call.value, data: call.data }));
  return perpsDepositAction(owner, raw, { tool: "cctp", calls,
    creditRaw: (raw - BigInt(fee.protocolFeeRaw) - BigInt(fee.forwardFeeRaw)).toString(), minimumCreditRaw: fee.minimumCreditRaw });
}

function perpsDepositAction(owner: `0x${string}`, raw: bigint, route: { tool: "relay_direct" | "cctp"; calls: BuiltAction["calls"];
  creditRaw: string; minimumCreditRaw: string }): BuiltAction {
  return {
    kind: "route", chainId: BASE_CHAIN_ID, calls: route.calls,
    effects: [{ type: "erc20_debit", token: BASE_USDC, amountRaw: raw.toString() },
      { type: "delivery", tool: route.tool, destinationChainId: HYPERCORE_CHAIN_ID, token: HYPERLIQUID_USDC.address as `0x${string}`, to: owner,
        minimumRaw: route.minimumCreditRaw }],
    summary: { from: { id: BASE_USDC_ID, symbol: "USDC", decimals: 6 }, to: { id: HYPERLIQUID_USDC.id, symbol: "USDC", decimals: 6 },
      fromAmountRaw: raw.toString(), toAmountRaw: route.creditRaw, toAmountMinRaw: route.minimumCreditRaw, tool: route.tool, recipient: owner,
      external: false, market: "hyperliquid", providerFeeRaw: (raw - BigInt(route.creditRaw)).toString() },
    countsTowardLimit: false,
    valuation: { assetId: BASE_USDC_ID, amountRaw: raw.toString(), decimals: 6 },
    destinationChainId: HYPERCORE_CHAIN_ID
  };
}
