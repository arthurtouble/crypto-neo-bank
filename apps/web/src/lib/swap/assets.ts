import { isAddress } from "viem";
import { z } from "zod";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";

export type AssetId = string;

const supportedChainIds = new Set<number>(SUPPORTED_CHAINS.map((chain) => chain.id));
const canonicalAddress = /^0x[a-f0-9]{40}$/;
const canonicalId = /^([1-9]\d*):(native|0x[a-f0-9]{40})$/;

function isSupportedChain(chainId: number): boolean {
  return Number.isSafeInteger(chainId) && supportedChainIds.has(chainId);
}

export function assetId(chainId: number, address: string | null): AssetId {
  if (!isSupportedChain(chainId)) throw new Error("Unsupported asset chain.");
  if (address === null) return `${chainId}:native`;
  if (!isAddress(address)) throw new Error("Invalid asset contract address.");
  return `${chainId}:${address.toLowerCase()}`;
}

export function parseAssetId(value: string): { chainId: number; address: string | null } | null {
  const match = canonicalId.exec(value);
  if (!match) return null;
  const chainId = Number(match[1]);
  if (!isSupportedChain(chainId)) return null;
  const address = match[2] === "native" ? null : match[2];
  if (address !== null && (!canonicalAddress.test(address) || !isAddress(address))) return null;
  return { chainId, address };
}

export function sameAsset(a: AssetId, b: AssetId): boolean {
  return parseAssetId(a) !== null && a === b;
}

export const catalogAssetSchema = z.object({
  id: z.string(),
  chainId: z.number().int(),
  address: z.string().nullable(),
  symbol: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  decimals: z.number().int().min(0).max(36),
  logoUrl: z.url().refine((url) => url.startsWith("https://")).nullable(),
  verification: z.enum(["verified", "unverified"]),
  eligibility: z.enum(["eligible", "unavailable"]),
  unavailableReason: z.string().max(240).optional()
}).superRefine((value, context) => {
  const parsed = parseAssetId(value.id);
  if (!parsed || parsed.chainId !== value.chainId || parsed.address !== value.address) {
    context.addIssue({ code: "custom", message: "Asset ID does not match its chain and address." });
  }
});

export type CatalogAsset = z.infer<typeof catalogAssetSchema>;
