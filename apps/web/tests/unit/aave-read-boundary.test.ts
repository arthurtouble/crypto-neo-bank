import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({
  AuthenticationError: httpErrors.AuthenticationError,
  WalletOwnershipError: httpErrors.WalletOwnershipError,
  authenticated: false,
  linked: false,
  marketCalls: 0
}));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: state.AuthenticationError,
  requireVerifiedSubject: async () => {
    if (!state.authenticated) throw new state.AuthenticationError();
    return { subjectReference: "subject-a" };
  }
}));
vi.mock("@/lib/auth/wallet", () => ({
  WalletOwnershipError: state.WalletOwnershipError,
  requireLinkedEvmWallet: async (_subject: string, address: string) => {
    if (!state.linked) throw new state.WalletOwnershipError();
    return address.toLowerCase();
  }
}));
vi.mock("@/lib/defi/aave", () => ({
  getAaveBaseMarkets: async (address?: string) => { state.marketCalls++; return { address }; },
}));

import { GET as markets } from "@/app/api/defi/aave/markets/route";


const address = "0x2222222222222222222222222222222222222222";
const request = (path: string) => new Request(`https://aura.test${path}`);

describe("Aave read boundaries", () => {
  beforeEach(() => Object.assign(state, { authenticated: false, linked: false, marketCalls: 0 }));

  it("keeps general market data public without a wallet", async () => {
    const response = await markets(request("/api/defi/aave/markets"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(state.marketCalls).toBe(1);
  });

  it("requires a verified session and wallet ownership before address-scoped markets", async () => {
    const path = `/api/defi/aave/markets?address=${address}`;
    expect((await markets(request(path))).status).toBe(401);
    state.authenticated = true;
    expect((await markets(request(path))).status).toBe(403);
    state.linked = true;
    const response = await markets(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.marketCalls).toBe(1);
  });
});
