import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({ authenticated: false, linked: true }));
vi.mock("@/lib/auth/server", () => {
  const AuthenticationError = httpErrors.AuthenticationError;
  return { AuthenticationError, requireVerifiedSubject: async () => {
    if (!state.authenticated) throw new AuthenticationError();
    return { subjectReference: "subject-a" };
  } };
});
vi.mock("@/lib/auth/wallet", () => {
  const WalletOwnershipError = httpErrors.WalletOwnershipError;
  return { WalletOwnershipError, requireLinkedEvmWallet: async (_subject: string, wallet: string) => {
    if (!state.linked) throw new WalletOwnershipError();
    return wallet;
  } };
});
vi.mock("@/lib/transactions/chain-observation", () => ({ observeTransaction: async () => ({ status: "pending" }) }));

import { POST } from "@/app/api/defi/sky/receipt/route";


const request = (amount = "12.5") => new Request("https://aura.test/api/defi/sky/receipt", { method: "POST",
  body: JSON.stringify({ action: "deposit", sender: "0x1111111111111111111111111111111111111111",
    amount, hash: `0x${"a".repeat(64)}` }) });

describe("Sky receipt route", () => {
  beforeEach(() => { state.authenticated = false; state.linked = true; });

  it("requires the verified subject and linked wallet", async () => {
    expect((await POST(request())).status).toBe(401);
    state.authenticated = true; state.linked = false;
    expect((await POST(request())).status).toBe(403);
  });

  it("keeps an unobserved transaction pending and private", async () => {
    state.authenticated = true;
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ status: "pending", chainId: 1 });
    expect((await POST(request("0.0000001"))).status).toBe(400);
  });
});
