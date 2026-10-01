"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { erc20TransferData } from "@/lib/chain/erc20-transfer";
import { formatUnits } from "@/lib/format/units";
import { HOME_CHAIN } from "@/config/supported-chains";
import { assetsFor } from "@/lib/assets/registry";

// The previous smart wallet held USDC, WETH, and ETH on Base.
const baseToken = (symbol: string) => assetsFor("hold", HOME_CHAIN.id).find((item) => item.symbol === symbol)!.address!;
const USDC = baseToken("USDC");
const WETH = baseToken("WETH");
import { useApi } from "@/lib/client/api";
import { useNativeBalance, useTokenBalance, useWallet } from "@/lib/client/wallet-context";
import { formatToken } from "@/lib/format";
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
  const { smartWalletClient: client } = useWallet();
  const accounts = useQuery({ queryKey: ["previous-account"], queryFn: () => api<Previous>("/api/account/previous"), staleTime: 60_000 });
  const previous = accounts.data?.previous ?? undefined;
  const usdc = useTokenBalance(USDC, previous, HOME_CHAIN.id);
  const weth = useTokenBalance(WETH, previous, HOME_CHAIN.id);
  const eth = useNativeBalance(previous, HOME_CHAIN.id);
  const [phase, setPhase] = useState<Phase>("idle");
  const toast = useToast();

  const account = accounts.data?.account;
  const holdings = [
    { symbol: "USDC", raw: usdc.data ?? 0n, decimals: 6 },
    { symbol: "WETH", raw: weth.data ?? 0n, decimals: 18 },
    { symbol: "ETH", raw: eth.data ?? 0n, decimals: 18 }
  ].filter((item) => item.raw > 0n);
  if (!previous || !account || previous === account || holdings.length === 0) {
    return null;
  }

  async function move() {
    if (!client || !account) return toast.error("Not ready yet", "Your previous account isn't ready yet. Refresh and try again.");
    setPhase("confirm");
    const calls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [];
    if (usdc.data) calls.push({ to: USDC, value: 0n, data: erc20TransferData(account, usdc.data) });
    if (weth.data) calls.push({ to: WETH, value: 0n, data: erc20TransferData(account, weth.data) });
    if (eth.data) calls.push({ to: account, value: eth.data, data: "0x" });
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
          formatToken(Number(formatUnits(item.raw, item.decimals)), item.symbol, { maxDecimals: 6 })).join(", ")}.</p>
      </div>
      <button type="button" className="appButton appButtonPrimary" disabled={phase === "confirm"} onClick={() => void move()}>
        {phase === "confirm" ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}{phase === "confirm" ? "Confirm the move" : "Move everything"}
      </button>
    </section>
  );
}
