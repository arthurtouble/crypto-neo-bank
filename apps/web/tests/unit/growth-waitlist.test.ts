import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const load = () => import("@/lib/growth/waitlist").catch(() => null);

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE growth_waitlist (
    waitlist_id TEXT PRIMARY KEY,
    email_ciphertext TEXT NOT NULL,
    email_nonce TEXT NOT NULL,
    email_lookup_hmac TEXT NOT NULL UNIQUE,
    country_hint TEXT,
    country_hint_source TEXT NOT NULL,
    privacy_notice_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    attribution_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const statement = sqlite.prepare(sql);
          return {
            async first<T>() { return (statement.get(...values as (string | number | null)[]) ?? null) as T | null; },
            async run() { return { success: true, meta: statement.run(...values as (string | number | null)[]) }; }
          };
        }
      };
    }
  } as unknown as D1Database;
  return { db, sqlite };
}

describe("email-only waitlist", () => {
  it("accepts a trimmed email but rejects client-supplied country", async () => {
    const waitlist = await load();
    const accepted = waitlist?.waitlistSchema.safeParse({ email: " Test@Example.com ", privacyNoticeVersion: "2026-09-23" });
    expect(accepted?.success).toBe(true);
    expect(accepted?.success && accepted.data.email).toBe("Test@Example.com");
    expect(waitlist?.waitlistSchema.safeParse({ email: "person@example.com", privacyNoticeVersion: "2026-09-23", countryCode: "PT" }).success).toBe(false);
  });

  it("ignores forged country headers and special Cloudflare codes", async () => {
    const waitlist = await load();
    const forged = new Request("https://aurel.test", { headers: { "CF-IPCountry": "PT" } });
    expect(waitlist?.countryFromRequest(forged)).toEqual({ countryCode: null, source: "unknown" });
    for (const country of ["XX", "T1", "ZZ", "XK", "QO", "EZ"]) {
      const request = new Request("https://aurel.test") as Request & { cf?: { country: string } };
      request.cf = { country };
      expect(waitlist?.countryFromRequest(request)).toEqual({ countryCode: null, source: "unknown" });
    }
    const trusted = new Request("https://aurel.test") as Request & { cf?: { country: string } };
    trusted.cf = { country: "PT" };
    expect(waitlist?.countryFromRequest(trusted)).toEqual({ countryCode: "PT", source: "cloudflare" });
  });

  it("encrypts one row for case-equivalent duplicate emails", async () => {
    const waitlist = await load();
    const { db, sqlite } = database();
    process.env.GROWTH_EMAIL_ENCRYPTION_KEY = "unit-encryption-key";
    process.env.GROWTH_EMAIL_LOOKUP_KEY = "unit-lookup-key";
    const input = { email: " Test@Example.com ", privacyNoticeVersion: "2026-09-23" };
    expect(await waitlist?.persistWaitlist(db, input, { countryCode: null, source: "unknown" })).toMatchObject({ created: true });
    expect(await waitlist?.persistWaitlist(db, { ...input, email: "test@example.com" }, { countryCode: "PT", source: "cloudflare" })).toMatchObject({ created: false });
    const rows = sqlite.prepare("SELECT * FROM growth_waitlist").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].email_ciphertext).not.toContain("test@example.com");
    expect(rows[0].country_hint).toBeNull();
    sqlite.close();
  });
});
