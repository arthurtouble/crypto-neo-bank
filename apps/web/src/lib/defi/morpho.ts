import { encodeFunctionData, erc20Abi, getAddress, parseAbi } from "viem";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import { localEdgeUrl } from "@/lib/testing/local-edge";
import type { Call } from "@/lib/actions/types";

/**
 * Morpho vaults Aura offers, reviewed like the asset registry: both are USDC
 * vaults on Base with no fee, the largest on Base, from two curators.
 * Deposits and withdrawals are plain ERC-4626 calls to the vault itself; no
 * router or aggregator sits in between. Shares use 18 decimals.
 *
 * To add a vault: check on chain that its asset is USDC and (for V2) that
 * every gate is unset, add it here in a reviewed change, and run the tests.
 */
type MorphoVault = { id: string; address: `0x${string}`; name: string; curator: string; version: 1 | 2; asset: `0x${string}`; assetSymbol: "USDC"; assetDecimals: 6 };

export const MORPHO_USDC = BASE_USDC;
export const MORPHO_VAULTS: readonly MorphoVault[] = [
  { id: "steakhouse-prime-usdc", address: "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9", name: "Steakhouse Prime USDC", curator: "Steakhouse Financial",
    version: 2, asset: MORPHO_USDC, assetSymbol: "USDC", assetDecimals: 6 },
  { id: "gauntlet-usdc-prime", address: "0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61", name: "Gauntlet USDC Prime", curator: "Gauntlet",
    version: 1, asset: MORPHO_USDC, assetSymbol: "USDC", assetDecimals: 6 }
];

export function morphoVault(id: string): MorphoVault | null {
  return MORPHO_VAULTS.find((vault) => vault.id === id) ?? null;
}

export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  // Vault V2 access gates; an unset gate is the zero address.
  "function receiveSharesGate() view returns (address)",
  "function sendSharesGate() view returns (address)",
  "function receiveAssetsGate() view returns (address)",
  "function sendAssetsGate() view returns (address)"
]);

const call = (to: string, data: `0x${string}`): Call => ({ to: to.toLowerCase() as `0x${string}`, value: "0", data: data.toLowerCase() as `0x${string}` });

/** An exact approval and deposit of `assets` USDC, for the account itself. */
export function morphoDepositCalls(vault: MorphoVault, wallet: string, assets: bigint): Call[] {
  const owner = getAddress(wallet);
  return [
    call(vault.asset, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(vault.address), assets] })),
    call(vault.address, encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [assets, owner] }))
  ];
}

/** Withdraw exactly `assets` USDC, or redeem every share (`shares`), paid to the account. */
export function morphoWithdrawCall(vault: MorphoVault, wallet: string, amount: { assets: bigint } | { shares: bigint }): Call {
  const owner = getAddress(wallet);
  return "assets" in amount
    ? call(vault.address, encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [amount.assets, owner, owner] }))
    : call(vault.address, encodeFunctionData({ abi: vaultAbi, functionName: "redeem", args: [amount.shares, owner, owner] }));
}

type VaultRate = { vaultId: string; netApyPct: number; totalAssetsUsd: number; liquidityUsd: number };
export type VaultRates = { rates: VaultRate[]; observedAt: string; source: "Morpho API" } | null;

const MORPHO_API = "https://api.morpho.org/graphql";

/**
 * Each vault's net APY (after the curator's fee), deposits, and what can be
 * withdrawn right now, from Morpho's public API. Rates are display only: a
 * failed or malformed read is unavailable, never a guess.
 */
export async function morphoVaultRates(fetcher: typeof fetch = fetch, now = new Date()): Promise<VaultRates> {
  const fields = MORPHO_VAULTS.map((vault) => vault.version === 1
    ? `${vault.id.replaceAll("-", "_")}: vaultByAddress(address: "${vault.address}", chainId: ${BASE_CHAIN_ID}) { state { netApy totalAssetsUsd } liquidity { usd } }`
    : `${vault.id.replaceAll("-", "_")}: vaultV2ByAddress(address: "${vault.address}", chainId: ${BASE_CHAIN_ID}) { netApy totalAssetsUsd liquidityUsd }`).join(" ");
  try {
    const response = await fetcher(localEdgeUrl("MORPHO_API_URL") ?? MORPHO_API, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ ${fields} }` }), signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const body = await response.json() as { data?: Record<string, { netApy?: number; totalAssetsUsd?: number; liquidityUsd?: number;
      state?: { netApy?: number; totalAssetsUsd?: number }; liquidity?: { usd?: number } } | null> };
    const rates = MORPHO_VAULTS.map((vault) => {
      const row = body.data?.[vault.id.replaceAll("-", "_")];
      const apy = row?.state?.netApy ?? row?.netApy;
      const total = row?.state?.totalAssetsUsd ?? row?.totalAssetsUsd;
      const liquidity = row?.liquidity?.usd ?? row?.liquidityUsd;
      return [apy, total, liquidity].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
        ? { vaultId: vault.id, netApyPct: Math.round(apy! * 10_000) / 100, totalAssetsUsd: total!, liquidityUsd: liquidity! } : null;
    });
    if (rates.some((rate) => rate === null)) return null;
    return { rates: rates as VaultRate[], observedAt: now.toISOString(), source: "Morpho API" };
  } catch { return null; }
}
