import { z } from "zod";

export const allGrowthEvents = ["landing_viewed","waitlist_viewed","waitlist_joined","invite_issued","invite_redeemed","onboarding_started","account_secured","wallet_ready","live_balance_viewed","first_value_completed","retained_30d","referral_unlocked","referral_issued","referral_redeemed"] as const;
export const publicGrowthEvents = ["landing_viewed", "waitlist_viewed"] as const;

const publicProperties = z
  .object({
    cta: z.string().max(100).optional(),
    step: z.union([z.string().max(100), z.number().finite()]).optional(),
    variant: z.string().max(100).optional(),
    viewport: z.string().max(100).optional()
  })
  .strict()
  .default({});
export const publicEventSchema = z.object({
  eventName: z.enum(publicGrowthEvents),
  anonymousSessionId: z.string().uuid(),
  surface: z.string().trim().max(200).refine((value) => value.startsWith("/") && !value.startsWith("//"), "Surface must be a same-origin path."),
  campaignId: z.string().uuid().nullable().optional(),
  contentId: z.string().regex(/^[a-z0-9-]{2,120}$/).nullable().optional(),
  properties: publicProperties
}).strict();
export const publicEventsBatchSchema = z.object({ events: z.array(publicEventSchema).min(1).max(20) }).strict();

export async function recordPublicEvents(database: D1Database, events: z.infer<typeof publicEventSchema>[], now = new Date()) {
  const timestamp = now.toISOString();
  const statements = [];
  for (const event of events) {
    let campaignId: string | null = null; let contentId: string | null = null;
    if (event.campaignId) campaignId = await database.prepare("SELECT campaign_id FROM growth_campaigns WHERE campaign_id = ? AND status = 'active'").bind(event.campaignId).first<string>("campaign_id");
    if (event.contentId) contentId = event.contentId;
    statements.push(database.prepare(`INSERT INTO growth_events (event_id, subject_reference, anonymous_session_id, event_name, surface, campaign_id, content_id, properties_json, occurred_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), event.anonymousSessionId, event.eventName, event.surface, campaignId, contentId, JSON.stringify(event.properties), timestamp));
  }
  await database.batch(statements);
}

export const RETENTION_RULE_VERSION = "retained-30d-v1";
export function retentionDecision(input: { activationAt: Date; returnedAt?: Date; hasMeaningfulEvent: boolean; now: Date }) {
  const ageDays = (input.now.getTime() - input.activationAt.getTime()) / 86_400_000;
  if (ageDays < 30) return "not_due" as const;
  if (!input.returnedAt || !input.hasMeaningfulEvent) return "not_retained" as const;
  const returnDays = (input.returnedAt.getTime() - input.activationAt.getTime()) / 86_400_000;
  return returnDays >= 21 && returnDays <= 37 ? "retained" as const : "not_retained" as const;
}
