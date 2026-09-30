import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: process.env.AURA_DOCS_SITE ?? "https://aurel-docs.aurel-events.workers.dev",
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
        { tag: "meta", attrs: { name: "theme-color", content: "#f7f8fa" } },
        { tag: "link", attrs: { rel: "preload", href: "/fonts/Geist-Variable.woff2", as: "font", type: "font/woff2", crossorigin: "anonymous" } }
      ]
    })
  ]
});
