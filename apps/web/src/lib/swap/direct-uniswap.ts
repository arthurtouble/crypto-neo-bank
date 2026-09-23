import { createPublicClient, decodeFunctionData, decodeFunctionResult, encodeFunctionData, formatUnits, getAddress,
  http, parseAbi, parseUnits, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { CatalogAsset } from "./assets";
import type { ServerHeldLifiPlan } from "./lifi";
import type { StoredSwapQuotePlan } from "./plans";
import { SwapQuoteError, type SwapQuoteInput, type ValidatedSwapQuote } from "./quotes";
import { valueSwapSource } from "@/lib/transactions/valuation";

// Official Base deployments: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments
export const DIRECT_SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
const FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as const;
const QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const;
const USDC = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "8453:0x4200000000000000000000000000000000000006";
const REVIEWED_POOL = "0xb4CB800910B228ED3d0834cF79D697127BBB00e5";
const FEE = 100;
const TOOL = "uniswap_v3_direct";
const POLICY = "base-usdc-weth-uniswap-v3-fee100-router02-multicall-v1";
const TTL_MS = 45_000;
const DEADLINE_SECONDS = 90;
const MAX_UINT256 = (1n << 256n) - 1n;

// SwapRouter02's IV3SwapRouter tuple has no deadline. The outer multicall enforces it.
const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)"
]);
const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
]);
const FACTORY_ABI = parseAbi(["function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)"]);

type Assets = { from: CatalogAsset; to: CatalogAsset };
type Dependencies = { client?: PublicClient; now?: () => number; priceUsd?: (assetId: string) => Promise<number> };

const same = (a: string, b: string) => getAddress(a) === getAddress(b);
const positive = (value: string) => /^[1-9]\d*$/.test(value) && BigInt(value) <= MAX_UINT256;

