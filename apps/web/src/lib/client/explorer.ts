import { SUPPORTED_CHAINS } from "@/config/supported-chains";

/** A transaction on its network's block explorer, or null for a network Aura doesn't list. */
export function explorerTx(chainId: number | null | undefined, hash: string | null | undefined): string | null {
  const url = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.blockExplorers?.default.url;
  return url && hash && /^0x[0-9a-f]{64}$/i.test(hash) ? `${url}/tx/${hash}` : null;
}
