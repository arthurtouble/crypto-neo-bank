import { appendFileSync, readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Where the docs live, and the Aura app they link back to. Production's workers.dev addresses unless the build sets
// them: the dev deploy sets both, and a production custom domain sets both (docs/operations/production-launch.md).
const site = process.env.AURA_DOCS_SITE ?? "https://aurel-docs.aurel-events.workers.dev";
const app = process.env.AURA_APP_URL ?? "https://aurel-financial-os.aurel-events.workers.dev";
// Dev asks search engines to stay out: robots.txt (src/pages/robots.txt.ts), a robots meta, and an X-Robots-Tag header.
const noindex = process.env.AURA_DOCS_NOINDEX === "1";

// The browser's theme colour is the page canvas, light and dark, read from the design tokens.
const tokens = readFileSync(new URL("../web/public/design-tokens.css", import.meta.url), "utf8");
const canvas = (block) => tokens.match(new RegExp(`${block} \\{[^}]*--color-canvas: (#[0-9a-f]+);`))?.[1];
const themeColor = { light: canvas(":root"), dark: canvas(':root\\[data-theme="dark"\\]') };
if (!themeColor.light || !themeColor.dark) throw new Error("design-tokens.css has no --color-canvas for light and dark");

/** Outside production, every file the docs Worker serves carries X-Robots-Tag (public/_headers has the cache rules). */
const noindexHeader = {
  name: "aura-noindex-header",
  hooks: { "astro:build:done": ({ dir }) => { if (noindex) appendFileSync(new URL("_headers", dir), "\n/*\n  X-Robots-Tag: noindex, nofollow\n"); } }
};

export default defineConfig({
  site,
  redirects: {
    "/safety/transaction-verification": "/safety/security-model/",
    "/product/tokenized-markets": "/product/tokenized-stocks-and-gold/"
  },
  integrations: [
    starlight({
      title: "Aura",
      description: "Clear guidance for using Aura and understanding its safeguards.",
      favicon: "/favicon.svg",
      logo: { light: "./src/assets/aura-mark-light.svg", dark: "./src/assets/aura-mark-dark.svg" },
      customCss: ["./src/styles/aurel.css"],
      social: [{ icon: "external", label: "Aura home", href: app }],
      routeMiddleware: "./src/route-data.ts",
      pagefind: true,
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        { label: "Start here", items: [
          { label: "Welcome", slug: "" },
          { label: "Product status", slug: "getting-started/status" },
          { label: "Get started with Aura", slug: "getting-started/setup" },
          { label: "Access and availability", slug: "getting-started/access" },
          { label: "Fees", slug: "company/fees-and-alignment" }
        ] },
        { label: "Use Aura", items: [
          { label: "Your account and balances", slug: "product/wallets-and-assets" },
          { label: "Add money", slug: "product/add-money" },
          { label: "Send money", slug: "product/send-and-route" },
          { label: "Moves between networks", slug: "product/cross-chain-routing" },
          { label: "Transactions and their status", slug: "product/transaction-lifecycle" },
          { label: "Aura tag", slug: "product/aura-tag" },
          { label: "Settings and notifications", slug: "product/settings-and-notifications" },
          { label: "Bank transfers", slug: "product/bank-transfers" },
          { label: "Cards and controls", slug: "product/cards-and-controls" }
        ] },
        { label: "Swap and earn", items: [
          { label: "Swap", slug: "product/swaps" },
          { label: "Earn", slug: "product/earn" },
          { label: "Networks and assets", slug: "product/networks-and-assets" },
          { label: "Tokenized stocks and gold", slug: "product/tokenized-stocks-and-gold" }
        ] },
        { label: "Safety", items: [
          { label: "Security model", slug: "safety/security-model" },
          { label: "Account controls", slug: "safety/account-controls" },
          { label: "Data and privacy", slug: "safety/data-and-privacy" },
          { label: "Report a security issue", slug: "safety/report-a-security-issue" }
        ] },
        { label: "Help", items: [
          { label: "Contact and support", slug: "help/contact-and-support" },
          { label: "Lost access and recovery", slug: "help/lost-access" },
          { label: "FAQ", slug: "help/faq" }
        ] },
        { label: "How it works", items: [
          { label: "How Aura works", slug: "concepts/architecture" },
          { label: "Sources of truth", slug: "concepts/sources-of-truth" },
          { label: "Product principles", slug: "concepts/product-principles" },
          { label: "Who does what", slug: "company/provider-responsibilities" },
          { label: "What could go wrong", slug: "safety/threat-model" },
          { label: "Regulated services", slug: "company/regulated-services" }
        ] },
        { label: "Legal", items: [{ autogenerate: { directory: "legal" } }] }
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", media: "(prefers-color-scheme: light)", content: themeColor.light } },
        { tag: "meta", attrs: { name: "theme-color", media: "(prefers-color-scheme: dark)", content: themeColor.dark } },
        // The same preview image as the Aura home page: the Overview with fictional example data.
        { tag: "meta", attrs: { property: "og:image", content: new URL("/images/aura-og.png", site).href } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: "Aura's Overview with example balances" } },
        { tag: "meta", attrs: { name: "twitter:image", content: new URL("/images/aura-og.png", site).href } },
        ...(noindex ? [{ tag: "meta", attrs: { name: "robots", content: "noindex, nofollow" } }] : []),
        { tag: "link", attrs: { rel: "preload", href: "/fonts/Geist-Variable.woff2", as: "font", type: "font/woff2", crossorigin: "anonymous" } }
      ]
    }),
    noindexHeader
  ]
});
