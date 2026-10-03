import { encodeFunctionData, erc20Abi, getAddress, isAddress } from "viem";
import { z } from "zod";
import { VenueError } from "../types";
import type { WalletCall } from "./account";
import { POLYMARKET_CONTRACTS, ZERO_BYTES32, builderCode, numeric, polymarketRequest, type RequestOptions } from "./http";

/**
 * Polymarket's bridge moves money between Base USDC and the Deposit
 * Wallet's pUSD on Polygon. A deposit is USDC sent to the wallet's bridge
 * address on Base; a withdrawal is pUSD sent from the wallet (an owner-signed
 * batch) to a bridge address that delivers USDC to the recipient on Base.
 * The bridge's status is corroboration; the chains are the authority.
 */

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const evmAddress = z.string().regex(/^0x[\da-fA-F]{40}$/).transform((value) => getAddress(value));
const addressesResponse = z.object({ address: z.object({ evm: evmAddress }).passthrough() });

const checkedAddress = (value: string, what: string) => {
  if (!isAddress(value, { strict: false })) throw new VenueError("polymarket", "invalid_request", `Invalid ${what} address.`, 400);
  return getAddress(value);
};

/** Aura's builder code on bridge requests, so stuck transfers can be traced; omitted while it is zero. */
function builderHeader(): Record<string, string> {
  const code = builderCode();
  return code === ZERO_BYTES32 ? {} : { "X-Builder-Code": code };
}

/** The wallet's EVM bridge address: USDC sent there on Base arrives as pUSD in the wallet. */
export async function depositAddress(wallet: string, options: RequestOptions = {}): Promise<`0x${string}`> {
  const result = await polymarketRequest({
    service: "bridge", method: "POST", path: "/deposit", body: { address: checkedAddress(wallet, "wallet") },
    headers: builderHeader(), schema: addressesResponse, fetcher: options.fetcher
  });
  return result.address.evm;
}

const assetsResponse = z.object({
  supportedAssets: z.array(z.object({
    chainId: z.union([z.string(), z.number()]).transform(String),
    token: z.object({ address: z.string().max(100), symbol: z.string().max(40), decimals: z.number().int() }),
    minCheckoutUsd: numeric.nullish()
  }).passthrough()).max(5_000)
});

/** The bridge's minimum for a Base USDC deposit, in USD. Below it a deposit is not processed. */
export async function baseUsdcDepositMinimum(options: RequestOptions = {}): Promise<number> {
  const result = await polymarketRequest({ service: "bridge", path: "/supported-assets", schema: assetsResponse, maxBytes: 2_000_000, fetcher: options.fetcher });
  const asset = result.supportedAssets.find((entry) => entry.chainId === String(BASE_CHAIN_ID) && entry.token.address.toLowerCase() === BASE_USDC);
  if (!asset || asset.token.decimals !== 6 || asset.minCheckoutUsd === null || asset.minCheckoutUsd === undefined) {
    throw new VenueError("polymarket", "unsupported_asset", "Polymarket's bridge does not take Base USDC right now.", 503);
  }
  return asset.minCheckoutUsd;
}

/**
 * A bridge address for one withdrawal to `recipient` as USDC on Base. Make
 * it only when the customer is withdrawing: each address is tied to this
 * destination.
 */
export async function withdrawAddress(input: { wallet: string; recipient: string }, options: RequestOptions = {}): Promise<`0x${string}`> {
  const result = await polymarketRequest({
    service: "bridge", method: "POST", path: "/withdraw",
    body: { address: checkedAddress(input.wallet, "wallet"), toChainId: String(BASE_CHAIN_ID), toTokenAddress: getAddress(BASE_USDC), recipientAddr: checkedAddress(input.recipient, "recipient") },
    headers: builderHeader(), schema: addressesResponse, fetcher: options.fetcher
  });
  return result.address.evm;
}

export type BridgeTransfer = {
  status: "DEPOSIT_DETECTED" | "PROCESSING" | "ORIGIN_TX_CONFIRMED" | "SUBMITTED" | "COMPLETED" | "FAILED";
  fromChainId: string;
  fromTokenAddress: string;
  fromAmountRaw: string;
  toChainId: string;
  toTokenAddress: string;
  /** Destination transaction, once completed. */
  txHash: string | null;
  createdAt: string | null;
};

const statusResponse = z.object({
  transactions: z.array(z.object({
    fromChainId: z.union([z.string(), z.number()]).transform(String),
    fromTokenAddress: z.string().max(100),
    fromAmountBaseUnit: z.union([z.string().regex(/^\d{1,78}$/), z.number().int().nonnegative().transform(String)]),
    toChainId: z.union([z.string(), z.number()]).transform(String),
    toTokenAddress: z.string().max(100),
    status: z.enum(["DEPOSIT_DETECTED", "PROCESSING", "ORIGIN_TX_CONFIRMED", "SUBMITTED", "COMPLETED", "FAILED"]),
    txHash: z.string().max(200).nullish(),
    createdTimeMs: z.number().int().nonnegative().nullish()
  })).max(100)
});

/** Transfers seen at a bridge address (from `depositAddress` or `withdrawAddress`), newest first. */
export async function bridgeStatus(bridgeAddress: string, options: RequestOptions = {}): Promise<BridgeTransfer[]> {
  const result = await polymarketRequest({
    service: "bridge", path: `/status/${checkedAddress(bridgeAddress, "bridge")}`, query: { limit: 50 },
    schema: statusResponse, fetcher: options.fetcher
  });
  return result.transactions.map((tx) => ({
    status: tx.status, fromChainId: tx.fromChainId, fromTokenAddress: tx.fromTokenAddress, fromAmountRaw: tx.fromAmountBaseUnit,
    toChainId: tx.toChainId, toTokenAddress: tx.toTokenAddress, txHash: tx.txHash || null,
    createdAt: tx.createdTimeMs ? new Date(tx.createdTimeMs).toISOString() : null
  }));
}

/** The wallet call that sends `amountRaw` pUSD (6 decimals) to `to`, for a withdrawal batch. */
export function pusdTransferCall(to: string, amountRaw: bigint | string): WalletCall {
  const amount = typeof amountRaw === "bigint" ? amountRaw : /^\d{1,78}$/.test(amountRaw) ? BigInt(amountRaw) : -1n;
  if (amount <= 0n) throw new VenueError("polymarket", "invalid_request", "Invalid amount.", 400);
  return {
    target: POLYMARKET_CONTRACTS.pusd, value: "0",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [checkedAddress(to, "recipient"), amount] })
  };
}
