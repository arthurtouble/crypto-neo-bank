import app from "vinext/server/app-router-entry";
import { recheckOpenActions } from "@/lib/actions/recheck";
import { deliverPending } from "@/lib/notifications/deliver";
import { scanIncoming } from "@/lib/notifications/incoming";

const log = (event: string, scheduledTime: number) => [
  (summary: unknown) => console.log(JSON.stringify({ level: "info", event: `${event}.completed`, scheduledTime, summary })),
  (error: unknown) => console.error(JSON.stringify({ level: "error", event: `${event}.failed`, scheduledTime, message: error instanceof Error ? error.message : "unknown" }))
] as const;

/**
 * Every 2 minutes: advance open money actions from chain evidence, so they
 * settle even when nobody is looking at them; check watched accounts for
 * money received; then deliver pending notices by email and push.
 */
const scheduled: ExportedHandlerScheduledHandler<Cloudflare.Env> = async (controller, env, ctx) => {
  const now = new Date(controller.scheduledTime);
  ctx.waitUntil(recheckOpenActions(env.PROJECTION_DB, now).then(...log("actions.recheck", controller.scheduledTime)));
  ctx.waitUntil((async () => ({ notified: (await scanIncoming(env.PROJECTION_DB, { now, limit: 20 })).length,
    delivered: await deliverPending(env.PROJECTION_DB, { limit: 50 }) }))().then(...log("notifications.run", controller.scheduledTime)));
};

/** The web Worker: vinext serves every request; the cron runs `scheduled`. */
const worker = { ...app, scheduled };
export default worker;
