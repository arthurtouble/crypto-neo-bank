import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://aurel-internal-kb.aurel-events.workers.dev",
  integrations: [
    starlight({
      title: "Aurel internal",
      description: "Internal product, architecture, operations, risk, compliance, and growth knowledge.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/internal.css"],
      pagefind: true,
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        { label: "Start here", items: [
          { label: "Knowledge base", slug: "" },
          { label: "Aura build status", link: "/overview/build-status/" },
          { label: "Build status", slug: "overview/build-status" },
          { label: "Launch readiness", slug: "overview/launch-readiness" },
          { label: "Product implementation plan", slug: "overview/product-implementation-plan" }
        ] },
        { label: "Product and design", items: [
          { label: "Design system", slug: "product/design-system" },
          { label: "Content standard", slug: "product/content-style-guide" },
          { label: "Daily money flows", slug: "product/daily-money-flows" },
          { label: "Volume and economics", slug: "product/volume-and-economics-inputs" }
        ] },
        { label: "Architecture and providers", items: [
          { label: "Architecture", slug: "architecture/architecture" },
          { label: "Fund and data flows", slug: "architecture/fund-flow-and-provider-data" },
          { label: "Partner integration", slug: "architecture/partner-integration" },
          { label: "Provider activation", slug: "architecture/provider-activation-blueprint" },
          { label: "Dependency risk", slug: "architecture/dependency-risk-register" }
        ] },
        { label: "Operations", items: [
          { label: "Runbook", slug: "operations/operations-runbook" },
          { label: "Acceptance testing", slug: "operations/acceptance-test-plan" },
          { label: "Closed beta", slug: "operations/closed-beta-plan" },
          { label: "Incident response", slug: "operations/incident-response-plan" },
          { label: "Customer communications", slug: "operations/customer-communication-templates" },
          { label: "Data retention", slug: "operations/data-retention-schedule" },
          { label: "Edge security activation", slug: "operations/edge-security-activation" },
          { label: "Knowledge-base access", slug: "operations/knowledge-base-access" }
        ] },
        { label: "Security", items: [
          { label: "Threat model", slug: "security/threat-model" },
          { label: "Internal security review", slug: "security/security-review" },
          { label: "External review scope", slug: "security/external-security-review-scope" }
        ] },
        { label: "Legal and compliance", items: [
          { label: "Decision register", slug: "compliance/legal-and-jurisdiction-decisions" },
          { label: "Responsibility matrix", slug: "compliance/compliance-responsibility-matrix" },
          { label: "Provider requirements", slug: "compliance/provider-requirements-matrix" },
          { label: "Partner diligence", slug: "compliance/partner-diligence" }
        ] }
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#10251b" } },
        { tag: "meta", attrs: { name: "robots", content: "noindex, nofollow, noarchive, nosnippet" } },
        { tag: "meta", attrs: { name: "referrer", content: "no-referrer" } }
      ]
    })
  ]
});
