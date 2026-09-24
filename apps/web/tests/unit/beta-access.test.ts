import { afterEach, describe, expect, it } from "vitest";
import { BETA_TERMS_VERSION, betaMode, configuredCountries, getBetaAccess, redeemBetaInvite, requireBetaAccess } from "@/lib/beta/access";

describe("private-beta access policy", () => {
  const environment = process.env as Record<string, string | undefined>;
  const priorMode = environment.BETA_ACCESS_MODE;
  const priorCountries = environment.BETA_ALLOWED_COUNTRIES;

  afterEach(() => {
    if (priorMode === undefined) delete environment.BETA_ACCESS_MODE;
    else environment.BETA_ACCESS_MODE = priorMode;
    if (priorCountries === undefined) delete environment.BETA_ALLOWED_COUNTRIES;
    else environment.BETA_ALLOWED_COUNTRIES = priorCountries;
  });

  it("defaults to a bounded public preview", async () => {
    delete environment.BETA_ACCESS_MODE;
    const database = { prepare: () => { throw new Error("preview mode must not query enrollment data"); } } as unknown as D1Database;
    await expect(getBetaAccess(database, "did:privy:test")).resolves.toEqual({
      allowed: true,
      mode: "preview",
      status: "preview",
      cohort: "public-preview",
      transactionLimitUsd: 25_000,
      termsVersion: BETA_TERMS_VERSION
    });
  });

  it("switches to invite enforcement only when explicitly configured", () => {
    environment.BETA_ACCESS_MODE = "invite";
    expect(betaMode()).toBe("invite");
    environment.BETA_ACCESS_MODE = "unexpected";
    expect(betaMode()).toBe("preview");
  });

  it("normalizes the launch-country allowlist", () => {
    environment.BETA_ALLOWED_COUNTRIES = " pt,US, ch ,";
    expect(configuredCountries()).toEqual(["PT", "US", "CH"]);
  });

  it("rechecks an active invitation against the current launch countries", async () => {
    environment.BETA_ACCESS_MODE = "invite";
    environment.BETA_ALLOWED_COUNTRIES = "PT,CH";
    const row = { cohort: "founders", country_code: "PT", status: "active", transaction_limit_usd: 25_000, terms_version: BETA_TERMS_VERSION };
    const database = { prepare: () => ({ bind: () => ({ first: async () => row }) }) } as unknown as D1Database;
    await expect(requireBetaAccess(database, "subject-a")).resolves.toMatchObject({ allowed: true, countryCode: "PT" });
    environment.BETA_ALLOWED_COUNTRIES = "CH";
    await expect(getBetaAccess(database, "subject-a")).resolves.toMatchObject({ allowed: false, status: "country_unavailable", transactionLimitUsd: 0 });
    await expect(requireBetaAccess(database, "subject-a")).rejects.toMatchObject({ code: "country_unavailable" });
    environment.BETA_ALLOWED_COUNTRIES = "";
    await expect(requireBetaAccess(database, "subject-a")).rejects.toMatchObject({ code: "country_unavailable" });
  });

  it("does not redeem an invitation when the launch-country list is empty", async () => {
    environment.BETA_ACCESS_MODE = "invite";
    environment.BETA_ALLOWED_COUNTRIES = "";
    const database = { prepare: () => { throw new Error("No enrollment write or read should occur"); } } as unknown as D1Database;
    await expect(redeemBetaInvite(database, { subjectReference: "subject-a", code: "AUREL-TEST", countryCode: "PT" }))
      .rejects.toMatchObject({ code: "country_unavailable" });
  });
});
