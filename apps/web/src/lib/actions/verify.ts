import { decodeEventLog, erc20Abi, parseAbiItem } from "viem";
import { AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { MORPHO_USDC } from "@/lib/defi/morpho";
import { HYPERCORE_CHAIN_ID, observeHyperliquidCredit } from "@/lib/markets/funding";
import { verifyCctpDeposit } from "@/lib/markets/hyperliquid/cctp";
import { relayDeliveryStatus } from "@/lib/markets/relay";
import { observeTransaction, observeTransactionIdentity, requiredConfirmations, type ChainObservation } from "./chain";
import { LifiStatusError, readLifiTransferStatus } from "./lifi-status";
import { observeNativeCredit, storedNativeCredit, type NativeCredit, type NativeCreditEvidence } from "./native-credit";
import { sameAddress, type Call, type Effect } from "./types";
import { readWalletOperation, walletOperationCalls, type Log } from "./user-operation";

/** `nativeCredit` is the chain observation behind a native ETH payout, kept as the action's evidence. */
type Observed = { nativeCredit?: NativeCreditEvidence };
export type Verification =
  | { status: "pending"; reason: string } & Observed
  | { status: "settling"; reason: string; destinationHash?: string } & Observed
  | { status: "confirmed"; destinationHash?: string } & Observed
  | { status: "failed"; reason: string } & Observed;

export type VerifiableAction = {
  chainId: number;
  walletAddress: string;
  calls: Call[];
  effects: Effect[];
  transactionHash: string;
  /** Native credit already observed for this action, reused while its block is canonical. */
  nativeEvidence?: NativeCreditEvidence[];
};

type Dependencies = {
  observe?: (chainId: number, hash: string) => Promise<ChainObservation>;
  lifiStatus?: typeof readLifiTransferStatus;
  nativeCredit?: typeof observeNativeCredit;
  hyperliquidCredit?: typeof observeHyperliquidCredit;
  cctpDeposit?: typeof verifyCctpDeposit;
  relayDelivery?: typeof relayDeliveryStatus;
};

type LogEffect = Exclude<Effect, { type: "delivery" | "native_credit_min" }>;

/** The recipient's native credit in this receipt's block: stored evidence for the same canonical block, or a fresh chain read. */
async function nativeCreditAt(action: VerifiableAction, chainId: number, receipt: { transactionHash: string; blockNumber: bigint; blockHash: string },
  to: string, read: typeof observeNativeCredit): Promise<NativeCredit> {
  const target = { chainId, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, to };
  const stored = storedNativeCredit(action.nativeEvidence, target);
  return stored ? { status: "observed", evidence: stored } : read(target);
}

const aaveEvents = {
  aave_supply: parseAbiItem("event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)"),
  aave_withdraw: parseAbiItem("event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)")
};
/** ERC-4626 events, as Morpho vaults emit them. */
const vaultEvents = {
  deposit: parseAbiItem("event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)"),
  withdraw: parseAbiItem("event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)")
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
export function effectPresent(effect: LogEffect, wallet: string, logs: readonly Log[]): boolean {
  switch (effect.type) {
    case "erc20_transfer":
      return transfers(logs, effect.token).some((item) => sameAddress(item.from, wallet)
        && sameAddress(item.to, effect.to) && item.value === BigInt(effect.amountRaw));
    case "erc20_debit":
      return transfers(logs, effect.token).filter((item) => sameAddress(item.from, wallet))
        .reduce((sum, item) => sum + item.value, 0n) === BigInt(effect.amountRaw);
    case "erc20_approval":
      // Exactly this value: a zero approval (card spending off) confirms only when the Approval event says 0.
      return logs.some((log) => {
        if (!sameAddress(log.address, effect.token)) return false;
        const event = decode(erc20Abi, log);
        return event?.eventName === "Approval" && sameAddress(String(event.args.owner), wallet) && sameAddress(String(event.args.spender), effect.spender)
          && event.args.value === BigInt(effect.amountRaw);
      });
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
    case "aave_withdraw_all":
      // The pool's own Withdraw event for the reserve, from and to the account, returning at least the balance read before signing.
      return logs.some((log) => {
        if (!sameAddress(log.address, AAVE_BASE_V3_MARKET)) return false;
        const event = decode([aaveEvents.aave_withdraw], log);
        return Boolean(event && sameAddress(String(event.args.reserve), effect.asset) && sameAddress(String(event.args.user), wallet)
          && sameAddress(String(event.args.to), wallet) && (event.args.amount as bigint) >= BigInt(effect.minimumRaw));
      });
    case "morpho_deposit": {
      // The vault's own Deposit event, from and for the account, for exactly the amount, backed by the USDC leaving the account.
      const assets = BigInt(effect.assetsRaw);
      const deposited = logs.some((log) => {
        if (!sameAddress(log.address, effect.vault)) return false;
        const event = decode([vaultEvents.deposit], log);
        return Boolean(event && sameAddress(String(event.args.sender), wallet) && sameAddress(String(event.args.owner), wallet)
          && event.args.assets === assets && (event.args.shares as bigint) > 0n);
      });
      const paid = transfers(logs, MORPHO_USDC).filter((item) => sameAddress(item.from, wallet) && sameAddress(item.to, effect.vault))
        .reduce((sum, item) => sum + item.value, 0n);
      return deposited && paid === assets;
    }
    case "morpho_withdraw":
    case "morpho_redeem":
      // The vault's own Withdraw event: the account's shares, paid to the account, for exactly the amount or every share.
      return logs.some((log) => {
        if (!sameAddress(log.address, effect.vault)) return false;
        const event = decode([vaultEvents.withdraw], log);
        if (!event || !sameAddress(String(event.args.sender), wallet) || !sameAddress(String(event.args.receiver), wallet)
          || !sameAddress(String(event.args.owner), wallet)) return false;
        return effect.type === "morpho_withdraw"
          ? event.args.assets === BigInt(effect.assetsRaw) && (event.args.shares as bigint) > 0n
          : event.args.shares === BigInt(effect.sharesRaw) && (event.args.assets as bigint) > 0n;
      });
  }
}

function callsMatch(expected: readonly Call[], observed: readonly Call[]): boolean {
  return expected.length === observed.length && expected.every((call, index) =>
    sameAddress(call.to, observed[index].to) && call.value === observed[index].value
    && call.data.toLowerCase() === observed[index].data.toLowerCase());
}

export type ReportedTransaction = "own" | "unavailable" | "not_own";

/**
 * Whether a hash the customer's wallet reported is that wallet's own
 * operation carrying exactly the action's calls, read from the chain before
 * the hash is bound. Without this, anyone could bind someone else's hash to
 * their own action and keep it from the action it belongs to.
 */
export async function checkReportedTransaction(action: Pick<VerifiableAction, "chainId" | "walletAddress" | "calls">, hash: string,
  observe: typeof observeTransactionIdentity = observeTransactionIdentity): Promise<ReportedTransaction> {
  const observed = await observe(action.chainId, hash);
  if (observed.status === "pending") return "unavailable";
  const own = walletOperationCalls(action.walletAddress, observed.call);
  return own.status === "found" && callsMatch(action.calls, own.calls) ? "own" : "not_own";
}

type Unsettled = { status: "pending"; reason: string } | { status: "failed"; reason: string };
type Settled = { status: "found"; observed: Extract<ChainObservation, { status: "found" }>; final: boolean };

/**
 * A receipt that succeeded and has enough confirmations, and whether its
 * block is final yet. Base finalizes 15 to 25 minutes after inclusion, so a
 * matching operation shows as settling first. A reverted receipt only fails
 * once final, because a reorg could still include the operation differently.
 */
function settledReceipt(observed: ChainObservation, chainId: number, hash: string): Unsettled | Settled {
  if (observed.status === "pending") return { status: "pending", reason: "transaction_unavailable" };
  const receipt = observed.receipt;
  if (!receipt) return { status: "pending", reason: "receipt_unavailable" };
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) return { status: "pending", reason: "rpc_inconsistent" };
  if (!observed.blockHash || !observed.canonicalBlockHash || !sameAddress(receipt.blockHash, observed.blockHash)
    || !sameAddress(observed.canonicalBlockHash, observed.blockHash)) return { status: "pending", reason: "reorg" };
  if (observed.confirmations < requiredConfirmations(chainId)) return { status: "pending", reason: "confirmations" };
  const final = observed.finalizedBlockNumber !== null && observed.finalizedBlockNumber >= receipt.blockNumber;
  if (receipt.status === "reverted") return final ? { status: "failed", reason: "transaction_reverted" } : { status: "pending", reason: "finality" };
  if (receipt.status !== "success") return { status: "pending", reason: "receipt_status_unknown" };
  return { status: "found", observed, final };
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
  // Until the block is final, only a fully matching operation moves forward; anything else waits for finality to decide.
  const fail = (reason: string): Verification => source.final ? { status: "failed", reason } : { status: "pending", reason: "finality" };
  const operation = readWalletOperation(action.walletAddress, call, receipt!.logs, receipt!.status === "success");
  if (operation.status === "unrecognized") return fail(`operation_${operation.reason}`);
  if (!callsMatch(action.calls, operation.calls)) return fail("calls_mismatch");
  if (!operation.success) return fail("operation_reverted");
  for (const effect of action.effects) {
    if (effect.type === "delivery" || effect.type === "native_credit_min") continue;
    if (!effectPresent(effect, action.walletAddress, operation.logs)) return fail(`effect_missing_${effect.type}`);
  }
  // Native ETH paid out on this network: read from the chain, since it leaves no log. Without that reading, it never moves on.
  const native = action.effects.find((effect) => effect.type === "native_credit_min");
  let evidence: Observed = {};
  if (native) {
    const credit = await nativeCreditAt(action, action.chainId, receipt!, native.to, dependencies.nativeCredit ?? observeNativeCredit);
    if (credit.status === "unavailable") return { status: "pending", reason: credit.reason };
    evidence = { nativeCredit: credit.evidence };
    if (BigInt(credit.evidence.creditedRaw) < BigInt(native.minimumRaw)) {
      // A trace is this transaction's own calls, so a shortfall there is a real one. A balance change can hide a credit
      // behind the recipient's own spending in the same block, so it stays open for an operator rather than failing.
      return credit.evidence.method === "trace" ? { ...fail("effect_missing_native_credit_min"), ...evidence }
        : { status: "pending", reason: "native_credit_below_minimum", ...evidence };
    }
  }
  const delivery = action.effects.find((effect) => effect.type === "delivery");
  // A CCTP fast transfer or a Relay fill pays out before Base is final: once Hyperliquid's ledger shows the credit, the
  // money has arrived whatever happens to the source block, so it doesn't wait.
  if ((delivery?.tool === "cctp" || delivery?.tool === "relay_direct") && delivery.destinationChainId === HYPERCORE_CHAIN_ID) {
    const verdict = delivery.tool === "cctp" ? await verifyHyperliquidCctp(action, delivery, dependencies.cctpDeposit ?? verifyCctpDeposit)
      : await verifyHyperliquidRelay(action, delivery, dependencies.relayDelivery ?? relayDeliveryStatus, dependencies.hyperliquidCredit ?? observeHyperliquidCredit);
    return !source.final && verdict.status === "failed" ? { status: "settling", reason: "finality" } : verdict;
  }
  if (!source.final) return { status: "settling", reason: "finality", ...evidence };
  if (!delivery) return { status: "confirmed", ...evidence };
  return verifyDelivery(action, delivery, observe, dependencies.lifiStatus ?? readLifiTransferStatus, dependencies.nativeCredit ?? observeNativeCredit,
    dependencies.hyperliquidCredit ?? observeHyperliquidCredit);
}

/** How far back Hyperliquid's ledger is read for a delivery's credit. LI.FI reports the hash, so this only bounds the read. */
const HYPERLIQUID_LEDGER_WINDOW_MS = 7 * 86_400_000;

/**
 * A deposit into Hyperliquid through Circle's CCTP: Circle's message for this
 * burn must name the customer's perps balance and be forwarded, and
 * Hyperliquid's ledger must show the credit, for at least the minimum.
 */
async function verifyHyperliquidCctp(action: VerifiableAction, delivery: Extract<Effect, { type: "delivery" }>,
  cctpDeposit: typeof verifyCctpDeposit): Promise<Verification> {
  let verdict;
  try { verdict = await cctpDeposit({ owner: delivery.to, sourceTxHash: action.transactionHash, since: Date.now() - HYPERLIQUID_LEDGER_WINDOW_MS }); }
  catch { return { status: "settling", reason: "cctp_unavailable" }; }
  if (verdict.state === "mismatch") return { status: "failed", reason: "cctp_mismatch" };
  if (verdict.state === "failed") return { status: "failed", reason: "delivery_failed" };
  if (verdict.state !== "credited") return { status: "settling", reason: verdict.state === "forwarding" ? "awaiting_hyperliquid_credit" : "awaiting_delivery" };
  if (BigInt(verdict.amountRaw) - BigInt(verdict.feeRaw) < BigInt(delivery.minimumRaw)) return { status: "failed", reason: "delivery_below_minimum" };
  return { status: "confirmed", destinationHash: verdict.forwardTxHash };
}

/**
 * A deposit into Hyperliquid through Relay: Relay must report this Base transaction filled for this account, and
 * Hyperliquid's ledger must show the credit under the hash Relay paid out with, for at least the minimum.
 */
async function verifyHyperliquidRelay(action: VerifiableAction, delivery: Extract<Effect, { type: "delivery" }>,
  relayDelivery: typeof relayDeliveryStatus, hyperliquidCredit: typeof observeHyperliquidCredit): Promise<Verification> {
  let status;
  try { status = await relayDelivery(action.transactionHash, delivery.to); }
  catch { return { status: "settling", reason: "relay_unavailable" }; }
  if (status.state === "mismatch") return { status: "failed", reason: "relay_mismatch" };
  if (status.state === "failed") return { status: "failed", reason: status.reason };
  if (status.state === "pending") return { status: "settling", reason: "awaiting_delivery" };
  const credit = await hyperliquidCredit({ user: delivery.to, hash: status.hyperliquidHash, since: Date.now() - HYPERLIQUID_LEDGER_WINDOW_MS });
  if (credit.status === "unavailable") return { status: "settling", reason: credit.reason, destinationHash: status.hyperliquidHash };
  if (credit.status === "missing") return { status: "settling", reason: "awaiting_hyperliquid_credit", destinationHash: status.hyperliquidHash };
  if (BigInt(credit.creditedRaw) < BigInt(delivery.minimumRaw)) return { status: "failed", reason: "delivery_below_minimum" };
  return { status: "confirmed", destinationHash: status.hyperliquidHash };
}

async function verifyDelivery(action: VerifiableAction, delivery: Extract<Effect, { type: "delivery" }>,
  observe: NonNullable<Dependencies["observe"]>, lifiStatus: typeof readLifiTransferStatus, nativeCredit: typeof observeNativeCredit,
  hyperliquidCredit: typeof observeHyperliquidCredit): Promise<Verification> {
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
  // The receiving transaction must be the one LI.FI reports for this very source transaction, on the expected network.
  if (!status.sourceHash || status.sourceHash.toLowerCase() !== action.transactionHash.toLowerCase()
    || status.destinationChainId !== delivery.destinationChainId) return { status: "settling", reason: "status_mismatch" };
  if (delivery.destinationChainId === HYPERCORE_CHAIN_ID) {
    // Hyperliquid isn't an EVM chain: its own ledger shows the credit under the hash LI.FI reported.
    const credit = await hyperliquidCredit({ user: delivery.to, hash: status.destinationHash, since: Date.now() - HYPERLIQUID_LEDGER_WINDOW_MS });
    if (credit.status === "unavailable") return { status: "settling", reason: credit.reason, destinationHash: status.destinationHash };
    if (credit.status === "missing") return { status: "settling", reason: "awaiting_hyperliquid_credit", destinationHash: status.destinationHash };
    if (BigInt(credit.creditedRaw) < BigInt(delivery.minimumRaw)) return { status: "failed", reason: "delivery_below_minimum" };
    return { status: "confirmed", destinationHash: status.destinationHash };
  }
  const destination = settledReceipt(await observe(delivery.destinationChainId, status.destinationHash),
    delivery.destinationChainId, status.destinationHash);
  if (destination.status === "failed") return { status: "failed", reason: `destination_${destination.reason}` };
  if (destination.status !== "found") return { status: "settling", reason: destination.reason, destinationHash: status.destinationHash };
  const receipt = destination.observed.receipt!;
  if (delivery.token) {
    if (transfers(receipt.logs, delivery.token).filter((item) => sameAddress(item.to, delivery.to))
      .reduce((sum, item) => sum + item.value, 0n) < BigInt(delivery.minimumRaw)) return { status: "failed", reason: "delivery_below_minimum" };
    return { status: "confirmed", destinationHash: status.destinationHash };
  }
  // Native ETH delivered: the recipient's credit in the receiving transaction's block on the destination network.
  // Until it's read, the move stays settling; it is never confirmed on LI.FI's word alone.
  const credit = await nativeCreditAt(action, delivery.destinationChainId, receipt, delivery.to, nativeCredit);
  if (credit.status === "unavailable") return { status: "settling", reason: credit.reason };
  const evidence = { nativeCredit: credit.evidence };
  if (BigInt(credit.evidence.creditedRaw) < BigInt(delivery.minimumRaw)) {
    return credit.evidence.method === "trace" ? { status: "failed", reason: "delivery_below_minimum", ...evidence }
      : { status: "settling", reason: "native_credit_below_minimum", ...evidence };
  }
  return { status: "confirmed", destinationHash: status.destinationHash, ...evidence };
}
