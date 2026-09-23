import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSwapRouteReview, swapQuoteErrorText } from "@/components/swap-workspace";

const input = { token: "session-token", planId: "d917c99a-f60d-4194-a98a-cc0fcdb84569", walletAddress: "0x000000000000000000000000000000000000dEaD" };

afterEach(() => vi.unstubAllGlobals());

describe("swap route review request", () => {
  it("explains unsupported and unavailable routes without exposing provider plumbing", () => {
    expect(swapQuoteErrorText("no_live_route")).toBe("No route is available for this pair right now. Try another amount or asset.");
    expect(swapQuoteErrorText("quote_unavailable")).toBe("Routes are temporarily unavailable. Try again shortly.");
    expect(swapQuoteErrorText("unsupported_chain")).toBe("This asset pair cannot be swapped right now.");
  });
  it("prepares only the exact intent returned by policy review and never submits a wallet transaction", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      if (url === "/api/swap/review") return Response.json({ intentId: "intent-1" }, { status: 201 });
      return Response.json({ intentId: "intent-1", stepIndex: 0, fingerprint: "fingerprint", call: { chainId: 8453, from: input.walletAddress, to: input.walletAddress, value: "0", data: "0x1234" }, expiresAt: "2026-09-23T23:00:00Z" }, { status: 201 });
    });
    await expect(requestSwapRouteReview(input)).resolves.toBe("prepared");
    expect(requests).toEqual([
      { url: "/api/swap/review", body: { planId: input.planId, walletAddress: input.walletAddress } },
      { url: "/api/swap/prepare", body: { intentId: "intent-1", planId: input.planId, walletAddress: input.walletAddress } }
    ]);
  });

  it("does not prepare a route denied by policy", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return Response.json({ error: "policy_not_permitted" }, { status: 403 });
    });
    await expect(requestSwapRouteReview(input)).rejects.toThrow(/transaction settings/);
    expect(urls).toEqual(["/api/swap/review"]);
  });

  it("does not label missing allowance as a completed swap", async () => {
    vi.stubGlobal("fetch", async (url: string) => url === "/api/swap/review"
      ? Response.json({ intentId: "intent-1" }, { status: 201 })
      : Response.json({ error: "approval_required" }, { status: 409 }));
    await expect(requestSwapRouteReview(input)).resolves.toBe("approval_required");
  });
});
