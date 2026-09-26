"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, LoaderCircle, Wallet } from "lucide-react";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from "viem";
import { usePublicClient, useReadContract } from "wagmi";
import { BASE_ASSETS, HOME_CHAIN } from "@/config/chains";

type Phase = "idle" | "confirm" | "pending" | "done";

const USDC = BASE_ASSETS.USDC;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Move USDC on Base from a wallet the customer connected, such as MetaMask,
 * into their Aura account. It is a plain transfer the connected wallet signs
 * and pays gas for; Aura only reads the result from the chain.
 */
export function AddFromWallet({ account }: { account: `0x${string}` }) {
  const { connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const source = wallets.find((wallet) => !wallet.walletClientType.startsWith("privy"));
  const sourceAddress = source?.address as `0x${string}` | undefined;
  const publicClient = usePublicClient({ chainId: HOME_CHAIN.id });
  const queryClient = useQueryClient();
  const balance = useReadContract({ address: USDC.address, abi: erc20Abi, functionName: "balanceOf", args: sourceAddress ? [sourceAddress] : undefined,
    chainId: HOME_CHAIN.id, query: { enabled: Boolean(sourceAddress) } });
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!source || !sourceAddress) {
    return <button type="button" className="button primary full" onClick={() => connectWallet()}><Wallet size={16} /> Connect a wallet</button>;
  }

  const available = balance.data;
  const busy = phase === "confirm" || phase === "pending";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let raw: bigint;
    try { raw = parseUnits(amount, USDC.decimals); } catch { return setError("Enter an amount like 25 or 25.50."); }
    if (raw <= 0n) return setError("Enter an amount greater than zero.");
    if (available !== undefined && raw > available) return setError("That's more USDC on Base than this wallet holds.");
    if (!source || !sourceAddress || !publicClient) return;
    try {
      setPhase("confirm");
      await source.switchChain(HOME_CHAIN.id);
      const provider = await source.getEthereumProvider();
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: sourceAddress, to: USDC.address,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, raw] }) }] }) as `0x${string}`;
      setPhase("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error("reverted");
      setPhase("done");
      setAmount("");
      await queryClient.invalidateQueries();
      void balance.refetch();
    } catch (reason) {
      setPhase("idle");
      const rejected = reason instanceof Error && /reject|denied|cancel/i.test(reason.message);
      setError(rejected ? "You cancelled it in your wallet. Nothing moved." : "The transfer didn't go through. Check your wallet's activity before you try again.");
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label className="fieldLabel">Amount in USDC
        <input inputMode="decimal" placeholder="0.00" value={amount} disabled={busy} onChange={(event) => { setAmount(event.target.value.trim()); setPhase("idle"); }} />
      </label>
      <p className="authorityFootnote">
        From {shortAddress(sourceAddress)} on Base · {available === undefined ? "balance unavailable" : `${formatUnits(available, USDC.decimals)} USDC available`}
      </p>
      {error && <p className="formError" role="alert">{error}</p>}
      {phase === "done" && <p role="status">Added. Your balance updates in a moment.</p>}
      <button className="button primary full" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}
        {phase === "confirm" ? "Confirm in your wallet" : phase === "pending" ? "Adding" : "Add from wallet"}
      </button>
      <p className="authorityFootnote">Your wallet pays a small Base network fee in ETH.</p>
    </form>
  );
}
