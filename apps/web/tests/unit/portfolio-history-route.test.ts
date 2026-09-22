import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = "8453:0x1111111111111111111111111111111111111111";
const external = "8453:0x2222222222222222222222222222222222222222";
const state = vi.hoisted(() => ({ authorized: true, accounts: [] as Array<{ accountId: string; origin: string }>, rows: [] as Record<string, unknown>[], checkpoints: [] as Record<string, unknown>[], nonfinal: [] as Record<string, unknown>[], calls: [] as Array<{ sql: string; values: unknown[] }>, aaveUnavailable: false }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare(sql: string) { const query = { values: [] as unknown[], bind(...values: unknown[]) { this.values = values; state.calls.push({ sql, values }); return this; }, async first() { return { version: state.rows.length ? 1 : null }; }, async all() { if (sql.includes("portfolio_daily_results")) return { results: state.rows }; if (sql.includes("portfolio_source_checkpoints")) return { results: state.checkpoints }; if (sql.includes("portfolio_events")) return { results: state.nonfinal }; return { results: [] }; } }; return query; } } } }));
vi.mock("@/lib/auth/server", () => { class AuthenticationError extends Error {} return { AuthenticationError, requireVerifiedSubject: async () => { if (!state.authorized) throw new AuthenticationError(); return { subjectReference: "subject-a" }; } }; });
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/portfolio/accounts", () => ({ resolvePortfolioAccounts: async () => state.accounts }));
vi.mock("@/lib/portfolio/aave-source", () => ({ readCurrentAaveLegs: async () => state.aaveUnavailable ? { legs: [], status: "unavailable", reason: "offline" } : { legs: [], status: "complete", reason: null } }));

import { GET } from "@/app/api/portfolio/history/route";

type HistoryBody = { points: Array<{ day: string; netValueUsd: string | null; twrIndex: string | null; status: string; reasons: string[] }>; currentAave: { status: string }; externalWallets: string[]; calculationVersion: number };
async function readBody(response: Response): Promise<HistoryBody> { return response.json() as Promise<HistoryBody>; }
function request(range = "7D") { return new Request(`https://aurel.test/api/portfolio/history?range=${range}`); }
beforeEach(() => { state.authorized = true; state.accounts = [{ accountId: wallet, origin: "embedded" }]; state.rows = []; state.checkpoints = []; state.nonfinal = []; state.calls = []; state.aaveUnavailable = false; });

