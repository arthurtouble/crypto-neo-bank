import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { chainlinkUsd } from "@/lib/assets/prices";
import { registeredAsset } from "@/lib/assets/registry";

const apple = registeredAsset("8453:0xb200000000000000000000c2e324d24d7eecd1fb")!.price;
if (apple.kind !== "chainlink") throw new Error("Apple should use a Chainlink feed");
// Sunday: the feed still holds Friday's close.
const now = new Date("2026-09-27T12:00:00.000Z");
const at = (iso: string) => BigInt(Date.parse(iso) / 1000);
const feed = (answer: bigint, updatedAt: bigint, fail = false) =>
  ({ readContract: async () => { if (fail) throw new Error("rpc down"); return [1n, answer, updatedAt, updatedAt, 1n] as const; } }) as unknown as PublicClient;

describe("reading a Chainlink price", () => {
  it("returns the price and when it was published, even from the last market close", async () => {
    expect(await chainlinkUsd(apple, now, feed(34_151_300_000n, at("2026-09-25T20:00:00.000Z"))))
      .toEqual({ usd: "341.513", observedAt: "2026-09-25T20:00:00.000Z" });
  });

  it("treats a price older than four days, from the future, zero or negative, or unreadable as unavailable", async () => {
    expect(await chainlinkUsd(apple, now, feed(34_151_300_000n, at("2026-09-23T11:59:00.000Z")))).toBeNull();
    expect(await chainlinkUsd(apple, now, feed(34_151_300_000n, at("2026-09-27T12:05:00.000Z")))).toBeNull();
    expect(await chainlinkUsd(apple, now, feed(0n, at("2026-09-27T11:00:00.000Z")))).toBeNull();
    expect(await chainlinkUsd(apple, now, feed(-1n, at("2026-09-27T11:00:00.000Z")))).toBeNull();
    expect(await chainlinkUsd(apple, now, feed(1n, 0n, true))).toBeNull();
  });
});
