// Stands in for @privy-io/wagmi in end-to-end tests: plain wagmi, with every
// chain read from the fake edge's node instead of a public RPC.
import { http, type Transport } from "viem";
import { createConfig as createWagmiConfig, type CreateConfigParameters } from "wagmi";

export { WagmiProvider } from "wagmi";

declare const __AURA_E2E_EDGE__: string;

export function createConfig(parameters: CreateConfigParameters) {
  const transports: Record<number, Transport> = Object.fromEntries(parameters.chains.map((chain) => [chain.id, http(`${__AURA_E2E_EDGE__}/rpc/${chain.id}`)]));
  return createWagmiConfig({ ...parameters, transports } as CreateConfigParameters);
}
