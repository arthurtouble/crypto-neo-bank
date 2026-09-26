import app from "vinext/server/app-router-entry";
import { recheckOpenActions } from "@/lib/actions/recheck";

/** Advance open money actions from chain evidence, so they settle even when nobody is looking at them. */
const scheduled: ExportedHandlerScheduledHandler<Cloudflare.Env> = async (controller, env, ctx) => {
  ctx.waitUntil(recheckOpenActions(env.PROJECTION_DB, new Date(controller.scheduledTime)).then(
    (summary) => console.log(JSON.stringify({ level: "info", event: "actions.recheck.completed", scheduledTime: controller.scheduledTime, ...summary })),
    (error: unknown) => console.error(JSON.stringify({ level: "error", event: "actions.recheck.failed", scheduledTime: controller.scheduledTime,
      message: error instanceof Error ? error.message : "unknown" }))
  ));
};

/** The web Worker: vinext serves every request; the cron runs `scheduled`. */
const worker = { ...app, scheduled };
export default worker;
