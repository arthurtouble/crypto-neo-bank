import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSwapRouteReview, submitPreparedApproval, submitPreparedSwap, swapQuoteErrorText } from "@/components/swap-workspace";
import { normalizePreparedCall } from "@/lib/transactions/evidence";

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
    await expect(requestSwapRouteReview(input)).resolves.toMatchObject({ state: "prepared", intentId: "intent-1", stepIndex: 0 });
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
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url === "/api/swap/review") return Response.json({ intentId: "intent-1" }, { status: 201 });
      if (url === "/api/swap/prepare") return Response.json({ error: "approval_required" }, { status: 409 });
      return Response.json({ approvalId: "approval-1", kind: "approve", amountRaw: "1000000",
        spender: "0x2626664c2603336E57B271c5C0b26F421741e481", fingerprint: "fingerprint",
        call: { chainId: 8453, from: input.walletAddress, to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", value: "0", data: "0x1234" },
        expiresAt: "2026-09-23T23:00:00Z" }, { status: 201 });
    });
    await expect(requestSwapRouteReview(input)).resolves.toMatchObject({ state: "approval_required", approvalId: "approval-1" });
    expect(urls).toEqual(["/api/swap/review", "/api/swap/prepare", "/api/swap/approval"]);
  });

  it("does not mark an unsupported route reviewed when preparation rejects it", async () => {
    const markReviewed = vi.fn();
    vi.stubGlobal("fetch", async (url: string) => url === "/api/swap/review"
      ? Response.json({ intentId: "intent-1" }, { status: 201 })
      : Response.json({ error: "route_unavailable" }, { status: 422 }));
    await expect(requestSwapRouteReview(input, markReviewed)).rejects.toThrow(/isn't available to trade/);
    expect(markReviewed).not.toHaveBeenCalled();
  });

  it("submits only an exact, fresh server-prepared call and reports its hash", async () => {
    const call = { chainId: 8453, from: input.walletAddress, to: "0x000000000000000000000000000000000000bEEF", value: "0", data: "0x1234" };
    const normalized = await normalizePreparedCall(call);
    const sent: unknown[] = [];
    const reports: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      reports.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ verificationState: "pending" }, { status: 202 });
    });
    const result = await submitPreparedSwap({
      prepared: { state: "prepared", intentId: "00000000-0000-4000-8000-000000000001", stepIndex: 0,
        fingerprint: normalized.fingerprint, call, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      walletAddress: input.walletAddress, reviewKey: "selection", currentReviewKey: "selection", token: input.token,
      send: async (transaction) => { sent.push(transaction); return { hash: `0x${"ab".repeat(32)}` }; }
    });
    expect(result).toEqual({ hash: `0x${"ab".repeat(32)}`, reportRecorded: true });
    expect(sent).toEqual([{ chainId: 8453, to: normalized.to, value: 0n, data: normalized.data }]);
    expect(reports).toEqual([{ url: "/api/intents/status", body: {
      intentId: "00000000-0000-4000-8000-000000000001", stepIndex: 0, status: "submitted", transactionHash: `0x${"ab".repeat(32)}`
    } }]);
  });

  it.each(["fingerprint", "wallet", "chain", "review", "expiry"])("refuses %s mismatch before opening wallet", async (kind) => {
    const call = { chainId: 8453, from: input.walletAddress, to: "0x000000000000000000000000000000000000bEEF", value: "0", data: "0x1234" };
    const normalized = await normalizePreparedCall(call);
    const send = vi.fn();
    const prepared = { state: "prepared" as const, intentId: "00000000-0000-4000-8000-000000000001", stepIndex: 0,
      fingerprint: normalized.fingerprint, call, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    if (kind === "fingerprint") prepared.fingerprint = `0x${"00".repeat(32)}`;
    if (kind === "chain") prepared.call = { ...call, chainId: 1 };
    if (kind === "expiry") prepared.expiresAt = new Date(Date.now() - 1_000).toISOString();
    await expect(submitPreparedSwap({ prepared, walletAddress: kind === "wallet" ? "0x0000000000000000000000000000000000000001" : input.walletAddress,
      reviewKey: "selection", currentReviewKey: kind === "review" ? "changed" : "selection", token: input.token, send })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("retains a broadcast hash if status reporting fails", async () => {
    const call = { chainId: 8453, from: input.walletAddress, to: "0x000000000000000000000000000000000000bEEF", value: "0", data: "0x1234" };
    const normalized = await normalizePreparedCall(call);
    vi.stubGlobal("fetch", async () => Response.json({ error: "status_unavailable" }, { status: 503 }));
    const result = await submitPreparedSwap({ prepared: { state: "prepared", intentId: "00000000-0000-4000-8000-000000000001", stepIndex: 0,
      fingerprint: normalized.fingerprint, call, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      walletAddress: input.walletAddress, reviewKey: "selection", currentReviewKey: "selection", token: input.token,
      send: async () => ({ hash: `0x${"ab".repeat(32)}` }) });
    expect(result).toEqual({ hash: `0x${"ab".repeat(32)}`, reportRecorded: false });
  });

  it("sends a separately prepared exact approval and reports its hash", async () => {
    const call = { chainId: 8453, from: input.walletAddress,
      to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", value: "0", data: "0x095ea7b3" };
    const normalized = await normalizePreparedCall(call);
    const reports: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      reports.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return Response.json({ status: "pending" }, { status: 202 });
    });
    const result = await submitPreparedApproval({ prepared: { state: "approval_required", approvalId: "approval-1",
      kind: "approve", amountRaw: "1000000", spender: "0x2626664c2603336e57b271c5c0b26f421741e481",
      fingerprint: normalized.fingerprint, call, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      walletAddress: input.walletAddress, token: input.token,
      send: async (transaction) => { expect(transaction).toEqual({ chainId: 8453, to: normalized.to, value: 0n, data: normalized.data });
        return { hash: `0x${"ab".repeat(32)}` }; } });
    expect(result.reportRecorded).toBe(true);
    expect(reports).toEqual([{ url: "/api/swap/approval", method: "PATCH",
      body: { approvalId: "approval-1", transactionHash: `0x${"ab".repeat(32)}` } }]);
  });
});
