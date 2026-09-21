"use client";

import { ExternalLink } from "lucide-react";
import { erc20Abi, formatEther, formatUnits } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { BASE_ASSETS, HOME_CHAIN } from "@/config/chains";

function short(address: string) { return `${address.slice(0, 7)}…${address.slice(-5)}`; }

function ExternalWalletRow({ address }: { address: `0x${string}` }) {
  const eth = useBalance({ address, chainId: HOME_CHAIN.id });
  const usdc = useReadContract({ address: BASE_ASSETS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: HOME_CHAIN.id });
  return <div className="externalWalletRow"><span><strong>{short(address)}</strong><small>Connected account · Base</small></span><span><strong>{usdc.data === undefined ? "—" : Number(formatUnits(usdc.data, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><small>USDC</small></span><span><strong>{eth.data === undefined ? "—" : Number(formatEther(eth.data.value)).toLocaleString(undefined, { maximumFractionDigits: 5 })}</strong><small>ETH</small></span><a href={`https://basescan.org/address/${address}`} target="_blank" rel="noreferrer" aria-label={`View ${short(address)} on BaseScan`}><ExternalLink size={14} /></a></div>;
}

export function ExternalWalletBalances({ addresses }: { addresses: `0x${string}`[] }) {
  if (!addresses.length) return null;
  return <section className="panel externalWalletPanel"><div className="panelHeading"><div><p className="eyebrow">CONNECTED ACCOUNTS</p><h2>Other wallets you control</h2><p className="sourceCaption">Read-only Base balances. Connecting a wallet does not give Aurel signing authority.</p></div></div><div className="externalWalletList">{addresses.map((address) => <ExternalWalletRow address={address} key={address} />)}</div></section>;
}
