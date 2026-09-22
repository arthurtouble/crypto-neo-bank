import { decodeEventLog, erc20Abi, isAddress } from "viem";
import { z } from "zod";
import { normalizePreparedCall } from "./evidence";
import type { ChainObservation } from "./chain-observation";

const address = z.string().refine(isAddress);
const amount = z.string().regex(/^[1-9]\d*$/);
const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("native_transfer"), recipient: address, amountRaw: amount }).strict(),
  z.object({ type: z.literal("erc20_transfer"), token: address, recipient: address, amountRaw: amount }).strict(),
  z.object({ type: z.literal("erc20_approval"), token: address, spender: address, amountRaw: amount }).strict()
]);

export type PreparedEffectEvidence = {
  chainId: number;
  walletAddress: string;
  targetAddress: string;
  nativeValue: string;
  calldataHash: string;
  semanticAction: string;
  expectedEffect: unknown;
  reportedHash: string;
  observedBlockHash: string | null;
};

export type EffectVerification =
  | { status: "confirmed" }
  | { status: "pending"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "inconsistent"; reason: string };

export function requiredConfirmations(chainId: number): number {
  if (chainId === 1) return 12;
  if (chainId === 137) return 64;
  return 3;
}

function sameAddress(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }

export async function verifyExpectedEffect(prepared: PreparedEffectEvidence, observed: ChainObservation): Promise<EffectVerification> {
  if (observed.status === "pending") return { status: "pending", reason: "transaction_unavailable" };
  let normalized;
  try { normalized = await normalizePreparedCall(observed.call); }
  catch { return { status: "inconsistent", reason: "invalid_transaction" }; }
  if (prepared.chainId !== normalized.chainId || !sameAddress(prepared.walletAddress, normalized.from) || !sameAddress(prepared.targetAddress, normalized.to) || prepared.nativeValue !== normalized.value || prepared.calldataHash.toLowerCase() !== normalized.dataHash.toLowerCase()) return { status: "inconsistent", reason: "transaction_identity" };
  if (!observed.receipt) return { status: "pending", reason: "receipt_unavailable" };
  const receipt = observed.receipt;
  if (receipt.transactionHash.toLowerCase() !== prepared.reportedHash.toLowerCase()) return { status: "inconsistent", reason: "receipt_hash" };
  if (receipt.status === "reverted") return { status: "failed", reason: "transaction_reverted" };
  if (receipt.status !== "success") return { status: "pending", reason: "receipt_status_unknown" };
  if (!observed.blockHash || !observed.canonicalBlockHash || receipt.blockHash.toLowerCase() !== observed.blockHash.toLowerCase() || observed.canonicalBlockHash.toLowerCase() !== observed.blockHash.toLowerCase() || prepared.observedBlockHash && prepared.observedBlockHash.toLowerCase() !== observed.blockHash.toLowerCase()) return { status: "inconsistent", reason: "reorg" };
  if (observed.confirmations < requiredConfirmations(prepared.chainId)) return { status: "pending", reason: "finality" };
  if (observed.finalizedBlockNumber === null || observed.finalizedBlockNumber < receipt.blockNumber) return { status: "pending", reason: "finality" };
  const parsed = effectSchema.safeParse(prepared.expectedEffect);
  if (!parsed.success || parsed.data.type !== prepared.semanticAction) return { status: "inconsistent", reason: "effect_schema" };
  const effect = parsed.data;
  if (effect.type === "native_transfer") {
    if (!sameAddress(effect.recipient, normalized.to) || BigInt(effect.amountRaw) !== BigInt(normalized.value) || normalized.data !== "0x") return { status: "inconsistent", reason: "native_effect" };
    return { status: "confirmed" };
  }
  if (!sameAddress(effect.token, normalized.to) || normalized.value !== "0") return { status: "inconsistent", reason: "token_effect" };
  const eventName = effect.type === "erc20_transfer" ? "Transfer" : "Approval";
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, effect.token)) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      const args = decoded.args as unknown as Record<string, unknown>;
      const counterparty = effect.type === "erc20_transfer" ? effect.recipient : effect.spender;
      const observedCounterparty = effect.type === "erc20_transfer" ? args.to : args.spender;
      if (sameAddress(String(args.owner ?? args.from), prepared.walletAddress) && sameAddress(String(observedCounterparty), counterparty) && BigInt(String(args.value)) === BigInt(effect.amountRaw)) return { status: "confirmed" };
    } catch { /* This log is not the expected ERC-20 event. */ }
  }
  return { status: "inconsistent", reason: "expected_log_missing" };
}
