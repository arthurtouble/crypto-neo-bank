import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: process.env.AURA_DOCS_SITE ?? "https://aurel-docs.aurel-events.workers.dev",
  integrations: [
    starlight({
      title: "Aura",
      description: "Clear guidance for using Aura and understanding its safeguards.",
      favicon: "/favicon.svg",
      logo: { light: "./src/assets/aura-mark-light.svg", dark: "./src/assets/aura-mark-dark.svg" },
      customCss: ["./src/styles/aurel.css"],
      pagefind: true,
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        { label: "Start here", items: [{ label: "Welcome", slug: "" }, { label: "Product status", slug: "getting-started/status" }, { label: "Set up Aura", slug: "getting-started/setup" }, { label: "Access and availability", slug: "getting-started/access" }] },
        { label: "Understand Aura", items: [
          { label: "Product principles", slug: "concepts/product-principles" },
          { label: "Architecture", slug: "concepts/architecture" },
          { label: "Sources of truth", slug: "concepts/sources-of-truth" },
          { label: "Providers and responsibilities", slug: "company/provider-responsibilities" }
        ] },
        { label: "Accounts and money", items: [
          { label: "Bank transfers", slug: "product/bank-transfers" },
          { label: "Wallets and assets", slug: "product/wallets-and-assets" },
          { label: "Send money", slug: "product/send-and-route" },
          { label: "Aura tag", slug: "product/aura-tag" },
          { label: "Cards and controls", slug: "product/cards-and-controls" },
          { label: "Networks and assets", slug: "product/networks-and-assets" },
          { label: "Cross-chain routes", slug: "product/cross-chain-routing" },
          { label: "Activity and transaction states", slug: "product/transaction-lifecycle" }
        ] },
        { label: "Build wealth", items: [
          { label: "Swap", slug: "product/swaps" },
          { label: "Earn", slug: "product/earn" },
          { label: "Tokenized markets", slug: "product/tokenized-markets" }
        ] },
        { label: "Safety", items: [
          { label: "Security model", slug: "safety/security-model" },
          { label: "Account controls", slug: "safety/account-controls" },
          { label: "Transaction verification", slug: "safety/transaction-verification" },
          { label: "Threat model", slug: "safety/threat-model" },
          { label: "Data and privacy", slug: "safety/data-and-privacy" },
          { label: "Report a security issue", slug: "safety/report-a-security-issue" }
        ] },
        { label: "Company", items: [
          { label: "Fees and alignment", slug: "company/fees-and-alignment" },
          { label: "Regulated services", slug: "company/regulated-services" }
        ] },
        { label: "Legal", items: [{ autogenerate: { directory: "legal" } }] }
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#f7f8fa" } },
        { tag: "link", attrs: { rel: "preload", href: "/fonts/Geist-Variable.woff2", as: "font", type: "font/woff2", crossorigin: "anonymous" } }
      ]
    })
  ]
});
