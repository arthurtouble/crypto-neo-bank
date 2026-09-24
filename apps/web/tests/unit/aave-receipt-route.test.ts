import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  observed: { status: "pending" } as unknown,
  result: { status: "pending", reason: "transaction_unavailable" } as { status: string; reason?: string },
  prepared: null as unknown
}));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }) }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: class extends Error {},
  requireLinkedEvmWallet: async () => "0x2222222222222222222222222222222222222222" }));
vi.mock("@/lib/transactions/chain-observation", () => ({ observeTransaction: async () => state.observed }));
vi.mock("@/lib/transactions/effects", () => ({ verifyExpectedEffect: async (prepared: unknown) => {
  state.prepared = prepared;
  return state.result;
} }));

import { POST } from "@/app/api/defi/aave/receipt/route";

const sender = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;
const post = (body: unknown) => POST(new Request("https://aura.test/api/defi/aave/receipt", {
  method: "POST", body: JSON.stringify(body)
}));

describe("Aave receipt boundary", () => {
  beforeEach(() => { state.result = { status: "pending", reason: "transaction_unavailable" }; state.prepared = null; });

  it.each(["supply", "withdraw", "borrow", "repay"] as const)("binds the %s event to the exact wallet call", async (action) => {
    const response = await post({ action, sender, symbol: "USDC", amount: "1.5", hash });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "pending", hash });
    expect(state.prepared).toMatchObject({ chainId: 8453, walletAddress: sender,
      semanticAction: { supply: "earn_supply", withdraw: "earn_withdraw", borrow: "borrow", repay: "repay" }[action],
      expectedEffect: { asset: expect.any(String), amountRaw: "1500000" }, reportedHash: hash });
  });

  it("reports chain failure and rejects unsupported receipt requests", async () => {
    state.result = { status: "failed", reason: "transaction_reverted" };
    const response = await post({ action: "borrow", sender, symbol: "USDC", amount: "1", hash });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "failed", reason: "transaction_reverted" });
    expect((await post({ action: "borrow", sender, symbol: "USDC", amount: "1", hash: "bad" })).status).toBe(400);
  });
});
