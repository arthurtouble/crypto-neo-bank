import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prepareIntentSteps, submitPreparedTransfer } from "@/lib/transactions/prepare-client";
import { normalizePreparedCall } from "@/lib/transactions/evidence";

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

  it("never opens the wallet when exact preparation is denied", async () => {
    const events: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      events.push(url);
      return Response.json({ error: "call_not_reviewed" }, { status: 409 });
    });
    const simulate = vi.fn(async () => { events.push("simulation"); });
    const send = vi.fn(async () => ({ hash: `0x${"b".repeat(64)}` }));
    await expect(submitPreparedTransfer({ accessToken: "access-token", intentId, step: steps[1], simulate, send, fetcher: fetcher as typeof fetch })).rejects.toThrow(/prepare/i);
    expect(events).toEqual(["simulation", "/api/intents/prepare"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the exact step zero hash only after simulation, preparation, and wallet send", async () => {
    const events: string[] = [];
    const hash = `0x${"b".repeat(64)}`;
    const fingerprint = (await normalizePreparedCall(steps[1].call)).fingerprint;
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      events.push(url);
      if (url === "/api/intents/prepare") return Response.json({ intentId, stepIndex: 0, fingerprint }, { status: 201 });
      expect(JSON.parse(String(init.body))).toMatchObject({ intentId, stepIndex: 0, status: "submitted", transactionHash: hash });
      return Response.json({ verificationState: "reported" });
    });
    const result = await submitPreparedTransfer({ accessToken: "access-token", intentId, step: steps[1], simulate: async () => { events.push("simulation"); }, send: async () => { events.push("wallet"); return { hash }; }, fetcher: fetcher as typeof fetch });
    expect(result).toEqual({ hash, stepIndex: 0, reportRecorded: true });
    expect(events).toEqual(["simulation", "/api/intents/prepare", "wallet", "/api/intents/status"]);
  });

  it("preserves a broadcast hash if status reporting is temporarily unavailable", async () => {
    const hash = `0x${"b".repeat(64)}`;
    const fingerprint = (await normalizePreparedCall(steps[1].call)).fingerprint;
    const fetcher = vi.fn(async (url: string) => url === "/api/intents/prepare"
      ? Response.json({ intentId, stepIndex: 0, fingerprint }, { status: 201 })
      : Response.json({ error: "unavailable" }, { status: 503 }));
    const result = await submitPreparedTransfer({ accessToken: "access-token", intentId, step: steps[1], simulate: async () => undefined, send: async () => ({ hash }), fetcher: fetcher as typeof fetch });
    expect(result).toEqual({ hash, stepIndex: 0, reportRecorded: false });
  });

  it("does not open the wallet when the server returns a different call fingerprint", async () => {
    const send = vi.fn(async () => ({ hash: `0x${"b".repeat(64)}` }));
    const fetcher = vi.fn(async () => Response.json({ intentId, stepIndex: 0, fingerprint: `0x${"a".repeat(64)}` }, { status: 201 }));
    await expect(submitPreparedTransfer({ accessToken: "access-token", intentId, step: steps[1], simulate: async () => undefined, send, fetcher: fetcher as typeof fetch })).rejects.toThrow(/match/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("has no dormant wallet signing path in bridge or Aave review components", () => {
    for (const component of ["cross-chain-workspace", "earn-workspace", "borrow-workspace", "defi-positions"]) {
      const source = readFileSync(new URL(`../../src/components/${component}.tsx`, import.meta.url), "utf8");
      expect(source, component).not.toMatch(/useSendTransaction|sendTransaction\s*\(|\/api\/intents\/status/);
      expect(source, component).toMatch(/temporarily unavailable|execution is paused|unavailable/);
    }
  });
});
