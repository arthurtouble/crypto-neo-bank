---
title: Threat model
description: The main ways customers or the service could lose money, access, or trustworthy evidence.
---

Aurel's threat model starts with outcomes, not security slogans. The most important outcomes to prevent are unauthorized asset movement, a customer signing something materially different from what the interface described, exposure of sensitive data, silent loss of transaction evidence, and misleading presentation of financial risk.

## Account takeover

An attacker may compromise email, a social account, a device, a session, or recovery method. Aurel relies on Privy for identity and wallet infrastructure, verifies access tokens on the server, and requires stronger authentication for higher-risk preparation.

Customers still need secure devices and recovery methods. Passkeys reduce phishing exposure but do not make a compromised session or device harmless.

## Malicious or altered transaction data

A compromised frontend, dependency, route response, or provider integration could attempt to change a destination, amount, contract, or calldata.

Aurel validates supported chains, assets, contract targets, requested amounts, and returned route fields on the server. The wallet provides a final independent confirmation surface. Customers should stop if the wallet request does not match the action they intended.

## Destination mistakes and scams

Valid blockchain addresses can belong to scammers, be copied incorrectly, or be substituted by clipboard malware. The address book, optional saved-only mode, cooling periods, clear labels, and high-value review are designed to slow down dangerous first-time transfers.

These controls cannot establish that a person on the other end is honest.

## Smart-contract and protocol failure

A supported contract can contain a bug, be upgraded, suffer an oracle failure, lose liquidity, or change through governance. Allowlisting and simulation reduce accidental interaction with unknown contracts, but they do not guarantee protocol safety.

Aurel should keep integrations narrow, monitor material changes, and stop preparing affected actions when reliable operation or review is not possible.

## Stablecoin and issuer risk

Stablecoins can lose their peg, freeze addresses, change redemption terms, or face issuer, reserve, banking, or regulatory problems. A dollar-denominated display is not a guarantee of one-dollar redemption.

## Bridge and routing risk

Cross-chain routes can depend on several contracts, liquidity sources, validators, messages, and relayers. Source-chain success does not prove destination delivery. Aurel tracks the route reference and distinguishes source confirmation from destination completion.

## Insider and operations risk

A malicious or mistaken operator could misuse access, alter configuration, mishandle a support case, or expose logs. Aurel separates customer and operator authorization, keeps operator access allowlisted, limits the concierge to read-only tools, and keeps signing outside Aurel.

This design reduces the power of an operator but does not eliminate the need for access review, logging, change control, incident response, and vendor oversight.

## Projection and evidence loss

Because chains and providers hold canonical financial state, an Aurel database loss should not change ownership. It could still erase security settings, case history, or transaction context. Backups, restoration tests, append-style events, idempotent provider processing, and reconciliation address this risk.

## Denial of service and dependency failure

Cloudflare, Privy, RPC endpoints, LI.FI, Aave interfaces, or future regulated providers may be unavailable. The product should isolate affected features, show honest status, and avoid treating a timeout as a completed action.

## AI risk

An AI assistant can hallucinate, misread context, or be manipulated by untrusted content. The concierge has no signing, transaction, or administrative tool. Its output is explanatory and cannot replace the authoritative transaction preview or eligibility decision.

## Outside the boundary

Aurel cannot enforce its controls after a customer exports a wallet or uses another application. It cannot reverse confirmed blockchain transactions, prevent every phishing attack, guarantee a protocol, or recover a secret it never possessed.

