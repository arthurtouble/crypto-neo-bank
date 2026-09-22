import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = "8453:0x1111111111111111111111111111111111111111";
const state = vi.hoisted(() => ({ authorized: true, accounts: [] as string[], rows: [] as Record<string, unknown>[], checkpoints: [] as Record<string, unknown>[], calls: [] as Array<{ sql: string; values: unknown[] }> }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare(sql: string) { return { values: [] as unknown[], bind(...values: unknown[]) { this.values = values; state.calls.push({ sql, values }); return this; }, async first() { if (sql.includes("MAX(calculation_version)")) return { version: 1 }; if (sql.includes("COUNT")) return { count: state.rows.filter((row) => row.classification === "review_required" && this.values.includes(row.account_id)).length }; return null; }, async all() {
  if (sql.includes("portfolio_source_checkpoints")) return { results: state.checkpoints };
  if (sql.includes("ORDER BY occurred_at")) {
    const [limit, offset] = this.values.slice(-2) as number[];
    const filtered = state.rows.filter((row) => this.values.includes(row.account_id)).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)) || String(a.source_event_id).localeCompare(String(b.source_event_id)));
    return { results: filtered.slice(offset, offset + limit) };
  }
  return { results: state.rows };
} }; } } } }));
vi.mock("@/lib/auth/server", () => { class AuthenticationError extends Error {} return { AuthenticationError, requireVerifiedSubject: async () => { if (!state.authorized) throw new AuthenticationError(); return { subjectReference: "subject-a" }; } }; });
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/portfolio/accounts", () => ({ resolvePortfolioAccounts: async () => state.accounts.map((accountId) => ({ accountId, origin: "embedded" })) }));

import { GET } from "@/app/api/portfolio/tax-support/route";
type TaxBody = { calculationVersion: number; coverage: { status: string }; reviewRequiredCount: number; rows: Array<{ kind: string; basisUsd: string | null; gainUsd: string | null; classification: string }>; notice: string; nextCursor: string | null };
async function readBody(response: Response): Promise<TaxBody> { return response.json() as Promise<TaxBody>; }
function request(query = "year=2025") { return new Request(`https://aurel.test/api/portfolio/tax-support?${query}`); }
beforeEach(() => { state.authorized = true; state.accounts = [wallet]; state.rows = []; state.checkpoints = []; state.calls = []; });

describe("portfolio tax-support read boundary", () => {
  it("requires auth and rejects invalid years or cursors", async () => {
    state.authorized = false;
    expect((await GET(request())).status).toBe(401);
    state.authorized = true;
    expect((await GET(request("year=1800"))).status).toBe(400);
    expect((await GET(request("year=2025&cursor=forged"))).status).toBe(400);
  });

  it("returns versioned FIFO/review evidence with incomplete year coverage and no-store", async () => {
    state.rows = [
      { kind: "lot", account_id: wallet, asset_id: "8453:native", source_event_id: "gift", leg_index: 0, occurred_at: "2025-02-01T00:00:00Z", calculation_version: 1, raw_units: "100", proceeds_usd: null, basis_usd: null, gain_usd: null, classification: "review_required", evidence_json: '{"sourceId":"blockscout:8453"}' },
      { kind: "disposal", account_id: wallet, asset_id: "8453:native", source_event_id: "sale", leg_index: 0, occurred_at: "2025-04-01T00:00:00Z", calculation_version: 1, raw_units: "20", proceeds_usd: "50", basis_usd: "30", gain_usd: "20", classification: "supported", evidence_json: '{"sourceId":"blockscout:8453"}' }
    ];
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await readBody(response);
    expect(body.calculationVersion).toBe(1);
    expect(body.coverage.status).toBe("partial");
    expect(body.reviewRequiredCount).toBe(1);
    expect(body.rows).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "disposal", basisUsd: "30", gainUsd: "20", classification: "supported" }), expect.objectContaining({ kind: "lot", classification: "review_required" })]));
    expect(body.notice).toMatch(/not tax advice/i);
    expect(state.calls.every((call) => call.values.includes("subject-a"))).toBe(true);
  });

  it("paginates with a stable cursor bound to year and version", async () => {
    state.rows = Array.from({ length: 51 }, (_, index) => ({ kind: "disposal", account_id: wallet, asset_id: "8453:native", source_event_id: `sale-${index}`, leg_index: 0, occurred_at: `2025-04-${String(index % 28 + 1).padStart(2, "0")}T00:00:00Z`, calculation_version: 1, raw_units: "1", proceeds_usd: "2", basis_usd: "1", gain_usd: "1", classification: "supported", evidence_json: "{}" }));
    const first = await readBody(await GET(request()));
    expect(first.rows).toHaveLength(50);
    expect(first.nextCursor).toBeTypeOf("string");
    const second = await readBody(await GET(request(`year=2025&cursor=${encodeURIComponent(first.nextCursor!)}`)));
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect((await GET(request(`year=2024&cursor=${encodeURIComponent(first.nextCursor!)}`))).status).toBe(400);
  });

  it("excludes no-longer-linked accounts from rows and review counts", async () => {
    const foreign = "8453:0x2222222222222222222222222222222222222222";
    state.rows = [{ kind: "lot", account_id: foreign, asset_id: "8453:native", source_event_id: "foreign", leg_index: 0, occurred_at: "2025-01-01T00:00:00Z", calculation_version: 1, raw_units: "1", proceeds_usd: null, basis_usd: null, gain_usd: null, classification: "review_required", evidence_json: "{}" }];
    const body = await readBody(await GET(request()));
    expect(body.rows).toEqual([]);
    expect(body.reviewRequiredCount).toBe(0);
  });

  it("keeps a fully dated but interrupted source checkpoint incomplete", async () => {
    state.checkpoints = [
      { account_id: wallet, source_id: "blockscout:8453", covered_from: "2023-01-01T00:00:00Z", covered_through: "2026-01-01T00:00:00Z", status: "complete", ingestion_version: 1 },
      { account_id: wallet, source_id: "aave:v3:8453", covered_from: "2023-01-01T00:00:00Z", covered_through: "2026-01-01T00:00:00Z", status: "partial", ingestion_version: 1 }
    ];
    const body = await readBody(await GET(request()));
    expect(body.coverage.status).toBe("partial");
  });
});
