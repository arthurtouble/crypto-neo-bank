import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://aurel-docs.aurel-events.workers.dev",
  integrations: [
    starlight({
      title: "Aurel",
      description: "Clear guidance for using Aurel and understanding its safeguards.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/aurel.css"],
      pagefind: true,
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        { label: "Start here", items: [{ label: "Welcome", slug: "" }, { label: "Product status", slug: "getting-started/status" }, { label: "Set up Aurel", slug: "getting-started/setup" }, { label: "Apply for private access", slug: "getting-started/private-access-application" }, { label: "Private beta", slug: "getting-started/private-beta" }] },
        { label: "Understand Aurel", items: [
          { label: "Product principles", slug: "concepts/product-principles" },
          { label: "Architecture", slug: "concepts/architecture" },
          { label: "Sources of truth", slug: "concepts/sources-of-truth" },
          { label: "Providers and responsibilities", slug: "company/provider-responsibilities" }
        ] },
        { label: "Accounts and money", items: [
          { label: "Bank transfers", slug: "product/bank-transfers" },
          { label: "Wallets and assets", slug: "product/wallets-and-assets" },
          { label: "Send money", slug: "product/send-and-route" },
          { label: "Recipients and schedules", slug: "product/recipients-and-schedules" },
          { label: "Networks and assets", slug: "product/networks-and-assets" },
          { label: "Cross-chain routes", slug: "product/cross-chain-routing" },
          { label: "Activity and transaction states", slug: "product/transaction-lifecycle" }
        ] },
        { label: "Build wealth", items: [
          { label: "Earn and borrow", slug: "product/earn-and-borrow" },
          { label: "Tokenized markets", slug: "product/tokenized-markets" },
          { label: "Membership and benefits", slug: "product/membership-and-benefits" },
          { label: "Concierge and support", slug: "product/concierge-and-support" }
        ] },
        { label: "Safety", items: [
          { label: "Security model", slug: "safety/security-model" },
          { label: "Account controls", slug: "safety/account-controls" },
          { label: "Threat model", slug: "safety/threat-model" },
          { label: "Data and privacy", slug: "safety/data-and-privacy" },
          { label: "Report a security issue", slug: "safety/report-a-security-issue" }
        ] },
        { label: "Operations", items: [
          { label: "Private-beta operations", slug: "operations/private-beta" },
          { label: "Provider events", slug: "operations/provider-events" },
          { label: "Reliability and recovery", slug: "operations/reliability-and-recovery" },
          { label: "Incident response", slug: "operations/incident-response" },
          { label: "Release process", slug: "operations/release-process" },
          { label: "Provider diligence", slug: "operations/provider-diligence" }
        ] },
        { label: "Company", items: [
          { label: "Fees and alignment", slug: "company/fees-and-alignment" },
          { label: "Regulated services", slug: "company/regulated-services" },
          { label: "Roadmap", slug: "company/roadmap" }
        ] },
        { label: "Legal", items: [{ autogenerate: { directory: "legal" } }] }
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#123524" } },
        { tag: "link", attrs: { rel: "preload", href: "/fonts/Satoshi-Variable.woff2", as: "font", type: "font/woff2", crossorigin: "anonymous" } }
      ]
    })
  ]
});
