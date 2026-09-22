import { describe, expect, it } from "vitest";
import { routeRequestSchema } from "@/lib/routing/lifi";

describe("LI.FI route input", () => {
  it("accepts supported mainnet USDC routes", () => expect(routeRequestSchema.parse({ fromChainId: 1, toChainId: 8453, amount: "100.25", fromAddress: "0x1111111111111111111111111111111111111111" }).amount).toBe("100.25"));
  it("accepts a distinct destination for withdrawals", () => expect(routeRequestSchema.parse({ fromChainId: 8453, toChainId: 1, amount: "25", fromAddress: "0x1111111111111111111111111111111111111111", toAddress: "0x2222222222222222222222222222222222222222" }).toAddress).toBe("0x2222222222222222222222222222222222222222"));
  it("rejects same-chain and unsupported routes", () => {
    expect(() => routeRequestSchema.parse({ fromChainId: 8453, toChainId: 8453, amount: "10", fromAddress: "0x1111111111111111111111111111111111111111" })).toThrow();
    expect(() => routeRequestSchema.parse({ fromChainId: 56, toChainId: 8453, amount: "10", fromAddress: "0x1111111111111111111111111111111111111111" })).toThrow();
  });
});
