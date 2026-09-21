---
title: Security model
description: The controls that protect access, preparation, signing, and settlement.
sidebar:
  order: 1
---

No single control can prevent every loss. Aurel uses layers, and each layer has a clear job.

## Access

Privy handles sign-in and wallet infrastructure. Protected Aurel APIs verify the Privy access token on the server. They do not trust an identity supplied by the browser.

## Preparation

Aurel checks the account lock, supported chain and asset, destination rules, cooling period, amount limits, review threshold, step-up requirement, and required disclosures.

## Signing

The wallet shows the final transaction. You sign or cancel. Aurel cannot sign on your behalf.

## Settlement

The chain or provider decides whether an action settles. Aurel records transaction hashes and rechecks supported source-chain receipts, but its database is not the final balance record.

## Important boundary

Aurel’s controls apply only to actions prepared through Aurel. They cannot stop an action signed in another app or from an exported wallet.

See [report a security issue](/safety/report-a-security-issue/) for safe disclosure steps.
