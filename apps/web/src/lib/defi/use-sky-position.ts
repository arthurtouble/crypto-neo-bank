"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { SKY_SUSDS, SKY_USDC, skyVaultAbi } from "./sky-call-policy";

export function useSkyPosition(address?: string) {
  const client = usePublicClient({ chainId: 1 });
  return useQuery({
    queryKey: ["sky-vault", address],
    enabled: Boolean(address && client),
    queryFn: async () => {
      const owner = address as `0x${string}`;
      const [usdc, shares] = await Promise.all([
        client!.readContract({ address: SKY_USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
        client!.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "balanceOf", args: [owner] })
      ]);
      const assets = shares ? await client!.readContract({ address: SKY_SUSDS, abi: skyVaultAbi,
        functionName: "convertToAssets", args: [shares] }) : 0n;
      return { usdc: formatUnits(usdc, 6), susds: formatUnits(assets, 18) };
    },
    refetchInterval: 30_000
  });
}
