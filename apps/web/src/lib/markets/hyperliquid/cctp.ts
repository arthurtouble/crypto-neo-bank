import { encodeFunctionData, isAddress, pad, parseAbi } from "viem";
import { z } from "zod";
import { readBoundedJson } from "@/lib/http/bounded";
import { localEdgeUrl } from "@/lib/testing/local-edge";
import { VenueError } from "../types";
import { nonFundingLedgerUpdates, type InfoOptions, type LedgerTransfer } from "./info";

/**
 * Fast deposit from Base straight into the customer's Hyperliquid perp
 * balance with Circle's CCTP. The customer's wallet burns USDC on Base with
 * hook data naming their HyperCore account. Circle attests the burn and its
 * forwarding service mints on HyperEVM to the CctpForwarder, which deposits
 * through the CoreDepositWallet. HyperCore then records a `send` from that
 * contract to the customer.
 * https://developers.circle.com/cctp/howtos/transfer-usdc-from-ethereum-to-hypercore
 */

export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** CCTP v2 TokenMessengerV2 on Base (Circle uses this address on every EVM chain). */
export const BASE_TOKEN_MESSENGER_V2 = "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d";
/** Circle's CctpForwarder on HyperEVM. It must be both the mint recipient and the destination caller, or funds are stuck. */
export const HYPEREVM_CCTP_FORWARDER = "0xb21d281dedb17ae5b501f6aa8256fe38c4e45757";
export const BASE_DOMAIN = 6;
export const HYPEREVM_DOMAIN = 19;
/** CCTP finality threshold for Fast Transfer (attested after one Base block, about 8 seconds). */
export const FAST_FINALITY_THRESHOLD = 1_000;
/** HyperCore destination: the main perp balance. uint32 max would be spot. */
const PERP_DEX = 0;

export type WalletCall = { to: `0x${string}`; value: string; data: `0x${string}` };

const usdcAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const tokenMessengerAbi = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)"
]);

function invalid(message: string): VenueError {
  return new VenueError("hyperliquid", "invalid_request", message, 400);
}

function rawAmount(value: string, name: string): bigint {
  if (!/^(0|[1-9]\d{0,30})$/.test(value)) throw invalid(`The ${name} is not valid.`);
  return BigInt(value);
}

/**
 * CctpForwarder hook data: "cctp-forward" padded to 24 bytes, version 0
 * (uint32), data length 24 (uint32), then the HyperCore recipient (20 bytes)
 * and destination dex (uint32, 0 = perps).
 */
export function hyperCoreHookData(recipient: string, destinationDex = PERP_DEX): `0x${string}` {
  if (!isAddress(recipient, { strict: false })) throw invalid("The recipient is not a valid address.");
  if (!Number.isInteger(destinationDex) || destinationDex < 0 || destinationDex > 0xffff_ffff) throw invalid("The destination is not valid.");
  const magic = Array.from(new TextEncoder().encode("cctp-forward"), (byte) => byte.toString(16).padStart(2, "0")).join("").padEnd(48, "0");
  return `0x${magic}00000000${(24).toString(16).padStart(8, "0")}${recipient.slice(2).toLowerCase()}${destinationDex.toString(16).padStart(8, "0")}`;
}

/**
 * The two Base calls the owner's wallet batches: approve TokenMessengerV2 for
 * `amountRaw`, then burn it for HyperEVM with hook data that credits `owner`'s
 * main perp balance on HyperCore. Fast Transfer; `maxFeeRaw` (from
 * `cctpDepositFee`) caps the fee Circle may take from the minted amount.
 * Pure: it sends nothing.
 */
export function cctpDepositCalls(input: { owner: string; amountRaw: string; maxFeeRaw: string }): [WalletCall, WalletCall] {
  const amount = rawAmount(input.amountRaw, "amount");
  const maxFee = rawAmount(input.maxFeeRaw, "fee");
  if (amount === 0n || maxFee >= amount) throw invalid("The amount must be more than the fee.");
  const forwarder = pad(HYPEREVM_CCTP_FORWARDER, { size: 32 });
  return [
    { to: BASE_USDC, value: "0",
      data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [BASE_TOKEN_MESSENGER_V2, amount] }) },
    { to: BASE_TOKEN_MESSENGER_V2, value: "0",
      data: encodeFunctionData({ abi: tokenMessengerAbi, functionName: "depositForBurnWithHook", args: [
        amount, HYPEREVM_DOMAIN, forwarder, BASE_USDC, forwarder, maxFee, FAST_FINALITY_THRESHOLD, hyperCoreHookData(input.owner)
      ] }) }
  ];
}

// ---------------------------------------------------------------- Circle's API

const IRIS_API_URL = "https://iris-api.circle.com";
function irisUrl(): string {
  return localEdgeUrl("CIRCLE_IRIS_API_URL") ?? IRIS_API_URL;
}

