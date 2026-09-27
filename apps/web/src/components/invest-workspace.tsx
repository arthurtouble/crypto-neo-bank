import Link from "next/link";

/** Until the Invest feature pass, each category points to Swap, which buys every registered asset. */
export function InvestWorkspace() {
  return <div className="exampleGrid">
    <article className="panel exampleCard"><span className="exampleLabel">Crypto</span><strong>ETH and bitcoin</strong><p>Buy in Swap. You review a current LI.FI route before you confirm.</p><Link className="button secondary" href="/app/swap">Open Swap</Link></article>
    <article className="panel exampleCard"><span className="exampleLabel">Tokenized stocks</span><strong>Ten US stocks, tokenized by Coinbase</strong><p>Apple, Amazon, Alphabet, Meta, Microsoft, Strategy, NVIDIA, Sandisk, SpaceX, and Tesla, on Base. Coinbase says they&apos;re only for eligible people outside the US.</p><Link className="button secondary" href="/app/swap">Open Swap</Link></article>
    <article className="panel exampleCard"><span className="exampleLabel">Metals</span><strong>Tether Gold</strong><p>One token is one troy ounce of gold. It&apos;s held on Ethereum, and the route&apos;s fees come out of the amount.</p><Link className="button secondary" href="/app/swap">Open Swap</Link></article>
  </div>;
}
