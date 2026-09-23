import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyPendingActionPasskeyRegistration } from "@/lib/security/action-passkey-registration";

const rpId = "app.aurel.test";
const origin = `https://${rpId}`;
const challenge = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const credentialId = Buffer.from("aurel-credential-1").toString("base64url");
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const cborBytes = (bytes: Uint8Array) => Buffer.concat([
  Buffer.from(bytes.length < 24 ? [0x40 + bytes.length] : bytes.length < 256
    ? [0x58, bytes.length] : [0x59, bytes.length >> 8, bytes.length & 0xff]), Buffer.from(bytes)
]);

async function registration(changes: { challenge?: string; origin?: string; rpId?: string; flags?: number; algorithm?: number; id?: string; counter?: number; malformedKey?: boolean } = {}) {
  const algorithm = changes.algorithm ?? -7;
  let cose: Buffer;
  if (changes.malformedKey) cose = Buffer.from([0xa1, 0x01, 0x02]);
  else if (algorithm === -257) {
    const keys = await webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const jwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
    cose = Buffer.concat([Buffer.from([0xa4, 0x01, 0x03, 0x03, 0x39, 0x01, 0x00, 0x20]),
      cborBytes(Buffer.from(jwk.n!, "base64url")), Buffer.from([0x21]), cborBytes(Buffer.from(jwk.e!, "base64url"))]);
  } else {
    const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
    const x = Buffer.from(jwk.x!, "base64url");
    const y = Buffer.from(jwk.y!, "base64url");
    cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, algorithm === -7 ? 0x26 : 0x27, 0x20, 0x01, 0x21, 0x58, 0x20]),
      x, Buffer.from([0x22, 0x58, 0x20]), y]);
  }
  const idBytes = Buffer.from("aurel-credential-1");
  const authData = Buffer.alloc(37);
  Buffer.from(await webcrypto.subtle.digest("SHA-256", Buffer.from(changes.rpId ?? rpId))).copy(authData);
  authData[32] = changes.flags ?? 0x45;
  authData.writeUInt32BE(changes.counter ?? 0, 33);
  const attested = Buffer.concat([authData, Buffer.alloc(16), Buffer.from([0, idBytes.length]), idBytes, cose]);
  const attestation = Buffer.concat([
    Buffer.from([0xa3, 0x63, ...Buffer.from("fmt"), 0x64, ...Buffer.from("none"), 0x67, ...Buffer.from("attStmt"), 0xa0,
      0x68, ...Buffer.from("authData")]),
    cborBytes(attested)
  ]);
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: changes.challenge ?? challenge, origin: changes.origin ?? origin }));
  const response: RegistrationResponseJSON = {
    id: changes.id ?? credentialId,
    rawId: changes.id ?? credentialId,
    type: "public-key",
    clientExtensionResults: {},
    response: { attestationObject: encode(attestation), clientDataJSON: encode(clientData) }
  };
  return { response, challenge, expectedOrigin: origin, expectedRpId: rpId, deploymentMode: "development" as const, subjectReference: "subject-a" };
}

describe("pending action passkey registration verification", () => {
  it("verifies a UV registration and returns only pending credential evidence", async () => {
    const result = await verifyPendingActionPasskeyRegistration(await registration());
    expect(result).toMatchObject({ credentialId, subjectReference: "subject-a", algorithm: -7, counter: 0, origin, rpId });
    expect(result.publicKeyCose).toBeInstanceOf(Uint8Array);
    expect(result.publicKeyCose.length).toBeGreaterThan(50);
    expect(result.challengeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty("status", "active");
  });

  it("preserves a nonzero authenticator counter", async () => {
    await expect(verifyPendingActionPasskeyRegistration(await registration({ counter: 3 }))).resolves.toMatchObject({ counter: 3 });
  });

  it("accepts a valid RS256 public key", async () => {
    await expect(verifyPendingActionPasskeyRegistration(await registration({ algorithm: -257 })))
      .resolves.toMatchObject({ algorithm: -257 });
  });

  it.each([
    ["wrong challenge", { challenge: "d3JvbmctY2hhbGxlbmdl" }],
    ["wrong origin", { origin: "https://other.aurel.test" }],
    ["wrong RP hash", { rpId: "other.aurel.test" }],
    ["missing UV", { flags: 0x41 }],
    ["unsupported algorithm", { algorithm: -8 }],
    ["malformed public key", { malformedKey: true }],
    ["changed credential ID", { id: "b3RoZXItY3JlZGVudGlhbA" }]
  ] as const)("rejects %s", async (_name, changes) => {
    await expect(verifyPendingActionPasskeyRegistration(await registration(changes))).rejects.toThrow();
  });

  it("rejects a Worker host in production", async () => {
    const host = "aurel-financial-os.aurel-events.workers.dev";
    const input = await registration({ origin: `https://${host}`, rpId: host });
    await expect(verifyPendingActionPasskeyRegistration({ ...input, expectedOrigin: `https://${host}`, expectedRpId: host, deploymentMode: "production" })).rejects.toThrow();
  });

  it("rejects an oversized attestation before parsing", async () => {
    const input = await registration();
    input.response.response.attestationObject = "a".repeat(131_073);
    await expect(verifyPendingActionPasskeyRegistration(input)).rejects.toThrow(/binding/i);
  });
});