async function getIris(path: string, maxBytes: number, options: InfoOptions): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${irisUrl()}${path}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
  } catch {
    throw new VenueError("hyperliquid", "unavailable", "Circle did not answer.", 503);
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return { status: 404, body: null };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new VenueError("hyperliquid", "unavailable", `Circle answered HTTP ${response.status}.`, 503);
  }
  const body = await readBoundedJson(response, maxBytes).catch(() => {
    throw new VenueError("hyperliquid", "invalid_response", "Circle sent an unreadable answer.");
  });
  return { status: response.status, body };
}

const feeSchema = z.array(z.object({
  finalityThreshold: z.number().int(),
  /** Basis points of the amount, possibly fractional (Base: 1.3). */
  minimumFee: z.number().nonnegative().max(1_000),
  forwardFee: z.object({ low: z.number().int().nonnegative(), med: z.number().int().nonnegative(),
    high: z.number().int().nonnegative() }).optional()
})).max(10);

export type CctpDepositFee = {
  /** Fast Transfer protocol fee at the quoted rate, rounded up. */
  protocolFeeRaw: string;
  /** Circle's forwarding fee (HyperEVM gas plus its flat fee), the "med" quote. */
  forwardFeeRaw: string;
  /** What to pass as `maxFeeRaw`: protocol fee + 20%, plus the "high" forwarding quote. */
  maxFeeRaw: string;
  /** The least the customer receives on HyperCore: amount − maxFee. */
  minimumCreditRaw: string;
};

/**
 * Current Fast Transfer fees from Base to HyperCore, from Circle's
 * `/v2/burn/USDC/fees/6/19?forward=true&hyperCoreDeposit=true`. Circle asks
 * integrators not to hard-code fees: they change. A `maxFee` below the
 * required fee degrades the transfer to Standard (about 15–19 minutes from Base).
 */
export async function cctpDepositFee(amountRaw: string, options: InfoOptions = {}): Promise<CctpDepositFee> {
  const amount = rawAmount(amountRaw, "amount");
  const { body } = await getIris(`/v2/burn/USDC/fees/${BASE_DOMAIN}/${HYPEREVM_DOMAIN}?forward=true&hyperCoreDeposit=true`, 20_000, options);
  const parsed = feeSchema.safeParse(body);
  const fast = parsed.success ? parsed.data.find((fee) => fee.finalityThreshold === FAST_FINALITY_THRESHOLD) : undefined;
  if (!fast?.forwardFee) throw new VenueError("hyperliquid", "invalid_response", "Circle sent an unexpected fee quote.");
  // minimumFee is in basis points with up to two decimals: amount × bps × 100 / 1,000,000, rounded up.
  const hundredthsOfBps = BigInt(Math.round(fast.minimumFee * 100));
  const protocolFee = (amount * hundredthsOfBps + 999_999n) / 1_000_000n;
  const maxFee = (protocolFee * 120n + 99n) / 100n + BigInt(fast.forwardFee.high);
  if (maxFee >= amount) throw invalid("The amount is too small to cover the transfer fees.");
  return { protocolFeeRaw: protocolFee.toString(), forwardFeeRaw: String(fast.forwardFee.med), maxFeeRaw: maxFee.toString(),
    minimumCreditRaw: (amount - maxFee).toString() };
}

const hex = z.string().regex(/^0x[\da-fA-F]*$/);
const messagesSchema = z.object({
  messages: z.array(z.object({
    status: z.string().max(40),
    forwardState: z.string().max(40).nullable().optional(),
    forwardTxHash: hex.nullable().optional(),
    decodedMessage: z.object({
      sourceDomain: z.string(),
      destinationDomain: z.string(),
      destinationCaller: hex,
      decodedMessageBody: z.object({
        burnToken: hex,
        mintRecipient: hex,
        amount: z.string().regex(/^\d+$/),
        feeExecuted: z.string().regex(/^\d+$/).nullable().optional(),
        hookData: hex.nullable().optional()
      })
    }).nullable().optional()
  })).max(20)
});

export type CctpDepositProgress =
  | { state: "not_found" }
  /** Burned on Base; Circle has not attested or forwarded yet. */
  | { state: "pending"; status: string; forwardState: string | null }
  /** Minted on HyperEVM and forwarded into HyperCore for `creditedRaw`. */
  | { state: "forwarded"; amountRaw: string; feeRaw: string; creditedRaw: string; forwardTxHash: string }
  /** Circle's message does not credit this owner's perp balance; never treat it as their deposit. */
  | { state: "mismatch" }
  | { state: "failed"; forwardState: string };

/**
 * Follow a Base burn through Circle: GET /v2/messages/6?transactionHash=…
 * returns the message, its forwarding state, and the HyperEVM forward
 * transaction. The decoded hook data must name `owner` and the perp dex.
 */
