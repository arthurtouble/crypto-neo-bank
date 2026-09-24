"use client";

import { useConnectWallet, usePrivy } from "@privy-io/react-auth";
import { convertQuoteToRoute, createClient, executeRoute, type LiFiStep, type RouteExtended } from "@lifi/sdk";
import { EthereumProvider } from "@lifi/sdk-provider-ethereum";
import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useConnection } from "wagmi";
import { getConnectorClient, switchChain } from "wagmi/actions";
import { web3Config } from "@/config/chains";
import { CURATED_SWAP_ASSETS, curatedSwapAsset, type CuratedAsset } from "@/lib/swap/curated-assets";

type Quote = LiFiStep & { estimate: LiFiStep["estimate"] & { toAmountMin?: string } };

function AssetPicker({ value, onChange, exclude }: { value: string; onChange(id: string): void; exclude: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = curatedSwapAsset(value);
  const matches = CURATED_SWAP_ASSETS.filter((asset) => asset.id !== exclude && `${asset.symbol} ${asset.name} ${asset.network}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <button className="swapAssetTrigger" type="button" onClick={() => { setSearch(""); setOpen(true); }} aria-label={`Select asset, current ${selected?.symbol} on ${selected?.network}`}>
      <span className="swapAssetMark">{selected?.symbol.slice(0, 1)}</span><span><strong>{selected?.symbol}</strong><small>{selected?.network}</small></span>
    </button>
    {open && <div className="swapModalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="swapAssetModal" role="dialog" aria-modal="true" aria-label="Select asset">
        <div className="swapModalHeader"><h2>Select Asset</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
        <input autoFocus className="swapAssetSearch" placeholder="Search assets or networks" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="swapAssetList">{matches.map((asset) => <button type="button" key={asset.id} onClick={() => { onChange(asset.id); setOpen(false); }}>
          <span className="swapAssetMark">{asset.symbol.slice(0, 1)}</span><span><strong>{asset.symbol}</strong><small>{asset.name} · {asset.network}</small></span>
        </button>)}{matches.length === 0 && <p>No matching assets</p>}</div>
      </section>
    </div>}
  </>;
}

function amountText(raw: string | undefined, asset: CuratedAsset | undefined) {
  if (!raw || !asset) return "—";
  try { return Number(formatUnits(BigInt(raw), asset.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
  catch { return "—"; }
}

function estimatedCosts(quote: Quote | null): string {
  if (!quote) return "—";
  const costs = [...(quote.estimate.gasCosts ?? []), ...(quote.estimate.feeCosts ?? [])];
  const values = costs.map((item) => Number(item.amountUSD));
  if (values.some((value) => !Number.isFinite(value))) return "See Wallet";
  return `$${values.reduce((sum, value) => sum + value, 0).toFixed(2)}`;
}

export function LifiSwapWorkspace() {
  const { getAccessToken } = usePrivy();
  const { connectWallet } = useConnectWallet();
  const connection = useConnection();
  const walletAddress = connection.address;
  const [fromId, setFromId] = useState("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const [toId, setToId] = useState("8453:0x4200000000000000000000000000000000000006");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteTime, setQuoteTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [finishedRoute, setFinishedRoute] = useState<RouteExtended | null>(null);
  const to = curatedSwapAsset(toId);
  useEffect(() => {
    if (!quote) return;
    const timer = window.setTimeout(() => setQuote(null), 45_000);
    return () => window.clearTimeout(timer);
  }, [quote]);
  const client = useMemo(() => createClient({ integrator: "aurel", providers: [EthereumProvider({
    getWalletClient: () => getConnectorClient(web3Config, { assertChainId: false }),
    switchChain: async (chainId) => { const chain = await switchChain(web3Config, { chainId: chainId as 8453 | 1 | 42161 | 10 | 137 }); return getConnectorClient(web3Config, { chainId: chain.id }); }
  })] }), []);

  function invalidate() { setQuote(null); setError(""); setFinishedRoute(null); setProgress(""); }
  async function findRoute() {
    if (!walletAddress) { connectWallet(); return; }
    setBusy(true); setError(""); setProgress("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to continue.");
      const response = await fetch("/api/swap/curated-quote", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fromAssetId: fromId, toAssetId: toId, amount, walletAddress, slippageBps: 50 }) });
      const body = await response.json() as { quote?: Quote; message?: string };
      if (!response.ok || !body.quote) throw new Error(body.message ?? "No route is available right now.");
      setQuote(body.quote); setQuoteTime(Date.now());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No route is available right now."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!quote || !walletAddress || Date.now() - quoteTime > 45_000) { invalidate(); setError("This quote expired. Find a new route."); return; }
    setBusy(true); setError(""); setProgress("Opening your wallet…");
    try {
      const route = convertQuoteToRoute(quote);
      const completed = await executeRoute(client, route, { updateRouteHook: (updated) => {
        const actions = updated.steps.flatMap((step) => step.execution?.actions ?? []);
        const latest = actions[actions.length - 1];
        setProgress(latest?.message ?? "Swap in progress…");
      } });
      setFinishedRoute(completed); setQuote(null); setProgress("Swap complete");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The swap could not be completed."); setProgress(""); }
    finally { setBusy(false); }
  }
  const quoteFresh = Boolean(quote);
  const output = amountText(quote?.estimate.toAmount, to);
  const minimum = amountText(quote?.estimate.toAmountMin, to);
  const transaction = finishedRoute?.steps.flatMap((step) => step.execution?.actions ?? []).find((item) => item.txHash);
  const explorer = transaction?.chainId === 1 ? "etherscan.io" : transaction?.chainId === 42161 ? "arbiscan.io"
    : transaction?.chainId === 10 ? "optimistic.etherscan.io" : transaction?.chainId === 137 ? "polygonscan.com" : "basescan.org";
  return <section className="aurelSwap" aria-label="Swap assets">
    <div className="aurelSwapCard">
      <div className="swapAmountRow"><label htmlFor="swapAmount">You Pay</label><div><input id="swapAmount" inputMode="decimal" placeholder="0" value={amount} onChange={(event) => { setAmount(event.target.value); invalidate(); }} /><AssetPicker value={fromId} exclude={toId} onChange={(id) => { setFromId(id); invalidate(); }} /></div></div>
      <button className="swapReverse" type="button" aria-label="Reverse swap" onClick={() => { setFromId(toId); setToId(fromId); invalidate(); }}>⇅</button>
      <div className="swapAmountRow"><span>You Receive</span><div><output>{quoteFresh ? output : "—"}</output><AssetPicker value={toId} exclude={fromId} onChange={(id) => { setToId(id); invalidate(); }} /></div></div>
      {quoteFresh && <div className="swapQuoteDetails"><div><span>Minimum Received</span><strong>{minimum} {to?.symbol}</strong></div><div><span>Estimated Fees</span><strong>{estimatedCosts(quote)}</strong></div><div><span>Route</span><strong>{quote?.tool}</strong></div><div><span>Slippage</span><strong>0.5%</strong></div></div>}
      {error && <p className="swapError" role="alert">{error}</p>}
      {progress && <p className="swapProgress" role="status">{progress}</p>}
      {transaction?.txHash && <a className="swapTransaction" href={`https://${explorer}/tx/${transaction.txHash}`} target="_blank" rel="noreferrer">View Transaction</a>}
      <button className="button primary full" type="button" disabled={busy || !amount} onClick={quoteFresh ? confirm : findRoute}>{busy ? "Processing…" : !walletAddress ? "Connect Wallet" : quoteFresh ? "Confirm Swap" : "Review Swap"}</button>
    </div>
    <p className="swapFootnote">Assets are held in your wallet. Your wallet will ask you to approve any required token allowance and confirm the swap.</p>
  </section>;
}
