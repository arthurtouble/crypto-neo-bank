import {
  concat, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, getContractAddress, isAddress,
  keccak256, maxUint256, numberToHex, pad, recoverTypedDataAddress, type Hex
} from "viem";
import { z } from "zod";
import { VenueError, type TypedData } from "../types";
import { ethGetCode, multicall, type ChainOptions } from "./chain";
import { POLYGON_CHAIN_ID, POLYMARKET_CONTRACTS, address, builderCredentials, builderHeaders, polymarketRequest, uintString, type ApiCredentials } from "./http";

/**
 * The customer's Polymarket account is a Deposit Wallet (signature type 3)
 * owned by their own Privy wallet. Aura never holds a key to it: Aura's
 * Builder key only pays gas through Polymarket's relayer, and every action
 * the wallet takes is a `Batch` the owner signed. These helpers build what
 * the owner signs and submit it once signed.
 */

const C = POLYMARKET_CONTRACTS;

export type WalletCall = { target: `0x${string}`; value: string; data: Hex };

function ownerAddress(owner: string): `0x${string}` {
  if (!isAddress(owner, { strict: false })) throw new VenueError("polymarket", "invalid_request", "Invalid wallet address.", 400);
  return getAddress(owner);
}

const BEACON_PREFIX = 0x6100523d8160233d3973n;
const BEACON_CONST1 = "0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3";
const BEACON_CONST2 = "0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c";
const BEACON_CONST3 = "0x60195155f3363d3d373d3d363d602036600436635c60da";

/**
 * The owner's Deposit Wallet address: CREATE2 by the factory of Solady's
 * ERC-1967 beacon proxy, salted by `abi.encode(factory, bytes32(owner))`. New
 * wallets have used the beacon since 29 June 2026 (the factory's `beacon()`
 * answered 0x7A18…fc3a on 3 October 2026), so it is derived without a chain read.
 */
export function depositWalletAddress(owner: string): `0x${string}` {
  const args = encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [C.depositWalletFactory, pad(ownerAddress(owner), { size: 32 })]);
  const argsLength = BigInt((args.length - 2) / 2);
  const initCode = concat([numberToHex(BEACON_PREFIX + (argsLength << 56n), { size: 10 }), C.depositWalletBeacon, BEACON_CONST3, BEACON_CONST2, BEACON_CONST1, args]);
  return getContractAddress({ opcode: "CREATE2", from: C.depositWalletFactory, salt: keccak256(args), bytecodeHash: keccak256(initCode) });
}

/** Whether the wallet has code on Polygon. The chain answers, not the relayer. */
export async function isDeployed(wallet: string, options: ChainOptions = {}): Promise<boolean> {
  const code = await ethGetCode(ownerAddress(wallet), options);
  return code !== "0x" && code.length > 2;
}

type RelayerOptions = { fetcher?: typeof fetch; credentials?: ApiCredentials; now?: Date };

const relayerSign = (options: RelayerOptions) => {
  const credentials = options.credentials ?? builderCredentials();
  return (method: string, path: string, body: string | undefined) => builderHeaders(credentials, method, path, body, options.now);
};

const relayerState = z.enum(["STATE_NEW", "STATE_EXECUTED", "STATE_MINED", "STATE_CONFIRMED", "STATE_INVALID", "STATE_FAILED"]);
const txHash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const submitted = z.object({ transactionID: z.string().min(1).max(200), state: relayerState, transactionHash: txHash.nullish() });

export type RelayerSubmission = { transactionId: string; state: z.output<typeof relayerState>; transactionHash: `0x${string}` | null };

const toSubmission = (value: z.output<typeof submitted>): RelayerSubmission =>
  ({ transactionId: value.transactionID, state: value.state, transactionHash: (value.transactionHash ?? null) as `0x${string}` | null });

/**
 * Ask the relayer to deploy the owner's Deposit Wallet (gas paid through
 * Aura's Builder key). The owner signs nothing for this step; the wallet's
 * address is fixed by the owner, so no one else can take it.
 */
export async function deployDepositWallet(owner: string, options: RelayerOptions = {}): Promise<RelayerSubmission> {
  const body = { type: "WALLET-CREATE", from: ownerAddress(owner), to: C.depositWalletFactory, metadata: "Deploy Deposit Wallet" };
  return toSubmission(await polymarketRequest({ service: "relayer", method: "POST", path: "/submit", body, sign: relayerSign(options), schema: submitted, fetcher: options.fetcher }));
}

const transactionSchema = z.object({
  transaction_id: z.string().min(1).max(200),
  transaction_hash: z.union([z.literal(""), txHash]).nullish(),
  state: relayerState,
  error_msg: z.string().max(1_000).nullish()
});

export type RelayerTransaction = {
  transactionId: string;
  state: z.output<typeof relayerState>;
  /** `confirmed` and `failed` are final; anything else is still on its way. */
  outcome: "pending" | "confirmed" | "failed";
  transactionHash: `0x${string}` | null;
  error: string | null;
};

