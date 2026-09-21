# Launch readiness

This is the go/no-go checklist for a closed mainnet beta. It is deliberately stricter than a feature checklist: a polished screen is not evidence that a money movement is safe or supportable.

## Product gate

- [x] One customer workspace with all capabilities grouped by customer intent.
- [x] Persistent activation checklist covering passkey, wallet, risks, test funding, and first action.
- [x] Explicit supported-network and asset matrix; no “any chain” promise.
- [x] Connected-wallet Base balance aggregation.
- [x] Balance privacy control.
- [x] Traceable human support-case intake.
- [x] Invite/cohort, geography, per-customer beta cap, feedback, and kill-switch controls.
- [x] Customer-visible dependency and incident status surface.
- [ ] Five non-crypto users complete signup, recovery, test funding, and withdrawal without coaching.
- [ ] Product copy is reviewed for bank, deposit, insurance, yield, reward, and investment claims.

## Money-movement gate

- [x] Every in-product write is policy-reviewed and explicitly customer-signed.
- [x] Pre-signing RPC simulation for direct Base sends.
- [x] Server-side emergency lock, rolling limit, saved-destination policy, and cooling period.
- [x] Persistent intent event history and state-transition validation.
- [x] Submitted EVM transactions are rechecked from source-chain receipts after reload.
- [ ] At least 100 test movements across every published chain/asset pair with >=98% supported-flow completion.
- [ ] Documented recovery exercise for source success/destination delay on each LI.FI route.
- [ ] Independent security review finds no critical or high unresolved issue.

## Operations gate

- [x] Operations console is deny-all unless an explicit Privy subject is allowed.
- [x] Stale, failed, and customer-reported activity reaches a triage queue.
- [x] Product funnel and settlement health are visible separately from balances.
- [x] Incident, webhook, Queue, ambiguous-command, and projection-recovery runbooks exist.
- [x] Operations can issue hashed one-use invitations, publish incidents, inspect cohort telemetry, and disable product capabilities without a deploy.
- [x] Isolated backup/restore drill verifies schema, beta controls, consent evidence, and restored database integrity.
- [ ] Named primary and backup incident contacts.
- [ ] Tested out-of-band customer communication channel.
- [ ] Provider escalation contacts and severity/response commitments recorded.
- [ ] Customer support coverage and response target published internally.

## Cloudflare gate

- [x] Local development uses isolated Miniflare state; production uses the named Worker and production D1/Queues.
- [x] Logs and traces enabled with structured application events.
- [x] CI runs lint, types, unit/E2E tests, build, recovery drill, CodeQL, and dependency audit.
- [x] Version upload, gradual deployment, and rollback procedure documented.
- [x] Turnstile client and mandatory Siteverify path implemented for support intake.
- [ ] Custom production domain attached.
- [x] Turnstile production widget and secret configured with exact action and hostname validation.
- [ ] WAF managed rules, API rate-limit rules, and API Shield schema validation configured on the custom domain.
- [ ] Cloudflare Access protects any operator-only hostname.
- [ ] Log retention/export destination and alert receiver configured.
- [ ] Version affinity rule configured before using split traffic with hashed static assets.

Configuration evidence must be attached after the custom hostname, Turnstile widget, operator identity, alert receiver and log destination are selected. The checked-in OpenAPI contract is `infra/cloudflare/aurel-api.openapi.yaml`; it is a validation input, not proof that API Shield mitigation is enabled.
The exact activation sequence, initial rate ceilings and evidence fields are in `infra/cloudflare/EDGE_SECURITY_ACTIVATION.md`.

## Legal and provider gate

- [ ] Launch entity, customer contracting entity, permitted countries, and excluded countries approved by counsel.
- [ ] Terms, privacy notice, protocol/routing disclosures, complaint policy, and data-retention schedule effective-dated.
- [ ] Bridge/Rain responsibilities matrix signed before any fiat, KYC, or card feature is activated.
- [ ] Sanctions/fraud escalation ownership and provider handoff tested.
- [ ] Marketing and customer support do not imply FDIC insurance, bank deposits, guaranteed APY, or universal asset support.

Decision and evidence templates: `PARTNER_DILIGENCE.md`, `PROVIDER_REQUIREMENTS_MATRIX.md`, `COMPLIANCE_RESPONSIBILITY_MATRIX.md`, `LEGAL_AND_JURISDICTION_DECISIONS.md`, `ACCEPTANCE_TEST_PLAN.md`, and `CLOSED_BETA_PLAN.md`.

## Proposed beta limits

- Invite-only: 25 internal/friendly users, then 100 external users.
- Default rolling Aurel-prepared transaction limit: USD 25,000 per 24 hours.
- New direct destinations: USD 1,000 threshold and 24-hour cooling period.
- Bank rails and cards: unavailable until contracted and reconciled end-to-end.
- Public launch: prohibited until every unchecked security, operations, Cloudflare, and legal gate above has an accountable owner and completion evidence.
