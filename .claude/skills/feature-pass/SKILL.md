---
name: feature-pass
description: Take one Aura feature from docs/overview/feature-readiness.md to done — scope, audit, fix, unit and end-to-end tests, live check on dev, cleanup, and status update. Use when starting or continuing work on any feature in that plan, or when the user says "next feature".
---

# Feature pass

The plan, the order, and the definition of done live in `docs/overview/feature-readiness.md`. Read it first. This skill is the procedure for one row.

## 1. Pick and scope

- Take the first row that isn't Done or Cut, unless the user named one.
- Branch from the latest `main`.
- Set the row to In progress.
- List what the feature includes today: pages, components, API routes, `src/lib` modules, tables, feature switches, and tests. Then ask the product owner one short question: keep all of it, simplify, or cut parts? Don't build anything until scope is confirmed.

## 2. Map every customer step

Write the steps a customer takes through the feature, including each failure they can hit: switch off, account locked, over limit, no passkey, provider or chain unavailable, cancelled, expired. This list becomes the test plan. Put it in the pull request description.

## 3. Audit and fix

For each step, trace the page, the API handler, the domain logic, and the database, and fix what is broken or missing. Check the rules in `CLAUDE.md`:

- D1 never owns money.
- Observations carry source, reference, status, and time.
- Every handler uses `lib/http/route.ts`.
- Money actions are gated on the server.
- Tables are classified in `lib/privacy/subject-data.ts`.

Delete what scoping cut.

## 4. Tests

- **Unit** (`apps/web/tests/unit`): domain logic, each API route's success and every error code, and database effects, including the triggers in `infra/d1/migrations/0001_baseline.sql`.
- **End to end** (`apps/web/tests/e2e`): one spec per feature, covering every step from section 2, desktop and mobile, signed in. Privy and chain or provider calls are stubbed at the edge; the app's own server code and local D1 run for real. Guest pages keep their labelled example data.
- A test that can't be written is a gap to report, never a reason to skip.

## 5. Live check on dev (money flows)

Merge, wait for the dev deploy (the version label shows the short commit), then ask the user to do the smallest real version of each money step. Verify it from the dev database (`wrangler d1 execute aura-dev-projections --remote --env dev`) and the chain: action status and events, Transactions page, and receipt. Report the result.

## 6. Finish

- Remove dead code, duplicate helpers, and unused switches in the feature's area.
- Bring every doc that mentions the feature in line with what shipped, internal and public, in the same pull request:
  - Search `docs/` and `apps/docs/src/content/docs` for the feature's names, screens, API routes, tables, switches, and assets (`grep -ril`), and read each hit.
  - Internal (`docs/`): architecture and data flow, `overview/build-status.md`, runbooks and operations, security and threat model where the rules changed. Leave dated files alone.
  - Public (`apps/docs`): what a customer can do, what is coming soon, limits and controls, and fees. Never describe something as working when it is off, cut, or coming soon. Follow `docs/product/content-style-guide.md`.
  - Repo guides: `CLAUDE.md`, `docs/README.md`, `apps/web/tests/e2e/README.md`, and skills, when commands, layout, or rules changed.
  - Run `pnpm typecheck:all` (it checks the docs site) and `pnpm marketing:check`; fix any finding in pages you changed.
- Set the row to Done with the pull request link.
- Run `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, and the feature's e2e specs. Then merge (see the Cloudflare section of `CLAUDE.md`).
- Tell the user what works, what was cut, and what is left for later steps. Then propose the next row.
