import { formatRequestForAuthorizationSignature, PrivyClient } from "@privy-io/node";
import { describe, expect, it } from "vitest";
import { readRelayedTransaction, relaySendCalls, sendCallsRequest } from "@/lib/actions/privy-relay";

const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const request = sendCallsRequest({ appId: "app-1", walletId: "wallet-1", chainId: 8453, idempotencyKey: "aura-action-a1",
  expiresAt: new Date("2026-09-26T12:10:00.000Z"),
  calls: [{ to: usdc, value: "0", data: "0xa9059cbb" }, { to: "0x2222222222222222222222222222222222222222", value: "1000000000000000", data: "0x" }] });

function stubbedClient(capture: { url?: string; body?: unknown; headers?: Headers }, reply: unknown) {
  return new PrivyClient({ appId: "app-1", appSecret: "secret", fetch: (async (url: string, init: RequestInit) => {
    capture.url = String(url); capture.body = init.body ? JSON.parse(String(init.body)) : undefined; capture.headers = new Headers(init.headers);
    return Response.json(reply);
  }) as typeof fetch });
}

describe("relaying a signed Privy request", () => {
  it("builds a sponsored wallet_sendCalls request with hex values, bound to the action and its expiry", () => {
    expect(request).toMatchObject({ method: "POST", url: "https://api.privy.io/v1/wallets/wallet-1/rpc",
      body: { method: "wallet_sendCalls", caip2: "eip155:8453", sponsor: true, params: { calls: [{ value: "0x0" }, { value: "0x38d7ea4c68000" }] } },
      headers: { "privy-app-id": "app-1", "privy-idempotency-key": "aura-action-a1", "privy-request-expiry": String(Date.parse("2026-09-26T12:10:00.000Z")) } });
  });

  it("sends exactly the bytes the customer signed, with their signature", async () => {
    const capture: { url?: string; body?: unknown; headers?: Headers } = {};
    const reference = await relaySendCalls(stubbedClient(capture, { method: "wallet_sendCalls", data: { caip2: "eip155:8453", transaction_id: "tx-1" } }),
      "wallet-1", request, "c2lnbmF0dXJlLW9mLXRoZS1jdXN0b21lcg==");
    expect(reference).toBe("tx-1");
    expect(capture.headers!.get("privy-authorization-signature")).toBe("c2lnbmF0dXJlLW9mLXRoZS1jdXN0b21lcg==");
    // Privy verifies the signature over the canonical form of what it receives; it must equal what was signed.
    const received = formatRequestForAuthorizationSignature({ version: 1, method: "POST", url: capture.url!, body: capture.body,
      headers: { "privy-app-id": "app-1", "privy-idempotency-key": capture.headers!.get("privy-idempotency-key")!,
        "privy-request-expiry": capture.headers!.get("privy-request-expiry")! } });
    expect(new TextDecoder().decode(received)).toBe(new TextDecoder().decode(formatRequestForAuthorizationSignature(request)));
  });

  it("reads a relayed transaction as pending, landed with its hash, or failed", async () => {
    const hash = `0x${"AB".repeat(32)}`;
    const read = (reply: unknown) => readRelayedTransaction(stubbedClient({}, reply), "tx-1");
    expect(await read({ id: "tx-1", status: "broadcasted", transaction_hash: null, caip2: "eip155:8453", created_at: 1, wallet_id: "wallet-1" })).toEqual({ status: "pending" });
    expect(await read({ id: "tx-1", status: "confirmed", transaction_hash: hash, caip2: "eip155:8453", created_at: 1, wallet_id: "wallet-1" })).toEqual({ status: "landed", hash: hash.toLowerCase() });
    expect(await read({ id: "tx-1", status: "failed", transaction_hash: null, caip2: "eip155:8453", created_at: 1, wallet_id: "wallet-1" })).toEqual({ status: "failed", reason: "relay_failed" });
  });
});
