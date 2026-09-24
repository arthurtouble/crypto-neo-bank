import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

const createSchema = z.object({ label: z.string().trim().min(2).max(80), cohort: z.string().trim().regex(/^[a-z0-9-]{2,40}$/), maxRedemptions: z.number().int().min(1).max(500).default(1), allowedCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50).default([]), expiresAt: z.string().datetime().optional() });

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `AUREL-${[...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").toUpperCase()}`;
}

function responseFor(error: unknown, traceId: string) {
  if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
  if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
  if (error instanceof z.ZodError) return Response.json({ error: "invalid_beta_control", issues: error.issues, traceId }, { status: 400 });
  return Response.json({ error: "beta_controls_unavailable", traceId }, { status: 503 });
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireOperationsAdmin(request);
    const [invites, cohorts, recent] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("SELECT label, cohort, status, max_redemptions, redemption_count, allowed_countries_json, expires_at, created_at FROM beta_invites ORDER BY created_at DESC LIMIT 100"),
      env.PROJECTION_DB.prepare("SELECT cohort, status, COUNT(*) AS count, AVG(transaction_limit_usd) AS average_limit FROM beta_access GROUP BY cohort, status ORDER BY cohort"),
      env.PROJECTION_DB.prepare("SELECT subject_reference, cohort, country_code, status, transaction_limit_usd, activated_at FROM beta_access ORDER BY activated_at DESC LIMIT 100")
    ]);
    return Response.json({ invites: invites.results, cohorts: cohorts.results, access: recent.results, mode: process.env.BETA_ACCESS_MODE === "invite" ? "invite" : "preview", traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseFor(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const admin = await requireOperationsAdmin(request);
    const input = createSchema.parse(await request.json());
    const code = inviteCode();
    const codeHash = await hash(code);
    await env.PROJECTION_DB.prepare(`INSERT INTO beta_invites
      (code_hash, label, cohort, status, max_redemptions, redemption_count, allowed_countries_json, expires_at, created_at, created_by)
      VALUES (?, ?, ?, 'active', ?, 0, ?, ?, ?, ?)`)
      .bind(codeHash, input.label, input.cohort, input.maxRedemptions, JSON.stringify(input.allowedCountries), input.expiresAt ?? null, new Date().toISOString(), admin.subjectReference).run();
    return Response.json({ code, label: input.label, cohort: input.cohort, message: "Copy this code now. Aura stores only its hash.", traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseFor(error, traceId); }
}

