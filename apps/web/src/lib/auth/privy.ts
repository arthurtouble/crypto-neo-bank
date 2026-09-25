import { PrivyClient } from "@privy-io/node";
import { PRIVY_APP_ID } from "@/config/client";

let client: PrivyClient | null = null;

/** One Privy client per isolate, so its verification key cache is reused across requests. */
export function privyClient(): PrivyClient {
  if (!process.env.PRIVY_APP_SECRET) throw new Error("Privy server authentication is not configured.");
  client ??= new PrivyClient({ appId: PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
  return client;
}
