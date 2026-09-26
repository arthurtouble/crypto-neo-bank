import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@privy-io/react-auth", () => ({
  useFundWallet: () => ({ fundWallet: async () => undefined }),
  usePrivy: () => ({ getAccessToken: async () => null, user: { linkedAccounts: [
    { type: "wallet", chainType: "ethereum", walletClientType: "privy", address: "0x2222222222222222222222222222222222222222" },
    { type: "wallet", chainType: "ethereum", walletClientType: "metamask", address: "0xABE0750986FB2A72E0EBB71E28BB80402F7A6B54" }
  ] } })
}));
vi.mock("@privy-io/react-auth/smart-wallets", () => ({ useSmartWallets: () => ({
  client: { account: { address: "0x1111111111111111111111111111111111111111" } }, getClientForChain: async () => undefined
}) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }), useQueryClient: () => ({ invalidateQueries: async () => undefined }) }));
const search = vi.hoisted(() => ({ params: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }), useSearchParams: () => new URLSearchParams(search.params) }));
vi.mock("wagmi", async (importOriginal) => ({
  ...await importOriginal<typeof import("wagmi")>(),
  useBalance: () => ({ data: undefined, isPending: false, isError: true }),
  useReadContract: () => ({ data: undefined, isPending: false, isError: true })
}));

import { WalletWorkspace } from "@/components/wallet-workspace";

describe("wallet balance authority", () => {
  it("shows unavailable when chain balance reads fail", () => {
    const html = renderToStaticMarkup(createElement(WalletWorkspace, { mode: "send" }));
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Observed now");
  });

  it("offers the customer's own linked wallet as a destination, never the Privy signer", () => {
    search.params = "sendTo=0x4444444444444444444444444444444444444444";
    const html = renderToStaticMarkup(createElement(WalletWorkspace, { mode: "send" })).replaceAll("<!-- -->", "");
    expect(html).toContain("Send to my wallet · 0xabe0…6b54");
    expect(html).not.toContain("0x2222…2222");
  });
});
