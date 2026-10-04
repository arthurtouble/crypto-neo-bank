/**
 * What search engines and other crawlers may see. Only production is indexed: dev, previews, and local runs ask not
 * to be, in robots.txt, in every page's robots meta, and in an `X-Robots-Tag` header on every response
 * (worker/index.ts). Within production, only the public pages are: the landing page. The app (example data or a
 * customer's own) carries a noindex robots meta (app/app/layout.tsx), so robots.txt leaves it crawlable for search
 * engines to read that. The API, payment pages (a person's public tag, not something to surface in search), and the
 * unavailable page are kept out in robots.txt.
 */
export const siteOrigin = () => process.env.APP_ORIGIN || undefined;
export const indexable = () => process.env.PRODUCT_ENVIRONMENT === "production";
export const publicPaths = ["/"];
export const privatePaths = ["/api/", "/pay/", "/unavailable"];
/** The `X-Robots-Tag` every response carries outside production. */
export const noindexHeader = "noindex, nofollow";

/** The public docs site, set at build time (the dev deploy sets the dev docs); production's workers.dev address otherwise. */
export const docsOrigin = () => process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";

/** The browser's theme colour: `--color-canvas` in public/design-tokens.css, light and dark (tests/unit/seo.test.ts). */
export const themeColors = { light: "#f7f8fa", dark: "#0b0d11" } as const;

export const landingTitle = "Aura: stablecoins, crypto, stocks, and gold in one app";
export const landingDescription = "Money you control, in one simple app. Hold stablecoins, crypto, stocks, and gold, then send, swap, and earn. What you can use depends on where you live.";

/** The preview image for shared links: the Overview with fictional example data. */
export const shareImage = { url: "/images/aura-og.png", width: 1200, height: 630, alt: "Aura's Overview with example balances" };

type Faq ={ question: string; answer: string };

/**
 * The landing page's structured data: who publishes it, the site, the app itself, and its questions. Built from the
 * page's own FAQ list so the two can't drift. No ratings, prices, or offers: none would be true.
 */
export function landingStructuredData(faqs: readonly Faq[], origin = siteOrigin()) {
  const at = (path: string) => (origin ? new URL(path, origin).href : path);
  const organization = { "@type": "Organization", "@id": at("/#organization"), name: "Aura", url: at("/"), logo: at("/icons/icon-512.png") };
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      { "@type": "WebSite", "@id": at("/#website"), name: "Aura", url: at("/"), description: landingDescription, inLanguage: "en", publisher: { "@id": organization["@id"] } },
      { "@type": "WebApplication", "@id": at("/#app"), name: "Aura", url: at("/app"), applicationCategory: "FinanceApplication", operatingSystem: "Web", description: landingDescription, publisher: { "@id": organization["@id"] } },
      { "@type": "FAQPage", "@id": at("/#faq"), mainEntity: faqs.map(({ question, answer }) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) }
    ]
  };
}

/** JSON for a `<script type="application/ld+json">`: `<` escaped so no string in it can close the script element. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
