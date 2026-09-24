import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ authorized: true, row: { waitlist_id: "00000000-0000-4000-8000-000000000001", status: "waiting", country_hint: "PT", email_ciphertext: "cipher", email_nonce: "nonce", created_at: "2026-09-23T00:00:00.000Z" } as Record<string, unknown> | null, listRows: null as Record<string, unknown>[] | null, listSql: "", listBinds: [] as unknown[], inviteIssued: false, batchCalls: 0 }));

vi.mock("@/lib/auth/admin", () => {
  class AuthenticationError extends Error {}
  class AuthorizationError extends Error {}
  return { AuthenticationError, AuthorizationError, requireOperationsAdmin: async () => { if (!state.authorized) throw new AuthenticationError(); return { subjectReference: "operator-a" }; } };
});
vi.mock("@/lib/growth/crypto", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/growth/crypto")>()), decryptEmail: async () => "person@example.com" }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) {
    return { values: [] as unknown[], bind(...values: unknown[]) { this.values = values; return this; },
      async first() {
        if (sql.includes("COUNT(*)")) return { count: state.listRows?.length ?? (state.row ? 1 : 0) };
        if (sql.includes("growth_waitlist_invites")) return state.inviteIssued ? { invite_hash: "old-hash" } : null;
        if (sql.includes("growth_waitlist")) return state.row;
        return null;
      },
      async all() { state.listSql = sql; state.listBinds = this.values; return { results: state.listRows ?? (state.row ? [state.row] : []) }; },
      async run() { return { success: true, meta: { changes: 1 } }; }
    };
  },
  async batch(statements: unknown[]) { state.batchCalls++; state.inviteIssued = true; return statements.map(() => ({ success: true, meta: { changes: 1 } })); }
} } }));

const listRoute = () => import("@/app/api/ops/growth/waitlist/route").catch(() => null);
const inviteRoute = () => import("@/app/api/ops/growth/waitlist/[waitlistId]/invite/route").catch(() => null);
const inviteId = "00000000-0000-4000-8000-000000000001";
const inviteRequest = (body: unknown) => new Request(`https://aurel.test/api/ops/growth/waitlist/${inviteId}/invite`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  state.authorized = true;
  state.row = { waitlist_id: inviteId, status: "waiting", country_hint: "PT", email_ciphertext: "cipher", email_nonce: "nonce", created_at: "2026-09-23T00:00:00.000Z" };
  state.inviteIssued = false;
  state.batchCalls = 0;
  state.listRows = null;
  state.listSql = "";
  state.listBinds = [];
  process.env.GROWTH_ALLOWED_COUNTRIES = "PT";
  process.env.GROWTH_EMAIL_ENCRYPTION_KEY = "unit-key";
  process.env.GROWTH_EMAIL_LOOKUP_KEY = "unit-lookup-key";
});

describe("operator waitlist", () => {
  it("does not expose the list or invite to an unauthenticated visitor", async () => {
    state.authorized = false;
    expect((await (await listRoute())?.GET(new Request("https://aurel.test/api/ops/growth/waitlist")))?.status).toBe(401);
    expect((await (await inviteRoute())?.POST(inviteRequest({ verifiedCountry: "PT", eligibilityEvidence: "review-1" })))?.status).toBe(401);
    expect(state.batchCalls).toBe(0);
  });

  it("returns a bounded admin list with an approximate country hint", async () => {
    const response = await (await listRoute())?.GET(new Request("https://aurel.test/api/ops/growth/waitlist?limit=1"));
    expect(response?.status).toBe(200);
    const body = await response?.json() as { entries: Array<{ email: string; countryHint: string; countryHintLabel: string }>; totalCount: number };
    expect(body.entries).toEqual([expect.objectContaining({ email: "person@example.com", countryHint: "PT", countryHintLabel: "Approximate" })]);
    expect(body.totalCount).toBe(1);
  });

  it("pages by timestamp and waitlist ID so equal-time entries are not skipped", async () => {
    state.listRows = [state.row!, { ...state.row!, waitlist_id: "00000000-0000-4000-8000-000000000000" }];
    const first = await (await listRoute())?.GET(new Request("https://aurel.test/api/ops/growth/waitlist?limit=1"));
    const body = await first?.json() as { nextCursor: string; totalCount: number };
    expect(body.totalCount).toBe(2);
    expect(body.nextCursor).toContain("00000000-0000-4000-8000-000000000001");
    await (await listRoute())?.GET(new Request(`https://aurel.test/api/ops/growth/waitlist?limit=1&cursor=${encodeURIComponent(body.nextCursor)}`));
    expect(state.listSql).toContain("waitlist_id < ?");
    expect(state.listBinds).toContain("00000000-0000-4000-8000-000000000001");
  });

  it("rejects an invalid paging cursor", async () => {
    expect((await (await listRoute())?.GET(new Request("https://aurel.test/api/ops/growth/waitlist?cursor=bad")))?.status).toBe(400);
  });

  it("keeps historical operator reads but issues no new waitlist invites", async () => {
    const route = await inviteRoute();
    const first = await route?.POST(inviteRequest({ verifiedCountry: "PT", eligibilityEvidence: "review-1" }));
    expect(first?.status).toBe(410);
    expect(state.batchCalls).toBe(0);
  });
});
