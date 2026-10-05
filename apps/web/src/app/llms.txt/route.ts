import { docsOrigin, siteOrigin } from "@/lib/site/seo";

/**
 * /llms.txt (llmstxt.org): a short, plain summary of Aura for AI assistants and search tools, with links to the docs
 * pages that answer most questions. Public and the same for everyone; the docs site has the full index
 * (/llms.txt there) and every page in one file (/llms-full.txt).
 */
export function GET(request: Request) {
  const docs = docsOrigin();
  const app = siteOrigin() ?? new URL(request.url).origin;
  const page = (path: string) => `${docs}${path}`;
  const body = `# Aura

> Aura is a money app. Hold stablecoins, crypto, stocks, and gold, then send, swap, and earn from one wallet. You confirm every payment with your passkey. We never hold your keys or your money. What you can use depends on where you live.

Aura is in preview. Signed out, every screen works with example data, clearly labelled. Balances come from the blockchains and partners that hold the money, read each time the app opens. Bank transfers and cards aren't available yet: both need approved partners.

## What Aura does

- Hold and send ETH, USDC, EURC, WETH, cbBTC, tokenized stocks, and Tether Gold, mainly on Base.
- Swap between crypto, stocks, and gold, with the price and fees shown before you confirm.
- Earn by lending through Aave or a Morpho vault on Base, with the risks next to the rate.
- An Aura tag: a short name with a public page where people can pay you in crypto.
- Daily limits, saved recipients, and an emergency lock.

Each feature is switched on only once it's ready. The product status page says what's on now.

## Docs

- [Product status](${page("/getting-started/status/")}): what you can use now, and what's waiting on a partner
- [Get started](${page("/getting-started/setup/")}): look around, sign in, and understand your account
- [Security model](${page("/safety/security-model/")}): how sign-in, signing, and settlement are protected
- [Fees and alignment](${page("/company/fees-and-alignment/")}): what you pay, and why there's no Aura token
- [Networks and assets](${page("/product/networks-and-assets/")}): supported networks and assets
- [Legal documents](${page("/legal/")}): terms, privacy notice, and risk disclosure

## Optional

- [Docs index for AI tools](${page("/llms.txt")})
- [All docs in one file](${page("/llms-full.txt")})
- [Try Aura with example data](${app}/app)
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
