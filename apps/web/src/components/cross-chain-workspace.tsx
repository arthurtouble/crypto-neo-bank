"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { LoaderCircle, Route, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { createPublicClient, erc20Abi, formatUnits, http, isAddress, parseUnits } from "viem";
import { HOME_CHAIN, USDC_BY_CHAIN } from "@/config/chains";
import { selectAutomaticSource } from "@/lib/routing/source-selection";

type Quote = { quote: { id: string; tool: string; action: { fromChainId: number; toChainId: number; fromToken: { address: string; symbol: string; decimals: number }; toToken: { address: string; symbol: string; decimals: number } }; estimate: { fromAmount: string; toAmount: string; toAmountMin: string; executionDuration?: number; approvalAddress?: string } }; observedAt: string; expiresAt: string };
type Direction = "add" | "withdraw";
type Props = { initialDirection?: Direction };

const chainOptions = Object.entries(USDC_BY_CHAIN).map(([id, item]) => ({ id: Number(id), name: item.chain.name, chain: item.chain, address: item.address }));
function networkName(id: number) { return chainOptions.find((item) => item.id === id)?.name ?? `Network ${id}`; }

export function CrossChainWorkspace({ initialDirection = "add" }: Props) {
  const { wallets } = useWallets();
  const { getAccessToken } = usePrivy();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [fromChainId, setFromChainId] = useState<number | null>(null);
  const [toChainId, setToChainId] = useState(1);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetReview() {
    setQuote(null); setError(null); setFromChainId(null); setStage(null);
  }

  async function findSource(requiredAmount: bigint) {
    if (!wallets.length) return null;
    const balances = await Promise.all(wallets.flatMap((connectedWallet) => chainOptions.filter((item) => item.id !== HOME_CHAIN.id).map(async (item) => {
      try {
        const client = createPublicClient({ chain: item.chain, transport: http() });
        const balance = await client.readContract({ address: item.address, abi: erc20Abi, functionName: "balanceOf", args: [connectedWallet.address as `0x${string}`] });
        return { chainId: item.id, walletAddress: connectedWallet.address, balance };
      } catch { return { chainId: item.id, walletAddress: connectedWallet.address, balance: 0n }; }
    })));
    return selectAutomaticSource(balances, requiredAmount, HOME_CHAIN.id);
  }

  async function requestQuote(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setError(null); setQuote(null); setFromChainId(null); setStage("Checking your accounts");
    try {
      const token = await getAccessToken();
      if (!token || !wallet) throw new Error("Your secure session expired.");
      const rawAmount = parseUnits(amount, 6);
      if (rawAmount <= 0n) throw new Error("Enter an amount greater than zero.");
      let sourceChainId: number;
      let sourceAddress: string;
      let destinationChainId: number;
      let destinationAddress: string;
      if (direction === "add") {
        const source = await findSource(rawAmount);
        if (!source) throw new Error("No connected account has enough USD Coin on a supported network.");
        sourceChainId = source.chainId;
        sourceAddress = source.walletAddress;
        destinationChainId = HOME_CHAIN.id;
        destinationAddress = wallet.address;
      } else {
        destinationAddress = recipient.trim() || wallet.address;
        if (!isAddress(destinationAddress)) throw new Error("Enter a valid destination address.");
        if (toChainId === HOME_CHAIN.id) throw new Error("Choose another destination network, or use Send for a direct transfer.");
        const base = chainOptions.find((item) => item.id === HOME_CHAIN.id)!;
        const client = createPublicClient({ chain: base.chain, transport: http() });
        const balance = await client.readContract({ address: base.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address as `0x${string}`] });
        if (balance < rawAmount) throw new Error("Your Aura account does not have enough USD Coin.");
        sourceChainId = HOME_CHAIN.id;
        sourceAddress = wallet.address;
        destinationChainId = toChainId;
      }
      setFromChainId(sourceChainId); setStage("Finding the best route");
      const response = await fetch("/api/routing/quote", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fromChainId: sourceChainId, toChainId: destinationChainId, amount, fromAddress: sourceAddress, toAddress: destinationAddress }) });
      const body = await response.json() as Quote & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "No route is currently available.");
      setQuote(body); setStage(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No route is currently available."); setStage(null); }
    finally { setWorking(false); }
  }

  const received = quote ? formatUnits(BigInt(quote.quote.estimate.toAmountMin), quote.quote.action.toToken.decimals) : null;
  return <section className="panel routePanel exchangePanel" id="digital-money">
    <div className="panelHeading"><div><h2>Move USD Coin</h2><p>Preview a route between your accounts.</p></div><Route size={20} /></div>
    <div className="segmentedControl routeDirection"><button type="button" className={direction === "add" ? "active" : ""} onClick={() => { setDirection("add"); resetReview(); }}>Add Money</button><button type="button" className={direction === "withdraw" ? "active" : ""} onClick={() => { setDirection("withdraw"); resetReview(); }}>Withdraw</button></div>
    <form className="exchangeForm" onSubmit={(event) => void requestQuote(event)}>
      <div className="exchangeAsset"><span>{direction === "add" ? "From" : "You Send"}</span><strong>{direction === "add" ? "Connected Account" : "Aura account"}</strong><small>USD Coin</small></div>
      <label className="fieldLabel exchangeAmount">Amount<input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); }} placeholder="0.00" /></label>
      {direction === "add" ? <div className="exchangeAsset destination"><span>To</span><strong>Aura account</strong><small>USD Coin</small></div> : <><label className="fieldLabel routeDestination">Destination Network<select value={toChainId} onChange={(event) => { setToChainId(Number(event.target.value)); setQuote(null); }}>{chainOptions.filter((item) => item.id !== HOME_CHAIN.id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="fieldLabel routeRecipient">Destination Address<input autoComplete="off" spellCheck={false} value={recipient} onChange={(event) => { setRecipient(event.target.value.trim()); setQuote(null); }} placeholder={wallet?.address ?? "0x…"} /></label></>}
      <button className="button secondary" disabled={working || !amount}>{working && !quote ? <LoaderCircle className="spin" size={15} /> : null}{working && !quote ? stage : "Review Quote"}</button>
    </form>
    {quote && <div className="routeQuote"><div><span>You Send</span><strong>{amount} USDC</strong><small>Source selected automatically</small></div><div><span>You Receive At Least</span><strong>{received} USDC</strong><small>{quote.quote.estimate.executionDuration ? `About ${Math.max(1, Math.ceil(quote.quote.estimate.executionDuration / 60))} min` : "Arrival time varies"}</small></div><div><span>Routing</span><strong>Automatic</strong><small>Execution paused pending verified call plans</small></div><button className="button primary" type="button" disabled>Transfer unavailable</button><p className="formWarning">Cross-network execution is paused until every route call can be verified before signing.</p></div>}
    {error && <div className="formError" role="alert"><ShieldAlert size={15} /> {error}</div>}
    {quote && fromChainId && <details className="technicalDetails"><summary>Technical Details</summary><span>From {networkName(fromChainId)} to {networkName(quote.quote.action.toChainId)} · Route provider: {quote.quote.tool}</span></details>}
    <p className="authorityFootnote">Rates, fees, and arrival times can change before confirmation. Cross-network transfers are never automatic.</p>
  </section>;
}
