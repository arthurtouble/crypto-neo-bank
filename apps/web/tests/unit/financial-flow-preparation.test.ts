import { describe, expect, it, vi } from "vitest";
import { prepareIntentSteps } from "@/lib/transactions/prepare-client";

const intentId = "00000000-0000-4000-8000-000000000001";
const wallet = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const steps = [
  { call: { chainId: 8453, from: wallet, to: token, value: 0n, data: "0x095ea7b3" }, semanticAction: "erc20_approval", sourceReference: "quote-1", expectedEffect: { type: "erc20_approval", token, spender: recipient, amountRaw: "10" } },
  { call: { chainId: 8453, from: wallet, to: recipient, value: 10n, data: "0x" }, semanticAction: "native_transfer", sourceReference: "review-1", expectedEffect: { type: "native_transfer", recipient, amountRaw: "10" } }
];

describe("financial call preparation client", () => {
  it("sends ordered, JSON-safe exact calls and returns their step references", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      seen.push({ url, body, authorization: new Headers(init.headers).get("Authorization") });
      return Response.json({ intentId, stepIndex: body.stepIndex, fingerprint: `0x${"a".repeat(64)}` }, { status: 201 });
    });
    const result = await prepareIntentSteps("access-token", intentId, steps, fetcher as typeof fetch);
    expect(result.map((step) => step.stepIndex)).toEqual([0, 1]);
    expect(seen.map((item) => item.body.stepIndex)).toEqual([0, 1]);
    expect((seen[0]?.body.call as Record<string, unknown>).value).toBe("0");
    expect(seen.every((item) => item.url === "/api/intents/prepare" && item.authorization === "Bearer access-token")).toBe(true);
  });

  it("stops before the next step when preparation is rejected", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: "call_not_reviewed" }, { status: 409 }));
    await expect(prepareIntentSteps("access-token", intentId, steps, fetcher as typeof fetch)).rejects.toThrow(/prepare/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not send unauthenticated or empty preparation", async () => {
    const fetcher = vi.fn();
    await expect(prepareIntentSteps("", intentId, steps, fetcher)).rejects.toThrow();
    await expect(prepareIntentSteps("access-token", intentId, [], fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
