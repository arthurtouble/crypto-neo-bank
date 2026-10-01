import { encodeFunctionData, erc20Abi, formatUnits as viemFormat, parseUnits as viemParse } from "viem";
import { describe, expect, it } from "vitest";
import { erc20TransferData } from "@/lib/chain/erc20-transfer";
import { formatUnits, parseUnits } from "@/lib/format/units";

// Screens use these instead of viem (lib/format/units.ts, lib/chain/erc20-transfer.ts); they must give viem's results.
describe("token unit helpers", () => {
  const raws = [0n, 1n, 9n, 10n, 999_999n, 1_000_000n, 1_234_567n, 25_000_000n, -1_500_000n, 10n ** 18n, 123_456_789_012_345_678_901n];
  it.each([0, 1, 6, 8, 18])("formats like viem with %i decimals", (decimals) => {
    for (const raw of raws) expect(formatUnits(raw, decimals)).toBe(viemFormat(raw, decimals));
  });

  const inputs = ["0", "1", "25", "0.05", ".5", "1.", "-1.5", "0.0000001", "1.2345675", "1.2345674", "0.9999999", "9.99999999999999999999", "123456789.123456789123456789", "007.10"];
  it.each([0, 1, 6, 18])("parses like viem with %i decimals", (decimals) => {
    for (const input of inputs) expect(parseUnits(input, decimals)).toBe(viemParse(input, decimals));
  });

  it("rejects what viem rejects", () => {
    for (const input of ["", ".", "-", "-.", "1.2.3", "abc", "1e6", " 1"]) {
      expect(() => viemParse(input, 6)).toThrow();
      expect(() => parseUnits(input, 6)).toThrow();
    }
  });

  it("encodes an ERC-20 transfer like viem", () => {
    const to = "0x1111111111111111111111111111111111111111";
    for (const amount of [0n, 1n, 25_000_000n, (1n << 256n) - 1n]) {
      expect(erc20TransferData(to, amount)).toBe(encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }));
    }
    expect(() => erc20TransferData("0x123", 1n)).toThrow();
    expect(() => erc20TransferData(to, -1n)).toThrow();
  });
});
