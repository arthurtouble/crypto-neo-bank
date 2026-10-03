# Aura internal documentation

Internal product, operations, architecture, security, and compliance docs. Customer-facing docs are in `apps/docs`.

Keep these files in the repository. Don't publish them to a public host, and never store secrets, tokens, customer data, or provider-confidential attachments here.

## Start here

- [Production launch](operations/production-launch.md): the current plan. The ordered steps to production, the owner's go-ahead for each, and `pnpm production:check`.
- [Build status](overview/build-status.md): what is built, what depends on providers, and what was retired.
- [Launch readiness](overview/launch-readiness.md): the release gates and their evidence.
- [Operations runbook](operations/operations-runbook.md): daily controls, incidents, recovery, the operations app (`apps/ops`), and closing accounts.
- [Monitoring and alerts](operations/monitoring.md): Worker logs, finding a failure, and the Cloudflare alerts to set up.
- [Development Worker](operations/aura-development-worker.md): deploying dev, migrations, configuration, and the funded transactions run so far.
- [Architecture](architecture/architecture.md): systems of record, Cloudflare bindings, and why D1 never owns money.
- [Money actions](architecture/money-actions.md): how every money movement is prepared, signed, verified, and recorded.
- [Markets](architecture/markets.md): perps on Hyperliquid and predictions on Polymarket, through the customer's own wallet.
- [Supported assets](architecture/assets.md): the asset registry, adding an asset, and pausing one.
- [Launch controls](operations/launch-controls.md): feature switches, customer controls, the passkey requirement, and stop conditions.

Done and closed: [feature readiness](overview/feature-readiness.md) (step 1, with the definition of done) and the [redesign](overview/redesign.md) (step 2). The [codebase audit of 25 September 2026](overview/codebase-audit-2026-09-25.md) is a point-in-time record.

## Sections

| Folder | Contents |
| --- | --- |
| `overview/` | Build status, launch readiness, feature readiness, redesign rules, codebase audit |
| `architecture/` | Architecture, money actions, markets, accounts and custody, assets, screen data, provider projections, fund flow and provider data, partner integration, dependency risks |
| `operations/` | Production launch, runbook, monitoring, development Worker, launch controls, incident response, customer communication templates, acceptance tests, data retention, edge security |
| `security/` | Threat model, security review, external review scope |
| `compliance/` | Responsibility matrix, legal and jurisdiction decisions, partner diligence, provider requirements |
| `product/` | Content style guide, design system (with the root `DESIGN.md` and `apps/web/public/design-tokens.css`), redesign journeys, wireframes, direction and visual mockup, volume and economics inputs |
| `archive/` | Dated plans, specs, and release logs |

Files named with a date are point-in-time evidence: leave them as they are, and update the undated docs when behavior changes.
