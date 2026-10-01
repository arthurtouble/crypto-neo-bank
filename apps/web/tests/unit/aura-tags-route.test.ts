import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const state = vi.hoisted(() => ({ db: null as D1Database | null, rpc: vi.fn() }));
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x4444444444444444444444444444444444444444";

vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
vi.mock("@/lib/auth/wallet", () => ({
  // Both wallets are linked to the customer's Privy account.
  requireLinkedEvmWallet: async (_subject: string, address: string) => address.toLowerCase(),
  requireMoneyAccount: async () => ({ address: wallet, walletId: "wallet-1" }),
  WalletOwnershipError: httpErrors.WalletOwnershipError
}));
vi.mock("@/lib/auth/privy", () => ({ privyClient: () => ({ wallets: () => ({ rpc: state.rpc }) }), privyEmail: async () => null }));

const { PUT } = await import("@/app/api/aura-tags/route");

let sqlite: DatabaseSync;
const signature = "MEUCIQDexampleexampleexampleexampleexampleexampleAiBexampleexampleexample==";
const save = (address: string, confirmation?: unknown) => PUT(new Request("https://aura.test/api/aura-tags", { method: "PUT",
  body: JSON.stringify({ tag: "alice", address, displayName: "Alice", publicEnabled: true, ...(confirmation ? { confirmation } : {}) }) }));
const tagAddress = () => (sqlite.prepare("SELECT receiving_address FROM aura_tags WHERE active = 1").get() as { receiving_address: string }).receiving_address;

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
    INSERT INTO security_profiles (subject_reference, updated_at) VALUES ('alice', 't');`);
  state.db = d1(sqlite);
  state.rpc = vi.fn(async () => ({ method: "personal_sign", data: { signature: "0xsigned" } }));
});
afterEach(() => sqlite.close());

describe("the Aura tag's receiving address", () => {
  it("is set without a confirmation when the tag is first saved, and kept on later edits", async () => {
    expect((await save(wallet)).status).toBe(200);
    expect((await save(wallet)).status).toBe(200);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()).toEqual({ n: 0 });
  });

  it("changes only with a fresh passkey confirmation, and the customer is told", async () => {
    await save(wallet);
    const asked = await save(other);
    expect(asked.status).toBe(428);
    const { challengeId, error } = await asked.json() as { challengeId: string; error: string };
    expect(error).toBe("confirmation_required");
    expect(tagAddress()).toBe(wallet);
    // A confirmation for another address doesn't apply.
    expect((await save("0x5555555555555555555555555555555555555555", { challengeId, signature })).status).toBe(409);

    const again = await (await save(other)).json() as { challengeId: string };
    const changed = await save(other, { challengeId: again.challengeId, signature });
    expect(changed.status).toBe(200);
    expect(tagAddress()).toBe(other);
    expect(state.rpc).toHaveBeenCalledWith("wallet-1", expect.objectContaining({ method: "personal_sign" }));
    expect(sqlite.prepare("SELECT kind, title FROM notifications").all()).toEqual([{ kind: "security", title: "Your Aura tag's address changed" }]);
  });
});
