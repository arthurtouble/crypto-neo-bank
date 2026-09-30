/**
 * Places Aura is never offered from: countries and regions under comprehensive sanctions. Requests from them get the
 * app and the API refused at the edge (worker/index.ts), from Cloudflare's geolocation of the connecting IP address.
 * The landing page, the docs, and the legal pages stay readable. This is one control among several (the terms, the
 * partners' own screening); a VPN gets around it. Add a place here in a reviewed change, and update
 * docs/compliance/legal-and-jurisdiction-decisions.md with it.
 */

/** ISO 3166-1 alpha-2 country codes. */
export const blockedCountries: Record<string, string> = {
  CU: "Cuba",
  IR: "Iran",
  KP: "North Korea",
  SY: "Syria"
};

/** Regions within a country, as Cloudflare reports them: the country code, then the ISO 3166-2 subdivision code. */
export const blockedRegions: Record<string, string> = {
  "UA-43": "Crimea",
  "UA-40": "Sevastopol",
  "UA-14": "Donetsk",
  "UA-09": "Luhansk"
};

/** The name of the blocked place a request comes from, or undefined when it may use Aura. Unknown places are allowed. */
export function blockedPlace(country: string | null | undefined, region: string | null | undefined): string | undefined {
  const code = country?.trim().toUpperCase();
  if (!code) return undefined;
  return blockedCountries[code] ?? (region ? blockedRegions[`${code}-${region.trim().toUpperCase()}`] : undefined);
}

/**
 * Whether a path is part of the product, and so refused from a blocked place: the app, the API, and the public payment
 * pages. The health probe and signed provider webhooks come from machines, not customers, so they stay open.
 */
export function isGatedPath(pathname: string): boolean {
  let path = pathname;
  // Match what the router will serve: decoded, any case, and the ".rsc" form of a page used by client navigation.
  try { path = decodeURIComponent(pathname); } catch { /* keep the raw path */ }
  path = path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\.rsc$/, "");
  if (path === "/api/health" || path.startsWith("/api/webhooks/")) return false;
  return ["/app", "/api", "/pay"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Where a request comes from, according to Cloudflare: the CF-IPCountry header it sets on every request (and overwrites
 * if a client sends one), else the `cf` object, which also carries the region. Local development has neither.
 */
export function requestPlace(request: Request): { country?: string; region?: string } {
  const cf = (request as Request & { cf?: { country?: unknown; regionCode?: unknown } }).cf;
  const country = request.headers.get("CF-IPCountry") ?? (typeof cf?.country === "string" ? cf.country : undefined);
  return { country, region: typeof cf?.regionCode === "string" ? cf.regionCode : undefined };
}
