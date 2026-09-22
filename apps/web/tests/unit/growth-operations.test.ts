import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition } from "@/lib/growth/operations";

describe("growth application transitions", () => {
  it("requires deliberate review before qualification", () => {
    expect(canTransition("received", "qualified")).toBe(false);
    expect(canTransition("received", "reviewing")).toBe(true);
    expect(canTransition("reviewing", "qualified")).toBe(true);
  });
  it("does not let an invited or withdrawn application silently reopen", () => {
    expect(allowedTransitions.invited).toEqual(["withdrawn"]);
    expect(allowedTransitions.withdrawn).toEqual([]);
  });
  it("permits declined records to enter explicit review", () => expect(canTransition("declined", "reviewing")).toBe(true));
});
