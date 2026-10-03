import { encode } from "@msgpack/msgpack";
import { concatBytes, hexToBytes, isAddress, keccak256 } from "viem";
import { z } from "zod";
import { readBoundedJson } from "@/lib/http/bounded";
import { type TypedData, VenueError } from "../types";
import { hyperliquidApiUrl } from "./info";

/**
 * Hyperliquid exchange actions. Aura never holds a key that can move money:
 * these helpers only build the action and the EIP-712 typed data to sign.
 * The owner's embedded wallet signs user-signed actions (agent approval,
 * withdrawal) behind a passkey; the customer's agent wallet signs L1 actions
 * (orders, cancels, leverage), and the agent cannot withdraw.
 */

/** Arbitrum One. Hyperliquid accepts any chain id here as long as the signature uses the same one. */
export const SIGNATURE_CHAIN_ID = "0xa4b1";
const SIGNATURE_CHAIN_ID_NUMBER = 42161;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const userSignedDomain = {
  name: "HyperliquidSignTransaction",
  version: "1",
  chainId: SIGNATURE_CHAIN_ID_NUMBER,
  verifyingContract: ZERO_ADDRESS
};

// ---------------------------------------------------------------- user-signed

export type ApproveAgentAction = {
  type: "approveAgent";
  signatureChainId: typeof SIGNATURE_CHAIN_ID;
  hyperliquidChain: "Mainnet";
  agentAddress: `0x${string}`;
  agentName: string;
  nonce: number;
};

export type WithdrawAction = {
  type: "withdraw3";
  signatureChainId: typeof SIGNATURE_CHAIN_ID;
  hyperliquidChain: "Mainnet";
  destination: `0x${string}`;
  amount: string;
  time: number;
};

function invalid(message: string): VenueError {
  return new VenueError("hyperliquid", "invalid_request", message, 400);
}

function timestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalid(`The ${name} is not valid.`);
  return value;
}

function lowerAddress(value: string, name: string): `0x${string}` {
  if (!isAddress(value, { strict: false })) throw invalid(`The ${name} is not a valid address.`);
  // Hyperliquid recovers the signer from the lowercase string it receives, so sign exactly that.
  return value.toLowerCase() as `0x${string}`;
}

/**
 * The owner registers Aura's per-customer agent. Hyperliquid caps the name at 16
 * characters, not counting an optional ` valid_until <ms>` suffix that makes the
 * approval expire on Hyperliquid's side.
 */
export function approveAgentAction(input: { agentAddress: string; agentName: string; nonce: number;
  validUntil?: number }): { action: ApproveAgentAction; typedData: TypedData } {
  const nonce = timestamp(input.nonce, "nonce");
  if (input.agentName.length < 1 || input.agentName.length > 16 || input.agentName.includes("valid_until")) {
    throw invalid("The agent name must be 1 to 16 characters, without an expiry.");
  }
  const agentName = input.validUntil === undefined ? input.agentName
    : `${input.agentName} valid_until ${timestamp(input.validUntil, "expiry")}`;
  const action: ApproveAgentAction = {
    type: "approveAgent", signatureChainId: SIGNATURE_CHAIN_ID, hyperliquidChain: "Mainnet",
    agentAddress: lowerAddress(input.agentAddress, "agent address"), agentName, nonce
  };
  return {
    action,
    typedData: {
      domain: userSignedDomain,
      types: {
        "HyperliquidTransaction:ApproveAgent": [
          { name: "hyperliquidChain", type: "string" },
          { name: "agentAddress", type: "address" },
          { name: "agentName", type: "string" },
          { name: "nonce", type: "uint64" }
        ]
      },
      primaryType: "HyperliquidTransaction:ApproveAgent",
      message: { hyperliquidChain: action.hyperliquidChain, agentAddress: action.agentAddress,
        agentName: action.agentName, nonce: action.nonce }
    }
  };
}

/** A positive USDC amount with at most 6 decimals, normalized the way Hyperliquid prints it ("1.50" → "1.5"). */
function usdcAmount(value: string): string {
  if (!/^\d{1,15}(\.\d{1,6})?$/.test(value) || !/[1-9]/.test(value)) throw invalid("The amount is not valid.");
  const trimmed = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return trimmed.replace(/^0+(?=\d)/, "");
}

/** CCTP domain for Base, where Aura sends withdrawals by default. */
export const BASE_CCTP_DOMAIN = 6;

export type SendToEvmWithDataAction = {
  type: "sendToEvmWithData";
  signatureChainId: typeof SIGNATURE_CHAIN_ID;
  hyperliquidChain: "Mainnet";
  token: "USDC";
  amount: string;
  sourceDex: "" | "spot";
  destinationRecipient: `0x${string}`;
  addressEncoding: "hex";
  destinationChainId: number;
  gasLimit: number;
  data: `0x${string}`;
  nonce: number;
};

