"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, LoaderCircle, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { erc20TransferData } from "@/lib/chain/erc20-transfer";
import { formatUnits, parseUnits } from "@/lib/format/units";
import { HOME_CHAIN } from "@/config/supported-chains";
import { ApiError, useApi } from "@/lib/client/api";
import { useNativeBalance, useTokenBalance, useWallet } from "@/lib/client/wallet-context";
import { DEPOSIT_NETWORKS, depositSource, depositSymbols, type DepositSymbol } from "@/lib/deposits/networks";
import { formatToken, formatUsd, shortAddress } from "@/lib/format";
import { useToast } from "./toast";

type Phase = "idle" | "quoting" | "review" | "confirm" | "pending" | "bridging" | "done";
type Call = { to: `0x${string}`; value: string; data: `0x${string}` };
type Quote = {
  chainId: number; symbol: DepositSymbol; tool: string; calls: Call[]; fromAmountRaw: string; toAmountRaw: string; toAmountMinRaw: string;
  decimals: number; expiresAt: string; networkFeeUsd: number | null; providerFeeUsd: number | null;
};
type SupportedChainId = (typeof DEPOSIT_NETWORKS)[number]["chainId"];

const POLL_MS = 10_000;

function amountText(raw: bigint | string, decimals: number) {
  return formatToken(Number(formatUnits(BigInt(raw), decimals)));
}

function quoteExpired(quote: Quote) {
  return Date.parse(quote.expiresAt) <= Date.now();
}

function usdText(value: number | null) {
  return value === null ? "unavailable" : formatUsd(value);
}

/**
 * Add money from a wallet the customer connected, such as MetaMask. From
 * Base it is a plain transfer. From another network the same asset is
 * bridged to Base through LI.FI, with bridge fees taken from the amount that
 * arrives. The connected wallet signs and pays the network fee either way;
 * Aura reads the result from the chain.
 */
