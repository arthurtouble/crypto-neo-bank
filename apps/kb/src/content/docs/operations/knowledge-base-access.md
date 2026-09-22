---
title: Knowledge-base access and deployment
description: How to build, deploy, protect, validate, and roll back the internal knowledge base.
---

## Security boundary

The knowledge base is a static Astro/Starlight site deployed with Cloudflare Workers Static Assets. Cloudflare Access is the authorization boundary. The `robots.txt` and `noindex` metadata reduce accidental indexing but are not access controls.

Do not publish or circulate the Workers hostname until Access is attached and tested.

## Local use

```bash
pnpm kb:dev
pnpm kb:build
```

Local development contains internal material. Do not expose the development server to a public network.

## Production prerequisites

1. Choose a dedicated internal hostname in the Cloudflare zone.
2. Create a self-hosted Cloudflare Access application for that exact hostname.
3. Attach a reusable default-deny policy and a narrowly scoped Allow policy for the approved identity group or emails.
4. Set an appropriate session duration and require the organization's configured identity provider and MFA policy.
5. Keep the direct Workers hostname inaccessible to unintended users. Prefer a production custom domain whose requests are covered by Access.
6. Confirm that Access authentication logs and an incident owner are available.

Identity-provider groups must come from verified IdP claims or SCIM. Do not invent a group selector that is not present in the identity assertion.

## Deploy

```bash
pnpm kb:deploy
```

Deployment does not prove that Access is configured. Treat deployment and access activation as separate gates.

## Acceptance checks

- An approved employee can authenticate and use navigation and search.
- An unapproved identity receives an Access denial and no page content.
- A signed-out private browser receives an Access challenge, not the site.
- The custom hostname is protected and the direct Workers hostname is not an unprotected bypass.
- Search results do not expose page content outside an authenticated session.
- `robots.txt` disallows crawling and every page carries `noindex`, `nofollow`, `noarchive`, and `nosnippet`.
- Access authentication events are visible to the operator.

## Content review

Before deployment, search for secrets, tokens, private keys, customer data, internal credentials, and provider-confidential attachments. The knowledge base may contain sensitive operating context, but it must not become a secret store.

## Rollback

Roll back the Worker asset deployment using the normal Cloudflare version/deployment process. If content exposure is suspected, disable the hostname or tighten the Access policy first; a code rollback does not revoke a copied document.
