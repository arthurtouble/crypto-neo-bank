import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({ accountLocked: false }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {} } }));
vi.mock("@/lib/markets/guard", () => ({ marketReader: async () => ({ subject: "did:privy:alice" }) }));
vi.mock("@/lib/auth/wallet", () => ({ requireActionWallet: async () => "0x1111111111111111111111111111111111111111" }));
vi.mock("@/lib/markets/perps", () => ({ perpsAccount: async () => ({ connection: null, state: { status: "unavailable" }, dexStates: { status: "unavailable" },
  orders: { status: "unavailable" }, fills: { status: "unavailable" } }) }));
vi.mock("@/lib/actions/controls", () => ({ loadControls: async () => ({ ...controls }) }));

const read = async (country?: string, region?: string) => {
  const { GET } = await import("@/app/api/perps/account/route");
  const headers: Record<string, string> = { ...(country ? { "CF-IPCountry": country } : {}), ...(region ? { "X-Aura-Region": region } : {}) };
  const response = await GET(new Request("https://aura.test/api/perps/account", { headers }));
  expect(response.status).toBe(200);
  return (await response.json()) as { blocked: { reason: string; message: string } | null };
};

beforeEach(() => { controls.accountLocked = false; });

describe("the perps account says what would stop a trade before it starts", () => {
  it("is not blocked where Hyperliquid serves and the account is unlocked", async () => {
    expect((await read("FR")).blocked).toBeNull();
    expect((await read()).blocked).toBeNull();
  });

  it("names a place Hyperliquid doesn't serve, and what still works", async () => {
    expect((await read("US")).blocked).toEqual({ reason: "place", message: "Perps aren't available where you are. You can still close positions and withdraw." });
    expect((await read("CA", "ON")).blocked?.reason).toBe("place");
  });

  it("says a locked account is locked, ahead of the place", async () => {
    controls.accountLocked = true;
    expect((await read("US")).blocked).toEqual({ reason: "locked", message: "Your account is locked. Unlock it in Settings to trade, add money, or withdraw." });
  });
});
