---
title: Monitoring and alerts
description: What the Workers log, how to find a failure, and the alerts to set up in Cloudflare before launch.
---

Aura monitors with Cloudflare's own tools: Workers Logs, Workers Observability, and Cloudflare notifications. No separate error-tracking vendor (owner's decision, 30 September 2026).

## What the Workers log

Workers Logs are on for every Worker in both environments, keeping every request (`head_sampling_rate: 1`). Traces are sampled at 1% for the web and events Workers. Settings are in each `wrangler.jsonc`.

Each log line the code writes is one JSON object with:

- `level`: `info`, `warn`, `error`, or `critical`;
- `event`: a dotted name, such as `actions.recheck.failed`;
- a `traceId` for API requests, also in the customer's error response, so support can find the exact request;
- only what's needed to find the cause: IDs, status, path, and an error message. Never secrets, tokens, bank account numbers, or request bodies. Page paths are logged without the query string.

| Event | Level | Where | What it means |
| --- | --- | --- | --- |
| `<route>.failed` | error | web API (`lib/http/route.ts`) | An API handler failed unexpectedly. The customer got the route's `…_unavailable` error with the same `traceId`. |
| `request.failed` | error | web Worker (`worker/index.ts`) | A page answered 5xx, or a request threw before any handler caught it. |
| `actions.recheck.failed`, `bank.payouts.refresh.failed`, `notifications.run.failed` | error | web cron, every 2 minutes | A scheduled job failed. Open money actions stop settling until it works again. |
| `notifications.email.bounced` | warn | web API (`/api/webhooks/resend`) | Resend reported a notice email bounced; the notice's email is marked failed. The in-app notice is unaffected. |
| `notifications.email.complained` | warn | web API | Someone marked a notice email as spam. |
| `edge.place_blocked` | info | web Worker | A request from a sanctioned place was refused. Useful for volume, not an alert. |
| `webhook.signature_rejected` | warn | web API | A provider webhook failed its signature check. |
| `provider_event.processing_failed` | error, then critical from the 5th attempt | events Worker | A provider event couldn't be applied and will be retried. |
| `provider_event.dead_letter` | critical | events Worker | A provider event gave up and needs an operator. It is also recorded as a critical operational issue. |
| `operations.reconciliation.failed` | error | events Worker cron | The reconciliation and dependency check, every 5 minutes, failed. |

## Finding a failure

1. From a customer's error, take the `traceId`.
2. In the Cloudflare dashboard, open **Workers & Pages → the Worker → Observability** (`aura-dev` for dev, `aurel-financial-os` for production).
3. Search for the trace ID, or filter on `event` or `level`.

For a live view, `pnpm --filter @aurel/web exec wrangler tail --env dev --format json` streams the dev web Worker's logs. Leave out `--env dev` only when you're working on production with permission.

## Alerts to set up before launch

These are Cloudflare account settings, not code, and are on the [launch readiness](../overview/launch-readiness.md) checklist. Set them up on dev, send a test alert, then repeat for production.

1. **Error spikes.** In Workers Observability, save a query per Worker filtered to `level` `error` or `critical`, and alert on it through **Notifications** (or the Observability alert option, if available) for more than 5 errors in 5 minutes. Send it to the incident owner's email and the on-call channel from the [incident response plan](incident-response-plan.md).
2. **Dead letters.** Alert on any `provider_event.dead_letter`; one is enough to act on.
3. **Stopped cron.** Alert when `actions.recheck.completed` hasn't been logged for 10 minutes, if the account supports absence checks; otherwise the daily operating review in [launch controls](launch-controls.md) covers it.
4. **Health.** A Cloudflare health check, or any uptime monitor the owner approves, on `/api/health` every minute. It returns 503 when D1 is unreachable.
5. **Usage.** Cloudflare billing and usage notifications for Workers, D1, and Queues, to catch a traffic spike or runaway loop before a limit.

Record each alert's name, receiver, and test date in the launch evidence, as [edge security activation](edge-security-activation.md#evidence-to-retain) describes.
