# Global Waitlist Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a restrained, accessible Aurel landing page and email-only global waitlist, with accurate product copy, a one-shot success celebration, and no public application or Tour flow.

**Architecture:** Keep `/` server-rendered and use a focused client form at `/waitlist`. A new waitlist persistence path reuses the existing encryption, abuse, and invitation primitives, but replaces application-only data and operator flows because there is no production application data to migrate. IP country is an approximate server-side hint, never access authority.

**Tech Stack:** React/Next-compatible vinext, TypeScript, CSS, Cloudflare Workers/D1, Zod, Vitest, Playwright/axe, pnpm. No new UI or animation package.

**Spec:** `docs/superpowers/specs/2026-09-23-global-waitlist-landing-design.md`

## Global Constraints

- Public form fields: email only. No country, survey, phone, marketing opt-in, or wallet connection.
- Canonical route and CTA: `/waitlist`, “Join waitlist”. Remove `/apply` and `/tour`; no redirects or data migration for these pre-launch flows.
- Geolocation: trusted Cloudflare country metadata only; missing, `XX`, `T1`, malformed, and untrusted values become unknown. Never authorize access from IP country.
- Show only documented live capabilities; label rewards/membership as planned. No invented balances, yield, availability, or guaranteed invitation.
- Successful submission and duplicate submission share one public response. Store encrypted email plus keyed lookup, never plaintext in logs.
- Confetti: one viewport-wide success burst, nonblocking and hidden from assistive technology; moving particles omitted under reduced motion. Success text is the accessible confirmation.
- Use existing tokens/components where possible; native FAQ disclosure; no new frontend dependency. All public layouts work at 320, 768, 1024, and 1440 px.
- Do not broaden the authenticated beta invitation country gate or deploy production code from this branch.

## Review Focus

1. A forged country header must not influence waitlist country or invite eligibility; Task 1 pins country provenance and Task 3 pins invitation checks.
2. A duplicate email with different case/spacing must not create a second record or reveal a different public outcome; Task 1 and Task 2 test it.
3. A failed/paused submission must not trigger a success message or confetti; Task 2 and Task 4 test it.
4. A keyboard or reduced-motion visitor must receive the same confirmation without inaccessible moving content; Task 4 and Task 7 test it.
5. A public visitor must never reach an application/Tour CTA or a dead footer link; Task 5 and Task 7 test it.

## File and interface map

- `apps/web/src/lib/growth/waitlist.ts`: Zod input, country normalization, idempotent encrypted persistence, and list/detail helpers. `waitlistSchema` produces `WaitlistInput = { email: string; privacyNoticeVersion: string; attribution?: { utmSource?: string; utmCampaign?: string; partnerCode?: string; referralCode?: string }; turnstileToken?: string }`; each attribution value is bounded to 120 characters and validated against its expected slug/code pattern. `persistWaitlist(database, input, countryHint)` returns `{ waitlistId, created }`.
- `apps/web/src/app/api/growth/waitlist/route.ts`: public POST, configuration gate, server-owned geolocation, Turnstile, rate limit, and neutral `202` response.
- `infra/d1/migrations/0008_growth_distribution.sql`: add the waitlist table first, then remove pre-launch application-only schema after its callers are gone. Fresh development databases apply the rewritten migration; do not delete a user's existing local DB as an implicit step.
- `apps/web/src/app/api/ops/growth/waitlist/**` and `apps/web/src/components/growth-operations.tsx`: minimal admin list/detail/invite flow; existing beta invite table remains authoritative.
- `apps/web/src/app/waitlist/page.tsx`, `apps/web/src/components/waitlist-form.tsx`, `apps/web/src/components/waitlist-confetti.tsx`: one-field public page, request states, and ephemeral visual celebration.
- `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`: landing, public token/component styling, metadata. Avoid a parallel CSS system; remove obsolete public-flow selectors after routes are deleted.
- `apps/docs`, `apps/kb`, `marketing`, and growth tests: make the public promise and operational instructions match the new flow.