/** One relayer transaction's state, for polling until `confirmed` or `failed`. */
export async function relayerTransaction(id: string, options: RelayerOptions = {}): Promise<RelayerTransaction> {
  if (!/^[\w-]{1,200}$/.test(id)) throw new VenueError("polymarket", "invalid_request", "Unknown transaction.", 400);
  const tx = await polymarketRequest({ service: "relayer", path: `/v1/account/transactions/${id}`, sign: relayerSign(options), schema: transactionSchema, fetcher: options.fetcher });
  return {
    transactionId: tx.transaction_id,
    state: tx.state,
    outcome: tx.state === "STATE_CONFIRMED" ? "confirmed" : tx.state === "STATE_FAILED" || tx.state === "STATE_INVALID" ? "failed" : "pending",
    transactionHash: (tx.transaction_hash || null) as `0x${string}` | null,
    error: tx.error_msg ?? null
  };
}

/** The relayer's next `WALLET` nonce for the owner; every batch signs a fresh one. */
export async function fetchWalletNonce(owner: string, options: RelayerOptions = {}): Promise<string> {
  const result = await polymarketRequest({
    service: "relayer", path: "/v1/account/transactions/params", query: { address: ownerAddress(owner), type: "WALLET" },
    sign: relayerSign(options), schema: z.object({ address, nonce: uintString }), fetcher: options.fetcher
  });
  return result.nonce;
}

/** A batch deadline `seconds` from now (the SDK's default is 10 minutes). */
export const batchDeadline = (now = new Date(), seconds = 600) => String(Math.floor(now.getTime() / 1000) + seconds);

const EIP712_DOMAIN_FULL = [
  { name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }
];

function checkCalls(calls: readonly WalletCall[]): WalletCall[] {
  if (calls.length === 0 || calls.length > 50) throw new VenueError("polymarket", "invalid_request", "A wallet batch needs 1 to 50 calls.", 400);
  return calls.map((call) => {
    if (!isAddress(call.target, { strict: false }) || !/^\d{1,78}$/.test(call.value) || !/^0x([\da-fA-F]{2})*$/.test(call.data)) {
      throw new VenueError("polymarket", "invalid_request", "Invalid wallet call.", 400);
    }
    return { target: getAddress(call.target), value: call.value, data: call.data.toLowerCase() as Hex };
  });
}

export type WalletBatch = { wallet: string; nonce: string; deadline: string; calls: readonly WalletCall[] };

/** The Deposit Wallet `Batch` the owner signs: domain `DepositWallet` v1 on the wallet itself. */
export function walletBatchTypedData(batch: WalletBatch): TypedData {
  if (!/^\d{1,78}$/.test(batch.nonce) || !/^\d{1,20}$/.test(batch.deadline)) throw new VenueError("polymarket", "invalid_request", "Invalid batch.", 400);
  const wallet = ownerAddress(batch.wallet);
  return {
    domain: { name: "DepositWallet", version: "1", chainId: POLYGON_CHAIN_ID, verifyingContract: wallet },
    types: {
      EIP712Domain: EIP712_DOMAIN_FULL,
      Batch: [{ name: "wallet", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "calls", type: "Call[]" }],
      Call: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }]
    },
    primaryType: "Batch",
    message: { wallet, nonce: batch.nonce, deadline: batch.deadline, calls: checkCalls(batch.calls) }
  };
}

/**
 * Recover who signed `typedData` and require it to be the owner. Privy
 * returns what the wallet signed; this keeps a wrong or swapped signature
 * from ever reaching Polymarket.
 */
export async function assertOwnerSignature(typedData: TypedData, signature: string, owner: string): Promise<void> {
  if (!/^0x[\da-fA-F]{130}$/.test(signature)) throw new VenueError("polymarket", "invalid_signature", "The signature is malformed.", 400);
  let signer: string;
  try {
    const types = Object.fromEntries(Object.entries(typedData.types).filter(([name]) => name !== "EIP712Domain"));
    signer = await recoverTypedDataAddress({ domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message, signature: signature as Hex } as Parameters<typeof recoverTypedDataAddress>[0]);
  } catch {
    throw new VenueError("polymarket", "invalid_signature", "The signature could not be checked.", 400);
  }
  if (signer.toLowerCase() !== ownerAddress(owner).toLowerCase()) throw new VenueError("polymarket", "invalid_signature", "The signature is not from this wallet's owner.", 400);
}

/**
 * Submit an owner-signed batch through the relayer. The signature is the
 * owner's raw ECDSA signature: an owner signs for its own wallet, so nothing
 * wraps it (only session keys do). A "batch nonce does not match" rejection
 * means the batch must be rebuilt and signed again (see `staleBatchNonce`).
 */
