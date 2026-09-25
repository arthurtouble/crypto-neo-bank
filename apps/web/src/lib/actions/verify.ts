import { decodeEventLog, erc20Abi, parseAbiItem } from "viem";
import { AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { skyConversionLimit, SKY_SUSDS, SKY_USDC, SKY_USDC_ACTIONS } from "@/lib/defi/sky-call-policy";
import { observeTransaction, requiredConfirmations, type ChainObservation } from "./chain";
import { LifiStatusError, readLifiTransferStatus } from "./lifi-status";
import { sameAddress, type Call, type Effect } from "./types";
import { readWalletOperation, type Log } from "./user-operation";

export type Verification =
  | { status: "pending"; reason: string }
  | { status: "settling"; reason: string; destinationHash?: string }
  | { status: "confirmed"; destinationHash?: string }
  | { status: "failed"; reason: string };

export type VerifiableAction = {
  chainId: number;
  walletAddress: string;
  calls: Call[];
  effects: Effect[];
  transactionHash: string;
};

type Dependencies = {
  observe?: (chainId: number, hash: string) => Promise<ChainObservation>;
  lifiStatus?: typeof readLifiTransferStatus;
};

const aaveEvents = {
  aave_supply: parseAbiItem("event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)"),
  aave_withdraw: parseAbiItem("event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)")
};
const skyEvents = {
  sky_deposit: parseAbiItem("event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)"),
  sky_withdraw: parseAbiItem("event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)")
};

function decode<const T extends readonly unknown[]>(abi: T, log: Log) {
  try {
    return decodeEventLog({ abi: abi as never, data: log.data as `0x${string}`,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]], strict: true }) as unknown as { eventName: string; args: Record<string, unknown> };
  } catch { return null; }
}

function transfers(logs: readonly Log[], token: string) {
  return logs.filter((log) => sameAddress(log.address, token)).flatMap((log) => {
    const event = decode(erc20Abi, log);
    return event?.eventName === "Transfer"
      ? [{ from: String(event.args.from), to: String(event.args.to), value: event.args.value as bigint }] : [];
  });
}

/** Whether one expected same-chain effect is present in the operation's own logs. */
export function effectPresent(effect: Exclude<Effect, { type: "delivery" }>, wallet: string, logs: readonly Log[]): boolean {
  switch (effect.type) {
    case "erc20_transfer":
      return transfers(logs, effect.token).some((item) => sameAddress(item.from, wallet)
        && sameAddress(item.to, effect.to) && item.value === BigInt(effect.amountRaw));
    case "erc20_debit":
      return transfers(logs, effect.token).filter((item) => sameAddress(item.from, wallet))
        .reduce((sum, item) => sum + item.value, 0n) === BigInt(effect.amountRaw);
    case "erc20_credit_min":
      return transfers(logs, effect.token).filter((item) => sameAddress(item.to, effect.to))
        .reduce((sum, item) => sum + item.value, 0n) >= BigInt(effect.minimumRaw);
    case "aave_supply":
    case "aave_withdraw":
      return logs.some((log) => {
        if (!sameAddress(log.address, AAVE_BASE_V3_MARKET)) return false;
        const event = decode([aaveEvents[effect.type]], log);
        if (!event || !sameAddress(String(event.args.reserve), effect.asset) || event.args.amount !== BigInt(effect.amountRaw)
          || !sameAddress(String(event.args.user), wallet)) return false;
        return effect.type === "aave_supply"
          ? sameAddress(String(event.args.onBehalfOf), wallet) && event.args.referralCode === 0
          : sameAddress(String(event.args.to), wallet);
      });
    case "sky_deposit":
    case "sky_withdraw": {
      const amount = BigInt(effect.amountRaw);
      const usdc = transfers(logs, SKY_USDC).filter((item) => effect.type === "sky_deposit"
        ? sameAddress(item.from, wallet) && sameAddress(item.to, SKY_USDC_ACTIONS)
        : sameAddress(item.to, wallet)).reduce((sum, item) => sum + item.value, 0n);
      const vault = logs.filter((log) => sameAddress(log.address, SKY_SUSDS)).filter((log) => {
        const event = decode([skyEvents[effect.type]], log);
        if (!event || !sameAddress(String(event.args.sender), SKY_USDC_ACTIONS) || !sameAddress(String(event.args.owner), wallet)
          || (event.args.shares as bigint) <= 0n) return false;
        const assets = event.args.assets as bigint;
        return effect.type === "sky_deposit"
          ? assets >= skyConversionLimit("deposit", amount)
          : sameAddress(String(event.args.receiver), SKY_USDC_ACTIONS) && assets > 0n && assets <= skyConversionLimit("withdraw", amount);
      });
      return usdc === amount && vault.length === 1;
    }
  }
}

