# Aurel Global Waitlist and Public Landing Design

Date: 2026-09-23
Status: Proposed for written-spec review

## Purpose and boundary

Make the first visit explain Aurel plainly, show the product honestly, and offer one clear next step: **Join waitlist**. The waitlist is global in reach, not a claim that the product is available in every country. It collects an email address only. A country inferred from the request's IP is a fallible backend hint, never an application question or proof of eligibility.

This replaces the pre-launch Portugal-focused private-access application. There are no production application records to migrate or preserve. Remove the unused public `/apply` and `/tour` routes and their application/walkthrough components, rather than carrying redirects or legacy compatibility code. Keep the separate authenticated invitation and country-eligibility controls. The work covers the landing page, `/waitlist`, supporting documentation/copy/claims, and the public-facing design tokens/components needed for consistency. It does not launch banking, cards, rewards, wider asset execution, or automated onboarding.

## Experience direction

Use the page rhythm of the [Grok Bot landing page](https://x.ai/bot), not its identity: compact navigation, a direct hero with one primary CTA, credible product visual, a few focused feature chapters, FAQ, closing CTA, and footer. Aurel owns its color, type, screenshots, and words. The result should feel like a dependable tool: warm light canvas, dark interface previews, restrained green accent, generous but not theatrical spacing, clear borders and hierarchy. Mobile is a first-class layout, not a scaled desktop page.

No stock-finance imagery, fictional customer balances, invented returns, glowing gradients, decorative cards without information, scroll-jacking, or animation libraries added for a single effect. Use the existing stack and native controls where practical. Outside the successful signup celebration, motion is limited to a brief product-preview entrance and normal interaction feedback.

## Public information architecture

1. **Navigation:** Aurel mark; Product, FAQ, Docs; Join waitlist. On narrow screens use a simple accessible menu or a compact set of links, whichever fits without hiding the primary action.
2. **Hero:** one short, factual proposition about seeing and using supported digital assets in one place, a sentence about customer-approved wallet actions, the Join waitlist CTA, and a real or clearly illustrative product UI preview. Avoid performance figures and implied live services.
3. **Product view:** show the current wallet/portfolio experience with labels reflecting actual data sources and supported networks. Screenshots or code-native mockups must be checked against the product before publication and marked illustrative if populated with sample data.
4. **Current capabilities:** two concise feature sections: supported balances/positions and deliberate review/approval before supported transfers. A route-discovery preview may be shown only as discovery/review, with execution paused or unavailable stated where relevant. Link to current product documentation for details.
5. **What is next:** a visibly separate, plainly labeled section for membership benefits/rewards and any other planned provider-dependent capabilities. Describe direction, not entitlements, dates, yield, guaranteed access, or availability.
6. **Docs bridge:** one short section linking to product status, security/control explanations, and getting started. No duplicate mini-documentation on the landing page.
7. **FAQ:** native expandable questions with useful answers: What is Aurel now? Is joining the waitlist free? Where is it available? Does joining guarantee access? Who approves transactions? Are rewards live? What happens to my email? Exact answers must match product status and privacy documents.
8. **Closing CTA and footer:** repeat Join waitlist. The footer carries the Aurel mark and a short, factual descriptor; four grouped columns for Product (landing features, waitlist, sign in), Resources (documentation, product status, getting started), Safety (security model, account controls, reporting an issue), and Legal (terms, privacy, risk disclosure, complaints), using existing destinations only. End with the current-year copyright, availability note, and existing theme control. On mobile, groups stack in a clear reading order. No competing “Apply for access” path, placeholder company pages, or links into authenticated areas presented as public documentation.

The landing page itself is the product introduction; no separate Tour exists. Delete `/tour` and `/apply`, remove their navigation and CTA references, and point active campaign/referral links directly at `/waitlist`. Header, footer, metadata, Open Graph copy, and relevant docs should use the same promise and destination. A removed pre-launch URL may return 404; do not add redirect maintenance solely for it. Existing authenticated invitation and account routes remain separate.

## Waitlist interaction

The canonical `/waitlist` page contains one required email field, a clear submit button, a short statement about waitlist-related contact and privacy, and links to the current privacy notice. Do not ask for country, phone, survey answers, marketing opt-in, or wallet connection. Native email input validation is augmented with server validation; the server remains authoritative. A successful submission and an already-registered address produce the same neutral confirmation: “You're on the waitlist.” Do not reveal whether an address already existed, display a queue position, promise an invitation, or imply product access. Preserve the page's campaign context using a bounded allowlist of attribution fields.

On that successful response, play one brief confetti burst across the **visible viewport**, including both sides of the page, then remove its particles. This is a rare, explicit delight moment, not ambient page motion: it fires once per successful form submission, never on loading or error, never intercepts clicks or focus, and does not obscure the confirmation. A small fixed, `pointer-events: none`, `aria-hidden` overlay with CSS transform/opacity animation is sufficient; do not install a confetti package. Keep particle count bounded and performance reasonable on mobile. For `prefers-reduced-motion: reduce`, omit moving particles and retain the same visible and announced success message. The message, not confetti, communicates success to assistive technology.

The current three-step `growth_applications` model asks for fields this form will not collect. Replace the pre-launch application submission, schema, application-only operations, tests, and docs with a small waitlist model; do not add a parallel compatibility layer or data migration for nonexistent production records. Retain unrelated beta invite/security tables and any shared growth helpers that still serve the waitlist. The write must be idempotent on normalized email, with an HMAC lookup key and encrypted email using the existing growth crypto pattern; avoid plaintext email in logs and analytics. Store only necessary notice version, creation/update time, status, bounded attribution, and optional geolocation country/provenance. Do not store raw IP for geolocation. Existing abuse controls (rate limiting and Turnstile if configured) apply without turning failed verification into a claim of successful signup.

The backend reads country from trusted Cloudflare request metadata (`request.cf.country` in the Worker runtime, or a header only if the deployment path explicitly establishes and trusts it). Normalize valid ISO alpha-2 values. Missing, `XX`, `T1`, malformed, local, or untrusted values become `unknown`; never fabricate a country or ask the visitor to fill one in. The field's provenance must say IP geolocation and be replaceable by later verified information. Cloudflare explicitly describes geolocation as approximate, so this value must not determine regulated access. At invitation and activation, the existing eligibility checks and actual country evidence still apply; global waitlist signup does not broaden the present country gates.

There must be a minimal operator-only path to count and review waitlist entries and deliberately issue an invite, without exposing decrypted email to general logs or public APIs. Remove the application-specific qualification queue, survey/funnel metrics, and data paths rather than adapting them to a single-field form. Invitation is a separate, operator-controlled transition that rechecks eligibility and uses an actually configured delivery channel; a local/test mail adapter is not proof that confirmations or invites are emailed. Before public launch, add a verified unsubscribe/deletion request path and align the privacy notice with waitlist purpose, retention, geolocation, and contact behavior. If email delivery and rights handling are not operational, the production submit path must remain gated rather than claiming a fully working waitlist.

## Copy and claims

Copy is short, specific, and human. Name only capabilities documented as live: Privy authentication, customer-controlled embedded or linked wallets, supported Base asset and Aave reads, and limited direct Base transfers where applicable. Describe LI.FI route discovery/review as such, not completed swaps. Keep rewards and membership benefits explicitly planned/provider-dependent. Avoid “bank account,” “insured,” “earn,” “any asset,” “instant access,” “available worldwide,” numerical APY/portfolio claims, and unsupported security superlatives. “Global waitlist” means anyone may register interest; it is not product availability.

Update the marketing claim register and content register for the new global audience before publishing. Review every public screenshot, FAQ, metadata string, and CTA against current product status and prohibited-claims checks. The humanizer skill informs sentence-level editing, but it does not override factual or legal review; short UI labels remain conventional.

## Design-system and code boundaries

Consolidate the public-facing palette, type scale, spacing, button, focus, form, preview, and section patterns into a small set of shared tokens/components. Avoid a new general-purpose UI framework, duplicated page-specific overrides, or a wholesale redesign of the authenticated app. Keep semantic HTML, visible focus, adequate contrast, keyboard-operable FAQ/menu, useful alt text, and reduced-motion behavior. Existing Aurel identity can evolve toward the chosen light/dark treatment without losing continuity.

Use minimal React state: only the menu, waitlist submission, and one-shot celebration need it; native `<details>` suits FAQ disclosure unless testing proves it insufficient. Keep server responsibilities (validation, persistence, geo, abuse) out of presentation components. Reuse existing security and growth helpers where their semantics match; delete application-only code instead of bending it to represent an email-only waitlist.

## Verification and release

- Test email validation, duplicate neutrality, idempotency, failure/retry behavior, missing database/configuration, rate limits, bot verification, encrypted storage, and no PII leakage.
- Test trusted, missing, unknown, and spoofed country values. Verify waitlist admission stays independent of invite/product eligibility.
- Check landing, `/waitlist`, removed-route links, campaign links, metadata, grouped footer, documentation, and privacy/data-rights paths at 320px, 768px, 1024px, and 1440px.
- Check keyboard navigation, form error/success announcement, FAQ disclosure, contrast, and reduced-motion behavior. Verify that confetti spans the viewport, is one-shot, blocks no interaction, and does not run after a failed submission. Verify real browser behavior rather than screenshots alone.
- Run unit, route, lint/type, build, growth e2e, and claims checks relevant to changed packages. Manually review all illustrative UI and prose against current product status.
- Deploy only after migration, operational contact/deletion path, consent/privacy review, marketing claim approval, and a production smoke test. No production deployment is implied by merging this branch.

## References and constraints

- [Grok Bot page](https://x.ai/bot) is a structural reference, not a license to copy assets or claims.
- [Cloudflare request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/) documents the Worker country field; [Cloudflare IP geolocation](https://developers.cloudflare.com/network/ip-geolocation/) notes that it is approximate.
- `apps/docs/src/content/docs/getting-started/status.md` and `apps/docs/src/content/docs/product/membership-and-benefits.md` are the current product truth sources until implementation verifies newer behavior.
- The pre-launch application flow and its records are removable. The authenticated invitation gate and country controls remain separate from waitlist registration.
