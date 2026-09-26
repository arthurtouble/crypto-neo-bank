import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ wallets: [] as Array<{ address: string; walletClientType: string }> }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ connectWallet: () => undefined, getAccessToken: async () => null }), useWallets: () => ({ wallets: state.wallets }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: async () => undefined }) }));
vi.mock("wagmi", async (importOriginal) => ({ ...await importOriginal<typeof import("wagmi")>(), usePublicClient: () => undefined, useBalance: () => ({ data: undefined }), useReadContract: () => ({ data: 5_000_000n, refetch: async () => undefined }) }));

import { AddFromWallet } from "@/components/add-from-wallet";

const account = "0x1111111111111111111111111111111111111111";
const render = () => renderToStaticMarkup(createElement(AddFromWallet, { account }));

describe("adding money from a connected wallet", () => {
  beforeEach(() => { state.wallets = []; });

  it("asks to connect a wallet when only the Privy signer is connected", () => {
    state.wallets = [{ address: "0x2222222222222222222222222222222222222222", walletClientType: "privy" }];
    expect(render()).toContain("Connect a wallet");
  });

  it("offers the connected wallet's USDC on Base", () => {
    state.wallets = [{ address: "0x2222222222222222222222222222222222222222", walletClientType: "privy" },
      { address: "0x3333333333333333333333333333333333333333", walletClientType: "metamask" }];
    const html = render().replaceAll("<!-- -->", "");
    expect(html).toContain("From 0x3333…3333 on Base");
    for (const network of ["Base", "Ethereum", "Arbitrum", "Optimism", "Polygon"]) expect(html).toContain(`>${network}</option>`);
    expect(html).toContain("5 USDC available");
    expect(html).toContain("Add from wallet");
  });
});
