"use client";

import { AlertCircle, Check, CircleDashed, CreditCard, DatabaseZap, KeyRound, Landmark, LoaderCircle, RefreshCw, Send, ShieldCheck, WalletCards } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { ProductCommand, ProviderCommandReceipt } from "@/lib/providers/contracts";
import type { DemoScenarioId } from "@/lib/providers/scenarios";
import type { ProductSession } from "@/lib/providers/session";

type ScenarioSummary = { id: DemoScenarioId; name: string; description: string };
type CommandResponse = { receipt?: ProviderCommandReceipt; message?: string; traceId: string };
const subscribeToBrowser = () => () => undefined;

const commands: Array<{ label: string; detail: string; icon: typeof WalletCards; build: () => ProductCommand }> = [
  { label: "Create wallet", detail: "Privy adapter", icon: WalletCards, build: () => ({ type: "create_wallet", subjectReference: "demo-user-001" }) },
  { label: "Start verification", detail: "Bridge compliance adapter", icon: ShieldCheck, build: () => ({ type: "start_compliance", subjectReference: "demo-user-001", country: "PT" }) },
  { label: "Deposit $5,000", detail: "Bridge rail adapter", icon: Landmark, build: () => ({ type: "deposit", subjectReference: "demo-user-001", amount: "5000.00", asset: "USD", rail: "bank" }) },
  { label: "Allocate $2,500", detail: "Privy signing + Aave adapter", icon: DatabaseZap, build: () => ({ type: "allocate", subjectReference: "demo-user-001", amount: "2500.00", asset: "USDC", strategyReference: "aave-v3-base" }) },
  { label: "Withdraw $1,000", detail: "Policy and signing review", icon: Send, build: () => ({ type: "withdraw", subjectReference: "demo-user-001", amount: "1000.00", asset: "USDC", destinationReference: "saved:operating-wallet" }) },
  { label: "Request card", detail: "Bridge card adapter", icon: CreditCard, build: () => ({ type: "issue_card", subjectReference: "demo-user-001" }) },
  { label: "Enable transfer delay", detail: "Wallet policy adapter", icon: KeyRound, build: () => ({ type: "set_security_policy", subjectReference: "demo-user-001", policy: "transfer_delay", enabled: true }) }
];

