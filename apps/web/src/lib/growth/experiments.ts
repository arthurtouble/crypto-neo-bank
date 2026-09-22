import { z } from "zod";

export const allowedExperimentMetrics = ["application_started_rate", "application_submitted_rate", "tour_to_application_rate", "invite_acceptance_rate"] as const;
export const experimentSchema = z.object({ name: z.string().trim().min(3).max(100), hypothesis: z.string().trim().min(10).max(500), primaryMetric: z.enum(allowedExperimentMetrics), variants: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).min(2).max(5), guardrails: z.array(z.enum(["support_rate","application_error_rate","withdrawal_rate"])).max(3), status: z.enum(["draft","running","stopped","completed"]).default("draft"), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).strict();

export async function assignExperiment(database: D1Database, experimentId: string, assignmentKey: string, variants: string[]) {
  const existing = await database.prepare("SELECT variant FROM growth_experiment_assignments WHERE experiment_id = ? AND assignment_key = ?").bind(experimentId, assignmentKey).first<string>("variant");
  if (existing) return existing;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${experimentId}:${assignmentKey}`)));
  const variant = variants[digest[0] % variants.length];
  await database.prepare("INSERT OR IGNORE INTO growth_experiment_assignments (experiment_id, assignment_key, variant, assigned_at) VALUES (?, ?, ?, ?)").bind(experimentId, assignmentKey, variant, new Date().toISOString()).run();
  return await database.prepare("SELECT variant FROM growth_experiment_assignments WHERE experiment_id = ? AND assignment_key = ?").bind(experimentId, assignmentKey).first<string>("variant") ?? variant;
}