/**
 * The owner withdraws USDC from Hyperliquid straight to another chain through
 * Circle's CCTP (Base by default). `sourceDex` "" is the perp balance, "spot" the
 * spot balance. Empty `data` ("0x") lets Circle's forwarding service mint to
 * the recipient on arrival, for the fee `cctpForwardFee` reads; custom hook data
 * would leave the mint for someone to claim on the destination chain, so Aura
 * only passes "0x". `destinationChainId` is the CCTP domain, not an EVM chain id.
 * https://developers.circle.com/cctp/howtos/withdraw-usdc-from-hypercore-to-evm
 */
export function sendToEvmWithDataAction(input: { amount: string; destinationRecipient: string;
  destinationDomain?: number; sourceDex?: "" | "spot"; gasLimit?: number; data?: string; nonce: number }):
  { action: SendToEvmWithDataAction; typedData: TypedData } {
  const nonce = timestamp(input.nonce, "nonce");
  const destinationChainId = input.destinationDomain ?? BASE_CCTP_DOMAIN;
  if (!Number.isInteger(destinationChainId) || destinationChainId < 0 || destinationChainId > 0xffff_ffff) {
    throw invalid("The destination is not valid.");
  }
  const gasLimit = input.gasLimit ?? 200_000;
  if (!Number.isSafeInteger(gasLimit) || gasLimit < 1) throw invalid("The gas limit is not valid.");
  const data = (input.data ?? "0x").toLowerCase();
  if (!/^0x([\da-f]{2})*$/.test(data) || data.length > 2_050) throw invalid("The hook data is not valid.");
  const sourceDex = input.sourceDex ?? "";
  if (sourceDex !== "" && sourceDex !== "spot") throw invalid("The source balance is not valid.");
  const action: SendToEvmWithDataAction = {
    type: "sendToEvmWithData", signatureChainId: SIGNATURE_CHAIN_ID, hyperliquidChain: "Mainnet", token: "USDC",
    amount: usdcAmount(input.amount), sourceDex,
    destinationRecipient: lowerAddress(input.destinationRecipient, "destination"), addressEncoding: "hex",
    destinationChainId, gasLimit, data: data as `0x${string}`, nonce
  };
  return {
    action,
    typedData: {
      domain: userSignedDomain,
      types: {
        "HyperliquidTransaction:SendToEvmWithData": [
          { name: "hyperliquidChain", type: "string" },
          { name: "token", type: "string" },
          { name: "amount", type: "string" },
          { name: "sourceDex", type: "string" },
          { name: "destinationRecipient", type: "string" },
          { name: "addressEncoding", type: "string" },
          { name: "destinationChainId", type: "uint32" },
          { name: "gasLimit", type: "uint64" },
          { name: "data", type: "bytes" },
          { name: "nonce", type: "uint64" }
        ]
      },
      primaryType: "HyperliquidTransaction:SendToEvmWithData",
      message: { hyperliquidChain: action.hyperliquidChain, token: action.token, amount: action.amount,
        sourceDex: action.sourceDex, destinationRecipient: action.destinationRecipient,
        addressEncoding: action.addressEncoding, destinationChainId: action.destinationChainId,
        gasLimit: action.gasLimit, data: action.data, nonce: action.nonce }
    }
  };
}

/**
 * The owner withdraws USDC to their own Arbitrum address with Hyperliquid's
 * native bridge. Secondary to `sendToEvmWithDataAction`. `time` doubles as the
 * nonce. Hyperliquid deducts a $1 fee.
 */
export function withdrawAction(input: { destination: string; amount: string; time: number }):
  { action: WithdrawAction; typedData: TypedData } {
  const time = timestamp(input.time, "time");
  const action: WithdrawAction = {
    type: "withdraw3", signatureChainId: SIGNATURE_CHAIN_ID, hyperliquidChain: "Mainnet",
    destination: lowerAddress(input.destination, "destination"), amount: usdcAmount(input.amount), time
  };
  return {
    action,
    typedData: {
      domain: userSignedDomain,
      types: {
        "HyperliquidTransaction:Withdraw": [
          { name: "hyperliquidChain", type: "string" },
          { name: "destination", type: "string" },
          { name: "amount", type: "string" },
          { name: "time", type: "uint64" }
        ]
      },
      primaryType: "HyperliquidTransaction:Withdraw",
      message: { hyperliquidChain: action.hyperliquidChain, destination: action.destination,
        amount: action.amount, time: action.time }
    }
  };
}

// ---------------------------------------------------------------- L1 (agent-signed)

/** Plain JSON values an L1 action may hold; key order is part of the hash. */
export type L1Value = string | number | boolean | null | L1Value[] | { [key: string]: L1Value };
export type L1Action = { type: string; [key: string]: L1Value };