export function SandboxLab({ initialSession, initialScenarios }: { initialSession: ProductSession; initialScenarios: ScenarioSummary[] }) {
  const [scenarios] = useState<ScenarioSummary[]>(initialScenarios);
  const [scenarioId, setScenarioId] = useState<DemoScenarioId>("funded");
  const [session, setSession] = useState<ProductSession | null>(initialSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [history, setHistory] = useState<ProviderCommandReceipt[]>([]);
  const interactive = useSyncExternalStore(subscribeToBrowser, () => true, () => false);

  const loadSession = useCallback(async (scenario: DemoScenarioId) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/demo/session?scenario=${scenario}`, { cache: "no-store" });
      if (!response.ok) throw new Error("The demo provider session could not be rebuilt.");
      setSession(await response.json() as ProductSession);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the provider session.");
    } finally {
      setLoading(false);
    }
  }, []);

  function selectScenario(nextScenario: DemoScenarioId) {
    setScenarioId(nextScenario);
    setHistory([]);
    void loadSession(nextScenario);
  }

  async function execute(command: ProductCommand, label: string) {
    setRunning(label);
    setError(null);
    try {
      const response = await fetch("/api/demo/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId, idempotencyKey: crypto.randomUUID(), command }) });
      const result = await response.json() as CommandResponse;
      if (!result.receipt) throw new Error(result.message ?? "The provider rejected the command.");
      setHistory((current) => [result.receipt!, ...current].slice(0, 8));
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Command failed.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="sandboxPage">
      <section className="pageIntro sandboxIntro">
        <div><p className="eyebrow">PARTNER DEMONSTRATION</p><h1>Provider integration lab</h1><p>Exercise every product boundary before live Privy or Bridge credentials exist.</p></div>
        <button className="button secondary" onClick={() => void loadSession(scenarioId)} disabled={loading}><RefreshCw size={15} /> Rebuild projection</button>
      </section>

      <section className="scenarioStrip" aria-label="Demonstration scenario">
        {scenarios.map((scenario) => <button key={scenario.id} className={scenario.id === scenarioId ? "active" : ""} onClick={() => selectScenario(scenario.id)}><strong>{scenario.name}</strong><small>{scenario.description}</small></button>)}
      </section>

      {error && <div className="sandboxAlert error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
      {loading && <div className="sandboxLoading"><LoaderCircle size={20} /><span>Rebuilding from simulated providers and chain observations…</span></div>}

      {!loading && session && <>
        <section className="sandboxSummary panel">
          <div><span>Wallet</span><strong>{session.wallets.length ? "Ready" : "Not created"}</strong><small>{session.wallets[0]?.control ?? "Privy activation required"}</small></div>
          <div><span>Identity</span><strong>{session.compliance.status.replaceAll("_", " ")}</strong><small>{session.compliance.provider}</small></div>
          <div><span>Card</span><strong>{session.card.status.replaceAll("_", " ")}</strong><small>{session.card.lastFour ? `Visa •••• ${session.card.lastFour}` : "No issued card"}</small></div>
          <div><span>Membership</span><strong>{session.membership.tier}</strong><small>{session.membership.score}/100 relationship score</small></div>
        </section>

        <div className="sandboxGrid">
          <section className="panel journeyPanel">
            <div className="panelHeading"><div><p className="eyebrow">VERTICAL SLICE</p><h2>Customer journey</h2></div><span className="statusBadge neutral">{session.scenario.name}</span></div>
            <div className="journeyList">
              {[
                ["Account and passkey", session.auth.assurance === "passkey", "Privy authentication"],
                ["Embedded wallet", session.wallets.length > 0, "Customer-controlled wallet"],
                ["Identity verification", session.compliance.status === "approved", "Bridge-hosted compliance"],
                ["Funded balance", session.positions.some((position) => Number(position.amount) > 0), "Provider and chain observations"],
                ["Card eligibility", session.card.status === "active", "Issuer decision through Bridge"]
              ].map(([label, done, note]) => <div key={String(label)}><span className={done ? "complete" : "pending"}>{done ? <Check size={16} /> : <CircleDashed size={16} />}</span><div><strong>{label}</strong><small>{note}</small></div><b>{done ? "Complete" : "Required"}</b></div>)}
            </div>
            {session.compliance.requiredActions.length > 0 && <div className="requiredActions"><strong>Provider requires</strong>{session.compliance.requiredActions.map((action) => <span key={action}>{action}</span>)}</div>}
          </section>

          <section className="panel commandPanel">
            <div className="panelHeading"><div><p className="eyebrow">PROVIDER COMMANDS</p><h2>Exercise a workflow</h2></div></div>
            <p>Commands return provider receipts. This demo never changes an authoritative balance.</p>
            <div className="commandGrid">
              {commands.map(({ label, detail, icon: Icon, build }) => <button key={label} disabled={!interactive || Boolean(running)} onClick={() => void execute(build(), label)}><Icon size={17} /><span><strong>{label}</strong><small>{detail}</small></span>{running === label ? <LoaderCircle className="spin" size={15} /> : null}</button>)}
            </div>
          </section>
        </div>

        <section className="panel receiptPanel">
          <div className="panelHeading"><div><p className="eyebrow">COMMAND RECEIPTS</p><h2>Auditable workflow state</h2></div><span>{history.length} this session</span></div>
          {!history.length ? <div className="emptyState"><CircleDashed size={22} /><strong>No commands yet</strong><span>Run a workflow above to inspect its provider receipt and next action.</span></div> : <div className="receiptList">{history.map((item) => <div key={item.commandId}><span className={item.status === "failed" ? "receiptState failed" : "receiptState"}>{item.status}</span><div><strong>{item.type.replaceAll("_", " ")}</strong><small>{item.provider} · {item.providerObjectId}</small></div><div><strong>{item.failure?.message ?? item.nextAction?.label ?? "Accepted by simulator"}</strong><small>{new Date(item.createdAt).toLocaleTimeString()}</small></div></div>)}</div>}
        </section>
      </>}
    </div>
  );
}
