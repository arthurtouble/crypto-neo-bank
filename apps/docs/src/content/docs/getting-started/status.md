---
title: Product status
description: What Aura can do now and what requires a provider or release gate.
sidebar:
  order: 1
---

Aura is a browsable product preview. Every section can be explored without signing in, using clearly labeled fictional data. Anyone can sign in; you accept the terms of use the first time. Personal records require authentication, and financial actions also depend on feature availability and your account controls. The current Aura development site uses this branch; it is not a production release. Your Aura account is a smart wallet on Base. Its setup, including covered network fees, is still being configured, and no funded transaction has been signed through it yet.

| Area | Current capability | Boundary |
| --- | --- | --- |
| Overview | Smart wallet balances on Base, Aave positions, and Sky sUSDS on Ethereum | Chains and protocols are authoritative; values depend on live reads |
| Deposit | Crypto receiving address and Aura tag page | Bank instructions require an active Bridge account and complete provider details |
| Send | Crypto sends on Base and saved recipients | Your controls, wallet signing, and onchain checks apply; bank payouts are not connected |
| Swap | Swaps and cross-chain moves between supported assets through LI.FI | Quotes expire after 45 seconds; a cross-chain move is complete only after delivery is checked |
| Earn | Aave supply and withdrawal on Base; Sky USDC deposits and withdrawals on Ethereum | Wallet signing and chain settlement apply; Morpho is not connected |
| Invest | Supported crypto routes | Tokenized stocks and metals require eligibility and a connected execution provider |
| Cards | The card your issuer reports, shown once the card program is switched on | Issuance, freeze, limits, countries, PIN, wallet provisioning, termination, and disputes need Bridge/Rain program and control adapters |
| Rewards | Membership and benefit allowances reported by a connected provider | Cashback and benefits need a contracted and funded provider program |
| Transactions and Insights | Aura money movements plus available chain and Aave activity | Exports show their coverage; issuer card transaction feed is not connected |
| Settings and Support | Privy sign-in, recovery, key export, daily limit, saved recipients, account lock, wallet-provider rules, notification choices, data export and deletion, and support cases | Session management and passcode changes depend on identity-provider capabilities |
| Aura tag payment page | Opted-in, verified linked crypto address | Bank transfer requires provider instructions; card payment requires an acquiring or payment-link provider |

A screen or database record is not proof that a regulated service is active. No bank account, payment card, securities trade, or reward is promised until its provider connection, country eligibility, terms, and operational controls are in place. Aura does not give regulated investment advice. Aave and swap rates can change, and onchain transactions may be irreversible.

See [sources of truth](/concepts/sources-of-truth/), [account controls](/safety/account-controls/), and [provider responsibilities](/company/provider-responsibilities/).

Last reviewed: 25 September 2026.
