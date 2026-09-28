import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the web app serves the operator APIs; Cloudflare Access isn't
// there, so a token for a local fake of it can be passed in OPS_DEV_ACCESS_TOKEN
// (end-to-end tests add it to each request themselves).
const target = process.env.OPS_API_TARGET ?? "http://127.0.0.1:43173";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: Number(process.env.OPS_PORT ?? 43175),
    strictPort: true,
    proxy: {
      "/api": {
        target, changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\//, "/api/ops/"),
        headers: process.env.OPS_DEV_ACCESS_TOKEN ? { "Cf-Access-Jwt-Assertion": process.env.OPS_DEV_ACCESS_TOKEN } : undefined
      }
    }
  }
});
