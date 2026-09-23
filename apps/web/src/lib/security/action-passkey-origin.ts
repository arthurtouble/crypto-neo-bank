/** Passkey RP configuration is server-owned. Worker hosts are development-only. */
export function validateActionPasskeyOrigin(origin: string, rpId: string, mode: "development" | "production"): void {
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error("Invalid passkey origin configuration."); }
  if ((mode !== "development" && mode !== "production") || url.protocol !== "https:" || url.origin !== origin || url.hostname !== rpId || rpId === "workers.dev"
    || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(rpId)
    || (mode === "production" && rpId.endsWith(".workers.dev")))
    throw new Error("Invalid passkey origin or RP ID configuration.");
}
