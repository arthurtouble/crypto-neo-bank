import { env } from "cloudflare:workers";
import { preferencesUpdateSchema, readPreferences, updatePreferences } from "@aurel/provider-projections";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const GET = route("preferences.get", { unavailable: "preferences_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  return Response.json({ preferences: await readPreferences(env.PROJECTION_DB, subject.subjectReference), traceId });
});

export const PATCH = route("preferences.patch", { invalid: "invalid_preferences", unavailable: "preferences_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "preferences_update", subject: subject.subjectReference, limit: 30, windowSeconds: 600 });
  const input = preferencesUpdateSchema.parse(await request.json());
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  return Response.json({ preferences: await updatePreferences(env.PROJECTION_DB, subject.subjectReference, input), traceId });
});