async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return `0x${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function reviewedPair(assets: Assets): boolean {
  return ((assets.from.id === USDC && assets.to.id === WETH) || (assets.from.id === WETH && assets.to.id === USDC))
    && assets.from.chainId === 8453 && assets.to.chainId === 8453
    && assets.from.address?.toLowerCase() === assets.from.id.split(":")[1]
    && assets.to.address?.toLowerCase() === assets.to.id.split(":")[1]
    && assets.from.decimals === (assets.from.id === USDC ? 6 : 18)
    && assets.to.decimals === (assets.to.id === USDC ? 6 : 18)
    && assets.from.verification === "verified" && assets.to.verification === "verified"
    && assets.from.eligibility === "eligible" && assets.to.eligibility === "eligible";
}

async function defaultPriceUsd(assetId: string): Promise<number> {
  const rawUnits = assetId === USDC ? "1000000" : "1000000000000000000";
  const price = await valueSwapSource({ assetId, amountRaw: rawUnits });
  return Number(price.marketPriceUsd);
}

function fingerprintFields(plan: Pick<ServerHeldLifiPlan, "fromAssetId" | "toAssetId" | "fromAmountRaw" | "toAmountMinRaw"
  | "recipient" | "slippageBps" | "quoteId" | "toolId" | "approvalSpender" | "routeSteps" | "economics"
  | "sourceCall" | "routePolicyVersion" | "catalogVersion" | "expiresAt">) {
  return [TOOL, plan.quoteId, plan.fromAssetId, plan.toAssetId, plan.fromAmountRaw,
    plan.economics.toAmountRaw, plan.toAmountMinRaw, plan.recipient.toLowerCase(), plan.slippageBps,
    plan.sourceCall.chainId, plan.sourceCall.from.toLowerCase(), plan.sourceCall.to.toLowerCase(),
    plan.sourceCall.value, plan.sourceCall.data.toLowerCase(), plan.approvalSpender?.toLowerCase() ?? null,
    plan.expiresAt, plan.routePolicyVersion, plan.catalogVersion, plan.routeSteps, plan.economics];
}

export async function buildDirectUniswapPlan(input: SwapQuoteInput, assets: Assets, dependencies: Dependencies = {}):
  Promise<{ quote: ValidatedSwapQuote; plan: ServerHeldLifiPlan }> {
  if (!reviewedPair(assets) || input.fromAssetId !== assets.from.id || input.toAssetId !== assets.to.id
    || !Number.isInteger(input.slippageBps) || input.slippageBps < 10 || input.slippageBps > 100)
    throw new SwapQuoteError("asset_unavailable", "This pair is not available for direct swaps.");
  if ((input.amount.split(".")[1]?.length ?? 0) > assets.from.decimals)
    throw new SwapQuoteError("asset_unavailable", "The amount precision is not supported.");
  let amount: bigint;
  try { amount = parseUnits(input.amount, assets.from.decimals); }
  catch { throw new SwapQuoteError("asset_unavailable", "Enter a valid amount."); }
  if (amount <= 0n || amount > MAX_UINT256)
    throw new SwapQuoteError("asset_unavailable", "Enter a supported amount.");
  const now = dependencies.now?.() ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new SwapQuoteError("quote_unavailable", "Time is unavailable.");
  const wallet = getAddress(input.fromAddress).toLowerCase();
  const client = dependencies.client ?? createPublicClient({ chain: base, transport: http(base.rpcUrls.default.http[0]) });
  const tokenIn = getAddress(assets.from.address!);
  const tokenOut = getAddress(assets.to.address!);
  try {
    if (await client.getChainId() !== 8453) throw new Error("rpc chain");
    const block = await client.getBlock({ blockTag: "latest" });
    if (block.number === null || !block.hash || Number(block.timestamp) * 1_000 > now + 30_000
      || now - Number(block.timestamp) * 1_000 > 120_000) throw new Error("stale block");
    const [pool, factoryCode, routerCode, quoterCode, quoted] = await Promise.all([
      client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPool",
        args: [tokenIn, tokenOut, FEE], blockNumber: block.number }),
      client.getCode({ address: FACTORY, blockNumber: block.number }),
      client.getCode({ address: DIRECT_SWAP_ROUTER, blockNumber: block.number }),
      client.getCode({ address: QUOTER, blockNumber: block.number }),
      client.call({ to: QUOTER,
        data: encodeFunctionData({ abi: QUOTER_ABI, functionName: "quoteExactInputSingle",
          args: [{ tokenIn, tokenOut, amountIn: amount, fee: FEE, sqrtPriceLimitX96: 0n }] }),
        blockNumber: block.number })
    ]);
    if (!same(pool, REVIEWED_POOL) || !factoryCode || factoryCode === "0x"
      || !routerCode || routerCode === "0x" || !quoterCode || quoterCode === "0x") throw new Error("unreviewed deployment");
    const output = decodeFunctionResult({ abi: QUOTER_ABI, functionName: "quoteExactInputSingle",
      data: quoted.data ?? "0x" })[0];
    if (output <= 0n || output > MAX_UINT256) throw new Error("no liquidity");
    const minimum = output * BigInt(10_000 - input.slippageBps) / 10_000n;
    if (minimum <= 0n) throw new Error("minimum zero");
    const [sourcePrice, destinationPrice] = await Promise.all([
      (dependencies.priceUsd ?? defaultPriceUsd)(assets.from.id),
      (dependencies.priceUsd ?? defaultPriceUsd)(assets.to.id)
    ]);
    const sourceUsd = Number(formatUnits(amount, assets.from.decimals)) * sourcePrice;
    const destinationUsd = Number(formatUnits(output, assets.to.decimals)) * destinationPrice;
    const impact = Math.max(0, (sourceUsd - destinationUsd) / sourceUsd * 100);
    if (!Number.isFinite(sourceUsd) || !Number.isFinite(destinationUsd) || !Number.isFinite(impact)
      || sourceUsd <= 0 || destinationUsd <= 0 || impact > 3) throw new Error("price diverges");
    const canonical = await client.getBlock({ blockNumber: block.number });
    if (canonical.hash?.toLowerCase() !== block.hash.toLowerCase()) throw new Error("reorg");
    const deadline = BigInt(Math.floor(now / 1_000) + DEADLINE_SECONDS);
    const inner = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle",
      args: [{ tokenIn, tokenOut, fee: FEE, recipient: wallet as `0x${string}`,
        amountIn: amount, amountOutMinimum: minimum, sqrtPriceLimitX96: 0n }] });
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [deadline, [inner]] });
    const observedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + TTL_MS).toISOString();
    const quoteId = crypto.randomUUID();
    const routePolicyVersion = await digest(POLICY);
    const catalogVersion = await digest([assets.from, assets.to]);
    const economics = { fromAmountUsd: sourceUsd.toFixed(8), toAmountUsd: destinationUsd.toFixed(8),
      toAmountRaw: output.toString(), networkFeeUsd: null, providerFeeUsd: null, totalFeeUsd: null,
      priceImpactPercent: Math.round(impact * 1_000_000) / 1_000_000, feeCosts: null };
    const routeSteps = [{ id: quoteId, type: "swap" as const, tool: TOOL, fromAssetId: assets.from.id,
      toAssetId: assets.to.id, fromAmountRaw: amount.toString(), toAmountRaw: output.toString(),
      toAmountMinRaw: minimum.toString(), slippage: input.slippageBps / 10_000 }];
    const plan: ServerHeldLifiPlan = { fromAssetId: assets.from.id, toAssetId: assets.to.id,
      fromChainId: 8453, toChainId: 8453, fromAmountRaw: amount.toString(), toAmountMinRaw: minimum.toString(),
      recipient: wallet, slippageBps: input.slippageBps, quoteId, stepId: quoteId, toolId: TOOL,
      approvalSpender: DIRECT_SWAP_ROUTER.toLowerCase(), routeSteps, economics,
      sourceCall: { chainId: 8453, from: wallet, to: DIRECT_SWAP_ROUTER.toLowerCase(), value: "0", data },
      routePolicyVersion, catalogVersion, observedAt, expiresAt, fingerprint: "" };
    plan.fingerprint = await digest(fingerprintFields(plan));
    const quote: ValidatedSwapQuote = { provider: "uniswap:v3:base", quoteId,
      fromAssetId: assets.from.id, toAssetId: assets.to.id, fromChainId: 8453, toChainId: 8453,
      fromAmountRaw: amount.toString(), toAmountRaw: output.toString(), toAmountMinRaw: minimum.toString(),
      expiresAt, networkFeeUsd: null, providerFeeUsd: null, totalFeeUsd: null,
      priceImpactPercent: economics.priceImpactPercent, approvalTarget: DIRECT_SWAP_ROUTER.toLowerCase(),
      planReference: `uniswap:${quoteId}:${plan.fingerprint}`, routeKind: "same_chain" };
    return { quote, plan };
  } catch (error) {
    if (error instanceof SwapQuoteError) throw error;
    throw new SwapQuoteError("no_live_route", "No validated direct route is currently available.");
  }
}

/** Re-decodes every byte of the retained call; provider metadata never authorizes signing. */
export async function validateDirectUniswapPlan(plan: StoredSwapQuotePlan, assets: Assets, nowMs: number) {
  const expiry = Date.parse(plan.expires_at);
  const observed = Date.parse(plan.observed_at);
  if (!reviewedPair(assets) || plan.status !== "active" || plan.tool_id !== TOOL
    || plan.source_asset_id !== assets.from.id || plan.destination_asset_id !== assets.to.id
    || plan.source_chain_id !== 8453 || plan.destination_chain_id !== 8453
    || !Number.isSafeInteger(nowMs) || !Number.isFinite(expiry) || expiry <= nowMs
    || expiry - observed !== TTL_MS || observed > nowMs || plan.slippage_bps < 10 || plan.slippage_bps > 100
    || !positive(plan.from_amount_raw) || !positive(plan.to_amount_min_raw)
    || !same(plan.wallet_address, plan.recipient) || plan.route_policy_version !== await digest(POLICY)
    || plan.catalog_version !== await digest([assets.from, assets.to])
    || !plan.approval_spender || !same(plan.approval_spender, DIRECT_SWAP_ROUTER))
    throw new Error("Direct swap plan is not reviewed or current.");
  const call = JSON.parse(plan.source_call_json) as Record<string, unknown>;
  if (!call || typeof call !== "object" || Array.isArray(call)
    || Object.keys(call).sort().join(",") !== "chainId,data,from,to,value"
    || call.chainId !== 8453 || typeof call.from !== "string" || !same(call.from, plan.wallet_address)
    || typeof call.to !== "string" || !same(call.to, DIRECT_SWAP_ROUTER)
    || call.value !== "0" || typeof call.data !== "string") throw new Error("Direct swap call changed.");
  const outer = decodeFunctionData({ abi: ROUTER_ABI, data: call.data as `0x${string}` });
  if (outer.functionName !== "multicall" || !outer.args || outer.args[1].length !== 1)
    throw new Error("Direct swap route shape changed.");
  const inner = decodeFunctionData({ abi: ROUTER_ABI, data: outer.args[1][0] });
  if (inner.functionName !== "exactInputSingle" || !inner.args) throw new Error("Direct swap selector changed.");
  const params = inner.args[0];
  if (!same(params.tokenIn, assets.from.address!) || !same(params.tokenOut, assets.to.address!)
    || !same(params.recipient, plan.wallet_address) || params.fee !== FEE
    || params.amountIn !== BigInt(plan.from_amount_raw)
    || params.amountOutMinimum !== BigInt(plan.to_amount_min_raw)
    || params.sqrtPriceLimitX96 !== 0n
    || outer.args[0] !== BigInt(Math.floor(observed / 1_000) + DEADLINE_SECONDS)
    || outer.args[0] <= BigInt(Math.floor(nowMs / 1_000))) throw new Error("Direct swap parameters changed.");
  const canonicalInner = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [params] });
  const canonicalOuter = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall",
    args: [outer.args[0], [canonicalInner]] });
  if (canonicalOuter.toLowerCase() !== call.data.toLowerCase()) throw new Error("Direct swap encoding changed.");
  const steps = JSON.parse(plan.route_steps_json) as unknown;
  const economics = JSON.parse(plan.economics_json ?? "null") as ServerHeldLifiPlan["economics"] | null;
  if (!economics || !positive(economics.toAmountRaw) || BigInt(economics.toAmountRaw) < params.amountOutMinimum
    || !Array.isArray(steps) || steps.length !== 1 || plan.step_id !== plan.quote_id
    || steps[0]?.tool !== TOOL || steps[0]?.id !== plan.quote_id
    || steps[0]?.fromAmountRaw !== plan.from_amount_raw || steps[0]?.toAmountRaw !== economics.toAmountRaw
    || steps[0]?.toAmountMinRaw !== plan.to_amount_min_raw)
    throw new Error("Direct swap quote evidence changed.");
  const hashPlan = { fromAssetId: plan.source_asset_id, toAssetId: plan.destination_asset_id,
    fromAmountRaw: plan.from_amount_raw, toAmountMinRaw: plan.to_amount_min_raw,
    recipient: plan.recipient, slippageBps: plan.slippage_bps, quoteId: plan.quote_id,
    toolId: plan.tool_id, approvalSpender: plan.approval_spender, routeSteps: steps,
    economics, sourceCall: call, routePolicyVersion: plan.route_policy_version,
    catalogVersion: plan.catalog_version, expiresAt: plan.expires_at } as ServerHeldLifiPlan;
  if (plan.fingerprint !== await digest(fingerprintFields(hashPlan))) throw new Error("Direct swap fingerprint changed.");
  return { sourceCall: call as ServerHeldLifiPlan["sourceCall"],
    reviewedSpender: DIRECT_SWAP_ROUTER.toLowerCase(),
    expectedEffect: { wallet: plan.wallet_address.toLowerCase(), sourceAssetId: plan.source_asset_id,
      destinationAssetId: plan.destination_asset_id, sourceAmountRaw: plan.from_amount_raw,
      minimumOutputRaw: plan.to_amount_min_raw, recipient: plan.recipient.toLowerCase(),
      router: DIRECT_SWAP_ROUTER.toLowerCase(), spender: DIRECT_SWAP_ROUTER.toLowerCase() } };
}

export function isDirectUniswapPair(fromAssetId: string, toAssetId: string): boolean {
  return (fromAssetId === USDC && toAssetId === WETH) || (fromAssetId === WETH && toAssetId === USDC);
}

export function isDirectUniswapPlan(plan: Pick<StoredSwapQuotePlan, "tool_id">): boolean {
  return plan.tool_id === TOOL;
}
