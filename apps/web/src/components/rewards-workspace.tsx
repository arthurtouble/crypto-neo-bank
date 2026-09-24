import Link from "next/link";

export function RewardsWorkspace() {
  return <div className="exampleGrid">
    <section className="panel exampleCard"><span className="exampleLabel">Cashback</span><strong>Unavailable</strong><p>Cashback appears only after a funded provider program and eligible card spending are connected.</p></section>
    <section className="panel exampleCard"><span className="exampleLabel">Benefits</span><strong>Unavailable</strong><p>Benefits need provider terms and an entitlement record before activation.</p></section>
    <section className="panel exampleCard"><span className="exampleLabel">Help</span><strong>Questions?</strong><p>See current product availability and partner responsibilities.</p><Link className="textLink" href="/app/support">Visit support</Link></section>
  </div>;
}