export function AddFromWallet({ account }: { account: `0x${string}` }) {
  const api = useApi();
  const { connectWallet, wallets, chain } = useWallet();
  const source = wallets.find((wallet) => !wallet.walletClientType.startsWith("privy"));
  const sourceAddress = source?.address as `0x${string}` | undefined;
  const [chainId, setChainId] = useState<SupportedChainId>(HOME_CHAIN.id);
  const [symbol, setSymbol] = useState<DepositSymbol>("USDC");
  const asset = depositSource(chainId, symbol) ?? depositSource(chainId, depositSymbols(chainId)[0])!;
  const home = chainId === HOME_CHAIN.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const nativeBalance = useNativeBalance(sourceAddress, chainId, asset.address === null);
  const tokenBalance = useTokenBalance(asset.address ?? undefined, sourceAddress, chainId, asset.address !== null);
  const available = asset.address === null ? nativeBalance.data : tokenBalance.data;
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [bridge, setBridge] = useState<{ hash: `0x${string}`; chainId: number; tool: string } | null>(null);

  // Follow a bridged deposit until it arrives on Base, or fails and is refunded.
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { status } = await api<{ status: string }>(`/api/deposits/status?chainId=${bridge.chainId}&hash=${bridge.hash}&tool=${bridge.tool}`);
        if (cancelled) return;
        if (status === "DONE" || status === "PARTIAL") {
          setPhase("done"); setBridge(null);
          toast.success("Added", "It reached your Aura account.");
          await queryClient.invalidateQueries(); return;
        }
        if (status === "REFUNDED" || status === "FAILED") {
          setPhase("idle"); setBridge(null);
          toast.error("Deposit didn't complete", status === "REFUNDED" ? "The bridge sent the funds back to your wallet." : "Check your wallet's activity.");
          return;
        }
      } catch { /* A failed status read is retried. */ }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bridge, api, queryClient, toast]);

  if (!source || !sourceAddress) {
    return <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => connectWallet()}><Wallet aria-hidden="true" /> Connect a wallet</button>;
  }

  const busy = phase === "quoting" || phase === "confirm" || phase === "pending" || phase === "bridging";
  const networkName = DEPOSIT_NETWORKS.find((network) => network.chainId === chainId)!.name;

  function reset() {
    setPhase("idle"); setQuote(null); setError(null);
  }

  function readAmount(): bigint | null {
    let raw: bigint;
    try { raw = parseUnits(amount, asset.decimals); } catch { setError("Enter an amount like 25 or 0.05."); return null; }
    if (raw <= 0n) { setError("Enter an amount greater than zero."); return null; }
    if (available !== undefined && raw > available) { setError(`That's more ${asset.symbol} on ${networkName} than this wallet holds.`); return null; }
    return raw;
  }

  /** Send each call from the connected wallet on the source network, waiting for each to land. */
  async function sendFromWallet(calls: Call[]): Promise<`0x${string}`> {
    if (!source || !sourceAddress || !chain) throw new Error("wallet_unavailable");
    await source.switchChain(chainId);
    const provider = await source.getEthereumProvider();
    let last: `0x${string}` | null = null;
    for (const call of calls) {
      setPhase("confirm");
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: sourceAddress, to: call.to, data: call.data,
        value: `0x${BigInt(call.value).toString(16)}` }] }) as `0x${string}`;
      setPhase("pending");
      const receipt = await chain.waitForReceipt({ chainId, hash, timeout: 300_000 });
      if (receipt.status !== "success") throw new Error("reverted");
      last = hash;
    }
    return last!;
  }

  function walletError(reason: unknown) {
    setPhase("idle");
    const rejected = reason instanceof Error && /reject|denied|cancel/i.test(reason.message);
    if (rejected) toast.show({ tone: "info", title: "Cancelled", detail: "Nothing was sent." });
    else toast.error("Deposit didn't go through", "Check your wallet's activity before you try again.");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (phase === "review" && quote) return confirmBridge(quote);
    const raw = readAmount();
    if (raw === null) return;
    if (home) {
      try {
        await sendFromWallet([asset.address === null
          ? { to: account, value: raw.toString(), data: "0x" }
          : { to: asset.address, value: "0", data: erc20TransferData(account, raw) }]);
        setPhase("done"); setAmount("");
        toast.success("Added", "Your balance updates in a moment.");
        await queryClient.invalidateQueries();
      } catch (reason) { walletError(reason); }
      return;
    }
    setPhase("quoting");
    try {
      const { quote: next } = await api<{ quote: Quote }>("/api/deposits/quote", { method: "POST", json: { chainId, symbol: asset.symbol, amount, from: sourceAddress } });
      setQuote(next); setPhase("review");
    } catch (reason) {
      setPhase("idle");
      const unavailable = reason instanceof ApiError && ["provider_unavailable", "feature_unavailable"].includes(reason.code);
      toast.error(unavailable ? "Not available right now" : "Can't move this amount", reason instanceof ApiError ? reason.message : "We couldn't find a route right now. Try again.");
    }
  }

  async function confirmBridge(current: Quote) {
    if (quoteExpired(current)) { reset(); return setError("That price expired. Review it again."); }
    try {
      const hash = await sendFromWallet(current.calls);
      setPhase("bridging"); setAmount("");
      toast.show({ tone: "info", title: "Sent", detail: "It usually arrives in a few minutes. You can leave this screen." });
      setBridge({ hash, chainId: current.chainId, tool: current.tool });
    } catch (reason) { walletError(reason); }
  }

  const buttonText = phase === "quoting" ? "Getting a price" : phase === "confirm" ? "Confirm in your wallet" : phase === "pending" ? "Sending"
    : phase === "bridging" ? "On its way" : phase === "review" ? "Confirm deposit" : home ? "Add from wallet" : "Review";

  return (
    <form className="mxForm" onSubmit={(event) => void submit(event)}>
      <div className="mxFieldRow">
        <label className="mxField">Network
          <select value={chainId} disabled={busy} onChange={(event) => { setChainId(Number(event.target.value) as SupportedChainId); reset(); }}>
            {DEPOSIT_NETWORKS.map((network) => <option key={network.chainId} value={network.chainId}>{network.name}</option>)}
          </select>
        </label>
        <label className="mxField">Asset
          <select value={asset.symbol} disabled={busy} onChange={(event) => { setSymbol(event.target.value as DepositSymbol); reset(); }}>
            {depositSymbols(chainId).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div className="mxFieldGroup">
        <div className="mxAmountWithMax">
          <label className="mxField">Amount in {asset.symbol}
            <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={busy} aria-invalid={error ? true : undefined}
              aria-describedby="wallet-available" onChange={(event) => { setAmount(event.target.value.trim()); reset(); }} />
          </label>
          {/* ETH also pays the network fee, so all of it can't be sent; Max is for tokens. */}
          {asset.address !== null && available !== undefined && available > 0n && <button type="button" className="appButton mxMaxButton" disabled={busy}
            onClick={() => { setAmount(formatUnits(available, asset.decimals)); reset(); }}>Max</button>}
        </div>
        <span className="mxHint" id="wallet-available">
          From {shortAddress(sourceAddress)} on {networkName} · {available === undefined ? "balance unavailable" : `${amountText(available, asset.decimals)} ${asset.symbol} available`}
        </span>
      </div>
      {quote && phase === "review" && <dl className="mxSummary" aria-label="Deposit summary">
        <div><dt>You get about</dt><dd>{amountText(quote.toAmountRaw, quote.decimals)} {quote.symbol}</dd></div>
        <div><dt>At least</dt><dd>{amountText(quote.toAmountMinRaw, quote.decimals)} {quote.symbol}</dd></div>
        <div><dt>Bridge fee</dt><dd>{usdText(quote.providerFeeUsd)}</dd></div>
        <div><dt>Network fee</dt><dd>{usdText(quote.networkFeeUsd)}</dd></div>
      </dl>}
      {error && <p className="mxFieldError" role="alert">{error}</p>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={busy}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowDownToLine aria-hidden="true" />}{buttonText}
      </button>
      <p className="mxHint">
        {home ? "Your wallet pays a small Base network fee in ETH."
          : `It arrives in your Aura account as ${asset.symbol}. The bridge fee comes out of the amount, and your wallet pays the ${networkName} network fee.`}
      </p>
    </form>
  );
}
