#!/usr/bin/env node

// Check every asset in the registry against the live chains: the contract
// exists, and its decimals and symbol match the entry. Run it after adding or
// changing an asset (`pnpm assets:check`). RPC_URL_<chainId> overrides the
// public endpoint for a network.

import { pathToFileURL } from "node:url";
import { ASSETS } from "../apps/web/src/lib/assets/registry.ts";

const PUBLIC_RPC = {
  1: "https://ethereum-rpc.publicnode.com",
  10: "https://mainnet.optimism.io",
  137: "https://polygon-bor-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  42161: "https://arb1.arbitrum.io/rpc"
};
const DECIMALS = "0x313ce567";
const SYMBOL = "0x95d89b41";

/** Decode an ABI string, or a bytes32 symbol as some older tokens return. */
export function decodeSymbol(hex) {
  const data = hex.slice(2);
  if (data.length === 64) return Buffer.from(data, "hex").toString("utf8").replace(/\0+$/, "");
  const length = Number.parseInt(data.slice(64, 128), 16);
  return Buffer.from(data.slice(128, 128 + length * 2), "hex").toString("utf8");
}

export async function checkAssets({ assets = ASSETS, fetcher = fetch, env = process.env } = {}) {
  const failures = [];
  const lines = [];
  const call = async (chainId, method, params) => {
    const url = env[`RPC_URL_${chainId}`] || PUBLIC_RPC[chainId];
    if (!url) throw new Error(`no RPC endpoint for chain ${chainId}`);
    const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`chain ${chainId} RPC returned ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`chain ${chainId} RPC: ${payload.error.message}`);
    return payload.result;
  };
  for (const asset of assets) {
    const label = `${asset.symbol} (${asset.id})`;
    try {
      if (asset.address === null) {
        if (asset.decimals !== 18) throw new Error("a native coin has 18 decimals");
        lines.push(`ok    ${label}: native coin`);
        continue;
      }
      const code = await call(asset.chainId, "eth_getCode", [asset.address, "latest"]);
      if (!code || code === "0x") throw new Error("no contract code");
      const decimals = Number.parseInt(await call(asset.chainId, "eth_call", [{ to: asset.address, data: DECIMALS }, "latest"]), 16);
      if (decimals !== asset.decimals) throw new Error(`contract has ${decimals} decimals; the registry says ${asset.decimals}`);
      const symbol = decodeSymbol(await call(asset.chainId, "eth_call", [{ to: asset.address, data: SYMBOL }, "latest"]));
      if (symbol !== asset.symbol) throw new Error(`contract symbol is ${JSON.stringify(symbol)}; the registry says ${JSON.stringify(asset.symbol)}`);
      lines.push(`ok    ${label}: contract, ${decimals} decimals, symbol ${symbol}`);
    } catch (error) {
      failures.push(label);
      lines.push(`FAIL  ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: failures.length === 0, lines, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await checkAssets();
  for (const line of result.lines) console.log(line);
  if (!result.ok) { console.error(`${result.failures.length} asset(s) failed.`); process.exit(1); }
}
