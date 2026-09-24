"use client";

import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { usePublicClient } from "wagmi";
import { AAVE_BASE_ASSETS, AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { validateAaveCall } from "@/lib/defi/aave-call-policy";

type Action = "supply" | "withdraw" | "borrow" | "repay";
type Symbol = "USDC" | "WETH";
type Call = { chainId: 8453; from: string; to: string; value: "0"; data: `0x${string}` };
type Prepared = { action: Action; symbol: Symbol; amount: string; amountRaw: string; assetAddress: string;
  approvalCall: Call | null; poolCall: Call; executionAvailable: true };
type Preview = { action: Action; symbol: Symbol; amount: string; observedAt: string;
  postHealthFactor: number | null; debtStatus: "none" | "positive" | "unresolved";
  approvalRequired: boolean; simulation: "passed" | "after_approval"; executionAvailable: false };
type Submitted = { action: Action; symbol: Symbol; amount: string; sender: string; hash: string;
  status: "submitted" | "pending" | "confirmed" | "failed" | "inconsistent" | "unavailable" };

const labels: Record<Action, string> = { supply: "Supply", withdraw: "Withdraw", borrow: "Borrow", repay: "Repay" };

export function AaveActionPreview({ walletAddress, actions, symbols }: {
  walletAddress?: string; actions: readonly Action[]; symbols: readonly Symbol[];
}) {
  const { getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: 8453 });
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action>(actions[0]);
  const [symbol, setSymbol] = useState<Symbol>(symbols[0]);
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [approvalHash, setApprovalHash] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const awaitingReceipt = Boolean(submitted && !["confirmed", "failed", "inconsistent"].includes(submitted.status));
  const selection = JSON.stringify([walletAddress, action, symbol, amount]);
  const liveSelection = useRef(selection);
  useEffect(() => { liveSelection.current = selection; }, [selection]);

  async function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreview(null); setError(""); setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token || !walletAddress) throw new Error("Sign in to check your position.");
      const response = await fetch("/api/defi/aave/preview", { method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, sender: walletAddress, symbol, amount }) });
      if (!response.ok) throw new Error("Current Aave risk could not be confirmed. Check your amount or try again later.");
      setPreview(await response.json() as Preview);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Preview unavailable."); }
    finally { setBusy(false); }
  }

  async function prepare(token: string, chosen: { action: Action; symbol: Symbol; amount: string; sender: string }) {
    const response = await fetch("/api/defi/aave/action", { method: "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(chosen) });
    const result = await response.json() as Prepared & { error?: string };
    if (!response.ok) throw new Error(result.error === "access_unavailable" || result.error === "invite_required"
      ? "An active Aura invitation is needed before using Aave."
      : result.error === "account_locked" ? "Your account is locked. Unlock it before using Aave."
        : response.status === 503 ? "Aave actions are unavailable right now." : "This Aave action could not be prepared.");
    const raw = parseUnits(chosen.amount, chosen.symbol === "USDC" ? 6 : 18);
    const asset = AAVE_BASE_ASSETS[chosen.symbol];
    if (result.action !== chosen.action || result.symbol !== chosen.symbol || result.amountRaw !== raw.toString()
      || result.assetAddress.toLowerCase() !== asset.toLowerCase() || !result.executionAvailable)
      throw new Error("Aave action changed. Review it again.");
    validateAaveCall({ action: chosen.action, wallet: chosen.sender, asset, amountRaw: raw,
      transaction: result.poolCall });
    if (chosen.action === "supply" || chosen.action === "repay") validateAaveCall({
      action: "approve", wallet: chosen.sender, asset, amountRaw: raw, transaction: result.approvalCall
    });
    else if (result.approvalCall !== null) throw new Error("Unexpected Aave approval step.");
    return { result, raw };
  }

  async function execute() {
    if (!walletAddress || !publicClient || busy || awaitingReceipt || outcomeUnknown || !amount.trim()) return;
    const chosen = { action, symbol, amount, sender: walletAddress };
    const selected = selection;
    setBusy(true); setError(""); setApprovalHash(null); setSubmitted(null); setPhase("Preparing wallet call…");
    let poolWalletOpened = false;
    let poolHashKnown = false;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      let { result, raw } = await prepare(token, chosen);
      if (liveSelection.current !== selected) throw new Error("Aave action changed. Review it again.");
      if (result.approvalCall) {
        const allowance = await publicClient.readContract({ address: result.assetAddress as `0x${string}`,
          abi: erc20Abi, functionName: "allowance", args: [walletAddress as `0x${string}`, AAVE_BASE_V3_MARKET] });
        if (allowance < raw) {
          setPhase("Confirm exact token approval in Privy…");
          const approval = await sendTransaction({ to: result.approvalCall.to as `0x${string}`,
            data: result.approvalCall.data, value: 0n, chainId: 8453 }, { address: walletAddress,
            uiOptions: { description: `Allow Aave to use ${chosen.amount} ${chosen.symbol}.`,
              buttonText: "Approve token", successHeader: "Approval submitted", isCancellable: true } });
          setApprovalHash(approval.hash);
          setPhase("Waiting for token approval…");
          const receipt = await publicClient.waitForTransactionReceipt({ hash: approval.hash as `0x${string}`,
            confirmations: 3, timeout: 180_000 });
          if (receipt.status !== "success") throw new Error("Token approval failed onchain.");
          const observed = await publicClient.getTransaction({ hash: approval.hash as `0x${string}` });
          validateAaveCall({ action: "approve", wallet: chosen.sender,
            asset: result.assetAddress, amountRaw: raw,
            transaction: { chainId: 8453, from: observed.from, to: observed.to,
              data: observed.input, value: observed.value.toString() } });
          const currentAllowance = await publicClient.readContract({ address: result.assetAddress as `0x${string}`,
            abi: erc20Abi, functionName: "allowance", args: [walletAddress as `0x${string}`, AAVE_BASE_V3_MARKET] });
          if (currentAllowance < raw) throw new Error("Token approval is not available onchain yet.");
          if (liveSelection.current !== selected) throw new Error("Aave action changed after approval. Review it again.");
          ({ result, raw } = await prepare(token, chosen));
        }
      }
      if (liveSelection.current !== selected) throw new Error("Aave action changed. Review it again.");
      setPhase("Confirm Aave action in Privy…");
      poolWalletOpened = true;
      const sent = await sendTransaction({ to: result.poolCall.to as `0x${string}`,
        data: result.poolCall.data, value: 0n, chainId: 8453 }, { address: walletAddress,
        uiOptions: { description: `${labels[chosen.action]} ${chosen.amount} ${chosen.symbol} with Aave on Base.`,
          buttonText: `Confirm ${labels[chosen.action].toLowerCase()}`, successHeader: "Transaction submitted", isCancellable: true } });
      if (!/^0x[a-fA-F0-9]{64}$/.test(sent.hash)) throw new Error("Wallet returned no usable transaction hash. Check wallet activity before retrying.");
      poolHashKnown = true;
      setSubmitted({ ...chosen, hash: sent.hash, status: "submitted" });
      setPhase("");
    } catch (reason) {
      if (poolWalletOpened && !poolHashKnown) {
        setOutcomeUnknown(true);
        setError("The wallet may have sent this Aave transaction. Check wallet activity before trying again.");
      } else setError(reason instanceof Error ? reason.message : "Aave action unavailable. Check your wallet before retrying.");
      setPhase("");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!submitted || ["confirmed", "failed", "inconsistent"].includes(submitted.status)) return;
    const currentSubmission = submitted;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Session unavailable.");
        const response = await fetch("/api/defi/aave/receipt", { method: "POST", cache: "no-store",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: currentSubmission.action, sender: currentSubmission.sender,
            symbol: currentSubmission.symbol, amount: currentSubmission.amount, hash: currentSubmission.hash }) });
        if (!response.ok) throw new Error("Chain status unavailable.");
        const evidence = await response.json() as { status: Submitted["status"] };
        if (cancelled) return;
        setSubmitted((current) => current?.hash === currentSubmission.hash && current.status !== evidence.status
          ? { ...current, status: evidence.status } : current);
        if (evidence.status === "confirmed") {
          await queryClient.invalidateQueries({ queryKey: ["aave-position"] });
          await queryClient.invalidateQueries({ queryKey: ["aave-base-market"] });
          await queryClient.invalidateQueries({ queryKey: ["aave-borrow-market"] });
          await queryClient.invalidateQueries({ queryKey: ["defi-positions"] });
        }
        if (!["confirmed", "failed", "inconsistent"].includes(evidence.status)) timer = setTimeout(poll, 8_000);
      } catch {
        if (!cancelled) { setSubmitted((current) => current?.hash === currentSubmission.hash && current.status !== "unavailable"
          ? { ...current, status: "unavailable" } : current); timer = setTimeout(poll, 15_000); }
      }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [submitted, getAccessToken, queryClient]);

  return <form className="aavePreviewForm" onSubmit={(event) => void check(event)}>
    <div className="aavePreviewFields">
      <label>Action<select value={action} onChange={(event) => { setAction(event.target.value as Action); setPreview(null); }}>
        {actions.map((item) => <option key={item} value={item}>{labels[item]}</option>)}
      </select></label>
      {symbols.length > 1 && <label>Asset<select value={symbol} onChange={(event) => { setSymbol(event.target.value as Symbol); setPreview(null); }}>
        {symbols.map((item) => <option key={item} value={item}>{item}</option>)}
      </select></label>}
      <label>Amount<input type="text" inputMode="decimal" autoComplete="off" value={amount}
        onChange={(event) => { setAmount(event.target.value); setPreview(null); }} placeholder={`0 ${symbol}`} required /></label>
    </div>
    <div className="aavePreviewButtons">
      <button className="button secondary" type="submit" disabled={busy || !walletAddress || !amount.trim()}>{busy && !phase ? "Checking…" : "Preview risk"}</button>
      <button className="button primary" type="button" disabled={busy || awaitingReceipt || outcomeUnknown || !walletAddress || !amount.trim()}
        onClick={() => void execute()}>{busy ? "Working…" : outcomeUnknown ? "Check wallet activity" : awaitingReceipt ? "Waiting for transaction" : `Continue ${labels[action].toLowerCase()} in wallet`}</button>
    </div>
    {phase && <p role="status">{phase}</p>}
    {error && <p className="formError" role="alert">{error}</p>}
    {preview && <div className="aavePreviewResult" role="status">
      <strong>{labels[preview.action]} {preview.amount} {preview.symbol}</strong>
      <span>{preview.debtStatus === "none" ? "No debt after this action" : preview.postHealthFactor === null ? "Final debt requires settlement" : `Estimated health factor ${preview.postHealthFactor.toFixed(2)}`}</span>
      {preview.approvalRequired && <span>An exact token approval would be needed first.</span>}
      {preview.simulation === "passed" && <span>The exact call passed a same-block revert check.</span>}
      <small>Observed {new Date(preview.observedAt).toLocaleTimeString()} · Preview only; Aave state can change before signing.</small>
    </div>}
    {approvalHash && <p role="status">Token approval: <a href={`https://basescan.org/tx/${approvalHash}`} target="_blank" rel="noreferrer">View on Base</a></p>}
    {submitted && <div className="aavePreviewResult" role="status"><strong>Aave transaction {submitted.status}</strong>
      <span>Completion is based on the Base receipt and Aave Pool event.</span>
      <a href={`https://basescan.org/tx/${submitted.hash}`} target="_blank" rel="noreferrer">View transaction on Base</a>
    </div>}
  </form>;
}
