import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";
import { decryptEmail, growthSecrets } from "@/lib/growth/crypto";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional()
}).strict();

export async function GET(request: Request) {
  try {
    await requireOperationsAdmin(request);
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const rows = await env.PROJECTION_DB.prepare(`SELECT waitlist_id, email_ciphertext, email_nonce, country_hint, status, created_at
      FROM growth_waitlist WHERE (? IS NULL OR created_at < ?) ORDER BY created_at DESC LIMIT ?`)
      .bind(input.cursor ?? null, input.cursor ?? null, input.limit + 1)
      .all<{ waitlist_id: string; email_ciphertext: string; email_nonce: string; country_hint: string | null; status: string; created_at: string }>();
    const entries = await Promise.all(rows.results.slice(0, input.limit).map(async (row) => ({
      waitlistId: row.waitlist_id,
      email: await decryptEmail(row.email_ciphertext, row.email_nonce, growthSecrets().encryptionKey),
      countryHint: row.country_hint,
      countryHintLabel: "Approximate",
      status: row.status,
      createdAt: row.created_at
    })));
    return Response.json({ entries, nextCursor: rows.results.length > input.limit ? entries.at(-1)?.createdAt : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_query" }, { status: 400 });
    return Response.json({ error: "waitlist_unavailable" }, { status: 503 });
  }
}