## Task 1: Waitlist data contract and trusted geography

**Files:** Modify `infra/d1/migrations/0008_growth_distribution.sql`; create `apps/web/src/lib/growth/waitlist.ts` and `apps/web/tests/unit/growth-waitlist.test.ts`. Keep the old application table and module until Task 3 removes their callers.

**Interfaces:** Produce `waitlistSchema`, `countryFromRequest(request: Request): { countryCode: string | null; source: "cloudflare" | "unknown" }`, `persistWaitlist(database: D1Database, input: WaitlistInput, country: CountryHint): Promise<{ waitlistId: string; created: boolean }>`. Keep `normalizeEmail`, `encryptEmail`, `emailLookupHmac`, and `growthSecrets` from `growth/crypto.ts`.

- [ ] **Step 1: Write failing unit tests** for `waitlistSchema.parse({email:" Test@Example.com ",privacyNoticeVersion:"2026-09-23"})`, rejection of `countryCode`, `countryFromRequest(new Request(...))` returning unknown for a forged `CF-IPCountry` header, `XX`, and `T1`, and two `persistWaitlist` calls with ` Test@Example.com ` / `test@example.com` producing one row and `created` true/false. Use the existing D1 test mock style in `growth-applications.test.ts` and assert stored ciphertext does not contain the email.

```ts
expect(waitlistSchema.safeParse({ email: "person@example.com", privacyNoticeVersion: "2026-09-23", countryCode: "PT" }).success).toBe(false);
expect(countryFromRequest(new Request("https://aurel.test", { headers: { "CF-IPCountry": "PT" } }))).toEqual({ countryCode: null, source: "unknown" });
expect(await persistWaitlist(db, input, { countryCode: null, source: "unknown" })).toMatchObject({ created: true });
expect(await persistWaitlist(db, { ...input, email: " PERSON@example.com " }, { countryCode: "PT", source: "cloudflare" })).toMatchObject({ created: false });
```
- [ ] **Step 2: Run** `pnpm --filter @aurel/web exec vitest run tests/unit/growth-waitlist.test.ts`; expect red tests because `growth/waitlist.ts` does not exist.
- [ ] **Step 3: Implement the smallest schema and storage path.** The migration's waitlist core is:

```sql
CREATE TABLE IF NOT EXISTS growth_waitlist (
  waitlist_id TEXT PRIMARY KEY,
  email_ciphertext TEXT NOT NULL,
  email_nonce TEXT NOT NULL,
  email_lookup_hmac TEXT NOT NULL UNIQUE,
  country_hint TEXT,
  country_hint_source TEXT NOT NULL CHECK (country_hint_source IN ('cloudflare','unknown')),
  privacy_notice_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','invited','withdrawn')),
  attribution_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS growth_waitlist_status_idx ON growth_waitlist(status, created_at DESC);
```

Use `request.cf?.country` only when the Worker adapter supplies it as trusted metadata; do not read client headers as a fallback. Validate against ISO country codes, not just a two-letter regex. Normalize missing/special values to null. Use `INSERT ... ON CONFLICT(email_lookup_hmac) DO NOTHING` then look up the stable ID; do not update country or attribution on duplicates. Check the result before reporting success. Keep the pre-launch application table temporarily in this task so existing callers still compile; Task 3 removes it and the related foreign keys.
- [ ] **Step 4: Run** the focused Vitest test and a fresh-database migration test/seed from the repo's existing migration harness. Confirm the schema contains no application-only required fields and `git diff --check` passes.
- [ ] **Step 5: Commit** the data-contract files with `feat: add minimal encrypted waitlist model`.

## Task 2: Public submission API

**Files:** Create `apps/web/src/app/api/growth/waitlist/route.ts` and `apps/web/tests/unit/growth-waitlist-route.test.ts`; modify `apps/web/wrangler.jsonc` and the matching local environment examples; remove `apps/web/src/app/api/growth/applications/route.ts` after callers move.