function uint64(value: number, name: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`The ${name} is not valid.`);
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

function assertNoFloats(value: L1Value): void {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    // Hyperliquid hashes prices and sizes as strings; a float here would hash differently from what it verifies.
    throw invalid("L1 actions carry numbers as integers only.");
  }
  if (Array.isArray(value)) value.forEach(assertNoFloats);
  else if (value && typeof value === "object") Object.values(value).forEach(assertNoFloats);
}

/**
 * keccak256(msgpack(action) ‖ nonce u64 BE ‖ vault flag [‖ vault] [‖ 0x00 ‖ expiresAfter u64 BE]),
 * the same bytes Hyperliquid's Python SDK hashes. msgpack keeps insertion key
 * order and encodes integers in their smallest form, as the Python encoder does.
 */
export function l1ActionHash(action: L1Action, nonce: number, vaultAddress?: string, expiresAfter?: number): `0x${string}` {
  assertNoFloats(action);
  const parts = [encode(action, { ignoreUndefined: true }), uint64(nonce, "nonce")];
  if (vaultAddress === undefined) parts.push(new Uint8Array([0]));
  else parts.push(new Uint8Array([1]), hexToBytes(lowerAddress(vaultAddress, "vault address")));
  if (expiresAfter !== undefined) parts.push(new Uint8Array([0]), uint64(expiresAfter, "expiry"));
  return keccak256(concatBytes(parts));
}

/** The "phantom agent" Hyperliquid has the agent sign for an L1 action on mainnet (source "a"). */
export function l1ActionTypedData(action: L1Action, nonce: number, vaultAddress?: string, expiresAfter?: number): TypedData {
  return {
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: ZERO_ADDRESS },
    types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
    primaryType: "Agent",
    message: { source: "a", connectionId: l1ActionHash(action, nonce, vaultAddress, expiresAfter) }
  };
}

// ---------------------------------------------------------------- HIP-3 margin (agent-signed)

/** HyperCore's USDC token, as `sendAsset` names it ("name:tokenId" from `spotMeta`). */
export const USDC_TOKEN_ID = "USDC:0x6d1e7cde53ba9467b783cb7c530ce054";

export type AgentSendAssetAction = {
  type: "agentSendAsset";
  destination: `0x${string}`;
  sourceDex: string;
  destinationDex: string;
  token: string;
  amount: string;
  fromSubAccount: "";
  nonce: number;
};

/**
 * Move USDC between the customer's own perp balances, e.g. from the main dex
 * ("") to a HIP-3 dex ("xyz") before trading there, or back after closing. In
 * Hyperliquid's standard account mode each dex has its own balance. The agent
 * signs it as an L1 action; Hyperliquid only accepts a destination equal to the
 * account itself, so the agent still cannot move money out. `nonce` must equal
 * the request nonce. Key order follows Hyperliquid's `sendAsset`.
 */
export function buildAgentSendAssetAction(input: { owner: string; sourceDex: string; destinationDex: string; amount: string;
  nonce: number }): AgentSendAssetAction {
  const dex = /^(|spot|[a-z0-9]{1,12})$/;
  if (!dex.test(input.sourceDex) || !dex.test(input.destinationDex) || input.sourceDex === input.destinationDex) {
    throw invalid("The balances to move between are not valid.");
  }
  return {
    type: "agentSendAsset", destination: lowerAddress(input.owner, "account"), sourceDex: input.sourceDex,
    destinationDex: input.destinationDex, token: USDC_TOKEN_ID, amount: usdcAmount(input.amount), fromSubAccount: "",
    nonce: timestamp(input.nonce, "nonce")
  };
}

/**
 * Set the account's abstraction mode from the agent (L1). "i" is standard
 * (separate balance per dex, Aura's choice: per-dex states stay readable and
 * HIP-3 margin moves are explicit), "u" unified account, "p" portfolio margin.
 */
export function buildAgentSetAbstractionAction(mode: "i" | "u" | "p"): { type: "agentSetAbstraction"; abstraction: "i" | "u" | "p" } {
  if (mode !== "i" && mode !== "u" && mode !== "p") throw invalid("The account mode is not valid.");
  return { type: "agentSetAbstraction", abstraction: mode };
}

// ---------------------------------------------------------------- submit

export type ExchangeStatus =
  | { kind: "resting"; oid: number }
  | { kind: "filled"; oid: number; totalSz: string; avgPx: string }
  | { kind: "success" }
  | { kind: "waiting"; for: "fill" | "trigger" }
  | { kind: "error"; message: string };

