import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { aTokenFor } from "./fake-edge.mjs";

const edgeUrl = `http://127.0.0.1:${process.env.AUREL_E2E_EDGE_PORT ?? "43174"}`;

export const ASSETS = {
  usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  weth: "0x4200000000000000000000000000000000000006",
  cbbtc: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
  aaveUsdc: aTokenFor("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
  aaveWeth: aTokenFor("0x4200000000000000000000000000000000000006"),
  skySavings: "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd"
} as const;

/** Change what the fake Privy, chains, and price feed return. */
export async function edge(path: "/__reset" | "/__state" | "/__session", body: unknown = {}) {
  const response = await fetch(`${edgeUrl}${path}`, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`fake edge ${path} failed: ${response.status}`);
  return response.json() as Promise<{ token?: string }>;
}

export type Customer = { userId: string; wallet: `0x${string}`; email: string; token: string };

/** A new customer with their own Privy account and embedded wallet, unique to the test. */
export async function newCustomer(options: { mfa?: string[]; expiresIn?: number } = {}): Promise<Customer> {
  const id = randomUUID().replaceAll("-", "");
  const customer = { userId: `did:privy:${id}`, wallet: `0x${id.padEnd(40, "0").slice(0, 40)}` as `0x${string}`, email: `${id.slice(0, 8)}@example.com` };
  await edge("/__state", { users: { [customer.userId]: { wallet: customer.wallet, email: customer.email, mfa: options.mfa ?? [] } } });
  const { token } = await edge("/__session", { userId: customer.userId, expiresIn: options.expiresIn });
  return { ...customer, token: token! };
}

/** Set on-chain balances for a wallet. Amounts are raw units, per chain and token (or "native"). */
export async function setBalances(wallet: string, balances: Partial<Record<1 | 8453, Record<string, string>>>) {
  const state: Record<number, Record<string, Record<string, string>>> = {};
  for (const [chain, tokens] of Object.entries(balances)) {
    state[Number(chain)] = {};
    for (const [token, amount] of Object.entries(tokens ?? {})) state[Number(chain)][token.toLowerCase()] = { [wallet.toLowerCase()]: amount };
  }
  await edge("/__state", { balances: state });
}

/**
 * Give the browser the identity Privy would return. With `signedIn`, the
 * customer starts signed in; otherwise they sign in with the page's button.
 */
export async function setIdentity(page: Page, customer: Customer, options: { signedIn?: boolean } = {}) {
  await page.addInitScript(({ session, signedIn }) => {
    localStorage.setItem("aura-e2e-session", JSON.stringify(session));
    if (signedIn) localStorage.setItem("aura-e2e-signed-in", "1");
  }, { session: { userId: customer.userId, token: customer.token, wallet: customer.wallet, email: customer.email }, signedIn: options.signedIn ?? false });
}

/** Accept the current terms through the API, as a returning customer already has. */
export async function acceptTerms(page: Page, customer: Customer) {
  const current = await page.request.get("/api/terms", { headers: { Authorization: `Bearer ${customer.token}` } });
  const { documents } = await current.json() as { documents: Array<{ key: string; version: string }> };
  const version = (key: string) => documents.find((item) => item.key === key)!.version;
  const response = await page.request.post("/api/terms", { headers: { Authorization: `Bearer ${customer.token}` },
    data: { termsVersion: version("terms_of_use"), privacyVersion: version("privacy_notice") } });
  if (!response.ok()) throw new Error(`accepting terms failed: ${response.status()}`);
}
