import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Sign-in and the wallet runtime (Privy and wagmi, through lib/client/auth.tsx and lib/client/wallet-context.tsx).
vi.mock("@/lib/client/auth", () => ({
  useAuth: () => ({ getAccessToken: async () => null, user: { linkedAccounts: [
    { type: "wallet", chainType: "ethereum", walletClientType: "privy", address: "0x2222222222222222222222222222222222222222" },
    { type: "wallet", chainType: "ethereum", walletClientType: "metamask", address: "0xABE0750986FB2A72E0EBB71E28BB80402F7A6B54" }
  ] } })
}));
vi.mock("@/lib/client/wallet-context", () => ({
  useWallet: () => ({
    wallets: [{ walletClientType: "privy", address: "0x1111111111111111111111111111111111111111" }],
    fundWallet: async () => undefined, showMfaEnrollmentModal: () => undefined,
    generateAuthorizationSignature: async () => ({ signature: "sig" }), smartWalletClient: undefined
  }),
  // Every chain balance read fails.
  useNativeBalance: () => ({ data: undefined, isPending: false, isError: true }),
  useTokenBalance: () => ({ data: undefined, isPending: false, isError: true }),
  useTokenBalances: () => ({ data: undefined, isPending: false, isError: true })
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }), useQueryClient: () => ({ invalidateQueries: async () => undefined }) }));
const search = vi.hoisted(() => ({ params: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }), useSearchParams: () => new URLSearchParams(search.params) }));

import { WalletWorkspace } from "@/components/wallet-workspace";
import { assetsFor } from "@/lib/assets/registry";

describe("wallet balance authority", () => {
  it("shows unavailable when chain balance reads fail", () => {
    const html = renderToStaticMarkup(createElement(WalletWorkspace));
    // The selected asset's balance says so instead of showing a number.
    expect(html).toContain("Balance unavailable");
    expect(html).not.toMatch(/\d USDC available/);
  });

  it("lists exactly the registry's sendable assets on Base", () => {
    search.params = "";
    const html = renderToStaticMarkup(createElement(WalletWorkspace)).replaceAll("<!-- -->", "");
    // The Asset field offers the registry's sendable assets, and nothing else.
    const offered = [...html.matchAll(/<option(?: selected="")?>([^<]+)<\/option>/g)].map((match) => match[1]);
    expect(offered).toEqual(assetsFor("send").map((item) => item.symbol));
    for (const symbol of ["ETH", "USDC", "WETH", "cbBTC"]) expect(offered).toContain(symbol);
  });

  it("offers the customer's own linked wallet as a destination, never the Privy signer", () => {
    search.params = "sendTo=0x4444444444444444444444444444444444444444";
    const html = renderToStaticMarkup(createElement(WalletWorkspace)).replaceAll("<!-- -->", "");
    expect(html).toContain("<strong>My wallet</strong><small>0xabe0…6b54</small>");
    expect(html).not.toContain("0x2222…2222");
  });
});
