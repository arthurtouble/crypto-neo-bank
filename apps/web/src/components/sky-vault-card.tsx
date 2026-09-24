"use client";

import Link from "next/link";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { usePublicClient } from "wagmi";
import { buildSkyCall, skyConversionLimit, skyVaultAbi, validateSkyCall, SKY_SUSDS, SKY_USDC, SKY_USDC_ACTIONS,
  type SkyAction } from "@/lib/defi/sky-call-policy";
import { useSkyPosition } from "@/lib/defi/use-sky-position";

type Call = ReturnType<typeof buildSkyCall>;
type Prepared = { action: SkyAction; amountRaw: string; conversionLimitRaw: string;
  approvalCall: Call; vaultCall: Call; executionAvailable: true; error?: string };
type Submitted = { action: SkyAction; amount: string; sender: string; hash: string;
  status: "pending" | "confirmed" | "failed" | "inconsistent" | "unavailable" };

export function SkyVaultCard({ walletAddress }: { walletAddress?: string }) {
  const { getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const client = usePublicClient({ chainId: 1 });
  const queryClient = useQueryClient();
  const [action, setAction] = useState<SkyAction>("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const awaitingSettlement = Boolean(submitted && ["pending", "unavailable"].includes(submitted.status));
  const position = useSkyPosition(walletAddress);

  async function prepare(chosen: { action: SkyAction; amount: string; sender: string }, token: string) {
    const response = await fetch("/api/defi/sky/action", { method: "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(chosen) });
    const result = await response.json() as Prepared;
    if (!response.ok) throw new Error(result.error === "insufficient_usdc" ? "You need this USDC on Ethereum first."
      : result.error === "insufficient_susds" ? "Your Sky balance is too low for this withdrawal."
      : result.error === "account_locked" ? "Unlock your account to continue."
      : "Sky is unavailable for this amount right now.");
    const amountRaw = parseUnits(chosen.amount, 6);
    if (result.action !== chosen.action || result.amountRaw !== amountRaw.toString()
      || result.conversionLimitRaw !== skyConversionLimit(chosen.action, amountRaw).toString()
      || !result.executionAvailable)
      throw new Error("Sky action changed. Review it again.");
    const identity = { action: chosen.action, wallet: chosen.sender, amountRaw };
    validateSkyCall({ ...identity, transaction: result.vaultCall });
    // The server's exact approval amount is checked against the public vault preview below.
    return { result, identity };
  }

  async function execute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!walletAddress || !client || busy || awaitingSettlement || !amount.trim()) return;
    const chosen = { action, amount, sender: walletAddress };
    setBusy(true); setError(""); setStatus("Preparing Sky transaction…"); setSubmitted(null);
    let actionWalletOpened = false;
    let actionHashKnown = false;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to use Sky.");
      let { result, identity } = await prepare(chosen, token);
      const owner = walletAddress as `0x${string}`;
      const tokenAddress = action === "deposit" ? SKY_USDC : SKY_SUSDS;
      const expectedApproval = action === "deposit" ? identity.amountRaw
        : await client.readContract({ address: SKY_SUSDS, abi: skyVaultAbi,
          functionName: "previewWithdraw", args: [BigInt(result.conversionLimitRaw)] });
      validateSkyCall({ ...identity, approvalShares: expectedApproval, transaction: result.approvalCall });
      const allowance = await client.readContract({ address: tokenAddress, abi: erc20Abi,
        functionName: "allowance", args: [owner, SKY_USDC_ACTIONS] });
      if (allowance < expectedApproval) {
        setStatus("Approve the exact token amount in your wallet…");
        const approval = await sendTransaction({ to: result.approvalCall.to as `0x${string}`,
          data: result.approvalCall.data, value: 0n, chainId: 1 }, { address: walletAddress,
          uiOptions: { description: `Approve ${action === "deposit" ? "USDC" : "sUSDS"} for Sky.`,
            buttonText: "Approve token", successHeader: "Approval submitted", isCancellable: true } });
        setStatus("Waiting for token approval…");
        const receipt = await client.waitForTransactionReceipt({ hash: approval.hash as `0x${string}`, confirmations: 2 });
        if (receipt.status !== "success") throw new Error("Token approval failed onchain.");
        ({ result, identity } = await prepare(chosen, token));
        validateSkyCall({ ...identity, approvalShares: expectedApproval, transaction: result.approvalCall });
        const currentAllowance = await client.readContract({ address: tokenAddress, abi: erc20Abi,
          functionName: "allowance", args: [owner, SKY_USDC_ACTIONS] });
        if (currentAllowance < expectedApproval) throw new Error("Token approval is not available onchain yet.");
      }
      setStatus(`Confirm Sky ${action} in your wallet…`);
      actionWalletOpened = true;
      const sent = await sendTransaction({ to: result.vaultCall.to as `0x${string}`,
        data: result.vaultCall.data, value: 0n, chainId: 1 }, { address: walletAddress,
        uiOptions: { description: `${action === "deposit" ? "Deposit" : "Withdraw"} ${amount} USDC with Sky on Ethereum.`,
          buttonText: `Confirm ${action}`, successHeader: "Transaction submitted", isCancellable: true } });
      if (!/^0x[a-fA-F0-9]{64}$/.test(sent.hash)) throw new Error("Check wallet activity before retrying.");
      actionHashKnown = true;
      setSubmitted({ ...chosen, hash: sent.hash, status: "pending" });
      setStatus("Waiting for Ethereum settlement…");
    } catch (reason) {
      setStatus("");
      setError(actionWalletOpened && !actionHashKnown ? "The wallet may have sent this transaction. Check wallet activity before retrying."
        : reason instanceof Error ? reason.message : "Sky transaction unavailable.");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!submitted || !["pending", "unavailable"].includes(submitted.status)) return;
    const current = submitted;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Session unavailable.");
        const response = await fetch("/api/defi/sky/receipt", { method: "POST", cache: "no-store",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: current.action, sender: current.sender, amount: current.amount, hash: current.hash }) });
        if (!response.ok && response.status !== 202) throw new Error("Ethereum status unavailable.");
        const evidence = await response.json() as { status: Submitted["status"] };
        if (!["pending", "confirmed", "failed", "inconsistent"].includes(evidence.status))
          throw new Error("Ethereum status was invalid.");
        if (cancelled) return;
        setSubmitted((previous) => previous?.hash === current.hash && previous.status !== evidence.status
          ? { ...previous, status: evidence.status } : previous);
        if (evidence.status === "confirmed") {
          setStatus("Confirmed on Ethereum");
          await queryClient.invalidateQueries({ queryKey: ["sky-vault", current.sender] });
        } else if (evidence.status === "failed") setStatus("Transaction failed on Ethereum");
        else if (evidence.status === "inconsistent") setStatus("Transaction differs from the reviewed Sky action. Check wallet activity.");
        else timer = setTimeout(poll, 8_000);
      } catch {
        if (!cancelled) {
          setSubmitted((previous) => previous?.hash === current.hash && previous.status !== "unavailable"
            ? { ...previous, status: "unavailable" } : previous);
          setStatus("Ethereum status is temporarily unavailable. Checking again…");
          timer = setTimeout(poll, 15_000);
        }
      }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [submitted, getAccessToken, queryClient]);

  return <article className="panel strategyCard">
    <div className="strategyTop"><span className="strategyGlyph">S</span><span className="statusBadge neutral"><i /> Sky on Ethereum</span></div>
    <p className="eyebrow">SKY SAVINGS</p><h2>Save with USDC</h2>
    <p>Deposit Ethereum USDC into Sky sUSDS. Sky converts it in the same transaction. Withdraw back to USDC.</p>
    <div className="strategyMetrics"><div><span>USDC on Ethereum</span><strong>{position.data?.usdc ?? (position.isError ? "Unavailable" : "—")}</strong></div>
      <div><span>Sky position</span><strong>{position.data?.susds ?? (position.isError ? "Unavailable" : "—")} USDS</strong></div></div>
    <form className="aavePreviewForm" onSubmit={(event) => void execute(event)}>
      <div className="aavePreviewFields"><label>Action<select value={action} onChange={(event) => { setAction(event.target.value as SkyAction); setStatus(""); }}>
        <option value="deposit">Deposit</option><option value="withdraw">Withdraw</option></select></label>
        <label>USDC amount<input type="text" inputMode="decimal" value={amount} autoComplete="off" required
          onChange={(event) => { setAmount(event.target.value); setStatus(""); }} placeholder="0 USDC" /></label></div>
      <button className="button primary" type="submit" disabled={busy || awaitingSettlement || !walletAddress || !amount.trim()}>
        {busy ? "Working…" : awaitingSettlement ? "Waiting for settlement" : `Continue ${action} in wallet`}</button>
      {status && <p role="status">{status}</p>}{error && <p className="formError" role="alert">{error}</p>}
      {submitted && <a href={`https://etherscan.io/tx/${submitted.hash}`} target="_blank" rel="noreferrer">View Ethereum transaction</a>}
    </form>
    <p className="authorityFootnote">Ethereum ETH pays network fees. Need USDC there? <Link href="/app/swap?from=8453%3A0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&to=1%3A0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48">Bridge from Base</Link>.</p>
  </article>;
}
