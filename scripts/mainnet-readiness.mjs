#!/usr/bin/env node

import { AAVE_BASE_ASSETS, AAVE_BASE_PROTOCOL, AAVE_BASE_V3_MARKET } from "../apps/web/src/lib/defi/aave-contracts.ts";
import { LIFI_DIAMOND } from "../apps/web/src/lib/actions/lifi-diamond.ts";

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

function addressWord(result, label) {
  if (typeof result !== "string" || !/^0x0{24}[0-9a-f]{40}$/i.test(result))
    throw new Error(`${label} returned an invalid address word.`);
  return `0x${result.slice(-40)}`;
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

async function checkLifiDiamond() {
  // Route actions pin their call target and approval spender to this address on every chain.
  // https://github.com/lifinance/contracts/blob/main/deployments/base.json
  for (const chain of chains) {
    const code = await rpc(chain, "eth_getCode", [LIFI_DIAMOND, "latest"]);
    if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code))
      throw new Error(`LI.FI Diamond has no contract code on ${chain.name}`);
  }
  return `LI.FI Diamond: deployed code at ${LIFI_DIAMOND} on ${chains.map((chain) => chain.name).join(", ")}`;
}

async function checkAaveBase() {
  const chain = chains[0];
  // Aave V3 Base address book: https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol
  const published = { pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    provider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
    dataProvider: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
    oracle: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH: "0x4200000000000000000000000000000000000006" };
  for (const [name, configured] of Object.entries({ pool: AAVE_BASE_V3_MARKET, ...AAVE_BASE_PROTOCOL, ...AAVE_BASE_ASSETS }))
    if (!published[name] || configured.toLowerCase() !== published[name].toLowerCase()) throw new Error(`Aave Base ${name} differs from reviewed address-book snapshot.`);
  for (const address of [AAVE_BASE_PROTOCOL.provider, AAVE_BASE_V3_MARKET, AAVE_BASE_PROTOCOL.oracle,
    AAVE_BASE_PROTOCOL.dataProvider, ...Object.values(AAVE_BASE_ASSETS)]) {
    const code = await rpc(chain, "eth_getCode", [address, "latest"]);
    if (!code || code === "0x") throw new Error(`Aave Base has no contract code at ${address}`);
    if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) throw new Error(`Aave Base has invalid contract code at ${address}`);
  }
  for (const [name, selector, expected] of [
    ["Pool", "0x026b1d5f", AAVE_BASE_V3_MARKET],
    ["oracle", "0xfca513a8", AAVE_BASE_PROTOCOL.oracle],
    ["data provider", "0xe860accb", AAVE_BASE_PROTOCOL.dataProvider]
  ]) {
    const result = await rpc(chain, "eth_call", [{ to: AAVE_BASE_PROTOCOL.provider, data: selector }, "latest"]);
    const active = addressWord(result, `Aave Base address provider ${name}`);
    if (active.toLowerCase() !== expected.toLowerCase()) throw new Error(`Aave Base ${name} differs from governed address: ${active}`);
  }
  return "Aave Base: active Pool, oracle, and data provider match governed addresses; deployed code at provider, Pool, oracle, data provider, USDC, and WETH";
}

const results = await Promise.allSettled([...chains.map(checkChain), checkLifi(), checkLifiDiamond(), checkAaveBase()]);
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
