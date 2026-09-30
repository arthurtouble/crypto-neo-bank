import app from "vinext/server/app-router-entry";
import { recheckOpenActions } from "@/lib/actions/recheck";
import { refreshBankPayouts } from "@/lib/money/bank-activity";
import { blockedPlace, isGatedPath, requestPlace } from "@/lib/legal/places";
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
  ctx.waitUntil(refreshBankPayouts(env.PROJECTION_DB, { now, limit: 20 }).then(...log("bank.payouts.refresh", controller.scheduledTime)));
  ctx.waitUntil((async () => ({ notified: (await scanIncoming(env.PROJECTION_DB, { now, limit: 20 })).length,
    delivered: await deliverPending(env.PROJECTION_DB, { limit: 50 }) }))().then(...log("notifications.run", controller.scheduledTime)));
};

/**
 * Refuse the app, the API, and payment pages to requests from a sanctioned place (lib/legal/places.ts), with 451.
 * Pages get the "not available where you are" page; the API gets a JSON error. Everything else goes to vinext.
 */
// vinext types its env as the assets binding alone; the Worker passes the whole env through, as `{ ...app }` would.
const serve = (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => app.fetch(request, env as Parameters<typeof app.fetch>[1], ctx);

const fetch: ExportedHandlerFetchHandler<Cloudflare.Env> = async (request, env, ctx) => {
  const url = new URL(request.url);
  const { country, region } = requestPlace(request);
  const place = isGatedPath(url.pathname) ? blockedPlace(country, region) : undefined;
  if (!place) return serve(request, env, ctx);
  console.log(JSON.stringify({ level: "info", event: "edge.place_blocked", country, region, path: url.pathname }));
  const headers = { "Cache-Control": "no-store", Vary: "CF-IPCountry" };
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "place_unavailable", message: "Aura isn't available where you are." }, { status: 451, headers });
  }
  const page = await serve(new Request(new URL("/unavailable", url), { headers: request.headers }), env, ctx);
  const blocked = new Response(page.body, { status: 451, headers: page.headers });
  for (const [name, value] of Object.entries(headers)) blocked.headers.set(name, value);
  return blocked;
};

/** The web Worker: vinext serves every request that passes the place check; the cron runs `scheduled`. */
const worker = { ...app, fetch, scheduled };
export default worker;
