import { isAddress } from "viem";
import { z } from "zod";
import { parseAssetId, type AssetId, type CatalogAsset } from "@/lib/swap/assets";

export type SwapQuoteInput = {
  fromAssetId: AssetId;
  toAssetId: AssetId;
  amount: string;
  fromAddress: string;
  slippageBps: number;
  unverifiedAcknowledgements?: AssetId[];
};

export type ValidatedSwapQuote = {
  provider: string;
  quoteId: string;
  fromAssetId: AssetId;
  toAssetId: AssetId;
  fromChainId: number;
  toChainId: number;
  fromAmountRaw: string;
  toAmountRaw: string;
  toAmountMinRaw: string;
  expiresAt: string;
  networkFeeUsd: number | null;
  providerFeeUsd: number | null;
  totalFeeUsd: number | null;
  priceImpactPercent: number | null;
  approvalTarget: string | null;
  planReference: string;
  routeKind: "same_chain" | "cross_chain";
};

export interface QuoteAdapter {
  quote(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): Promise<ValidatedSwapQuote[]>;
}

export type SwapQuoteErrorCode =
  | "unsupported_chain"
  | "asset_unavailable"
  | "acknowledgement_required"
  | "no_live_route"
  | "quote_unavailable";

export class SwapQuoteError extends Error {
  constructor(readonly code: SwapQuoteErrorCode, message: string) {
    super(message);
    this.name = "SwapQuoteError";
  }
}

const canonicalAssetId = z.string().max(96).refine((value) => parseAssetId(value) !== null, "Use a supported canonical asset ID.");

export const swapQuoteRequestSchema = z.object({
  fromAssetId: canonicalAssetId,
  toAssetId: canonicalAssetId,
  amount: z.string().regex(/^\d+(?:\.\d{1,36})?$/, "Enter a positive decimal amount."),
  fromAddress: z.string().refine(isAddress, "A valid EVM wallet is required."),
  slippageBps: z.number().int().min(10).max(100).default(50),
  unverifiedAcknowledgements: z.array(canonicalAssetId).max(2).optional()
}).strict().superRefine((value, context) => {
  if (value.fromAssetId === value.toAssetId) context.addIssue({ code: "custom", message: "Choose two different assets." });
  if (new Set(value.unverifiedAcknowledgements ?? []).size !== (value.unverifiedAcknowledgements ?? []).length) {
    context.addIssue({ code: "custom", message: "Asset acknowledgements must be unique." });
  }
});

export function requireExactUnverifiedAcknowledgements(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): void {
  const required = [assets.from, assets.to].filter((asset) => asset.verification === "unverified").map((asset) => asset.id).sort();
  const supplied = [...(input.unverifiedAcknowledgements ?? [])].sort();
  if (required.length !== supplied.length || required.some((id, index) => id !== supplied[index])) {
    throw new SwapQuoteError("acknowledgement_required", "Acknowledge each unverified asset before requesting a quote.");
  }
}
