import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { validateActionPasskeyOrigin } from "./action-passkey-origin";

export type StoredActionCredential = {
  credentialId: string;
  subjectReference: string;
  publicKeyCose: Uint8Array;
  counter: number;
  status: "pending" | "active" | "revoked";
  rpId: string;
};

export type VerifyActionPasskeyInput = {
  response: AuthenticationResponseJSON;
  challenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  deploymentMode: "development" | "production";
  subjectReference: string;
  credential: StoredActionCredential;
};

declare const verifiedAssertionBrand: unique symbol;
export type VerifiedActionPasskeyAssertion = {
  credentialId: string;
  newCounter: number;
  origin: string;
  rpId: string;
  challengeDigest: string;
  readonly [verifiedAssertionBrand]: true;
};

export async function verifyActionPasskeyAssertion(input: VerifyActionPasskeyInput): Promise<VerifiedActionPasskeyAssertion> {
  const { credential, expectedOrigin, expectedRpId } = input;
  validateActionPasskeyOrigin(expectedOrigin, expectedRpId, input.deploymentMode);
  if (
    !input.subjectReference ||
    credential.status !== "active" ||
    credential.subjectReference !== input.subjectReference ||
    credential.rpId !== expectedRpId ||
    credential.credentialId !== input.response.id ||
    credential.credentialId !== input.response.rawId ||
    credential.publicKeyCose.length === 0 ||
    !Number.isSafeInteger(credential.counter) ||
    credential.counter < 0 ||
    !/^[A-Za-z0-9_-]{43,}$/.test(input.challenge)
  ) {
    throw new Error("Passkey credential or challenge is not valid for this action.");
  }
  const verified = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin,
    expectedRPID: expectedRpId,
    expectedType: "webauthn.get",
    requireUserVerification: true,
    credential: { id: credential.credentialId, publicKey: new Uint8Array(credential.publicKeyCose), counter: credential.counter },
  });
  if (
    !verified.verified ||
    !verified.authenticationInfo.userVerified ||
    verified.authenticationInfo.credentialID !== credential.credentialId ||
    verified.authenticationInfo.origin !== expectedOrigin ||
    verified.authenticationInfo.rpID !== expectedRpId ||
    (verified.authenticationInfo.newCounter > 0 && verified.authenticationInfo.newCounter <= credential.counter)
  ) {
    throw new Error("Passkey assertion was not verified.");
  }
  const challengeHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.challenge)));
  return {
    credentialId: credential.credentialId,
    newCounter: verified.authenticationInfo.newCounter,
    origin: verified.authenticationInfo.origin,
    rpId: verified.authenticationInfo.rpID,
    challengeDigest: `sha256:${Array.from(challengeHash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  } as VerifiedActionPasskeyAssertion;
}
