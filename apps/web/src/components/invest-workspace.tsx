import Link from "next/link";

export function InvestWorkspace() {
  return <div className="exampleGrid">
    <article className="panel exampleCard"><span className="exampleLabel">Crypto</span><strong>Explore supported assets</strong><p>Search in Swap and review a current LI.FI route before signing.</p><Link className="button secondary" href="/app/swap">Open Swap</Link></article>
    <article className="panel exampleCard"><span className="exampleLabel">Tokenized stocks</span><strong>Unavailable</strong><p>Orders require an approved issuer, distributor, eligibility check, and venue.</p></article>
    <article className="panel exampleCard"><span className="exampleLabel">Metals</span><strong>Unavailable</strong><p>Availability depends on an issuer, country, and supported order provider.</p></article>
  </div>;
}
