---
title: Product principles
description: What Aura is building, who it is for, and the decisions that shape the product.
---

Aura is a financial interface built around stablecoins and customer-controlled wallets. It brings together money movement, onchain markets, borrowing, portfolio views, and—once providers are contracted—fiat accounts and cards.

The aim is not to put a bank-shaped skin over crypto. It is to make several independent financial systems feel coherent without hiding where the money sits, who controls it, or what can go wrong.

## One relationship, many financial systems

Aura is an aggregator. Public blockchains, wallet infrastructure, DeFi protocols, routing providers, and future regulated partners each perform a different job. Aura gives the customer one place to understand and use them.

That distinction matters. A balance shown in Aura may come from a blockchain, a lending protocol, or a future banking provider. Similar-looking balances can have different legal rights, liquidity, insurance, and settlement behavior. The interface should make those differences understandable instead of flattening them into a misleading total.

## Independent by design

Aura has no house token. There is no proprietary asset whose price depends on customers staying inside the product. Assets and providers should earn their place through utility, risk, liquidity, operating reliability, and customer demand.

That does not eliminate commercial incentives. Aura may eventually earn subscriptions, interchange share, disclosed provider revenue, or service fees. Those incentives should be visible and should not determine whether a risky or unsuitable product is promoted.

## Customer-controlled access

Wallet actions are prepared by Aura and confirmed by the customer. Aura does not keep a private key that lets an employee or an AI assistant move customer assets on its own.

This is a meaningful safety boundary, not a promise that loss is impossible. A customer can still approve a malicious transaction, lose account access, use an exported wallet elsewhere, or interact with a protocol that fails. Product controls reduce avoidable mistakes inside Aura; they do not control the whole internet.

## Safety should be visible

Financial products often hide safety in settings, terms, and compliance workflows. Aura treats safety as part of the primary product:

- clear transaction previews before signing;
- saved destinations and optional destination restrictions;
- cooling periods for higher-risk actions;
- rolling transaction limits and step-up authentication;
- honest status labels for live, preview, and unavailable services;
- retained transaction evidence and receipt checks;
- plain-language explanations of protocol and provider boundaries.

Controls should explain themselves at the moment they matter. Documentation provides depth, but it should not compensate for an unclear transaction screen.

## A useful first deposit

Aura does not require a large minimum balance to become useful. A new customer should be able to connect or create a wallet, see supported assets, understand the safety model, and try a small transaction before deciding whether to deepen the relationship.

Membership can recognize a larger and longer relationship, but it should not turn basic safety or support into a luxury feature. Higher tiers may add economically costly benefits or more personal service; core account security remains available to everyone.

## Calm, not simplistic

The interface removes unnecessary words and choices, but it does not remove material facts. The product should feel calm because information is ordered well—not because fees, risk, or responsibility have been hidden.

For the current boundary between working and planned features, see [Product status](/getting-started/status/).

