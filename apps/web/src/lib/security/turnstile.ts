type SiteverifyResult = { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };

export async function verifyTurnstile(input: { token?: string; remoteIp?: string | null; expectedAction: string }): Promise<{ configured: boolean; valid: boolean }> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return { configured: false, valid: true };

  const expectedHostnames = new Set((process.env.TURNSTILE_HOSTNAMES ?? "").split(",").map((hostname) => hostname.trim()).filter(Boolean));
  if (!input.token || input.token.length > 2048 || expectedHostnames.size === 0) return { configured: true, valid: false };

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: input.token, ...(input.remoteIp ? { remoteip: input.remoteIp } : {}) })
    });
    if (!response.ok) return { configured: true, valid: false };
    const result = await response.json() as SiteverifyResult;
    return { configured: true, valid: result.success === true && result.action === input.expectedAction && typeof result.hostname === "string" && expectedHostnames.has(result.hostname) };
  } catch {
    return { configured: true, valid: false };
  }
}
