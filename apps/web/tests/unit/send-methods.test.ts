import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const state = vi.hoisted(() => ({ db: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
const { GET } = await import("@/app/api/send/methods/route");

const read = async () => (await GET(new Request("https://aura.test/api/send/methods"))).json();

describe("what Send can do now", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); });

  it("follows the send and other-network switches", async () => {
    expect(await read()).toMatchObject({ sending: false, otherNetworks: false });
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'direct_transfers'");
    expect(await read()).toMatchObject({ sending: true, otherNetworks: false });
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'cross_chain'");
    expect(await read()).toMatchObject({ sending: true, otherNetworks: true });
  });
});
