// Whether this browser has a saved Privy session, read without loading Privy. Privy keeps its tokens in localStorage as
// `privy:token` and `privy:refresh_token` (or `privy:<client>:token`), and, with cookies on, sets `privy-token` and
// `privy-session` (or `privy-<client>-…`). A hit means "load Privy and let it decide"; a stale key only costs the
// download. End-to-end tests swap this module for tests/e2e/support/privy-session-fake.ts (vite.config.ts).

const STORAGE_KEY = /^privy:(?:[^:]+:)?(?:token|refresh_token)$/;
const COOKIE_NAME = /^privy-(?:[^=;]+-)?(?:session|token)$/;

export function hasSavedPrivySession(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && STORAGE_KEY.test(key) && localStorage.getItem(key)) return true;
    }
  } catch { /* Storage blocked: fall through to cookies. */ }
  try {
    return document.cookie.split(";").some((cookie) => {
      const [name, ...value] = cookie.trim().split("=");
      return COOKIE_NAME.test(name) && value.join("=") !== "";
    });
  } catch { return false; }
}
