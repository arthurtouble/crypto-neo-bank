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
        { label: "Start here", items: [{ label: "Welcome", slug: "" }, { label: "Product status", slug: "getting-started/status" }, { label: "Set up Aurel", slug: "getting-started/setup" }] },
        { label: "Use Aurel", items: [{ autogenerate: { directory: "product" } }] },
        { label: "Safety", items: [{ autogenerate: { directory: "safety" } }] },
        { label: "Company", items: [{ autogenerate: { directory: "company" } }] },
        { label: "Legal", items: [{ autogenerate: { directory: "legal" } }] }
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#123524" } },
        { tag: "link", attrs: { rel: "preload", href: "/fonts/Satoshi-Variable.woff2", as: "font", type: "font/woff2", crossorigin: "anonymous" } }
      ]
    })
  ]
});
