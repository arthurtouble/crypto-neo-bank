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
