---
title: Tokenized markets
description: Why a token contract alone is not enough to offer a market.
sidebar:
  order: 5
---

Aura can show a public tokenized-market catalog for research. Buying, selling, custody, and transfers of these instruments are not available in Aura.

The public catalog keeps issuer, instrument, network, and document references separate from a customer's permissions. For example, [xStocks describes its products as tracker certificates, not ownership of the underlying shares](https://docs.xstocks.fi/docs/product-legal-overview). A token address or familiar ticker does not change those rights.

An asset trading onchain is not automatically lawful to distribute. Before Aura lists a tokenized market, it must verify the issuer, holder rights, approved venue, eligible countries, identity rules, offering documents, transfer restrictions, custody model, liquidity, and pricing source.

Eligibility fails closed. If a required fact, document, country rule, or identity result is missing or out of date, Aura will not show trading access.

Future market access may require identity checks, investor classification, country restrictions, and provider agreements beyond ordinary wallet use.

## Listing review

A tokenized asset needs a documented record for:

| Area | Questions to answer |
| --- | --- |
| Issuer | Who owes the underlying obligation and under which law? |
| Holder rights | Does the token convey equity, debt, fund units, a contractual claim, or only technical exposure? |
| Distribution | Who may legally receive or trade it? |
| Venue | Which issuer-approved or regulated venue supports the transaction? |
| Identity | Which KYC or investor-classification standard applies? |
| Transfer rules | Can the contract freeze, claw back, whitelist, or reject transfers? |
| Documents | Are current offering, risk, financial, and redemption documents available? |
| Custody | Who controls the underlying asset and the token? |
| Pricing | Is the displayed price executable, independently sourced, and current? |
| Liquidity | How can the customer sell or redeem, and under what limits? |

## DeFi availability is not distribution approval

A token may be visible in a wallet or tradable in a decentralized pool while remaining inappropriate or unlawful for Aura to promote to a particular customer. Technical accessibility does not answer securities, sanctions, consumer-protection, marketing, or tax questions.

Privy can provide wallet access to a transaction. It does not replace the issuer, broker, venue, transfer agent, identity provider, or Aura's listing review.

## Fail-closed eligibility

Access remains unavailable when a required country rule, identity result, investor status, document, venue approval, or review date is missing or stale. A generic disclaimer does not cure missing eligibility.

Aura models quote, order, hold, and transfer permissions separately. A customer-specific decision must come from a contracted eligibility provider, match the exact customer and instrument, and include current identity, country, investor-class, document, and venue evidence. Private-beta access and ordinary Privy sign-in are not substitutes. The current provider adapter is unconnected, so it grants no permissions.

The order boundary is also off by default. Even after a provider is connected, it requires a separate operations switch, contracted venue and legal references, verified payment and receiving wallets, and a fresh eligibility decision. The public catalog and a DeFi swap quote cannot bypass that boundary.

Eligibility can change after onboarding. A customer may be allowed to hold or redeem an existing position while being unable to buy more. The product must represent those states separately.

## Product presentation

Future screens should distinguish market price from net asset value, exchange liquidity from issuer redemption, trading hours from blockchain availability, and token custody from ownership of the underlying security.

Yield should be decomposed into its source rather than presented as a single number. A Treasury-linked token, private-credit token, and synthetic stock exposure do not carry the same issuer, duration, liquidity, or legal risk.
