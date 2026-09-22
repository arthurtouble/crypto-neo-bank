import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";

// Server-safe chain identities. Keep React/wagmi configuration out of API
// module imports so an unauthenticated request can reach its auth guard.
export const SUPPORTED_CHAINS = [base, mainnet, arbitrum, optimism, polygon] as const;
