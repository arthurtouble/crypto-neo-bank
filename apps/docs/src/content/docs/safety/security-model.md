---
title: Security model
description: The controls that protect access, preparation, signing, and settlement.
sidebar:
  order: 1
---

No single control can prevent every loss. Aurel uses layers, and each layer has a clear job. The model assumes that browsers, dependencies, providers, protocols, and customers can all make mistakes or come under attack.

## Access

Privy handles sign-in and wallet infrastructure. Protected Aurel APIs verify the Privy access token on the server. They do not trust an identity supplied by the browser.

Authentication proves access to an account; it does not prove that every transaction is safe. Aurel currently holds actions above the step-up threshold until it can verify approval for that exact instruction on the server. Passkey enrollment alone is not sufficient evidence.

## Preparation

Aurel checks the account lock, supported chain and asset, destination rules, cooling period, amount limits, review threshold, step-up requirement, and required disclosures.

Unknown transaction values do not silently pass as small transactions. If Aurel cannot establish a fresh, independent USD value for a transfer, preparation stops.

## Signing

The wallet shows the final transaction. You sign or cancel. Aurel cannot sign on your behalf.

## Settlement

The chain or provider decides whether an action settles. Aurel records transaction hashes and rechecks supported source-chain receipts, but its database is not the final balance record.

## Default product controls

| Control | Default | What it does |
| --- | --- | --- |
| Emergency account lock | Off | Blocks new transaction intents prepared through Aurel when enabled |
| Saved destinations only | Off | Optionally restricts direct transfers to cooled address-book entries |
| New-address cooling | 24 hours | Delays transfers of $1,000 or more to a newly saved destination |
| Rolling transaction limit | $25,000 / 24 hours | Includes recent submitted, confirmed, and still-active prepared transfers; a final database guard prevents concurrent preparations from exceeding it |
| Step-up threshold | $10,000 | Holds higher-risk preparation until transaction-specific approval can be verified server-side |
| High-value review | $25,000 / 24 hours | Places the instruction in cooling and later revalidates the same details |
| Reviewed-intent expiry | 15 minutes | Requires prompt submission after review |
| Reserve-floor warning | $10,000 | Warns when visible liquid reserves may fall below the preference; it is not a hard hold |

These are product defaults, not universal promises. Availability and exact enforcement can depend on the action and authoritative data available at the time.

An ordinary signed-in session may tighten transaction controls but cannot unlock an account or raise limits. Such changes need a separate verified recovery path, which is not self-service in the current private beta.

## Operations separation

- Customer APIs require a verified customer identity.
- Operations APIs require a separate explicit subject allowlist. An empty allowlist grants no operator access.
- Supported chains, assets, contracts, and direct-transfer destinations are checked before a wallet prompt.
- The concierge is read-only and has no signing or administrative tool.
- Production secrets stay in server-side Cloudflare bindings rather than browser variables or source control.
- Provider events require signature and timestamp verification before queueing.

## Evidence and monitoring

Security-relevant state changes create evidence that can be reviewed after an incident. Submitted transactions retain available hashes and receipt checks. Provider events use idempotency identifiers. Scheduled checks surface stale transactions, expired reviews, and failed event processing.

Monitoring helps detect and explain problems. It does not prevent every exploit or guarantee immediate detection.

## Recovery

If application state cannot be trusted, affected instruction paths should pause. Operations restores retained evidence, rereads authoritative chain or provider state, replays safe idempotent events, and records unresolved differences.

Customer ownership should not depend on Aurel's projection database. Security preferences and evidence still need tested backup and restoration because losing them can weaken the product's control layer.

## Important boundary

Aurel’s controls apply only to actions prepared through Aurel. They cannot stop an action signed in another app or from an exported wallet.

They also cannot remove smart-contract, stablecoin, oracle, bridge, chain, provider, phishing, malware, or customer-decision risk. See the [Threat model](/safety/threat-model/) for the risks the product is designed around.

See [report a security issue](/safety/report-a-security-issue/) for safe disclosure steps.