function callsMatch(expected: readonly Call[], observed: readonly Call[]): boolean {
  return expected.length === observed.length && expected.every((call, index) =>
    sameAddress(call.to, observed[index].to) && call.value === observed[index].value
    && call.data.toLowerCase() === observed[index].data.toLowerCase());
}

type Unsettled = { status: "pending"; reason: string } | { status: "failed"; reason: string };
type Settled = { status: "found"; observed: Extract<ChainObservation, { status: "found" }> };

/** A receipt that is final on its chain and succeeded, or why not yet. */
function settledReceipt(observed: ChainObservation, chainId: number, hash: string): Unsettled | Settled {
  if (observed.status === "pending") return { status: "pending", reason: "transaction_unavailable" };
  const receipt = observed.receipt;
  if (!receipt) return { status: "pending", reason: "receipt_unavailable" };
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) return { status: "pending", reason: "rpc_inconsistent" };
  if (!observed.blockHash || !observed.canonicalBlockHash || !sameAddress(receipt.blockHash, observed.blockHash)
    || !sameAddress(observed.canonicalBlockHash, observed.blockHash)) return { status: "pending", reason: "reorg" };
  if (observed.confirmations < requiredConfirmations(chainId)
    || observed.finalizedBlockNumber === null || observed.finalizedBlockNumber < receipt.blockNumber) return { status: "pending", reason: "finality" };
  if (receipt.status === "reverted") return { status: "failed", reason: "transaction_reverted" };
  if (receipt.status !== "success") return { status: "pending", reason: "receipt_status_unknown" };
  return { status: "found", observed };
}

/**
 * Decide an action's state from chain evidence alone. The browser's report
 * only tells Aura which transaction to read.
 */
export async function verifyAction(action: VerifiableAction, dependencies: Dependencies = {}): Promise<Verification> {
  const observe = dependencies.observe ?? observeTransaction;
  const source = settledReceipt(await observe(action.chainId, action.transactionHash), action.chainId, action.transactionHash);
  if (source.status !== "found") return source;
  const { call, receipt } = source.observed;
  const operation = readWalletOperation(action.walletAddress, call, receipt!.logs, receipt!.status === "success");
  if (operation.status === "unrecognized") return { status: "failed", reason: `operation_${operation.reason}` };
  if (!callsMatch(action.calls, operation.calls)) return { status: "failed", reason: "calls_mismatch" };
  if (!operation.success) return { status: "failed", reason: "operation_reverted" };
  for (const effect of action.effects) {
    if (effect.type === "delivery") continue;
    if (!effectPresent(effect, action.walletAddress, operation.logs)) return { status: "failed", reason: `effect_missing_${effect.type}` };
  }
  const delivery = action.effects.find((effect) => effect.type === "delivery");
  if (!delivery) return { status: "confirmed" };
  return verifyDelivery(action, delivery, observe, dependencies.lifiStatus ?? readLifiTransferStatus);
}

async function verifyDelivery(action: VerifiableAction, delivery: Extract<Effect, { type: "delivery" }>,
  observe: NonNullable<Dependencies["observe"]>, lifiStatus: typeof readLifiTransferStatus): Promise<Verification> {
  let status;
  try {
    status = await lifiStatus({ sourceHash: action.transactionHash, sourceChainId: action.chainId,
      destinationChainId: delivery.destinationChainId, toolId: delivery.tool });
  } catch (error) {
    return { status: "settling", reason: error instanceof LifiStatusError ? error.code : "status_unavailable" };
  }
  if (status.status === "REFUNDED") return { status: "failed", reason: "refunded" };
  if (status.status === "FAILED") return { status: "failed", reason: "delivery_failed" };
  if (status.status === "PARTIAL") return { status: "failed", reason: "partial_delivery" };
  if (status.status !== "DONE" || !status.destinationHash) return { status: "settling", reason: "awaiting_delivery" };
  const destination = settledReceipt(await observe(delivery.destinationChainId, status.destinationHash),
    delivery.destinationChainId, status.destinationHash);
  if (destination.status === "failed") return { status: "failed", reason: `destination_${destination.reason}` };
  if (destination.status !== "found") return { status: "settling", reason: destination.reason, destinationHash: status.destinationHash };
  if (delivery.token && transfers(destination.observed.receipt!.logs, delivery.token)
    .filter((item) => sameAddress(item.to, delivery.to))
    .reduce((sum, item) => sum + item.value, 0n) < BigInt(delivery.minimumRaw)) {
    return { status: "failed", reason: "delivery_below_minimum" };
  }
  return { status: "confirmed", destinationHash: status.destinationHash };
}
