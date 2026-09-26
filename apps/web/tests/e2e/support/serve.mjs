// Start what end-to-end tests run against: the fake edge (Privy, chains,
// prices), a fresh local D1 with the baseline schema, and the web app in dev
// mode wired to both. Playwright runs this as its web server.

import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { startFakeEdge } from "./fake-edge.mjs";

const appPort = process.env.AUREL_E2E_PORT ?? "43173";
const edgePort = Number(process.env.AUREL_E2E_EDGE_PORT ?? "43174");
const persist = ".wrangler/e2e-state";

const edge = await startFakeEdge({ port: edgePort });

rmSync(persist, { recursive: true, force: true });
const migrate = spawnSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "aurel-projections", "--local", "--persist-to", persist],
  { stdio: "inherit", env: { ...process.env, CI: "1" } });
if (migrate.status !== 0) { await edge.close(); process.exit(migrate.status ?? 1); }

const app = spawn("pnpm", ["dev", "--host", "127.0.0.1", "--port", appPort], {
  stdio: "inherit",
  env: {
    ...process.env,
    PRIVY_APP_SECRET: edge.secret,
    AURA_E2E_VARS: JSON.stringify(edge.vars),
    AURA_E2E: "1",
    AURA_LOCAL_BINDINGS: "1",
    // Declared secrets (PRIVY_APP_SECRET) come from this environment.
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "true"
  }
});

const stop = async () => { app.kill("SIGTERM"); await edge.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
app.on("exit", async (code) => { await edge.close(); process.exit(code ?? 0); });
