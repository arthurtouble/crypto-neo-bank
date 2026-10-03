import { describe, expect, it } from "vitest";
import { requireSwapBalance } from "@/lib/swap/balance";

const usdc = { chainId: 8453, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 };
const wallet = "0x1111111111111111111111111111111111111111";
const holding = (raw: bigint) => async () => raw;

describe("paying for a swap", () => {
  it("allows up to the whole balance", async () => {
    await expect(requireSwapBalance(usdc, wallet, 50_000_000n, holding(50_000_000n))).resolves.toBeUndefined();
  });

  it("refuses more than the account holds, saying how much it has", async () => {
    await expect(requireSwapBalance(usdc, wallet, 500_000_000n, holding(50_000_000n)))
      .rejects.toMatchObject({ status: 422, code: "insufficient_balance", message: "You have 50 USDC. Enter that or less." });
    await expect(requireSwapBalance(usdc, wallet, 1n, holding(0n)))
      .rejects.toMatchObject({ code: "insufficient_balance", message: "You don't have any USDC." });
  });

  it("refuses when the balance can't be read, rather than sending a swap that may fail", async () => {
    await expect(requireSwapBalance(usdc, wallet, 1n, async () => { throw new Error("rpc down"); }))
      .rejects.toMatchObject({ status: 503, code: "balance_unavailable" });
  });
});
