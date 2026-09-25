---
title: Volume and unit-economics inputs
description: Assumptions and evidence required for volume, cost, revenue, and contribution-margin planning.
---

Use contracted provider pricing and observed early customer behavior. Blank cells are decisions, not zero-cost assumptions.

| Input | Low | Base | High | Evidence source |
|---|---:|---:|---:|---|
| Active customers | 25 | 100 | 500 | Launch scenarios |
| Activated customers | 15 | 70 | 350 | Measured activation funnel |
| Average visible assets | TBD | TBD | TBD | Onchain/provider observation; never stored as ledger |
| Monthly onchain actions/customer | TBD | TBD | TBD | Product events and intents |
| Monthly fiat volume/customer | TBD | TBD | TBD | Provider sandbox/production reports |
| Card spend/customer | TBD | TBD | TBD | Issuer reports |
| KYC/EDD cost | TBD | TBD | TBD | Provider quote |
| Account and transfer cost | TBD | TBD | TBD | Provider quote |
| Card, dispute and chargeback cost | TBD | TBD | TBD | Issuer/program quote |
| Benefits cost/customer | TBD | TBD | TBD | Vendor contract and observed use |
| Support cost/customer | TBD | TBD | TBD | Cases, handling time and coverage model |
| Cloudflare and observability cost | TBD | TBD | TBD | Metered account usage |

## Revenue scenarios

Model subscriptions, disclosed service fees, interchange share and provider/merchant-funded rewards separately. Do not count gross customer assets as revenue. Do not treat hidden spread, protocol yield, or a proprietary token as baseline revenue.

The provider diligence request should ask for setup charges, monthly minimums, per-check fees, EDD, accounts, transfers, FX/conversion, stablecoin settlement, card lifecycle, authorization, disputes, chargebacks, reserves, prefunding, data export, support and termination.
