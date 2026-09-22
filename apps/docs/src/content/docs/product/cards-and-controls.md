---
title: Cards and controls
description: Understand Aurel's card design, issuer boundaries, and the controls that appear after setup.
---

## Current status

Card issuance is not live. The Card page is provider-ready and clearly shows **Not Issued** until an issuer-backed card account is connected.

Aurel does not display a card number, last four digits, network, limit, or active control unless that value was observed from the issuer.

## Planned controls

The card workspace is designed for familiar controls:

- Freeze and unfreeze
- Daily and monthly spending limits
- Funding priority
- PIN access
- Apple Pay and Google Pay setup where supported
- Statements
- Replacement
- Transaction disputes

Each control stays unavailable until the connected issuer reports that the card and capability are ready **and** Aurel has enabled the issuer's control API. Country, identity, sanctions, eligibility, and underwriting checks may apply.

## Sources of truth

The issuer owns card creation, authorization, clearing, settlement, PIN handling, disputes, and statement records. Aurel may keep a disposable projection so the interface loads quickly, but it is not the authoritative card system.

If Aurel and the issuer differ, the issuer record controls. Aurel must reconcile or hide stale data rather than invent a state.
