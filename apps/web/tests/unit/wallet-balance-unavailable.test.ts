import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: async () => null }),
  useFundWallet: () => ({ fundWallet: async () => undefined })
}));
vi.mock("@privy-io/react-auth/smart-wallets", () => ({ useSmartWallets: () => ({
  client: { account: { address: "0x1111111111111111111111111111111111111111" } }, getClientForChain: async () => undefined
}) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }), useQueryClient: () => ({ invalidateQueries: async () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }), useSearchParams: () => new URLSearchParams() }));
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
});
