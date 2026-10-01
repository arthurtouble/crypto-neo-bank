/**
 * A provider's onboarding link is opened in the customer's browser, so it must be a plain https address. Anything
 * else (javascript:, data:, http:, or text that isn't a URL) is never opened.
 */
export function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname ? url.href : null;
  } catch { return null; }
}
