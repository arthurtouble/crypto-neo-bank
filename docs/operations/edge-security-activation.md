---
title: Cloudflare edge-security activation
description: Production hostname, Access, WAF, rate-limit, API Shield, logging, and rollout activation.
---

Application-level controls are already active. These settings need the final custom hostname, operator identity policy, alert destination, and plan capabilities. After activation, record screenshots or exported configuration in the launch evidence register.

## Custom hostnames

- Product: `app.<approved-domain>` → `aurel-financial-os`
- Documentation: `docs.<approved-domain>` → `aurel-docs`
- Operations: `ops.<approved-domain>` → `aurel-ops`, behind Cloudflare Access (below)
- Aura has no status page; announce incidents through the customer communication templates.
- Update Privy allowed origins, Intercom's allowed domains, CSP, OpenAPI servers, documentation links, and the production smoke target together. The CSP (`apps/web/src/lib/http/security-headers.ts`, mirrored in `public/_headers`) allows `https://js.stripe.com` in `script-src` and `https://js.stripe.com https://*.stripe.com` in `frame-src` for Stripe's card details and Add to Wallet frames, and `https://telegram.org` in `script-src` and `https://oauth.telegram.org` in `frame-src` for Telegram sign-in through Privy; keep them when tightening it.

## Cloudflare Access

Cloudflare Access is the only operator sign-in, in front of the operations app Worker (`aurel-ops` in production, `aura-dev-ops` in dev). The customer app has no operations pages.

1. Create a self-hosted Access application for the operations Worker's hostname (on dev, its workers.dev route: Workers & Pages → `aura-dev-ops` → Settings → Domains & Routes). In production, give it its own hostname, such as `ops.<domain>`.
2. Allow only named operator emails, with MFA. Deny everyone else. Don't allow service tokens; the web app refuses them anyway.
3. Copy the application's AUD tag and the team domain (`https://<team>.cloudflareaccess.com`) into the web app's `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` variables (not secrets) for that environment, and deploy the web Worker.
4. Sign in to the operations app and check it shows your email. Check that a request to the web app's `/api/ops/*` without a token, or with a made-up one, is refused (the deployment smoke does this).

The operations Worker also checks every write itself: it must carry `Sec-Fetch-Site: same-origin` (or an `Origin` equal to the app's own) and, with a body, `Content-Type: application/json`. It runs first for every path (`run_worker_first` in `apps/ops/wrangler.jsonc`) so the security headers are on the page and its files too. Scripts that call `/api/*` on the ops hostname outside a browser must send one of those headers.

The web app doesn't rely on the edge alone: every `/api/ops/*` route verifies the Access token itself, including requests to the web app's own hostname ([how](../architecture/architecture.md#operations-app)). While either variable is empty, every operator request is refused.

## WAF rules

Start in log or managed-challenge mode, inspect representative traffic, then enforce:

1. Managed ruleset for the product hostname.
2. Block non-HTTPS and unexpected methods where the API contract is explicit.
3. Managed Challenge for suspicious traffic to `/api/auth/*`, `/api/support/*`, and `/api/webhooks/*`. Exclude provider source ranges only when the provider publishes stable, validated ranges.
4. Block requests detected as API fallthrough after the OpenAPI operation inventory is complete.
5. Never bypass application authentication, webhook signatures, or D1-backed abuse limits because an edge rule exists.

## Rate limits

Initial edge ceilings, measured before enforcement:

| Path | Ceiling | Action |
|---|---:|---|
| `/api/routes/quote` GET | 60 per customer/IP / minute | Block excess; application enforces 30/customer/minute |
| `/api/actions` POST | 60 per customer/IP / minute | Block excess; application enforces 30/customer/minute |
| `/api/webhooks/bridge`, `/api/webhooks/privy`, `/api/webhooks/stripe` POST | Provider events (Bridge RSA, Privy Svix, Stripe HMAC-SHA256) | Rate high enough for retry bursts; never replace signature verification |
| `/api/ops/*` | Low operator volume | Access policy first, then strict per-identity/IP limit |

Revisit thresholds against observed traffic. A rate-limit event is not evidence that the customer is malicious.

## API Shield

1. Update `infra/cloudflare/aurel-api.openapi.yaml` with the custom server hostname.
2. Upload it as an OpenAPI 3.0 schema and add its operations to Web Assets.
3. Enable validation detection without mitigation.
4. Send representative valid and invalid customer traffic.
5. Review `cf.schema_validation.uploaded.violated` samples and correct the schema or clients.
6. Enforce violations with a scoped WAF custom rule only after false positives are resolved.

Uploading the schema enables detection, not blocking.

## Logs and alerts

Workers Logs and traces are on; [monitoring and alerts](monitoring.md) lists the log events and the Cloudflare alerts to set up. Before launch, configure OpenTelemetry export or Workers Trace Events Logpush to the approved destination, with redaction and retention controls. Alert on:

- authentication and authorization failure spikes;
- transaction preparation or receipt-check errors;
- dependency checks becoming unavailable;
- dead-letter messages and stuck provider events;
- Critical/High operational issues;
- unusual support and sign-up volume.

Record the destination, receiver, quiet hours, escalation, and test date in [launch readiness](../overview/launch-readiness.md).

## Evidence to retain

Hostname and TLS status, Access application and policy IDs, WAF/rate rule IDs and modes, API Shield schema ID, log export job/destination, alert delivery test, Privy hostname configuration, production smoke output, Worker version IDs and reviewer/date.
