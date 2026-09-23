#!/usr/bin/env node

import { AAVE_BASE_ASSETS, AAVE_BASE_V3_MARKET } from "../apps/web/src/lib/defi/aave.ts";

const chains = [
  { name: "Base", id: 8453, rpc: "https://base-rpc.publicnode.com", contracts: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"] },
  { name: "Ethereum", id: 1, rpc: "https://ethereum-rpc.publicnode.com", contracts: ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"] },
  { name: "Arbitrum", id: 42161, rpc: "https://arb1.arbitrum.io/rpc", contracts: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831"] },
  { name: "Optimism", id: 10, rpc: "https://mainnet.optimism.io", contracts: ["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"] },
  { name: "Polygon", id: 137, rpc: "https://polygon-bor-rpc.publicnode.com", contracts: ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"] }
];

async function rpc(chain, method, params = []) {
  const response = await fetch(chain.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`${chain.name} RPC returned ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${chain.name} RPC: ${payload.error.message}`);
  return payload.result;
}

async function checkChain(chain) {
  const returnedId = Number.parseInt(await rpc(chain, "eth_chainId"), 16);
  if (returnedId !== chain.id) throw new Error(`${chain.name} returned chain ${returnedId}; expected ${chain.id}`);
  for (const address of chain.contracts) {
    const code = await rpc(chain, "eth_getCode", [address, "latest"]);
    if (!code || code === "0x") throw new Error(`${chain.name} has no contract code at ${address}`);
  }
  return `${chain.name}: chain ${chain.id}, ${chain.contracts.length} allowlisted contract checked`;
}

async function checkLifi() {
  const url = new URL("https://li.quest/v1/quote");
  url.search = new URLSearchParams({
    fromChain: "8453",
    toChain: "42161",
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    toToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    fromAmount: "1000000",
    fromAddress: "0x000000000000000000000000000000000000dEaD"
  }).toString();
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`LI.FI quote returned ${response.status}: ${(await response.text()).slice(0, 180)}`);
  const quote = await response.json();
  if (!quote.transactionRequest?.to || !quote.estimate?.toAmount || !quote.tool) throw new Error("LI.FI quote omitted execution or estimate fields");
  return `LI.FI: ${quote.tool}, estimated destination amount ${quote.estimate.toAmount}`;
}

async function checkAaveBase() {
  const chain = chains[0];
  // Aave V3 Base address book: https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol
  const provider = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D";
  const published = { pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH: "0x4200000000000000000000000000000000000006" };
  for (const [name, configured] of Object.entries({ pool: AAVE_BASE_V3_MARKET, ...AAVE_BASE_ASSETS }))
    if (!published[name] || configured.toLowerCase() !== published[name].toLowerCase()) throw new Error(`Aave Base ${name} differs from reviewed address-book snapshot.`);
  for (const address of [provider, AAVE_BASE_V3_MARKET, ...Object.values(AAVE_BASE_ASSETS)]) {
    const code = await rpc(chain, "eth_getCode", [address, "latest"]);
    if (!code || code === "0x") throw new Error(`Aave Base has no contract code at ${address}`);
    if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) throw new Error(`Aave Base has invalid contract code at ${address}`);
  }
  const result = await rpc(chain, "eth_call", [{ to: provider, data: "0x026b1d5f" }, "latest"]); // getPool()
  if (typeof result !== "string" || !/^0x[0-9a-f]{64}$/i.test(result)) throw new Error("Aave Base address provider returned an invalid Pool.");
  const activePool = `0x${result.slice(-40)}`;
  if (activePool.toLowerCase() !== AAVE_BASE_V3_MARKET.toLowerCase()) throw new Error(`Aave Base Pool differs from governed address: ${activePool}`);
  return "Aave Base: active Pool matches governed address; deployed code at provider, Pool, USDC, and WETH";
}

const results = await Promise.allSettled([...chains.map(checkChain), checkLifi(), checkAaveBase()]);
let failed = false;
for (const result of results) {
  if (result.status === "fulfilled") console.log(`PASS  ${result.value}`);
  else {
    failed = true;
    console.error(`FAIL  ${result.reason?.message ?? result.reason}`);
  }
}
console.log("Read-only checks only; no transaction was constructed, signed, or broadcast.");
if (failed) process.exitCode = 1;
