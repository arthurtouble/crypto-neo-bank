import Link from "next/link";
import { WalletWorkspace } from "./wallet-workspace";

export function Dashboard() {
  return <div className="dashboardPage">
    <section className="pageIntro"><div><h1>Overview</h1><p>Cash, vaults, and portfolio in one place.</p></div>
      <div className="walletActions"><Link className="button secondary" href="/app/deposit">Deposit</Link><Link className="button primary" href="/app/send">Send</Link></div>
    </section>
    <section aria-label="Portfolio"><h2>Portfolio</h2><WalletWorkspace /></section>
    <div className="exampleNext"><Link className="button secondary" href="/app/transactions">View transactions</Link></div>
  </div>;
}