describe("portfolio history read boundary", () => {
  it("rejects unauthenticated and invalid ranges", async () => {
    state.authorized = false;
    expect((await GET(request())).status).toBe(401);
    state.authorized = true;
    expect((await GET(request("ALL"))).status).toBe(400);
  });

  it("returns null-valued gap days and fresh Aave unavailability, never today's modeled balance", async () => {
    state.aaveUnavailable = true;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await readBody(response);
    expect(body.points).toHaveLength(7);
    expect(body.points.every((point: { netValueUsd: string | null; twrIndex: string | null; reasons: string[] }) => point.netValueUsd === null && point.twrIndex === null && point.reasons.includes("missing_daily_result"))).toBe(true);
    expect(body.currentAave.status).toBe("unavailable");
  });

  it("does not claim zero Aave debt when no verified portfolio account is linked", async () => {
    state.accounts = [];
    const body = await readBody(await GET(request()));
    expect(body.currentAave.status).toBe("unavailable");
    expect(body.points.every((point) => point.netValueUsd === null)).toBe(true);
  });

  it("serves complete days but nulls a missing-price day and segregates linked external wallets", async () => {
    const today = new Date().toISOString().slice(0, 10);
    state.accounts.push({ accountId: external, origin: "linked_external" });
    state.rows = [{ day: today, calculation_version: 1, net_value_usd: "100", twr_index: "1", coverage_status: "complete", coverage_json: JSON.stringify([wallet, external].flatMap((accountId) => ["blockscout:8453", "aave:v3:8453"].map((sourceId) => ({ day: today, accountId, sourceId, eventStatus: "complete", priceStatus: "complete", reason: null })))) }];
    state.checkpoints = [wallet, external].flatMap((account_id) => ["blockscout:8453", "aave:v3:8453"].map((source_id) => ({ account_id, source_id, covered_from: "2023-01-01T00:00:00Z", covered_through: "2099-01-01T00:00:00Z", status: "complete", ingestion_version: 1 })));
    const response = await GET(request());
    const body = await readBody(response);
    expect(body.externalWallets).toEqual([external]);
    expect(body.points.at(-1)).toMatchObject({ day: today, netValueUsd: "100", status: "complete" });
    expect(body.calculationVersion).toBe(1);
    expect(state.calls.every((call) => call.values.includes("subject-a"))).toBe(true);
    state.rows[0].coverage_status = "partial";
    state.rows[0].net_value_usd = null;
    state.rows[0].twr_index = null;
    state.rows[0].coverage_json = JSON.stringify([{ day: today, accountId: wallet, sourceId: "blockscout:8453", eventStatus: "complete", priceStatus: "partial", reason: "missing_price" }]);
    const partial = await readBody(await GET(request()));
    expect(partial.points.at(-1)).toMatchObject({ netValueUsd: null, twrIndex: null, status: "partial" });
    expect(partial.points.at(-1)?.reasons).toContain("missing_price");
  });

  it("does not expose a complete value if Aave coverage or finality is unresolved", async () => {
    const today = new Date().toISOString().slice(0, 10);
    state.rows = [{ day: today, calculation_version: 1, net_value_usd: "100", twr_index: "1", coverage_status: "complete", coverage_json: JSON.stringify([{ day: today, accountId: wallet, sourceId: "blockscout:8453", eventStatus: "complete", priceStatus: "complete", reason: null }]) }];
    state.checkpoints = [{ account_id: wallet, source_id: "blockscout:8453", covered_from: "2023-01-01T00:00:00Z", covered_through: "2099-01-01T00:00:00Z", status: "complete", ingestion_version: 1 }];
    const missingAave = await readBody(await GET(request()));
    expect(missingAave.points.at(-1)?.reasons).toContain("missing_source_coverage");
    state.checkpoints.push({ account_id: wallet, source_id: "aave:v3:8453", covered_from: "2023-01-01T00:00:00Z", covered_through: "2099-01-01T00:00:00Z", status: "complete", ingestion_version: 1 });
    state.nonfinal = [{ account_id: wallet, source_id: "blockscout:8453", day: today }];
    const pending = await readBody(await GET(request()));
    expect(pending.points.at(-1)?.reasons).toContain("unfinalized_event");
    expect(pending.points.at(-1)?.netValueUsd).toBeNull();
  });

  it("hides an aggregate value computed with a wallet that is no longer linked", async () => {
    const today = new Date().toISOString().slice(0, 10);
    state.rows = [{ day: today, calculation_version: 1, net_value_usd: "999", twr_index: "1", coverage_status: "complete", coverage_json: JSON.stringify([wallet, external].flatMap((accountId) => ["blockscout:8453", "aave:v3:8453"].map((sourceId) => ({ day: today, accountId, sourceId, eventStatus: "complete", priceStatus: "complete", reason: null })))) }];
    state.checkpoints = ["blockscout:8453", "aave:v3:8453"].map((source_id) => ({ account_id: wallet, source_id, covered_from: "2023-01-01T00:00:00Z", covered_through: "2099-01-01T00:00:00Z", status: "complete", ingestion_version: 1 }));
    const body = await readBody(await GET(request()));
    expect(body.points.at(-1)?.reasons).toContain("account_scope_changed");
    expect(body.points.at(-1)?.netValueUsd).toBeNull();
  });

  it("rejects duplicated or malformed source coverage instead of selecting a favorable row", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const complete = ["blockscout:8453", "aave:v3:8453"].map((sourceId) => ({ day: today, accountId: wallet, sourceId, eventStatus: "complete", priceStatus: "complete", reason: null }));
    state.rows = [{ day: today, calculation_version: 1, net_value_usd: "100", twr_index: "1", coverage_status: "complete", coverage_json: JSON.stringify([...complete, { ...complete[0], eventStatus: "partial", reason: "late_page" }]) }];
    state.checkpoints = ["blockscout:8453", "aave:v3:8453"].map((source_id) => ({ account_id: wallet, source_id, covered_from: "2023-01-01T00:00:00Z", covered_through: "2099-01-01T00:00:00Z", status: "complete", ingestion_version: 1 }));
    const body = await readBody(await GET(request()));
    expect(body.points.at(-1)?.netValueUsd).toBeNull();
    expect(body.points.at(-1)?.reasons).toContain("conflicting_source_coverage");
  });

  it("fails closed if finality evidence exceeds the bounded scan", async () => {
    const today = new Date().toISOString().slice(0, 10);
    state.rows = [{ day: today, calculation_version: 1, net_value_usd: "100", twr_index: "1", coverage_status: "complete", coverage_json: JSON.stringify(["blockscout:8453", "aave:v3:8453"].map((sourceId) => ({ day: today, accountId: wallet, sourceId, eventStatus: "complete", priceStatus: "complete", reason: null }))) }];
    state.checkpoints = ["blockscout:8453", "aave:v3:8453"].map((source_id) => ({ account_id: wallet, source_id, covered_from: "2023-01-01T00:00:00Z", covered_through: "2099-01-01T00:00:00Z", status: "complete", ingestion_version: 1 }));
    state.nonfinal = Array.from({ length: 1001 }, (_, index) => ({ account_id: wallet, source_id: `unknown-${index}`, day: today }));
    const body = await readBody(await GET(request()));
    expect(body.points.at(-1)?.netValueUsd).toBeNull();
    expect(body.points.at(-1)?.reasons).toContain("finality_scan_incomplete");
  });

  it("holds a day incomplete for any non-finalized event on a linked account", async () => {
    const today = new Date().toISOString().slice(0, 10);
    state.rows = [{ day: today, calculation_version: 1, net_value_usd: "100", twr_index: "1", coverage_status: "complete", coverage_json: JSON.stringify(["blockscout:8453", "aave:v3:8453"].map((sourceId) => ({ day: today, accountId: wallet, sourceId, eventStatus: "complete", priceStatus: "complete", reason: null }))) }];
    state.checkpoints = ["blockscout:8453", "aave:v3:8453"].map((source_id) => ({ account_id: wallet, source_id, covered_from: "2023-01-01T00:00:00Z", covered_through: "2099-01-01T00:00:00Z", status: "complete", ingestion_version: 1 }));
    state.nonfinal = [{ account_id: wallet, source_id: "other-source", day: today }];
    const body = await readBody(await GET(request()));
    expect(body.points.at(-1)?.reasons).toContain("unfinalized_event");
    expect(body.points.at(-1)?.netValueUsd).toBeNull();
  });
});
