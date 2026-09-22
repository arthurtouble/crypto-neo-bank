import { describe, expect, it } from "vitest";
import { growthApplicationSchema, redactEmail } from "@/lib/growth/applications";

const valid = { email: "person@example.com", countryCode: "pt", primaryJob: "move", workflowFrequency: "weekly", assetBand: null, relationshipType: "individual", walletsChains: ["base", "external_wallet"], desiredOutcome: "I want fewer manual steps when moving digital dollars.", betaContactConsent: true, marketingConsent: false, privacyNoticeVersion: "2026-09-22", applicationVersion: "private-access-v1", attribution: { anonymousSessionId: "f5ba9bbc-4318-4fcb-8649-c9b3be2c315e", landingPath: "/apply", referrerHost: "example.com" }, turnstileToken: "test" };

describe("growth application schema", () => {
  it("normalizes country and accepts independent optional marketing consent", () => {
    const parsed = growthApplicationSchema.parse(valid);
    expect(parsed.countryCode).toBe("PT");
    expect(parsed.marketingConsent).toBe(false);
  });

  it.each([
    { ...valid, primaryJob: "invest_everything" },
    { ...valid, desiredOutcome: "short" },
    { ...valid, countryCode: "Portugal" },
    { ...valid, walletAddress: "0x123" },
    { ...valid, betaContactConsent: false },
    { ...valid, attribution: { ...valid.attribution, landingPath: "https://evil.example" } }
  ])("rejects invalid or extra sensitive input", (input) => expect(() => growthApplicationSchema.parse(input)).toThrow());

  it("redacts email for queues", () => expect(redactEmail("person@example.com")).toBe("p•••@example.com"));
});