export async function cctpDepositProgress(sourceTxHash: string, owner: string, options: InfoOptions = {}): Promise<CctpDepositProgress> {
  if (!/^0x[\da-fA-F]{64}$/.test(sourceTxHash)) throw invalid("The transaction is not valid.");
  const { status, body } = await getIris(`/v2/messages/${BASE_DOMAIN}?transactionHash=${sourceTxHash}`, 100_000, options);
  if (status === 404) return { state: "not_found" };
  const parsed = messagesSchema.safeParse(body);
  if (!parsed.success) throw new VenueError("hyperliquid", "invalid_response", "Circle sent an unexpected answer.");
  const message = parsed.data.messages.find((item) => item.decodedMessage?.destinationDomain === String(HYPEREVM_DOMAIN));
  if (!message) return parsed.data.messages.length ? { state: "mismatch" } : { state: "not_found" };
  const decoded = message.decodedMessage;
  const forwardState = message.forwardState ?? null;
  if (!decoded) return { state: "pending", status: message.status, forwardState };
  const bodyFields = decoded.decodedMessageBody;
  if (decoded.sourceDomain !== String(BASE_DOMAIN)
    || decoded.destinationCaller.toLowerCase() !== HYPEREVM_CCTP_FORWARDER
    || !bodyFields.mintRecipient.toLowerCase().endsWith(HYPEREVM_CCTP_FORWARDER.slice(2))
    || bodyFields.burnToken.toLowerCase() !== BASE_USDC
    || (bodyFields.hookData ?? "").toLowerCase() !== hyperCoreHookData(owner)) return { state: "mismatch" };
  if (forwardState === "FAILED") return { state: "failed", forwardState };
  if (message.status !== "complete" || forwardState !== "COMPLETE" || !message.forwardTxHash || bodyFields.feeExecuted == null) {
    return { state: "pending", status: message.status, forwardState };
  }
  const amount = BigInt(bodyFields.amount);
  const fee = BigInt(bodyFields.feeExecuted);
  return { state: "forwarded", amountRaw: amount.toString(), feeRaw: fee.toString(), creditedRaw: (amount - fee).toString(),
    forwardTxHash: message.forwardTxHash };
}

function usdcToRaw(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  return match ? BigInt(match[1] + (match[2] ?? "").padEnd(6, "0")) : null;
}

/**
 * The HyperCore ledger entry for a CCTP deposit: a `send` of exactly
 * `creditedRaw` USDC from the CoreDepositWallet into the perp balance, at or
 * after `since`. HyperCore's hash is its own; it is not the Base or HyperEVM
 * transaction hash, so the match is by amount, recipient, and time. Pass the
 * hashes already matched to other deposits in `exclude`.
 */
export function findCctpCredit(transfers: LedgerTransfer[], input: { creditedRaw: string; since: number; exclude?: ReadonlySet<string> }):
  LedgerTransfer | null {
  const credited = rawAmount(input.creditedRaw, "amount");
  return transfers.filter((item) => item.kind === "deposit" && item.route === "cctp" && item.dex === ""
    && item.time >= input.since && !input.exclude?.has(item.hash) && usdcToRaw(item.usdc) === credited)
    .sort((a, b) => a.time - b.time)[0] ?? null;
}

export type CctpDepositVerdict =
  | { state: "credited"; credit: LedgerTransfer; amountRaw: string; feeRaw: string; forwardTxHash: string }
  | Exclude<CctpDepositProgress, { state: "forwarded" }>
  /** Forwarded by Circle but not yet in the HyperCore ledger. */
  | { state: "forwarding"; creditedRaw: string; forwardTxHash: string };

/**
 * Whether the burn in `sourceTxHash` has reached `owner`'s perp balance:
 * Circle's message must name this owner and be forwarded, and the HyperCore
 * ledger must show the matching credit. `since` is a lower bound for the
 * credit's time, e.g. when the burn was sent.
 */
export async function verifyCctpDeposit(input: { owner: string; sourceTxHash: string; since: number; exclude?: ReadonlySet<string> },
  options: InfoOptions = {}): Promise<CctpDepositVerdict> {
  const progress = await cctpDepositProgress(input.sourceTxHash, input.owner, options);
  if (progress.state !== "forwarded") return progress;
  const credit = findCctpCredit(await nonFundingLedgerUpdates(input.owner, input.since, options),
    { creditedRaw: progress.creditedRaw, since: input.since, exclude: input.exclude });
  return credit
    ? { state: "credited", credit, amountRaw: progress.amountRaw, feeRaw: progress.feeRaw, forwardTxHash: progress.forwardTxHash }
    : { state: "forwarding", creditedRaw: progress.creditedRaw, forwardTxHash: progress.forwardTxHash };
}
