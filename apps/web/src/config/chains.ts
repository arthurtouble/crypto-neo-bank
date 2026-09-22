import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";

export const HOME_CHAIN = base;
export { SUPPORTED_CHAINS };

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

export const USDC_BY_CHAIN = {
  [base.id]: { chain: base, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  [mainnet.id]: { chain: mainnet, address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  [arbitrum.id]: { chain: arbitrum, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  [optimism.id]: { chain: optimism, address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  [polygon.id]: { chain: polygon, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" }
} as const;
