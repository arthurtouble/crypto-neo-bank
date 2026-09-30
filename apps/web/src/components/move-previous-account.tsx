"use client";

import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { HOME_CHAIN } from "@/config/chains";
import { assetsFor } from "@/lib/assets/registry";

// The previous smart wallet held USDC, WETH, and ETH on Base.
const baseToken = (symbol: string) => assetsFor("hold", HOME_CHAIN.id).find((item) => item.symbol === symbol)!.address!;
const USDC = baseToken("USDC");
const WETH = baseToken("WETH");
import { useApi } from "@/lib/client/api";
import { useToast } from "./toast";

type Previous = { previous: `0x${string}` | null; account: `0x${string}` };
type Phase = "idle" | "confirm" | "done";

/**
 * Earlier versions of Aura kept funds in a smart wallet. This moves its USDC,
 * WETH, and ETH on Base to the current account in one approval, with gas
 * paid as before. It is the same one-step move Aura would use to change
 * wallet providers.
 */
export function MovePreviousAccount() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { client } = useSmartWallets();
  const accounts = useQuery({ queryKey: ["previous-account"], queryFn: () => api<Previous>("/api/account/previous"), staleTime: 60_000 });
  const previous = accounts.data?.previous ?? undefined;
  const enabled = { enabled: Boolean(previous) };
  const usdc = useReadContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: previous ? [previous] : undefined, chainId: HOME_CHAIN.id, query: enabled });
  const weth = useReadContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: previous ? [previous] : undefined, chainId: HOME_CHAIN.id, query: enabled });
  const eth = useBalance({ address: previous, chainId: HOME_CHAIN.id, query: enabled });
  const [phase, setPhase] = useState<Phase>("idle");
  const toast = useToast();

  const account = accounts.data?.account;
  const holdings = [
    { symbol: "USDC", raw: usdc.data ?? 0n, decimals: 6 },
    { symbol: "WETH", raw: weth.data ?? 0n, decimals: 18 },
    { symbol: "ETH", raw: eth.data?.value ?? 0n, decimals: 18 }
  ].filter((item) => item.raw > 0n);
  if (!previous || !account || previous === account || holdings.length === 0) {
    return null;
  }

  async function move() {
    if (!client || !account) return toast.error("Not ready yet", "Your previous account isn't ready yet. Refresh and try again.");
    setPhase("confirm");
    const calls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [];
    if (usdc.data) calls.push({ to: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, usdc.data] }) });
    if (weth.data) calls.push({ to: WETH, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, weth.data] }) });
    if (eth.data?.value) calls.push({ to: account, value: eth.data.value, data: "0x" });
    try {
      await client.sendTransaction({ calls }, { uiOptions: { description: "Move your funds to your new Aura account.", buttonText: "Move", isCancellable: true } });
      setPhase("done");
      toast.success("Funds moved", "Your balance updates in a moment.");
      await queryClient.invalidateQueries();
    } catch (reason) {
      setPhase("idle");
      const rejected = reason instanceof Error && /reject|denied|cancel|exited/i.test(reason.message);
      if (rejected) toast.show({ tone: "info", title: "Cancelled", detail: "Nothing moved." });
      else toast.error("Move didn't go through", "Check your previous account's activity before you try again.");
    }
  }

  return (
    <section className="ovNotice ovMove" aria-label="Move funds to your new account">
      <div>
        <h2>Move funds to your new account</h2>
        <p>Aura now uses a new account address. Your previous account still holds {holdings.map((item) =>
          `${Number(formatUnits(item.raw, item.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${item.symbol}`).join(", ")}.</p>
      </div>
      <button type="button" className="appButton appButtonPrimary" disabled={phase === "confirm"} onClick={() => void move()}>
        {phase === "confirm" ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}{phase === "confirm" ? "Confirm the move" : "Move everything"}
      </button>
    </section>
  );
}
