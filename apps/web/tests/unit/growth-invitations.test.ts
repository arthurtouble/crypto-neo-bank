import { describe, expect, it } from "vitest";
import { createInviteCode, hashInviteCode } from "@/lib/growth/invitations";

describe("growth invitations", () => {
  it("generates one-time material without storing it as the hash", async () => {
    const code = createInviteCode(); const hash = await hashInviteCode(code);
    expect(code).toMatch(/^AUREL-[A-Z0-9]+$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(code);
  });
  it("hashes normalized invite input", async () => expect(await hashInviteCode(" aurel-test ")).toBe(await hashInviteCode("AUREL-TEST")));
});
