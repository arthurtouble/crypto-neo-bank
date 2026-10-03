import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import { jsonRpc, rpcEndpoints } from "@/lib/chain/rpc";
import { VenueError } from "../types";
import { POLYGON_CHAIN_ID } from "./http";

/**
 * Polygon reads for Polymarket: the chain is the authority on balances,
 * deployments, and approvals. Each read tries the configured endpoints in
 * order; when every one fails the read is unavailable, never a guess.
 */

export type ChainOptions = { fetcher?: typeof fetch };

export async function polygonRpc<T>(method: string, params: unknown[], options: ChainOptions = {}): Promise<T> {
  for (const endpoint of rpcEndpoints(POLYGON_CHAIN_ID)) {
    try {
      return await jsonRpc<T>(options.fetcher ?? fetch, endpoint, method, params);
    } catch { /* next endpoint */ }
  }
  throw new VenueError("polymarket", "chain_unavailable", "Polygon could not be read.", 503);
}

const hex = (value: unknown): Hex => {
  if (typeof value !== "string" || !/^0x[\da-fA-F]*$/.test(value)) throw new VenueError("polymarket", "chain_unavailable", "Polygon sent an unexpected answer.", 503);
  return value as Hex;
};

export async function ethCall(to: string, data: Hex, options: ChainOptions = {}): Promise<Hex> {
  return hex(await polygonRpc<unknown>("eth_call", [{ to, data }, "latest"], options));
}

export async function ethGetCode(address: string, options: ChainOptions = {}): Promise<Hex> {
  return hex(await polygonRpc<unknown>("eth_getCode", [address, "latest"], options));
}

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const aggregate3Abi = [{
  type: "function", name: "aggregate3", stateMutability: "payable",
  inputs: [{ name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" }] }],
  outputs: [{ name: "returnData", type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }]
}] as const;

/** Several view calls in one `eth_call` through Multicall3; a failed inner call fails the read. */
export async function multicall(calls: Array<{ target: `0x${string}`; data: Hex }>, options: ChainOptions = {}): Promise<Hex[]> {
  const data = encodeFunctionData({ abi: aggregate3Abi, functionName: "aggregate3", args: [calls.map((call) => ({ target: call.target, allowFailure: false, callData: call.data }))] });
  const result = await ethCall(MULTICALL3, data, options);
  try {
    const decoded = decodeFunctionResult({ abi: aggregate3Abi, functionName: "aggregate3", data: result });
    if (decoded.length !== calls.length || decoded.some((entry) => !entry.success)) throw new Error("mismatch");
    return decoded.map((entry) => entry.returnData);
  } catch {
    throw new VenueError("polymarket", "chain_unavailable", "Polygon sent an unexpected answer.", 503);
  }
}
