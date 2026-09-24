import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PortfolioHistory } from "@/lib/portfolio/types";

const fixture = vi.hoisted(() => ({
  query: { data: undefined as PortfolioHistory | undefined, isPending: false, error: null as Error | null },
  queryKey: [] as unknown[],
  requestedUrl: "",
  requestedInit: undefined as RequestInit | undefined
}));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ user: { id: "subject-a" }, getAccessToken: async () => "token-a" }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
  fixture.queryKey = options.queryKey;
  void options.queryFn;
  return fixture.query;
} }));

import { PortfolioPerformance, buildPortfolioChartModel } from "@/components/portfolio-performance";

const complete = (day: string, netValueUsd: string, twrIndex = "1") => ({ day, netValueUsd, twrIndex, status: "complete" as const, reasons: [] });
const partial = (day: string, reason: string) => ({ day, netValueUsd: null, twrIndex: null, status: "partial" as const, reasons: [reason] });
const history = (points: PortfolioHistory["points"]): PortfolioHistory => ({
  calculationVersion: 3, points,
  currentAave: { suppliedUsd: null, debtUsd: null, status: "partial" },
  embeddedWalletCount: 1,
  externalWallets: ["8453:0x1111111111111111111111111111111111111111"],
  coverage: [], observedAt: `${points.at(-1)?.day ?? "2026-09-22"}T12:00:00.000Z`
});

describe("authoritative portfolio chart", () => {
  it("draws separate line and fill paths around a missing-price day", () => {
    const model = buildPortfolioChartModel(history([
      complete("2026-09-19", "100"), partial("2026-09-20", "ETH price missing"), complete("2026-09-21", "105")
    ]));
    expect(model.runs).toHaveLength(2);
    expect(model.runs.every((run) => run.linePath.startsWith("M") && !run.linePath.includes("NaN"))).toBe(true);
    expect(model.gaps).toMatchObject([{ day: "2026-09-20", reasons: ["ETH price missing"] }]);
    expect(model.returnPercent).toBeNull();
    fixture.query = { data: history([complete("2026-09-19", "100"), partial("2026-09-20", "ETH price missing"), complete("2026-09-21", "105")]), isPending: false, error: null };
    const markup = renderToStaticMarkup(React.createElement(PortfolioPerformance));
    expect(markup.match(/class="chartLine"/g)).toHaveLength(2);
  });

  it("never stretches an area fill across a gap", () => {
    const model = buildPortfolioChartModel(history([
      complete("2026-09-17", "98"), complete("2026-09-18", "100"), partial("2026-09-19", "source partial"),
      complete("2026-09-20", "104"), complete("2026-09-21", "105")
    ]));
    expect(model.runs).toHaveLength(2);
    expect(model.runs.every((run) => run.areaPath.endsWith("Z"))).toBe(true);
    expect(model.runs[0].points.at(-1)?.day).toBe("2026-09-18");
    expect(model.runs[1].points[0].day).toBe("2026-09-20");
  });

  it("never substitutes today's balance when history is empty or the latest day is incomplete", () => {
    expect(buildPortfolioChartModel(history([])).displayValue).toBeNull();
    const model = buildPortfolioChartModel(history([complete("2026-09-19", "100"), partial("2026-09-20", "source partial")]));
    expect(model.displayValue).toBeNull();
    expect(model.latestComplete).toMatchObject({ day: "2026-09-19", valueUsd: 100 });
  });

  it("treats an omitted UTC day and an invalid decimal as explicit gaps", () => {
    const model = buildPortfolioChartModel(history([complete("2026-09-19", "100"), complete("2026-09-21", "not-a-value"), complete("2026-09-22", "103")]));
    expect(model.runs).toHaveLength(2);
    expect(model.gaps.map((gap) => gap.day)).toContain("2026-09-20");
    expect(model.gaps.map((gap) => gap.day)).toContain("2026-09-21");
    expect(model.returnPercent).toBeNull();
  });

  it("does not display a value when source coverage contradicts a complete point", () => {
    const result = history([complete("2026-09-19", "100"), complete("2026-09-20", "101")]);
    result.coverage = [{ day: "2026-09-20", accountId: "8453:0x1111111111111111111111111111111111111111", sourceId: "blockscout:8453", eventStatus: "complete", priceStatus: "partial", reason: "USDC price missing" }];
    const model = buildPortfolioChartModel(result);
    expect(model.displayValue).toBeNull();
    expect(model.gaps).toMatchObject([{ day: "2026-09-20", reasons: ["USDC price missing"] }]);
  });

  it("shows a return only for a wholly complete interval with valid TWR indices", () => {
    const model = buildPortfolioChartModel(history([complete("2026-09-19", "100", "1"), complete("2026-09-20", "101", "1.01")]));
    expect(model.returnPercent).toBeCloseTo(1);
    expect(buildPortfolioChartModel(history([complete("2026-09-19", "100", "1"), complete("2026-09-20", "101", "not-a-value")])).returnPercent).toBeNull();
  });

  it("does not manufacture a current-day gap after the last completed UTC day", () => {
    const result = history([complete("2026-09-20", "100", "1"), complete("2026-09-21", "101", "1.01")]);
    result.observedAt = "2026-09-22T12:00:00.000Z";
    const model = buildPortfolioChartModel(result);
    expect(model.lastDay).toBe("2026-09-21");
    expect(model.gaps).toHaveLength(0);
    expect(model.returnPercent).toBeCloseTo(1);
  });

  it("keeps incomplete history plain-language while retaining Aave legs and external scope", () => {
    fixture.query = { data: undefined, isPending: true, error: null };
    expect(renderToStaticMarkup(React.createElement(PortfolioPerformance))).toContain("Loading verified history");
    fixture.query = { data: history([complete("2026-09-19", "100"), partial("2026-09-20", "Aave source partial")]), isPending: false, error: null };
    const markup = renderToStaticMarkup(React.createElement(PortfolioPerformance));
    expect(markup).toContain("still verifying 1 day of history.");
    expect(markup).not.toContain("Aave source partial");
    expect(markup).not.toContain("Missing portfolio history days");
    expect(markup).toMatch(/Aave supply <strong class="sensitiveAmount">unavailable/);
    expect(markup).toMatch(/Aave debt <strong class="sensitiveAmount">unavailable/);
    expect(markup).toContain("Includes your Aurel wallet and 1 linked wallet.");
    expect(markup).toContain("Return unavailable");
    expect(markup).toContain('aria-label="Portfolio history period"');
    expect(markup).toContain(">7D</button>");
    expect(markup).toContain(">30D</button>");
    expect(markup).toContain(">90D</button>");
    expect(fixture.queryKey).toContain("subject-a");
  });

  it("does not claim an Aurel wallet is included when none is server verified", () => {
    const result = history([partial("2026-09-20", "missing_linked_account")]);
    result.embeddedWalletCount = 0;
    result.externalWallets = [];
    result.currentAave = { suppliedUsd: null, debtUsd: null, status: "unavailable", reason: "no_verified_account" };
    fixture.query = { data: result, isPending: false, error: null };
    const markup = renderToStaticMarkup(React.createElement(PortfolioPerformance));
    expect(markup).toContain("No verified wallet is included yet.");
    expect(markup).not.toContain("Includes your Aurel wallet");
  });
});
