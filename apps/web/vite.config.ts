import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vinext from "vinext";

// End-to-end tests (tests/e2e/support/serve.mjs) swap Privy's browser SDK for a
// local stand-in and keep their own local database. Never set outside tests.
const e2e = process.env.AURA_E2E === "1";
const fake = (file: string) => fileURLToPath(new URL(`./tests/e2e/support/${file}`, import.meta.url));

export default defineConfig({
  resolve: e2e ? { alias: [
    { find: /^@privy-io\/react-auth\/smart-wallets$/, replacement: fake("privy-smart-wallets-fake.tsx") },
    { find: /^@privy-io\/react-auth\/ui$/, replacement: fake("privy-ui-fake.tsx") },
    { find: /^@privy-io\/react-auth$/, replacement: fake("privy-react-fake.tsx") },
    { find: /^@privy-io\/wagmi$/, replacement: fake("privy-wagmi-fake.ts") }
  ] } : undefined,
  // The browser reaches the fake edge through an HTTPS name that Playwright forwards (tests/e2e/support/fixtures.ts), so the CSP stays as deployed.
  define: e2e ? { __AURA_E2E_EDGE__: JSON.stringify("https://edge.aura-e2e.test") } : undefined,
  optimizeDeps: {
    exclude: ["lucide-react"],
    include: [
      ...(e2e ? [] : ["@privy-io/react-auth", "@privy-io/wagmi"]),
      "eventemitter3",
      "canonicalize",
      "fetch-retry",
      "pino",
      "@coinbase/wallet-sdk",
    ],
    needsInterop: [
      "eventemitter3",
      "canonicalize",
      "fetch-retry",
      "pino",
      "@coinbase/wallet-sdk",
    ],
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      // Remote bindings (Workers AI) need Cloudflare credentials; tests and CI run without them.
      remoteBindings: process.env.AURA_LOCAL_BINDINGS !== "1",
      persistState: e2e ? { path: ".wrangler/e2e-state" } : true,
      // The fake edge's URLs and verification key, as plain variables of the local Worker.
      config: e2e ? (worker) => ({ vars: { ...worker.vars, ...JSON.parse(process.env.AURA_E2E_VARS ?? "{}") } }) : undefined,
    }),
  ],
});
