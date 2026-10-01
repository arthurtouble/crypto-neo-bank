// Stands in for src/lib/client/privy-session.ts in end-to-end tests (see vite.config.ts). The fake Privy
// (privy-react-fake.tsx) is signed in when "aura-e2e-signed-in" is "1", so that is the saved session here.
export function hasSavedPrivySession(): boolean {
  try { return localStorage.getItem("aura-e2e-signed-in") === "1"; } catch { return false; }
}
