import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Privy, its smart wallets, and wagmi load only inside the Privy runtime (components/web3-runtime-provider.tsx), which
// AuthProvider imports lazily for a saved session or a guest's Sign in. Screens read lib/client/auth.tsx and
// lib/client/wallet-context.tsx instead. A static import of these packages anywhere else puts them back on every
// page, guests included. See docs/architecture/frontend-data.md.

const srcRoot = resolve(process.cwd(), "src");

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The runtime and the files only it imports. */
const RUNTIME = new Set(["components/web3-runtime-provider.tsx", "components/privy-bridge.tsx"]);

/** Wallet libraries that must stay behind the runtime. viem's clients and chains count; its address checks don't. */
const FORBIDDEN = /^(?:@privy-io\/|wagmi(?:\/|$)|@wagmi\/|viem\/|@\/config\/chains$)/;
const VIEM_ALLOWED = new Set(["getAddress", "isAddress"]);

type Import = { specifier: string; names: string[]; typeOnly: boolean; dynamic: boolean };

function imports(source: string): Import[] {
  const found: Import[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g)) {
    const clause = match[2];
    const named = /\{([^}]*)\}/.exec(clause)?.[1].split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    const defaultOrNamespace = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
    const typeOnly = Boolean(match[1]) || (!defaultOrNamespace && named.length > 0 && named.every((item) => item.startsWith("type ")));
    found.push({ specifier: match[3], names: named.filter((item) => !item.startsWith("type ")).map((item) => item.split(/\s+as\s+/)[0]), typeOnly, dynamic: false });
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) found.push({ specifier: match[1], names: [], typeOnly: false, dynamic: false });
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: match[1], names: [], typeOnly: false, dynamic: true });
  return found;
}

const scanned = [...files(join(srcRoot, "components")), ...files(join(srcRoot, "lib/client")),
  ...files(join(srcRoot, "app")).filter((path) => !path.startsWith(join(srcRoot, "app/api")))]
  .map((path) => ({ path: relative(srcRoot, path), imports: imports(readFileSync(path, "utf8")) }));

describe("Privy runtime boundary", () => {
  it("finds the client files and their imports", () => {
    expect(scanned.length).toBeGreaterThan(50);
    expect(scanned.find((file) => file.path === "components/privy-bridge.tsx")?.imports.some((item) => item.specifier === "@privy-io/react-auth")).toBe(true);
  });

  it("keeps Privy, wagmi, and viem's clients out of every client file but the runtime", () => {
    const leaks = scanned.filter((file) => !RUNTIME.has(file.path)).flatMap((file) => file.imports
      .filter((item) => !item.typeOnly)
      .filter((item) => FORBIDDEN.test(item.specifier) || (item.specifier === "viem" && (item.names.length === 0 || item.names.some((name) => !VIEM_ALLOWED.has(name)))))
      .map((item) => `${file.path} imports ${item.specifier}${item.names.length ? ` (${item.names.join(", ")})` : ""}`));
    expect(leaks).toEqual([]);
  });

  it("loads the runtime only lazily, and its files only from the runtime", () => {
    const references = scanned.flatMap((file) => file.imports
      .filter((item) => /(?:^|\/)(?:web3-runtime-provider|privy-bridge)$/.test(item.specifier))
      .map((item) => `${file.path} -> ${item.specifier}${item.dynamic ? " (lazy)" : ""}`));
    expect(references.sort()).toEqual([
      "components/auth-provider.tsx -> ./web3-runtime-provider (lazy)",
      "components/web3-runtime-provider.tsx -> ./privy-bridge"
    ]);
  });
});
