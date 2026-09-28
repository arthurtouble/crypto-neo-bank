import { PrivyClient } from "@privy-io/node";
import { PRIVY_APP_ID } from "@/config/client";
import { localEdgeUrl } from "@/lib/testing/local-edge";

let client: PrivyClient | null = null;

/** One Privy client per isolate, so its verification key cache is reused across requests. */
export function privyClient(): PrivyClient {
  if (!process.env.PRIVY_APP_SECRET) throw new Error("Privy server authentication is not configured.");
  // In end-to-end tests, Privy is a local fake with its own token signing key.
  const localApi = localEdgeUrl("PRIVY_API_URL");
  client ??= new PrivyClient({ appId: PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET,
    ...(localApi ? { apiUrl: localApi, jwtVerificationKey: process.env.PRIVY_VERIFICATION_KEY } : {}) });
  return client;
}

/** The customer's verified email from Privy, if their account has one. Aura keeps no copy. */
export async function privyEmail(subject: string): Promise<string | null> {
  const user = await privyClient().users()._get(subject) as { linked_accounts: Array<{ type: string; address?: string }> };
  return user.linked_accounts.find((account) => account.type === "email" && account.address)?.address ?? null;
}
