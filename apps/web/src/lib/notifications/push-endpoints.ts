import { localEdgeUrl } from "@/lib/testing/local-edge";

/** Most browsers a customer can turn push on in. A new one replaces the one subscribed longest ago. */
export const MAX_PUSH_SUBSCRIPTIONS = 10;

/**
 * The push services browsers use: Chrome, Edge on Android, and other Chromium
 * browsers (Firebase Cloud Messaging), Safari (Apple), Firefox (Mozilla), and
 * Edge on Windows (Windows Notification Service). Aura sends push only to
 * these, so a subscription can't point Aura's requests anywhere else.
 */
const exactHosts = new Set(["fcm.googleapis.com"]);
const hostSuffixes = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

/** True when the end-to-end tests' fake push service is in use: plain HTTP on loopback, only in local-edge test mode. */
export const isLocalTestPushEndpoint = (value: string) =>
  /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(value) && localEdgeUrl("PRIVY_API_URL") !== null;

/** An HTTPS address on a known push service, on the default port, with no credentials in it. */
export function isPushEndpoint(value: string): boolean {
  if (isLocalTestPushEndpoint(value)) return true;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  return exactHosts.has(host) || hostSuffixes.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/** A notice's link as a path in the app; anything else (another site, `//host`, `@host`) opens the app's home instead. */
export const appPath = (link: string | null | undefined) =>
  typeof link === "string" && link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\") ? link : "/app";
