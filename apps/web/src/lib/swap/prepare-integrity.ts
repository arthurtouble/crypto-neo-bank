import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { CatalogAsset } from "./assets";
import { isDirectUniswapPlan, validateDirectUniswapPlan } from "./direct-uniswap";
import { validateGovernedAcrossPlan } from "./governed-across-route";
import { validateGovernedSameChainPlan } from "./governed-route";
import type { StoredSwapQuotePlan } from "./plans";

const address = z.string().refine(isAddress);
const configSchema = z.object({
  diamond: address, feeForwarder: address, feeRecipients: z.array(address).min(1).max(8),
  routerSpenders: z.array(z.object({ router: address, spender: address,
    feeTiers: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(8) }).strict()).max(8)
}).strict();

const configuredSet = (name: string) => new Set((process.env[name] ?? "").split(",")
  .map((value) => value.trim().toLowerCase()).filter(Boolean));

async function sha256(value: string): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The retained LI.FI proposal must still match every current operator and catalog input. */
export async function assertSwapPrepareIntegrity(plan: StoredSwapQuotePlan, assets: {
  from: CatalogAsset; to: CatalogAsset
}, nowMs: number) {
  if (isDirectUniswapPlan(plan)) return validateDirectUniswapPlan(plan, assets, nowMs);
  const configured = configSchema.parse(JSON.parse(process.env.AUREL_SWAP_EXECUTION_POLICY ?? "null"));
  const allowedTools = configuredSet("AUREL_LIFI_ALLOWED_TOOLS");
  const allowedExchanges = configuredSet("AUREL_LIFI_ALLOWED_EXCHANGES");
  const allowedBridges = configuredSet("AUREL_LIFI_ALLOWED_BRIDGES");
  const allowedTargets = configuredSet("AUREL_SWAP_ALLOWED_TARGETS");
  const allowedSpenders = configuredSet("AUREL_SWAP_ALLOWED_SPENDERS");
  const diamond = getAddress(configured.diamond);
  const isBridge = plan.source_chain_id !== plan.destination_chain_id;
  if (!allowedTools.has(plan.tool_id) || !(isBridge ? allowedBridges : allowedExchanges).has(plan.tool_id)
    || !allowedTargets.has(diamond.toLowerCase()) || !allowedSpenders.has(diamond.toLowerCase())
    || !plan.approval_spender || getAddress(plan.approval_spender) !== diamond
    || assets.from.id !== plan.source_asset_id || assets.to.id !== plan.destination_asset_id
    || assets.from.verification !== "verified" || assets.to.verification !== "verified"
    || assets.from.eligibility !== "eligible" || assets.to.eligibility !== "eligible")
    throw new Error("Swap route is not approved by current policy.");
  const currentPolicyVersion = await sha256(JSON.stringify([
    allowedTools, allowedExchanges, allowedBridges, allowedTargets, allowedSpenders
  ].map((set) => [...set].map((item) => item.toLowerCase()).sort())));
  if (plan.route_policy_version !== currentPolicyVersion
    || plan.catalog_version !== await sha256(JSON.stringify([assets.from, assets.to])))
    throw new Error("Swap quote policy or catalog changed.");

  const economics = JSON.parse(plan.economics_json ?? "null") as { toAmountRaw?: unknown } | null;
  const steps = JSON.parse(plan.route_steps_json) as unknown;
  const call = JSON.parse(plan.source_call_json) as { to?: unknown; value?: unknown; data?: unknown;
    providerGasLimit?: unknown; providerGasPrice?: unknown };
  if (!economics || typeof economics.toAmountRaw !== "string" || !/^\d+$/.test(economics.toAmountRaw)
    || !Array.isArray(steps) || steps.length !== 2 || plan.step_id !== plan.quote_id
    || typeof call.to !== "string" || typeof call.value !== "string" || typeof call.data !== "string")
    throw new Error("Swap plan evidence is incomplete.");
  const routeHash = await sha256(JSON.stringify([
    "lifi", plan.tool_id, plan.quote_id, plan.source_asset_id, plan.destination_asset_id,
    plan.from_amount_raw, economics.toAmountRaw, plan.to_amount_min_raw,
    plan.wallet_address.toLowerCase(), plan.recipient.toLowerCase(), plan.slippage_bps / 10_000,
    plan.source_chain_id, call.to.toLowerCase(), call.value, call.data.toLowerCase(),
    plan.approval_spender.toLowerCase(), call.providerGasLimit ?? null, call.providerGasPrice ?? null,
    plan.expires_at, currentPolicyVersion, plan.catalog_version, steps, economics
  ]));
  if (routeHash !== plan.fingerprint) throw new Error("Swap plan fingerprint changed.");
  if (isBridge) {
    const route = validateGovernedAcrossPlan(plan, { nowMs, routePolicyVersion: currentPolicyVersion, diamond,
      feeForwarder: getAddress(configured.feeForwarder),
      feeRecipients: new Set(configured.feeRecipients.map((value) => value.toLowerCase())),
      maxGasLimit: 2_000_000n, maxGasPriceWei: 100_000_000_000n });
    return { ...route, reviewedSpender: diamond };
  }
  const route = validateGovernedSameChainPlan(plan, {
    nowMs, routePolicyVersion: currentPolicyVersion, diamond,
    allowedToolIds: new Set([...allowedTools].filter((tool) => allowedExchanges.has(tool))),
    routerSpenders: configured.routerSpenders.map(({ router, spender, feeTiers }) => ({
      router: getAddress(router), spender: getAddress(spender), feeTiers: new Set(feeTiers)
    })),
    feeForwarder: getAddress(configured.feeForwarder),
    feeRecipients: new Set(configured.feeRecipients.map((value) => value.toLowerCase())),
    maxGasLimit: 2_000_000n, maxGasPriceWei: 100_000_000_000n
  });
  return { ...route, reviewedSpender: diamond };
}
