---
title: Cloudflare edge-security activation
description: Production hostname, Access, WAF, rate-limit, API Shield, logging, and rollout activation.
---

The application-level controls are already active. The settings below require the final custom hostname, operator identity policy, alert destination and plan capabilities. Record screenshots or exported configuration in the launch evidence register after activation.

## Custom hostnames

- Product: `app.<approved-domain>` → `aurel-financial-os`
- Documentation: `docs.<approved-domain>` → `aurel-docs`
- Operations: `ops.<approved-domain>` → `aurel-ops`, behind Cloudflare Access (below)
- Aura has no status page; announce incidents through the customer communication templates.
- Update Privy allowed origins, Intercom's allowed domains, CSP, OpenAPI servers, documentation links and production smoke target together. The CSP (`apps/web/next.config.ts`) allows `https://js.stripe.com` in `script-src` and `https://js.stripe.com https://*.stripe.com` in `frame-src` for Stripe's card details and Add to Wallet frames; keep them when tightening it.

## Cloudflare Access

Operators use the operations app, a separate Worker (`aurel-ops` in production, `aura-dev-ops` in dev). The customer app has no operations pages. Cloudflare Access is the only operator sign-in.

1. Create a self-hosted Access application for the operations Worker's hostname (on dev, its workers.dev route: Workers & Pages → `aura-dev-ops` → Settings → Domains & Routes). In production, give it its own hostname, such as `ops.<domain>`.
2. Allow only named operator emails, with MFA. Deny everyone else. Don't allow service tokens; the web app refuses them anyway.
3. Copy the application's AUD tag and the team domain (`https://<team>.cloudflareaccess.com`) into the web app's `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` variables for that environment, and deploy the web Worker. They aren't secrets.
4. Sign in to the operations app and check it shows your email. Check that a request to the web app's `/api/ops/*` without a token, or with a made-up one, is refused (the deployment smoke does this).

The web app doesn't rely on the edge alone. Every `/api/ops/*` route verifies the `Cf-Access-Jwt-Assertion` token itself (`requireOperator` in `apps/web/src/lib/auth/access.ts`): the signature against the team's published keys, the issuer, the audience, expiry, and a person's email. So a request that reaches `/api/ops/*` on the web app's own hostname, not through the operations Worker, is refused unless it carries a valid token for the operations application. While either variable is empty, every operator request is refused.

## WAF rules

Start in log or managed-challenge mode, inspect representative traffic, then enforce:

1. Managed ruleset for the product hostname.
2. Block non-HTTPS and unexpected methods where the API contract is explicit.
3. Managed Challenge for suspicious traffic to `/api/auth/*`, `/api/support/*` and `/api/webhooks/*` while excluding validated provider source ranges only when the provider publishes stable ranges.
4. Block requests detected as API fallthrough after the OpenAPI operation inventory is complete.
5. Never bypass application authentication, webhook signatures or D1-backed abuse limits because an edge rule exists.

## Rate limits

Recommended initial edge ceilings, measured before enforcement:

| Path | Ceiling | Action |
|---|---:|---|
| `/api/support/cases` POST | 10 per IP / hour | Managed Challenge; application also enforces 5/customer/hour |
| `/api/support/assistant` POST | 30 per customer/IP / minute | Block excess; application enforces its customer limit |
| `/api/swap/quote` POST | 60 per customer/IP / 10 minutes | Block excess; application enforces 20/customer/10 minutes |
| `/api/webhooks/bridge`, `/api/webhooks/privy`, `/api/webhooks/stripe` POST | Provider events (Bridge RSA, Privy Svix, Stripe HMAC-SHA256) | Rate high enough for retry bursts; never replace signature verification |
| `/api/ops/*` | Low operator volume | Access policy first, then strict per-identity/IP limit |

Revisit thresholds using observed traffic distributions. A rate-limit event is not evidence that the customer is malicious.

## API Shield

1. Update `infra/cloudflare/aurel-api.openapi.yaml` with the custom server hostname.
2. Upload it as an OpenAPI 3.0 schema and add its operations to Web Assets.
3. Enable validation detection without mitigation.
4. Send representative valid and invalid customer traffic.
5. Review `cf.schema_validation.uploaded.violated` samples and correct the schema or clients.
6. Enforce violations with a scoped WAF custom rule only after false positives are resolved.

Schema upload enables detection; it does not enable blocking by itself.

## Logs and alerts

Workers Logs and traces are enabled. Before launch, configure OpenTelemetry export or Workers Trace Events Logpush to the approved destination with redaction and retention controls. Alert on:

- authentication and authorization failure spikes;
- transaction preparation or receipt-check errors;
- dependency checks becoming unavailable;
- dead-letter messages and stuck provider events;
- Critical/High operational issues;
- unusual support and sign-up volume.

The destination, receiver, quiet hours, escalation and test date belong in [launch readiness](../overview/launch-readiness.md).

## Evidence to retain

Hostname and TLS status, Access application and policy IDs, WAF/rate rule IDs and modes, API Shield schema ID, log export job/destination, alert delivery test, Privy/Turnstile hostname configuration, production smoke output, Worker version IDs and reviewer/date.