export async function submitWalletBatch(input: WalletBatch & { owner: string; signature: string; metadata?: string }, options: RelayerOptions = {}): Promise<RelayerSubmission> {
  const typedData = walletBatchTypedData(input);
  await assertOwnerSignature(typedData, input.signature, input.owner);
  const owner = ownerAddress(input.owner);
  if (getAddress(input.wallet) !== depositWalletAddress(owner)) throw new VenueError("polymarket", "invalid_request", "This wallet does not belong to this owner.", 400);
  const metadata = (input.metadata ?? "Aura wallet batch").slice(0, 500);
  const body = {
    type: "WALLET", from: owner, to: C.depositWalletFactory, nonce: input.nonce, signature: input.signature.toLowerCase(), metadata,
    depositWalletParams: { depositWallet: getAddress(input.wallet), deadline: input.deadline, calls: (typedData.message as { calls: WalletCall[] }).calls }
  };
  return toSubmission(await polymarketRequest({ service: "relayer", method: "POST", path: "/submit", body, sign: relayerSign(options), schema: submitted, fetcher: options.fetcher }));
}

/** The on-chain nonce from a "batch nonce N does not match on-chain nonce M" rejection, if that is what it was. */
export function staleBatchNonce(error: unknown): string | null {
  if (!(error instanceof VenueError) || error.venue !== "polymarket" || error.code !== "rejected") return null;
  return /batch nonce\s+\d+\s+does not match on-chain nonce\s+(\d+)/i.exec(error.message)?.[1] ?? null;
}

const erc1155Abi = [
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }], outputs: [{ type: "bool" }] }
] as const;

/**
 * What the SDK's `setupTradingApprovals` grants a Deposit Wallet, in its
 * order: pUSD to both CLOB exchanges, the exchange v3, the collateral
 * adapters, and the v2 router; outcome tokens (CTF and the v2 position
 * manager) to the exchanges, adapters, modules, router, and auto-redeem
 * operator. Aura leaves out the SDK's pUSD approval to Polymarket's perps
 * deposit contract: Aura does not offer Polymarket perps.
 */
export const TRADING_APPROVALS: ReadonlyArray<{ kind: "erc20"; token: `0x${string}`; spender: `0x${string}` } | { kind: "erc1155"; token: `0x${string}`; operator: `0x${string}` }> = [
  { kind: "erc20", token: C.pusd, spender: C.standardExchange },
  { kind: "erc20", token: C.pusd, spender: C.negRiskExchange },
  { kind: "erc20", token: C.pusd, spender: C.collateralAdapter },
  { kind: "erc20", token: C.pusd, spender: C.negRiskCollateralAdapter },
  { kind: "erc20", token: C.pusd, spender: C.protocolV2Router },
  { kind: "erc20", token: C.pusd, spender: C.exchangeV3 },
  { kind: "erc1155", token: C.conditionalTokens, operator: C.standardExchange },
  { kind: "erc1155", token: C.conditionalTokens, operator: C.negRiskExchange },
  { kind: "erc1155", token: C.conditionalTokens, operator: C.collateralAdapter },
  { kind: "erc1155", token: C.conditionalTokens, operator: C.negRiskCollateralAdapter },
  { kind: "erc1155", token: C.conditionalTokens, operator: C.autoRedeemOperator },
  { kind: "erc1155", token: C.conditionalTokens, operator: C.binaryModule },
  { kind: "erc1155", token: C.conditionalTokens, operator: C.negRiskModule },
  { kind: "erc1155", token: C.positionManager, operator: C.protocolV2Router },
  { kind: "erc1155", token: C.positionManager, operator: C.exchangeV3 },
  { kind: "erc1155", token: C.positionManager, operator: C.autoRedeemOperator }
];

function approvalCall(approval: (typeof TRADING_APPROVALS)[number]): WalletCall {
  return approval.kind === "erc20"
    ? { target: approval.token, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approval.spender, maxUint256] }) }
    : { target: approval.token, value: "0", data: encodeFunctionData({ abi: erc1155Abi, functionName: "setApprovalForAll", args: [approval.operator, true] }) };
}

/** Every trading approval as a wallet call, for a first-time setup batch. */
export function approvalCalls(): WalletCall[] {
  return TRADING_APPROVALS.map(approvalCall);
}

/**
 * Which approvals the wallet still lacks, read from Polygon in one
 * multicall. `missing` is ready to go into `walletBatchTypedData`.
 */
export async function tradingApprovalsState(wallet: string, options: ChainOptions = {}): Promise<{ ready: boolean; missing: WalletCall[] }> {
  const owner = ownerAddress(wallet);
  const results = await multicall(TRADING_APPROVALS.map((approval) => approval.kind === "erc20"
    ? { target: approval.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, approval.spender] }) }
    : { target: approval.token, data: encodeFunctionData({ abi: erc1155Abi, functionName: "isApprovedForAll", args: [owner, approval.operator] }) }), options);
  const missing = TRADING_APPROVALS.filter((approval, index) => {
    const data = results[index] as Hex;
    try {
      // Setup grants the maximum; anything far below it was never granted or was revoked.
      return approval.kind === "erc20"
        ? decodeFunctionResult({ abi: erc20Abi, functionName: "allowance", data }) < maxUint256 / 2n
        : !decodeFunctionResult({ abi: erc1155Abi, functionName: "isApprovedForAll", data });
    } catch {
      throw new VenueError("polymarket", "chain_unavailable", "Polygon sent an unexpected answer.", 503);
    }
  });
  return { ready: missing.length === 0, missing: missing.map(approvalCall) };
}
