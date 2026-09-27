import { describe, expect, it } from "vitest";
import { parseSwapDeepLink } from "@/lib/swap/links";

describe("Swap deep links", () => {
  it("rejects malformed, unsupported, and identical deep-link assets", () => {
    expect(parseSwapDeepLink({ to: "8453:native" })).toEqual({ fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:native" });
    expect(parseSwapDeepLink({ from: "8453:native", to: "8453:native" })).toEqual({ fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:native" });
    expect(parseSwapDeepLink({ to: "javascript:alert(1)" })).toEqual({ fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:native" });
    expect(parseSwapDeepLink({ to: "56:native" })).toEqual({ fromAssetId: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toAssetId: "8453:native" });
  });
});
