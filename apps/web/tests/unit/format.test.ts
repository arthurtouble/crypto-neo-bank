import { describe, expect, it } from "vitest";
import { formatCents, formatShortDateTime, formatToken, formatUsd, fromRaw, shortAddress } from "@/lib/format";
import { bankRailNames } from "@/lib/format/bank";

describe("client formatters", () => {
  it("writes dollars with cents, or whole", () => {
    expect(formatUsd(2650)).toBe("$2,650.00");
    expect(formatUsd("1234.5")).toBe("$1,234.50");
    expect(formatUsd(1234.5, { whole: true })).toBe("$1,235");
    expect(formatCents(123450)).toBe("$1,234.50");
  });

  it("writes token amounts naturally, not as raw floats", () => {
    expect(formatToken(fromRaw("2650000000", 6), "USDC")).toBe("2,650 USDC");
    expect(formatToken(0.1 + 0.2, "ETH")).toBe("0.3 ETH");
    expect(formatToken(0.00012345)).toBe("0.000123");
    expect(formatToken(fromRaw("19999999", 6), "USDC", { maxDecimals: 6 })).toBe("19.999999 USDC");
  });

  it("shortens addresses to the first six and last four characters", () => {
    expect(shortAddress("0x5555000000000000000000000000000000005555")).toBe("0x5555…5555");
    expect(shortAddress(null)).toBe("");
  });

  it("writes a short date for lists", () => {
    expect(formatShortDateTime(new Date(2026, 8, 30, 20, 12))).toBe("Sep 30, 8:12 PM");
  });

  it("names bank transfers the same way everywhere", () => {
    expect(bankRailNames).toEqual({ ach: "Bank transfer", wire: "Wire", fednow: "Instant transfer" });
  });
});
