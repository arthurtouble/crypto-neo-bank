import { describe, expect, it } from "vitest";
import { RateLimitError } from "@/lib/security/rate-limit";

describe("rate-limit response", () => {
  it("carries a bounded retry interval", () => {
    const error = new RateLimitError(30);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.message).not.toContain("subject");
  });
});
