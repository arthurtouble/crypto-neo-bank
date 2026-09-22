---
title: Roadmap
description: What is built, what comes next, and which milestones depend on external partners.
---

The roadmap separates work Aurel can complete independently from features that require a provider contract, legal approval, or benefit vendor.

## Current foundation

The current product includes:

- Cloudflare-based product and API deployment;
- Privy authentication and customer-controlled wallets;
- Base asset and Aave market reads;
- supported transaction preparation and customer confirmation;
- account lock, destination rules, cooling, limits, and step-up controls;
- LI.FI route discovery and validation for allowlisted USDC paths;
- live market discovery that opens supported assets in a preselected Swap flow without starting a quote;
- activity evidence, receipt checks, provider-event infrastructure, and operations views;
- membership and benefit data models;
- a searchable documentation, safety, and legal center.

## Next product tranche

The next independent work focuses on customer readiness rather than adding more logos:

1. complete supported-flow usability testing with new customers;
2. add clearer error recovery and dependency status;
3. finish backup and restoration drills;
4. establish security monitoring and an external assessment;
5. finalize legal entity, customer terms, privacy operations, and jurisdiction policy;
6. instrument conversion, transaction success, support burden, and retention;
7. prepare provider diligence materials from tested system evidence.

## Regulated rails

Fiat accounts, conversions, cards, and related identity checks depend on a contracted provider such as Bridge, Rain, or another approved partner. The sequence is commercial diligence, sandbox integration, country and flow approval, production credentials, controlled pilot, then wider availability.

The provider may change the product scope. Aurel should keep provider-specific code behind clear interfaces and avoid marketing an approval before it exists.

## Membership and benefits

Membership can launch in stages:

- relationship history and projected tier;
- funded digital benefits with clear caps;
- travel and lifestyle services through contracted vendors;
- higher-touch support for economically sustainable tiers;
- insurance or protection products only with appropriate provider and terms.

Core safety controls remain independent of tier.

## Tokenized markets

Tokenized markets require issuer, venue, distribution, identity, country, transfer-rule, document, custody, pricing, and liquidity review. A DeFi pool alone is not the launch gate.

The first production market should be narrow, liquid enough to support a clear customer use case, and available only where the full distribution model is approved.

## Mobile

The web application comes first. A mobile app should follow stable product flows and shared APIs instead of duplicating unsettled logic. Mobile work includes secure local storage, deep-link review, wallet handoff behavior, push-notification privacy, device recovery, and app-store compliance.

## How status changes

Each feature stays **unavailable** until the underlying capability exists, moves to **preview** when the product foundation can be evaluated without creating a customer entitlement, and becomes **live** only after its technical, operational, provider, legal, and support gates pass.

See [Product status](/getting-started/status/) for the current state rather than relying on this forward-looking roadmap.
