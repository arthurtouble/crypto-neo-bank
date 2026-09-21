import Link from "next/link";
import { ArrowRight, ChevronRight, Eye, MoreHorizontal } from "lucide-react";
import { activity, dashboard, riskItems } from "@/data/demo";
import { icons } from "./icons";
import { DashboardActions } from "./dashboard-actions";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function AllocationRing() {
  return (
    <div className="allocationRing" role="img" aria-label="Portfolio allocation: 61.2% productive stablecoins, 23.4% connected assets, 15.4% liquid reserve">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="48" pathLength="100" className="ringBase" />
        <circle cx="60" cy="60" r="48" pathLength="100" className="ringPart green" strokeDasharray="61.2 38.8" strokeDashoffset="0" />
        <circle cx="60" cy="60" r="48" pathLength="100" className="ringPart brass" strokeDasharray="23.4 76.6" strokeDashoffset="-62.7" />
        <circle cx="60" cy="60" r="48" pathLength="100" className="ringPart blue" strokeDasharray="15.4 84.6" strokeDashoffset="-87.6" />
      </svg>
      <div><span>Net yield</span><strong>{dashboard.netYield}%</strong></div>
    </div>
  );
}

export function Dashboard() {
  return (
    <div className="dashboardPage">
      <section className="pageIntro">
        <div><p className="eyebrow">PRIVATE RELATIONSHIP · 00184</p><h1>Good morning, Alex.</h1><p>Your liquidity is healthy. One concentration deserves attention.</p></div>
        <DashboardActions />
      </section>

      <section className="balanceHero panel">
        <div className="balanceLead">
          <div className="balanceLabel"><span>Total relationship value</span><button aria-label="Hide balances"><Eye size={16} /></button></div>
          <div className="heroAmount">{money.format(dashboard.relationshipValue)} <small>USD</small></div>
          <div className="heroDelta"><span>+$2,184.60</span> this month · including deposits</div>
        </div>
        <div className="metricsGrid">
          <Metric label="Spendable now" value={money.format(dashboard.spendable)} note="Immediately available" />
          <Metric label="Productive" value={money.format(dashboard.productive)} note={`${dashboard.netYield}% weighted net APY`} />
          <Metric label="Connected assets" value={money.format(dashboard.external)} note="Read-only, externally held" />
        </div>
      </section>

      <section className="dashboardGrid">
        <article className="panel allocationPanel">
          <div className="panelHeading"><div><p className="eyebrow">ALLOCATION</p><h2>Where your money is</h2></div><button className="iconButton" aria-label="Portfolio allocation options"><MoreHorizontal size={18} /></button></div>
          <div className="allocationBody">
            <AllocationRing />
            <div className="allocationList">
              {dashboard.allocation.map((item) => <div key={item.label}><i style={{ backgroundColor: item.color }} /><span>{item.label}<small>{money.format(item.value)}</small></span><strong>{item.pct}%</strong></div>)}
            </div>
          </div>
          <div className="incomeStrip"><span><icons.money size={17} /> Estimated monthly income</span><strong>{money.format(dashboard.monthlyIncome)}</strong></div>
        </article>

        <article className="panel riskPanel">
          <div className="panelHeading"><div><p className="eyebrow">SAFETY</p><h2>Risk posture</h2></div><span className="statusBadge good"><i /> Balanced</span></div>
          <div className="riskList">
            {riskItems.map((item) => <div key={item.title} className={`riskItem ${item.state}`}><span className="riskIcon">{item.state === "good" ? <icons.verified size={18} /> : <span>!</span>}</span><div><span>{item.title}</span><small>{item.note}</small></div><strong>{item.value}</strong></div>)}
          </div>
          <Link className="textLink" href="/app/security">Review your safety profile <ArrowRight size={15} /></Link>
        </article>

        <article className="panel activityPanel">
          <div className="panelHeading"><div><p className="eyebrow">ACTIVITY</p><h2>Recent movements</h2></div><Link href="/app/activity">View all</Link></div>
          <div className="activityList">
            {activity.map((item) => <div className="activityRow" key={`${item.title}-${item.date}`}><span className={`activityIcon ${item.tone}`}>{item.amount.startsWith("+") ? <icons.received size={17} /> : <icons.sent size={17} />}</span><div><strong>{item.title}</strong><small>{item.detail} · {item.date}</small></div><div className="activityAmount"><strong>{item.amount}</strong><small>{item.status}</small></div></div>)}
          </div>
        </article>

        <aside className="rightRail">
          <article className="membershipCard">
            <div className="membershipTop"><span>AUREL</span><span>BLACK</span></div>
            <div><small>MEMBER SINCE 2026</small><strong>ALEX MORGAN</strong></div>
            <div className="membershipBottom"><span>•••• 1842</span><span>VISA</span></div>
          </article>
          <article className="panel progressPanel">
            <div className="panelHeading"><div><p className="eyebrow">MEMBERSHIP</p><h3>Black status</h3></div><span>{dashboard.relationshipScore}/100</span></div>
            <div className="progressTrack"><i style={{ width: `${dashboard.relationshipScore}%` }} /></div>
            <p>Your relationship qualifies through a 30-day productive balance. Maintain $50,000 to renew next month.</p>
            <Link href="/app/benefits">Explore benefits <ChevronRight size={15} /></Link>
          </article>
          <article className="conciergeCard">
            <span><icons.concierge size={17} /> PRIVATE CONCIERGE</span>
            <h3>What would you like to arrange?</h3>
            <p>Ask about your portfolio, a transfer, or an upcoming trip.</p>
            <button>Start a conversation <ArrowRight size={15} /></button>
          </article>
        </aside>
      </section>
    </div>
  );
}
