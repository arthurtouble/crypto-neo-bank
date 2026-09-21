import { afterEach, describe, expect, it } from "vitest";
import { BETA_TERMS_VERSION, betaMode, configuredCountries, getBetaAccess } from "@/lib/beta/access";

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
});
