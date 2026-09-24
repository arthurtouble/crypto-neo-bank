import { parseUnits, type PublicClient } from "viem";
import { AAVE_BASE_ASSETS } from "./aave";
import { assessAaveActionRisk, type AaveRiskAction } from "./aave-risk-gate";
import { readAaveBaseRiskSnapshot } from "./aave-risk-snapshot";

export type AavePreviewRequest = {
  action: AaveRiskAction;
  sender: string;
  symbol: keyof typeof AAVE_BASE_ASSETS;
  amount: string;
};

/** A preview is informational. Execution must repeat these reads at preparation and release. */
export async function previewAaveBaseAction(client: PublicClient, request: AavePreviewRequest, nowMs = Date.now()) {
  const decimals = request.symbol === "USDC" ? 6 : 18;
  if (!/^\d+(?:\.\d+)?$/.test(request.amount) || request.amount.length > 40)
    throw new Error("Enter a valid amount.");
  if ((request.amount.split(".")[1]?.length ?? 0) > decimals)
    throw new Error(`Amount exceeds ${decimals} decimal places.`);
  let amountRaw: bigint;
  try { amountRaw = parseUnits(request.amount, decimals); }
  catch { throw new Error(`Amount exceeds ${decimals} decimal places.`); }
  if (amountRaw <= 0n) throw new Error("Amount must be positive.");
  const input = await readAaveBaseRiskSnapshot(client, {
    action: request.action, amountRaw, user: request.sender, asset: AAVE_BASE_ASSETS[request.symbol],
    nowMs, maxAgeMs: 30_000, minHealthFactorWad: 1_250_000_000_000_000_000n
  });
  if (input.reserve.decimals !== decimals) throw new Error("Aave asset decimals changed.");
  if (["supply", "repay"].includes(request.action) && input.wallet.balanceRaw < amountRaw)
    throw new Error("Wallet balance is insufficient.");
  const risk = assessAaveActionRisk(input);
  return {
    action: request.action, symbol: request.symbol, amount: request.amount, amountRaw: amountRaw.toString(),
    chainId: 8453, market: "Aave V3", assetAddress: AAVE_BASE_ASSETS[request.symbol],
    walletBalanceRaw: input.wallet.balanceRaw.toString(),
    approvalRequired: ["supply", "repay"].includes(request.action) && input.wallet.poolAllowanceRaw < amountRaw,
    blockNumber: input.snapshot.blockNumber.toString(), observedAt: new Date(input.snapshot.observedAtMs).toISOString(),
    valueBase: risk.valueBase.toString(), debtStatus: risk.debtStatus,
    postHealthFactor: risk.postHealthFactorWad === null ? null : Number(risk.postHealthFactorWad) / 1e18,
    executionAvailable: false
  };
}
