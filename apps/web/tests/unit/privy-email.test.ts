import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ linked: [] as Array<Record<string, string>> }));
vi.mock("@privy-io/node", () => ({ PrivyClient: class { users() { return { _get: async () => ({ linked_accounts: state.linked }) }; } } }));
process.env.PRIVY_APP_SECRET ??= "test-secret";
const { privyEmail } = await import("@/lib/auth/privy");

const wallet = { type: "wallet", address: "0x1111111111111111111111111111111111111111" };

describe("the email Aura sends to", () => {
  beforeEach(() => { state.linked = []; });

  it("is the email added with a one-time code, before a Google sign-in's", async () => {
    state.linked = [wallet, { type: "google_oauth", email: "sam@gmail.com" }, { type: "email", address: "sam@example.com" }];
    expect(await privyEmail("did:privy:sam")).toBe("sam@example.com");
  });

  it("is the Google sign-in's when there's no other", async () => {
    state.linked = [wallet, { type: "google_oauth", email: "sam@gmail.com" }];
    expect(await privyEmail("did:privy:sam")).toBe("sam@gmail.com");
  });

  it("is missing for a Telegram or wallet sign-in that hasn't added one", async () => {
    state.linked = [wallet, { type: "telegram", telegram_user_id: "42", username: "sam" }];
    expect(await privyEmail("did:privy:sam")).toBeNull();
  });
});