export type ExchangeResult = { type: string; statuses: ExchangeStatus[] };

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const oid = z.number().int().nonnegative();
const statusSchema = z.union([
  z.object({ resting: z.object({ oid }) }),
  z.object({ filled: z.object({ oid, totalSz: decimal, avgPx: decimal }) }),
  z.object({ error: z.string().max(2_000) }),
  z.enum(["success", "waitingForFill", "waitingForTrigger"])
]);
const exchangeResponse = z.union([
  z.object({ status: z.literal("err"), response: z.string().max(2_000) }),
  z.object({
    status: z.literal("ok"),
    response: z.object({
      type: z.string().max(60),
      data: z.object({ statuses: z.array(statusSchema).max(1_000) }).optional()
    })
  })
]);

function toStatus(status: z.output<typeof statusSchema>): ExchangeStatus {
  if (status === "success") return { kind: "success" };
  if (status === "waitingForFill") return { kind: "waiting", for: "fill" };
  if (status === "waitingForTrigger") return { kind: "waiting", for: "trigger" };
  if ("resting" in status) return { kind: "resting", oid: status.resting.oid };
  if ("filled" in status) return { kind: "filled", ...status.filled };
  return { kind: "error", message: status.error };
}

/** Hyperliquid answers rejections in prose; these are the ones a caller may want to branch on. */
function rejectionCode(message: string): string {
  if (/does not exist/i.test(message)) return "account_not_found";
  if (/must deposit before/i.test(message)) return "account_not_funded";
  if (/insufficient margin|not enough margin/i.test(message)) return "insufficient_margin";
  if (/minimum value/i.test(message)) return "below_minimum";
  if (/nonce/i.test(message)) return "invalid_nonce";
  if (/could not immediately match/i.test(message)) return "no_liquidity";
  return "rejected";
}

/** 65-byte r ‖ s ‖ v hex, as viem and Privy return it, split the way /exchange expects. */
export function splitSignature(signature: string): { r: `0x${string}`; s: `0x${string}`; v: 27 | 28 } {
  if (!/^0x[\da-fA-F]{130}$/.test(signature)) throw invalid("The signature is not valid.");
  const raw = Number.parseInt(signature.slice(130, 132), 16);
  const v = raw < 27 ? raw + 27 : raw;
  if (v !== 27 && v !== 28) throw invalid("The signature is not valid.");
  return { r: `0x${signature.slice(2, 66).toLowerCase()}`, s: `0x${signature.slice(66, 130).toLowerCase()}`, v };
}

/**
 * POST a signed action to /exchange. A top-level `err`, or a batch in which
 * every status is an error (a single rejected order), throws VenueError with
 * Hyperliquid's own message. A partly rejected batch returns all statuses.
 */
export async function submitExchange(
  input: { action: L1Action | ApproveAgentAction | WithdrawAction | SendToEvmWithDataAction; nonce: number; signature: string;
    vaultAddress?: string; expiresAfter?: number },
  options: { fetcher?: typeof fetch } = {}
): Promise<ExchangeResult> {
  const body = {
    action: input.action,
    nonce: timestamp(input.nonce, "nonce"),
    signature: splitSignature(input.signature),
    ...(input.vaultAddress === undefined ? {} : { vaultAddress: lowerAddress(input.vaultAddress, "vault address") }),
    ...(input.expiresAfter === undefined ? {} : { expiresAfter: timestamp(input.expiresAfter, "expiry") })
  };
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${hyperliquidApiUrl()}/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store"
    });
  } catch {
    // The action may still have reached Hyperliquid; callers re-read state rather than retry blindly.
    throw new VenueError("hyperliquid", "unavailable", "Hyperliquid did not answer.", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) throw new VenueError("hyperliquid", "rate_limited", "Hyperliquid is busy. Try again shortly.", 503);
    if (response.status === 422) throw new VenueError("hyperliquid", "malformed_request", "Hyperliquid could not read the request.");
    throw new VenueError("hyperliquid", "unavailable", `Hyperliquid answered HTTP ${response.status}.`, 503);
  }
  const json = await readBoundedJson(response, 200_000).catch(() => {
    throw new VenueError("hyperliquid", "invalid_response", "Hyperliquid sent an unreadable answer.");
  });
  const parsed = exchangeResponse.safeParse(json);
  if (!parsed.success) throw new VenueError("hyperliquid", "invalid_response", "Hyperliquid sent an unexpected answer.");
  const result = parsed.data;
  if (result.status === "err") throw new VenueError("hyperliquid", rejectionCode(result.response), result.response, 422);
  const statuses = (result.response.data?.statuses ?? []).map(toStatus);
  const errors = statuses.flatMap((status) => status.kind === "error" ? [status.message] : []);
  if (statuses.length > 0 && errors.length === statuses.length) {
    throw new VenueError("hyperliquid", rejectionCode(errors[0]), errors.join(" "), 422);
  }
  return { type: result.response.type, statuses };
}
