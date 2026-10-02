/**
 * The security headers every response from the web app carries. One list, three users: next.config.ts (pages and
 * API routes), the Worker (any response vinext or the place check returned without them, such as the 451 JSON),
 * and public/_headers (static files that Cloudflare serves before the Worker runs). A unit test keeps the last one
 * identical to this list. Plain strings only: next.config.ts imports this file.
 */
export const securityHeaders: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Privy-supported smart wallets use a popup and require access to its opener.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://intercom.help https://api-iam.intercom.io; script-src 'self' 'unsafe-inline' https://*.privy.io https://telegram.org https://widget.intercom.io https://js.intercomcdn.com https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https://js.intercomcdn.com https://fonts.intercomcdn.com; media-src 'self' https://js.intercomcdn.com; connect-src 'self' https: wss:; frame-src https://*.privy.io https://oauth.telegram.org https://intercom-sheets.com https://www.intercom-reporting.com https://js.stripe.com https://*.stripe.com; worker-src 'self' blob:; upgrade-insecure-requests" }
];

/** Set any security header the response doesn't already carry. Returns the same response when nothing is missing. */
export function withSecurityHeaders(response: Response): Response {
  if (response.status === 101 || securityHeaders.every(({ key }) => response.headers.has(key))) return response;
  const out = new Response(response.body, response);
  for (const { key, value } of securityHeaders) if (!out.headers.has(key)) out.headers.set(key, value);
  return out;
}
