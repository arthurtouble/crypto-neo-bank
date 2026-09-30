import { z } from "zod";

/**
 * Resend's delivery reports for notice emails. Resend accepting an email only means it will try; a bounce comes
 * later. Each email is tagged with its notice's ID when it's sent (deliver.ts), so a report finds its notice without
 * storing Resend's own ID. A bounce marks the notice's email failed; a spam complaint is logged. Only a notice whose
 * email was marked sent changes, so a report can't touch anything else, and repeats change nothing.
 */
export const NOTICE_TAG = "notification";

const tagsSchema = z.union([
  z.record(z.string(), z.string()),
  z.array(z.object({ name: z.string(), value: z.string() })).transform((tags) => Object.fromEntries(tags.map((tag) => [tag.name, tag.value])))
]);
const eventSchema = z.object({
  type: z.string().max(80),
  data: z.object({
    email_id: z.string().max(120).optional(),
    tags: tagsSchema.optional(),
    bounce: z.object({ type: z.string().max(80).optional(), subType: z.string().max(80).optional() }).passthrough().optional()
  }).passthrough()
}).passthrough();

export type EmailEventOutcome = "bounced" | "complained" | "ignored";

export async function applyEmailEvent(db: D1Database, payload: unknown): Promise<EmailEventOutcome> {
  const event = eventSchema.safeParse(payload);
  if (!event.success) return "ignored";
  const { type, data } = event.data;
  const notificationId = data.tags?.[NOTICE_TAG];
  if (!notificationId || !/^[0-9a-f-]{36}$/i.test(notificationId)) return "ignored";
  // What's logged: the notice, Resend's email ID, and the bounce type. Never the address or the bounce message.
  const log = (level: "warn" | "info", name: string, extra: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ level, event: name, notificationId, emailId: data.email_id, ...extra }));
  if (type === "email.bounced") {
    await db.prepare("UPDATE notifications SET email_status = 'failed' WHERE notification_id = ? AND email_status = 'sent'").bind(notificationId).run();
    log("warn", "notifications.email.bounced", { bounceType: data.bounce?.type, bounceSubType: data.bounce?.subType });
    return "bounced";
  }
  if (type === "email.complained") {
    log("warn", "notifications.email.complained");
    return "complained";
  }
  return "ignored";
}
