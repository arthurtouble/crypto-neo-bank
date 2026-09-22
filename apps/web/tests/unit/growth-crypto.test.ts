import { describe, expect, it } from "vitest";
import { decryptEmail, emailLookupHmac, encryptEmail, normalizeEmail } from "@/lib/growth/crypto";

describe("growth privacy helpers", () => {
  it("normalizes email without exposing a reversible lookup value", async () => {
    expect(normalizeEmail("  Person@Example.COM ")).toBe("person@example.com");
    const first = await emailLookupHmac("Person@example.com", "lookup-key-one");
    expect(first).toBe(await emailLookupHmac(" person@EXAMPLE.com ", "lookup-key-one"));
    expect(first).not.toBe(await emailLookupHmac("person@example.com", "lookup-key-two"));
    expect(first).not.toContain("person");
  });

  it("encrypts with a unique nonce and decrypts with the matching key", async () => {
    const first = await encryptEmail("Person@example.com", "encryption-key");
    const second = await encryptEmail("Person@example.com", "encryption-key");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    await expect(decryptEmail(first.ciphertext, first.nonce, "encryption-key")).resolves.toBe("person@example.com");
    await expect(decryptEmail(first.ciphertext, first.nonce, "wrong-key")).rejects.toThrow();
  });
});
