# Aura internal documentation

Internal product, operations, architecture, security, and compliance docs. Customer-facing docs are in `apps/docs`.

Keep these files in the repository. Don't publish them to a public host, and never store secrets, tokens, customer data, or provider-confidential attachments here.

## Start here

- [Build status](overview/build-status.md): what is live, what depends on providers, and what was retired.
- [Redesign](overview/redesign.md): the current plan (step 2), with phases and status.
- [Feature readiness](overview/feature-readiness.md): step 1, the feature-by-feature plan (done).
- [Launch readiness](overview/launch-readiness.md): release gates.
- [Codebase audit, 25 September 2026](overview/codebase-audit-2026-09-25.md): findings, target architecture, and the refactor plan.
- [Operations runbook](operations/operations-runbook.md): provider activation, secrets, migrations, reconciliation, the operations app (`apps/ops`), and recovery.
- [Monitoring and alerts](operations/monitoring.md): Worker logs, finding a failure, and the Cloudflare alerts to set up.
- [Production launch](operations/production-launch.md): the ordered steps to production, and `pnpm production:check`.
- [Architecture](architecture/architecture.md): systems of record, and why D1 never owns money.
- [Supported assets](architecture/assets.md): the asset registry, adding an asset, and pausing one.
- [Money actions](architecture/money-actions.md): how every money movement is prepared, signed, verified, and recorded.
- [Accounts and custody](architecture/accounts-and-custody.md): the Privy embedded wallet, relaying, custody, and leaving Privy.
- [Screen data](architecture/frontend-data.md): the API each screen reads, and guest example data.
- [Provider projections](architecture/provider-projections.md): the event contract for bank, cards, and wallet policies.

## Sections

| Folder | Contents |
| --- | --- |
| `overview/` | Build status, redesign, feature readiness, launch readiness, codebase audit |
| `architecture/` | Architecture, money actions, provider projections, fund flow and provider data, partner integration, provider activation, dependency risks |
| `operations/` | Runbook, monitoring, launch controls, incident response, acceptance tests, data retention, edge security, production launch |
| `security/` | Threat model, security review, external review scope |
| `compliance/` | Responsibility matrix, legal and jurisdiction decisions, partner diligence, provider requirements |
| `product/` | Content style guide, design system (with the root `DESIGN.md` and `apps/web/public/design-tokens.css`), redesign journeys, wireframes, direction and visual mockup, daily money flows, volume and economics inputs |
| `archive/` | Dated plans, specs, and release logs |

Files named with a date are point-in-time evidence: leave them as they are, and update the undated docs when behavior changes.
