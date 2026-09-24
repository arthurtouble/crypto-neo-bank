import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { cancelSwapReminderPlan, listSwapReminderPlans } from "@/lib/swap/reminder-store";

const noStore = { "Cache-Control": "no-store" };
const cancel = z.strictObject({ planId: z.string().uuid(), version: z.number().int().positive(), action: z.literal("cancel") });

export async function GET(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const plans = await listSwapReminderPlans(env.PROJECTION_DB, subject.subjectReference);
    return Response.json({ plans, planningAvailable: false }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    return Response.json({ error: "reminders_unavailable" }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "swap_reminders_retired" }, { status: 410, headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    return Response.json({ error: "reminders_unavailable" }, { status: 503, headers: noStore });
  }
}

export async function PATCH(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    const input = cancel.parse(await request.json());
    const updated = await cancelSwapReminderPlan(env.PROJECTION_DB, subject.subjectReference, input.planId, input.version);
    return updated ? Response.json({ updated: true, planVersion: input.version + 1 }, { headers: noStore })
      : Response.json({ error: "reminder_changed" }, { status: 409, headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_reminder" }, { status: 400, headers: noStore });
    return Response.json({ error: "reminder_unavailable" }, { status: 503, headers: noStore });
  }
}
