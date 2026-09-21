import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { arbitrum, base, mainnet, optimism, polygon } from "wagmi/chains";

export const HOME_CHAIN = base;
export const SUPPORTED_CHAINS = [base, mainnet, arbitrum, optimism, polygon] as const;

export const web3Config = createConfig({
  chains: SUPPORTED_CHAINS,
  transports: {
    [base.id]: http(),
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http()
  }
});

declare module "wagmi" {
  interface Register {
    config: typeof web3Config;
  }
}

export const BASE_ASSETS = {
  ETH: { symbol: "ETH", name: "Ether", decimals: 18, address: null },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    address: "0x4200000000000000000000000000000000000006" as const
  }
} as const;

