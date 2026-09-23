import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyActionPasskeyAssertion } from "@/lib/security/action-passkey-assertion";

const origin = "https://app.aurel.test";
const rpId = "app.aurel.test";
const challenge = "YWN0aW9uLWJvdW5kLWNoYWxsZW5nZS0xMjM0NTY3ODkw";
const credentialId = "Y3JlZGVudGlhbC0xMjM0NTY3ODkw";
const encode = (value: Uint8Array) => Buffer.from(value).toString("base64url");

function derInteger(bytes: Uint8Array) {
  const trimmed = bytes.subarray(bytes.findIndex((byte) => byte !== 0));
  const value = trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : Buffer.from(trimmed);
  return Buffer.concat([Buffer.from([0x02, value.length]), value]);
}

function derSignature(raw: Uint8Array) {
  const r = derInteger(raw.subarray(0, 32));
  const s = derInteger(raw.subarray(32, 64));
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}

async function signedAssertion(changes: {
  challenge?: string;
  origin?: string;
  rpId?: string;
  flags?: number;
  counter?: number;
  badSignature?: boolean;
  credentialId?: string;
  status?: "pending" | "active" | "revoked";
  subjectReference?: string;
  expectedOrigin?: string;
  expectedRpId?: string;
  storedCounter?: number;
} = {}) {
  const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
  const x = Buffer.from(publicJwk.x!, "base64url");
  const y = Buffer.from(publicJwk.y!, "base64url");
  const publicKeyCose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x, Buffer.from([0x22, 0x58, 0x20]), y]);
  const rpHash = Buffer.from(await webcrypto.subtle.digest("SHA-256", Buffer.from(changes.rpId ?? rpId)));
  const authData = Buffer.alloc(37);
  rpHash.copy(authData);
  authData[32] = changes.flags ?? 0x05;
  authData.writeUInt32BE(changes.counter ?? 1, 33);
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: changes.challenge ?? challenge, origin: changes.origin ?? origin }));
  const clientHash = Buffer.from(await webcrypto.subtle.digest("SHA-256", clientData));
  const signature = derSignature(new Uint8Array(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, Buffer.concat([authData, clientHash]))));
  if (changes.badSignature) signature[signature.length - 1] ^= 0x01;
  const response: AuthenticationResponseJSON = {
    id: changes.credentialId ?? credentialId,
    rawId: changes.credentialId ?? credentialId,
    type: "public-key",
    clientExtensionResults: {},
    response: { authenticatorData: encode(authData), clientDataJSON: encode(clientData), signature: encode(signature) },
  };
  return {
    response,
    challenge,
    expectedOrigin: changes.expectedOrigin ?? origin,
    expectedRpId: changes.expectedRpId ?? rpId,
    subjectReference: "subject-1",
    credential: {
      credentialId,
      subjectReference: changes.subjectReference ?? "subject-1",
      publicKeyCose: new Uint8Array(publicKeyCose),
      counter: changes.storedCounter ?? 0,
      status: changes.status ?? "active",
      rpId,
    },
  };
}

describe("action-bound passkey assertion", () => {
  it("returns only verified facts for a signed, UV assertion", async () => {
    await expect(verifyActionPasskeyAssertion(await signedAssertion())).resolves.toEqual({
      credentialId, newCounter: 1, origin, rpId,
      challengeDigest: "sha256:5449142303fa7137526a537ca545cf6437af00e3cecb5446fc4b99572153c6fe"
    });
  });

  it.each([
    ["wrong challenge", { challenge: "d3JvbmctY2hhbGxlbmdl" }],
    ["wrong origin", { origin: "https://other.aurel.test" }],
    ["wrong RP hash", { rpId: "other.aurel.test" }],
    ["missing UV", { flags: 0x01 }],
    ["bad signature", { badSignature: true }],
    ["wrong credential ID", { credentialId: "b3RoZXItY3JlZGVudGlhbA" }],
    ["revoked credential", { status: "revoked" }],
    ["counter regression", { storedCounter: 2 }],
    ["foreign credential", { subjectReference: "subject-2" }],
    ["invalid configured origin", { expectedOrigin: "http://app.aurel.test" }],
    ["invalid configured RP", { expectedRpId: "workers.dev" }],
  ] as const)("rejects %s", async (_name, changes) => {
    await expect(verifyActionPasskeyAssertion(await signedAssertion(changes))).rejects.toThrow();
  });
});
