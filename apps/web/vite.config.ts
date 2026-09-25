import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig({
  optimizeDeps: {
    exclude: ["lucide-react"],
    include: [
      "@privy-io/react-auth",
      "@privy-io/wagmi",
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
    }),
  ],
});
