# Aura internal documentation

Internal product decisions, operating procedures, architecture, security, and compliance material. Public, customer-facing documentation lives in `apps/docs`.

These files contain operational and security-sensitive context. Keep them in the repository; do not publish them to a public host, and never store secrets, tokens, customer data, or provider-confidential attachments here.

## Start here

- [Build status](overview/build-status.md): what is live, what depends on providers, and what was retired.
- [Redesign](overview/redesign.md): the current plan for step 2, the redesign, with its phases, open questions, and status.
- [Feature readiness](overview/feature-readiness.md): step 1, the feature-by-feature plan, definition of done, and status (done).
- [Launch readiness](overview/launch-readiness.md): release gates.
- [Codebase audit, 25 September 2026](overview/codebase-audit-2026-09-25.md): findings, target architecture, and the refactor plan.
- [Operations runbook](operations/operations-runbook.md): provider activation, secrets, migrations, reconciliation, the operations app (`apps/ops`), and recovery.
- [Architecture](architecture/architecture.md): systems of record and the rule that D1 never owns money.
- [Supported assets](architecture/assets.md): the asset registry, how to add an asset, and how to pause one.
- [Money actions](architecture/money-actions.md): how every customer money movement is prepared, signed, verified, and recorded.
- [Accounts and custody](architecture/accounts-and-custody.md): the Privy embedded-wallet account, how actions are relayed, custody, and leaving Privy.
- [Screen data](architecture/frontend-data.md): the API each screen reads, and example data for guests.
- [Provider projections](architecture/provider-projections.md): the event contract for bank, cards, and wallet policies.

## Sections

| Folder | Contents |
| --- | --- |
| `overview/` | Build status and launch readiness |
| `architecture/` | Architecture, money actions, provider projections, fund flow and provider data, partner integration, provider activation, dependency risks |
| `operations/` | Runbook, launch controls, incident response, acceptance tests, data retention, edge security, release plans, feature readiness records |
| `security/` | Threat model, security review, external review scope |
| `compliance/` | Responsibility matrix, legal and jurisdiction decisions, partner diligence, provider requirements |
| `product/` | Content style guide, design system (with the root `DESIGN.md` and `apps/web/public/design-tokens.css`), redesign journeys and wireframes, redesign direction and its visual mockup, daily money flows, volume and economics inputs |
| `archive/` | Dated plans, specs, and release logs kept as historical records |

Files named with a date are point-in-time evidence. Update the undated documents when behavior changes; leave dated records as they were.
