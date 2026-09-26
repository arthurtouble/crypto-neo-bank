/**
 * End-to-end tests run the real server code against a local fake of Privy,
 * the chains, and the price feed (`tests/e2e/support`). These overrides only
 * take effect for loopback URLs, so a stray setting on a deployed Worker can
 * never point it at another host or let it trust another signing key.
 */
export function localEdgeUrl(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost") ? value.replace(/\/$/, "") : null;
  } catch { return null; }
}
