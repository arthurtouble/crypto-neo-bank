import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@privy-io/react-auth", "lucide-react"],
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
});
