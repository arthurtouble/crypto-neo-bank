import { HttpError } from "@/lib/http/errors";

/**
 * Places Aura is never offered from: countries and regions under comprehensive sanctions. Requests from them get the
 * app and the API refused at the edge (worker/index.ts), from Cloudflare's geolocation of the connecting IP address.
 * The landing page, the docs, and the legal pages stay readable. This is one control among several (the terms, the
 * partners' own screening); a VPN gets around it. Add a place here in a reviewed change, and update
 * docs/compliance/legal-and-jurisdiction-decisions.md with it.
 */

/** ISO 3166-1 alpha-2 country codes. */
const blockedCountries: Record<string, string> = {
  CU: "Cuba",
  IR: "Iran",
  KP: "North Korea",
  SY: "Syria"
};

/** Regions within a country, as Cloudflare reports them: the country code, then the ISO 3166-2 subdivision code. */
const blockedRegions: Record<string, string> = {
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
 * The header the web Worker puts Cloudflare's region in, so API handlers can read it after the router has rebuilt the
 * request without its `cf` object. The Worker sets or removes it on every request, so a client can't choose it.
 */
export const REGION_HEADER = "X-Aura-Region";

/**
 * Where a request comes from, according to Cloudflare: the CF-IPCountry header it sets on every request (and overwrites
 * if a client sends one), else the `cf` object, which also carries the region (or the Worker's region header, past the
 * router). Local development has neither.
 */
export function requestPlace(request: Request): { country?: string; region?: string } {
  const cf = (request as Request & { cf?: { country?: unknown; regionCode?: unknown } }).cf;
  const country = request.headers.get("CF-IPCountry") ?? (typeof cf?.country === "string" ? cf.country : undefined);
  const region = typeof cf?.regionCode === "string" ? cf.regionCode : request.headers.get(REGION_HEADER) ?? undefined;
  return { country, region };
}

/**
 * The request as the router should see it: Cloudflare's region copied into `REGION_HEADER`, and any value a client
 * sent for that header dropped.
 */
export function withRegionHeader(request: Request): Request {
  const cf = (request as Request & { cf?: { regionCode?: unknown } }).cf;
  const region = typeof cf?.regionCode === "string" ? cf.regionCode : undefined;
  if (!region && !request.headers.has(REGION_HEADER)) return request;
  const headers = new Headers(request.headers);
  if (region) headers.set(REGION_HEADER, region); else headers.delete(REGION_HEADER);
  return new Request(request, { headers });
}

/**
 * Places a provider doesn't serve, for the features built on it. Aura's server signs or sends these orders itself, so
 * the provider never sees the customer's location and its own check can't apply; Aura applies the provider's list
 * instead. From these places a customer can't start anything new (set up, add money, open or add to a position, buy
 * stock tokens), but can always sell, close, cancel, and withdraw. Sanctioned places are already refused at the edge.
 * Keep each list as the provider publishes it, in a reviewed change, and update docs/compliance/legal-and-jurisdiction-decisions.md.
 */
export type ProviderPlaceRule = "predictions" | "perps" | "stocks";

/** The United States and its territories, each of which Cloudflare reports as its own country code. */
const unitedStates: Record<string, string> = {
  US: "the United States", AS: "American Samoa", GU: "Guam", MP: "the Northern Mariana Islands", PR: "Puerto Rico",
  UM: "the US Minor Outlying Islands", VI: "the US Virgin Islands"
};

const providerPlaces: Record<ProviderPlaceRule, { countries: Record<string, string>; regions: Record<string, string> }> = {
  // Polymarket: close-only on its site and API, plus the places it's close-only on its site (docs.polymarket.com/api-reference/geoblock,
  // 3 October 2026). Malta is close-only for sports alone, which Aura doesn't list.
  predictions: {
    countries: {
      ...unitedStates, AU: "Australia", BE: "Belgium", BI: "Burundi", BR: "Brazil", BY: "Belarus", CD: "the Democratic Republic of the Congo",
      CF: "the Central African Republic", DE: "Germany", ET: "Ethiopia", FR: "France", GB: "the United Kingdom", IE: "Ireland", IQ: "Iraq",
      IT: "Italy", JP: "Japan", KR: "South Korea", LB: "Lebanon", LY: "Libya", MM: "Myanmar", NI: "Nicaragua", NL: "the Netherlands",
      NZ: "New Zealand", PL: "Poland", RU: "Russia", SD: "Sudan", SG: "Singapore", SK: "Slovakia", SO: "Somalia", SS: "South Sudan",
      TH: "Thailand", TW: "Taiwan", VE: "Venezuela", YE: "Yemen", ZW: "Zimbabwe"
    },
    regions: { "CA-AB": "Alberta", "CA-BC": "British Columbia", "CA-ON": "Ontario", "CA-QC": "Quebec" }
  },
  // Hyperliquid's terms of use: persons in the United States and Ontario are restricted.
  perps: { countries: unitedStates, regions: { "CA-ON": "Ontario" } },
  // Coinbase tokenized stocks are offered under Regulation S: not to the United States, nor the United Kingdom.
  stocks: { countries: { ...unitedStates, GB: "the United Kingdom" }, regions: {} }
};

/** The name of the place that keeps a request from starting something under this rule, or undefined. Unknown places are allowed. */
export function providerRestrictedPlace(rule: ProviderPlaceRule, country: string | null | undefined, region: string | null | undefined): string | undefined {
  const code = country?.trim().toUpperCase();
  if (!code) return undefined;
  const { countries, regions } = providerPlaces[rule];
  return countries[code] ?? (region ? regions[`${code}-${region.trim().toUpperCase()}`] : undefined);
}

const restrictedMessages: Record<ProviderPlaceRule, string> = {
  predictions: "Predictions aren't available where you are. You can still sell what you hold and withdraw.",
  perps: "Perps aren't available where you are. You can still close positions and withdraw.",
  stocks: "Stocks aren't available where you are. You can still sell or send the ones you hold."
};

/** Refuse a request that would start something new under this rule from a place its provider doesn't serve. */
export function requireProviderPlace(request: Request, rule: ProviderPlaceRule): void {
  const { country, region } = requestPlace(request);
  if (providerRestrictedPlace(rule, country, region)) throw new HttpError(451, "place_restricted", restrictedMessages[rule]);
}
