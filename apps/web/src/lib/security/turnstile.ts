export async function verifyTurnstile(input: { token?: string; remoteIp?: string | null }): Promise<{ configured: boolean; valid: boolean }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { configured: false, valid: true };
  if (!input.token) return { configured: true, valid: false };
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", input.token);
  form.set("idempotency_key", crypto.randomUUID());
  if (input.remoteIp) form.set("remoteip", input.remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!response.ok) return { configured: true, valid: false };
  const result = await response.json() as { success?: boolean };
  return { configured: true, valid: result.success === true };
}
