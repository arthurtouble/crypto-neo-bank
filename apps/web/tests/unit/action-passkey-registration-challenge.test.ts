import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { issuePendingRegistrationChallenge } from "@/lib/security/action-passkey-registration";

const root = resolve(process.cwd(), "../../infra/d1/migrations");
const now = new Date("2026-09-23T00:01:00.000Z");
const input = { subjectReference: "subject-a", sessionReference: "session-a", origin: "https://app.aurel.test", rpId: "app.aurel.test", deploymentMode: "development" as const, now };
let sqlite: DatabaseSync;
let database: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(root).filter((name) => name.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(resolve(root, file), "utf8"));
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at)
      VALUES ('subject-a','subject-a','2026-09-23T00:00:00.000Z','2026-09-23T00:00:00.000Z');
    INSERT INTO security_profiles (subject_reference, updated_at)
      VALUES ('subject-a','2026-09-23T00:00:00.000Z');
`);
  database = { prepare(sql: string) {
    let values: unknown[] = [];
    return { bind(...bound: unknown[]) { values = bound; return this; }, async run() {
      const result = sqlite.prepare(sql).run(...values as Array<string | number | null>);
      return { meta: { changes: Number(result.changes) } };
    } };
  } } as unknown as D1Database;
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); });

describe("pending passkey registration challenge", () => {
  it("stores a one-use digest, never the raw challenge, and requires UV", async () => {
    const issued = await issuePendingRegistrationChallenge(database, input);
    expect(issued.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.options.challenge).toBe(issued.challenge);
    expect(issued.options.authenticatorSelection?.userVerification).toBe("required");
    expect(issued.options.rp.id).toBe(input.rpId);
    expect(issued.expiresAt).toBe("2026-09-23T00:06:00.000Z");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(issued.challenge));
    const digest = `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    expect(sqlite.prepare("SELECT challenge_digest, purpose, subject_reference, session_reference, origin, rp_id, consumed_at FROM action_passkey_challenges").get())
      .toMatchObject({ challenge_digest: digest, purpose: "registration", subject_reference: "subject-a", session_reference: "session-a", origin: input.origin, rp_id: input.rpId, consumed_at: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM action_passkey_credentials").get()).toMatchObject({ count: 0 });
  });

  it.each([
    ["foreign subject", { subjectReference: "subject-b" }],
    ["empty session", { sessionReference: "" }],
    ["wrong origin", { origin: "https://evil.example" }],
    ["wrong RP", { rpId: "evil.example" }]
  ])("rejects %s", async (_name, change) => {
    await expect(issuePendingRegistrationChallenge(database, { ...input, ...change })).rejects.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM action_passkey_challenges").get()).toMatchObject({ count: 0 });
  });

  it("rejects a locked subject", async () => {
    sqlite.exec("UPDATE security_profiles SET account_locked=1");
    await expect(issuePendingRegistrationChallenge(database, input)).rejects.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM action_passkey_challenges").get()).toMatchObject({ count: 0 });
  });

  it("rejects a Worker host in production", async () => {
    const host = "aurel-financial-os.aurel-events.workers.dev";
    await expect(issuePendingRegistrationChallenge(database, { ...input, origin: `https://${host}`, rpId: host, deploymentMode: "production" })).rejects.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM action_passkey_challenges").get()).toMatchObject({ count: 0 });
  });
});
