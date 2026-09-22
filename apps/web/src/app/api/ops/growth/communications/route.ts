import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";
import { lifecycleMessageSchema, LocalLifecycleMessenger, sendLifecycleMessage } from "@/lib/growth/lifecycle";

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try { const admin = await requireOperationsAdmin(request); const input = lifecycleMessageSchema.parse(await request.json()); const result = await sendLifecycleMessage(env.PROJECTION_DB, new LocalLifecycleMessenger(), input, admin.subjectReference); return Response.json({ ...result, deliveryMode: "local", traceId }, { status: 202, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 }); if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 }); if (error instanceof z.ZodError) return Response.json({ error: "invalid_message", traceId }, { status: 400 }); return Response.json({ error: "message_suppressed", message: error instanceof Error ? error.message : "Message unavailable.", traceId }, { status: 409 }); }
}
