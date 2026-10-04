import { describe, expect, it } from "vitest";
import { linkEmailFailure } from "@/lib/client/account-email";

describe("linkEmailFailure", () => {
  it("says nothing when the customer closes the flow", () => {
    expect(linkEmailFailure("exited_link_flow")).toBeNull();
  });

  it("says what to do for each failure Privy reports", () => {
    expect(linkEmailFailure("linked_to_another_user")).toBe("That email is already on another Aura account. Add a different email, or log out and sign in with that one.");
    expect(linkEmailFailure("too_many_requests")).toBe("Too many tries. Wait a minute, then try again.");
    expect(linkEmailFailure("invalid_credentials")).toBe("That code didn't match. Add your email again to get a new code.");
    expect(linkEmailFailure("unknown_error")).toBe("That email couldn't be added. Try again.");
  });

  it("never speaks as \"we\"", () => {
    for (const code of ["linked_to_another_user", "too_many_requests", "invalid_credentials", "unknown_error"]) expect(linkEmailFailure(code)).not.toMatch(/\bwe\b/i);
  });
});
