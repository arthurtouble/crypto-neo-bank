import { describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
import { validateAaveCall } from "@/lib/defi/aave-call-policy";
import { AAVE_BASE_ASSETS } from "@/lib/defi/aave";

const state = vi.hoisted(() => ({ locked: false, defiEnabled: true }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare: () => ({ bind: () => ({ first: async () => ({ account_locked: Number(state.locked) }) }) })
} } }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: httpErrors.FeatureUnavailableError,
  requireFeature: async (_db: unknown, key: string) => { if (!state.defiEnabled) throw new httpErrors.FeatureUnavailableError(key); } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError, requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }) }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: httpErrors.WalletOwnershipError, requireLinkedEvmWallet: async () => "0x2222222222222222222222222222222222222222" }));

import { POST as action } from "@/app/api/defi/aave/action/route";


const sender = "0x2222222222222222222222222222222222222222";
const post = (body: unknown) => action(new Request("https://aura.test/api/defi/aave/action", { method: "POST", body: JSON.stringify(body) }));

describe("Aave self-custodial action boundary", () => {
  it.each(["supply", "withdraw"] as const)("returns only exact self-directed %s calls", async (operation) => {
    state.locked = false;
    const response = await post({ action: operation, sender, symbol: "USDC", amount: "1.5" });
    expect(response.status).toBe(200);
    const body = await response.json() as { executionAvailable: boolean; amountRaw: string; poolCall: unknown; approvalCall: unknown };
    expect(body.executionAvailable).toBe(true);
    expect(body.amountRaw).toBe("1500000");
    validateAaveCall({ action: operation, wallet: sender, asset: AAVE_BASE_ASSETS.USDC,
      amountRaw: 1_500_000n, transaction: body.poolCall });
    if (operation === "supply") validateAaveCall({
      action: "approve", wallet: sender, asset: AAVE_BASE_ASSETS.USDC,
      amountRaw: 1_500_000n, transaction: body.approvalCall
    });
    else expect(body.approvalCall).toBeNull();
  });

  it("rejects retired borrowing, unsupported modes, and account lock", async () => {
    expect((await post({ action: "borrow", sender, symbol: "USDC", amount: "1" })).status).toBe(400);
    expect((await post({ action: "withdraw", sender, symbol: "USDC", max: true })).status).toBe(400);
    expect((await post({ action: "withdraw", sender, symbol: "USDC", amount: "1", enableCollateral: true })).status).toBe(400);
    state.locked = true;
    expect((await post({ action: "supply", sender, symbol: "USDC", amount: "1" })).status).toBe(403);
    state.locked = false;
  });

  it("does not release a wallet call while DeFi actions are switched off", async () => {
    state.defiEnabled = false;
    const response = await post({ action: "supply", sender, symbol: "USDC", amount: "1" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "feature_unavailable" });
    state.defiEnabled = true;
  });

});