**Interfaces:** Consume `waitlistSchema`, `countryFromRequest`, `persistWaitlist`; produce `POST /api/growth/waitlist` with `202 {received:true}` for new/duplicate, `400` bad input, `403` bot failure, `409` stale privacy version, `429` rate limit, `503` paused/missing config/storage. Never echo email/country.

- [ ] **Step 1: Write route tests** that mock D1 and Turnstile, and assert: valid and duplicate responses have identical status/body shape; missing email gets 400; disabled mode gets 503 and no write; invalid Turnstile gets 403; a missing lookup key gets 503; spoofed `CF-IPCountry: US` does not become the stored country; case-folded duplicates return the same neutral response.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web exec vitest run tests/unit/growth-waitlist-route.test.ts`; expect failure because the route is absent.
- [ ] **Step 3: Implement** the route using the existing application route's `verifyTurnstile`, `enforceRateLimit`, `abuseKey`, `env.PROJECTION_DB`, and no-store headers. Rename env values to `GROWTH_WAITLIST_MODE` (`closed|open`) and `GROWTH_PRIVACY_NOTICE_VERSION`; use action `waitlist_signup`. Compute the rate key from trusted remote IP exactly as the existing growth route does, without persisting raw IP. Log only trace ID and non-PII error code. Do not call persistence if verification, configuration, or rate limit fails.

```ts
const input = waitlistSchema.parse(await request.json());
if (input.privacyNoticeVersion !== process.env.GROWTH_PRIVACY_NOTICE_VERSION) return Response.json({ received: false }, { status: 409 });
const country = countryFromRequest(request);
await persistWaitlist(env.PROJECTION_DB, input, country);
return Response.json({ received: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
```

The actual handler must run the mode, secret, Turnstile, and rate-limit gates **before** the shown persistence lines, and translate each failure to the interface's exact status without returning stored identity or country.
- [ ] **Step 4: Run** focused tests, typecheck, and route-level request checks for 202/400/403/409/429/503. Confirm a 202 only follows a completed D1 write or proven duplicate.
- [ ] **Step 5: Commit** with `feat: accept email-only waitlist signups`.

## Task 3: Minimal operator and invitation path

**Files:** Create `apps/web/src/app/api/ops/growth/waitlist/route.ts` and `apps/web/src/app/api/ops/growth/waitlist/[waitlistId]/invite/route.ts`; modify `apps/web/src/components/growth-operations.tsx`, `apps/web/src/lib/growth/operations.ts`, `apps/web/src/lib/growth/lifecycle.ts`, `apps/web/src/lib/growth/events.ts`, `apps/web/src/lib/growth/referrals.ts`, `apps/web/src/app/api/growth/referrals/route.ts`, and related unit/e2e tests. Remove application-only ops routes (`api/ops/growth/applications/**`, `funnel`, `research`) and their orphaned code when `rg growth_applications apps/web/src` finds no live caller.

**Interfaces:** `GET /api/ops/growth/waitlist?limit=50&cursor=...` returns bounded rows; `POST /api/ops/growth/waitlist/[waitlistId]/invite` consumes `{ verifiedCountry: string, eligibilityEvidence: string }`, requires ops admin, checks `GROWTH_ALLOWED_COUNTRIES`, creates a one-use `beta_invites` code, and marks the waitlist row invited. The operator records a nonempty reference to separately checked country evidence; IP `country_hint` is displayed as approximate but is never used as `verifiedCountry`.

- [ ] **Step 1: Write failing tests** that unauthenticated list/invite requests return 401/403; no row returns 404; missing `verifiedCountry` or `eligibilityEvidence` returns 400; a disallowed country returns 409; an allowed verified country with an evidence reference creates one one-use invite; a second request returns 409; an IP hint of `PT` with verified country `US` cannot pass a PT-only gate. Add an operator UI test that the list shows email only to an authenticated admin and labels the country hint “Approximate”.
- [ ] **Step 2: Run** focused growth operations/invitation tests; expect red paths for the new routes and UI.
- [ ] **Step 3: Implement** the list using `requireOperationsAdmin`, cursor pagination, and decryption only in the protected response. Implement invite with the existing `createInviteCode`, `hashInviteCode`, audit helper, and `beta_invites` table. Link the issued invite to the waitlist ID in a small `growth_waitlist_invites` table with unique `waitlist_id` and `invite_hash`; use a D1 batch/transactional pattern so status, code hash, and audit evidence cannot diverge. Show generated code once in the admin UI; do not claim an email was sent by the local mail adapter.

```sql
CREATE TABLE IF NOT EXISTS growth_waitlist_invites (
  waitlist_id TEXT PRIMARY KEY REFERENCES growth_waitlist(waitlist_id),
  invite_hash TEXT NOT NULL UNIQUE REFERENCES beta_invites(code_hash),
  verified_country TEXT NOT NULL,
  eligibility_evidence TEXT NOT NULL,
  issued_at TEXT NOT NULL
);
```

```ts
if (!allowedCountries.includes(input.verifiedCountry)) return Response.json({ error: "country_not_enabled" }, { status: 409 });
if (!input.eligibilityEvidence.trim()) return Response.json({ error: "eligibility_evidence_required" }, { status: 400 });
```
- [ ] **Step 4: Replace application-only UI/queries and adjust shared event/referral linkage to `waitlist_id`.** Account for `growth/lifecycle.ts`, `events.ts`, `referrals.ts`, `api/growth/link`, `consent`, `data-requests`, and `api/ops/growth/communications`, `data-requests`, `campaigns`, `experiments`, and their tests before removing schema columns. Remove old application routes/components/tests and application-only tables/foreign keys only after every caller is migrated or deleted. Keep beta invitation and account eligibility code untouched. Run `rg -n 'growth_applications|/apply|/tour' apps/web/src` and resolve every remaining live reference.
- [ ] **Step 5: Run** focused tests plus `pnpm --filter @aurel/web typecheck`; check unauthenticated operations fail closed. Commit with `feat: operate waitlist without application queue`.

## Task 4: One-field page and success celebration

**Files:** Create `apps/web/src/app/waitlist/page.tsx`, `apps/web/src/components/waitlist-form.tsx`, `apps/web/src/components/waitlist-confetti.tsx`, `apps/web/tests/e2e/waitlist.spec.ts`; delete `apps/web/src/app/apply/page.tsx` and `apps/web/src/components/private-access-application.tsx`.

**Interfaces:** Form POSTs `{email, privacyNoticeVersion, attribution?, turnstileToken?}` to `/api/growth/waitlist`. The confetti component takes `active: boolean` and renders a fixed, `aria-hidden`, `pointer-events: none` viewport overlay only during the one-shot successful state.

- [ ] **Step 1: Write failing Playwright tests** for one visible email input, no country field, 202 success announcement, 503 inline error with retry, no confetti after failure, exactly one confetti burst after success, form usability by keyboard, and a reduced-motion context with no moving particles. Stub `/api/growth/waitlist`; do not rely on production secrets in browser tests.

```ts
await page.route("**/api/growth/waitlist", route => route.fulfill({ status: 202, contentType: "application/json", body: '{"received":true}' }));
await page.goto("/waitlist");
await expect(page.getByLabel("Email")).toHaveCount(1);
await expect(page.getByLabel("Country")).toHaveCount(0);
await page.getByLabel("Email").fill("person@example.com");
await page.getByRole("button", { name: "Join waitlist" }).click();
await expect(page.getByRole("status")).toContainText("You're on the waitlist");
```
- [ ] **Step 2: Run** `pnpm --filter @aurel/web exec playwright test tests/e2e/waitlist.spec.ts`; expect red because `/waitlist` does not exist.
- [ ] **Step 3: Build** the labeled email form with `autoComplete="email"`, native required/type validation, pending disabled state, a focused `role="alert"` for errors, and an `aria-live="polite"` success heading. Use the existing Turnstile field with action `waitlist_signup` when configured; show no extra personal-data fields. Parse only allowlisted campaign query parameters with length bounds.
- [ ] **Step 4: Build** the one-shot overlay with a fixed small particle set and CSS `transform`/`opacity` keyframes, `pointer-events:none`, `aria-hidden="true"`, and cleanup on animation end. Fire only after a 202; reduced motion omits moving particles while keeping the success text. No canvas or animation dependency.

```tsx
{complete && <><p role="status">You're on the waitlist.</p><WaitlistConfetti active={!reduceMotion} /></>}
```

Give the overlay `data-testid="waitlist-confetti"`; remove it after its animation completes, and guard repeated submit handling so a single response creates one burst.
- [ ] **Step 5: Run** the Playwright test, axe on form/success, mobile overflow check, and `git diff --check`; commit with `feat: add accessible waitlist page and celebration`.

## Task 5: Landing and public design system

**Files:** Modify `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/identity.css`, `apps/web/src/app/layout.tsx`; remove `apps/web/src/app/tour/page.tsx` and `apps/web/src/components/public-product-tour.tsx`; modify `apps/web/tests/e2e/growth.spec.ts`.

**Interfaces:** All primary CTAs target `/waitlist`; section IDs `product`, `up-next`, and `faq` are stable nav/footer targets. FAQ uses `<details><summary>…</summary>…</details>`; no client state. Public CSS extends existing semantic tokens, with a small `marketing*`/`waitlist*` surface rather than another overriding stylesheet.

- [ ] **Step 1: Write failing e2e assertions** for nav and repeated Join waitlist CTA, product/current-vs-planned labels, working docs links, seven keyboard-expandable FAQ answers, four footer groups, current-year copyright, and absence of `/apply` or `/tour` links. Assert no horizontal overflow at 320/768/1024/1440 px.

```ts
await page.goto("/");
await expect(page.getByRole("link", { name: "Join waitlist" }).first()).toHaveAttribute("href", "/waitlist");
await expect(page.locator('a[href="/apply"], a[href="/tour"]')).toHaveCount(0);
await page.getByText("Are rewards live?").click();
await expect(page.getByText("planned", { exact: false })).toBeVisible();
```
- [ ] **Step 2: Run** the focused growth e2e spec; expect old CTA and section assertions to fail.
- [ ] **Step 3: Replace** the current invented `$184,290.42`/`4.72%` hero with an accurate product-interface preview, clearly marked illustrative where data is sample. Build the approved page sequence: nav → proposition/CTA → credible preview → two current-capability chapters → planned benefits → docs bridge → FAQ → closing CTA → grouped footer. Use existing Brand, ThemeToggle, and docs URL; do not add unused components or hardcode new claims before review.
- [ ] **Step 4: Consolidate** public-facing color/type/spacing/button/focus rules, remove CSS selectors only used by deleted application/Tour, add reduced-motion treatment for preview entrance, and update metadata/Open Graph description. Verify header/footer semantics and contrast. Do not restyle authenticated app components as collateral work.
- [ ] **Step 5: Run** Playwright/axe, visual checks at all four widths, typecheck, and `git diff --check`; commit with `feat: rebuild focused public landing`.

## Task 6: Docs, privacy, attribution, and claims

**Files:** Modify `apps/docs/src/content/docs/getting-started/private-access-application.md` (rename to `waitlist.md`), `apps/docs/astro.config.mjs`, `apps/docs/src/content/docs/getting-started/private-beta.md`, `apps/docs/src/content/docs/legal/privacy-notice.md`, `apps/kb/src/content/docs/growth/growth-operations-runbook.md`, `marketing/content-register.json`, `marketing/approved-claims.json`, `apps/web/src/app/api/ops/growth/campaigns/route.ts`, `apps/web/src/components/growth-registry.tsx`, `apps/web/src/app/api/growth/referrals/route.ts`, and focused tests.

**Interfaces:** Public campaign/referral URLs point to `/waitlist`, never `/apply`. `landing-global-waitlist-v1` replaces the PT-only landing/tour content entries. Privacy copy describes email-only waitlist, approximate IP country, operational invitations, retention, and a usable deletion/contact route; legal/controller placeholders remain a launch gate, not published as complete.

- [ ] **Step 1: Write failing checks** that generated campaign/referral URLs start `/waitlist`, docs sidebar has “Join the waitlist” and no “Apply for private access”, and marketing register contains the new landing content ID. Separately inspect the coverage of `pnpm marketing:check` and manually review claims it cannot detect.

```ts
expect(campaignUrl.pathname).toBe("/waitlist");
expect(referralUrl.pathname).toBe("/waitlist");
expect(contentRegister.some((entry) => entry.id === "landing-global-waitlist-v1")).toBe(true);
```
- [ ] **Step 2: Run** the relevant unit checks and `pnpm marketing:check`; record current failures.
- [ ] **Step 3: Update** docs and growth runbook to remove application questions/queue instructions, state global signup vs limited product access, explain no promised invite/email confirmation, and document operator invite and data-rights procedure. Keep historical implementation spec in `apps/kb` labeled superseded rather than rewriting its hundreds of lines into an inaccurate history. Update footer links only to existing docs routes.
- [ ] **Step 4: Update** all public claim/content registrations with evidence and required disclosures; do not self-mark novel global claims “approved” without the designated product/legal review. Keep publication blocked where privacy notice identity/contact/retention or claim approval is incomplete. Set campaign/referral destinations to `/waitlist`.
- [ ] **Step 5: Run** docs build, marketing check, focused URL tests, and search for user-facing `Apply for private access`, `/apply`, `/tour`, and Portugal-only signup copy. Commit with `docs: align global waitlist copy and claims`.

## Task 7: End-to-end and release gate

**Files:** Modify `apps/web/tests/e2e/growth.spec.ts`, `apps/web/tests/e2e/waitlist.spec.ts`, `apps/web/tests/unit/growth-waitlist*.test.ts`, and release/runbook documentation only where verification finds a gap.

**Interfaces:** No new production API. This task proves the integrated route, page, ops gate, country boundary, removed routes, and public content work together.

- [ ] **Step 1: Add an integration test** that begins at `/`, follows Join waitlist, submits email, sees a 202 confirmation and one confetti burst, then visits docs/footer/FAQ by keyboard. Add a separate 503 case with no confetti and no false success.

```ts
await page.goto("/");
await page.getByRole("link", { name: "Join waitlist" }).first().click();
await page.getByLabel("Email").fill("person@example.com");
await page.getByRole("button", { name: "Join waitlist" }).click();
await expect(page.getByRole("status")).toContainText("You're on the waitlist");
await expect(page.getByTestId("waitlist-confetti")).toHaveCount(1);
```
- [ ] **Step 2: Run** `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:e2e`, `pnpm docs:build`, `pnpm marketing:check`. Record exact outcomes; diagnose failures before patching.
- [ ] **Step 3: Inspect** rendered UI at 320/768/1024/1440 px and with reduced motion; check axe serious/critical findings, click/focus behavior, contrast, no horizontal overflow, and no console errors. Fix only observed issues, then rerun their checks.
- [ ] **Step 4: Verify** `git status --short`, `git diff --check`, and no lingering live application/Tour references. Preserve unrelated concurrent work by keeping all edits in this isolated worktree.
- [ ] **Step 5: Commit** verified integration fixes with `test: verify global waitlist landing`. Do not deploy; list any remaining product/legal/ops launch gates explicitly in the handoff.
