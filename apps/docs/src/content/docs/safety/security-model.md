---
title: Security model
description: The controls that protect access, preparation, signing, and settlement.
sidebar:
  order: 1
---

No single control can prevent every loss. Aura uses layers, and each layer has a clear job. The model assumes that browsers, dependencies, providers, protocols, and customers can all make mistakes or come under attack.

## Access

Privy handles sign-in and wallet infrastructure. Protected Aura APIs verify the Privy access token on the server. They do not trust an identity supplied by the browser.

Authentication proves access to an account. It does not prove that every transaction is safe, so Aura checks each money movement before you sign it.

## Preparation

Aura's server builds every money movement. It checks that the feature is on, your account is not locked, and the movement fits your limits and recipient settings. It then builds the exact transaction and records what it must do onchain.

If you have a daily limit and Aura cannot value the amount, the movement is blocked. An unknown value never passes as a small one.

## Signing

Your wallet shows the transaction. You sign or cancel. An approval and the action it enables are signed together, as one operation. Aura cannot sign on your behalf.

## Settlement

The chain or provider decides whether a movement settles. Aura then reads the chain itself. It marks a movement complete only when the signed operation matches what Aura prepared, the network has confirmed it, and the expected transfer or deposit appears. For a cross-chain move, Aura also waits for delivery on the other network. Aura's database is not the final balance record.

## Default product controls

You set these in Settings. Changes apply right away and are recorded.

| Control | Default | What it does |
| --- | --- | --- |
| Emergency lock | Off | Blocks every money movement through Aura |
| Daily limit | Off | Caps the US dollar value you send to other people in any 24 hours. Swaps and Earn moves within your own account don't count |
| Saved recipients only | Off | Only lets you send to saved recipients |
| Wait before new recipients | 4 hours | With saved recipients only on, a newly saved recipient can't receive until the wait ends |

## Operations separation

- Customer APIs require a verified customer identity.
- Operations APIs require a separate explicit subject allowlist. An empty allowlist grants no operator access.
- Supported chains, assets, contracts, and direct-transfer destinations are checked before a wallet prompt.
- Production secrets stay in server-side Cloudflare bindings rather than browser variables or source control.
- Provider events require signature and timestamp verification before queueing.

## Evidence and monitoring

Security-relevant state changes create evidence that can be reviewed after an incident. Each money movement keeps its transaction hash and the checks Aura ran. Provider events use idempotency identifiers. Scheduled checks surface stuck movements and failed event processing.

Monitoring helps detect and explain problems. It does not prevent every exploit or guarantee immediate detection.

## Recovery

If application state cannot be trusted, affected instruction paths should pause. Operations restores retained evidence, rereads authoritative chain or provider state, replays safe idempotent events, and records unresolved differences.

Customer ownership should not depend on Aura's projection database. Security preferences and evidence still need tested backup and restoration because losing them can weaken the product's control layer.

## Important boundary

Aura’s controls apply only to money movements prepared through Aura. They cannot stop a transaction signed in another app or with an exported key. Controls enforced by the wallet itself are planned, not live.

They also cannot remove smart-contract, stablecoin, oracle, bridge, chain, provider, phishing, malware, or customer-decision risk. See the [Threat model](/safety/threat-model/) for the risks the product is designed around.

See [report a security issue](/safety/report-a-security-issue/) for safe disclosure steps.
