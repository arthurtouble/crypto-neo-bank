---
title: Product status
description: What Aura can do now and what requires a provider or release gate.
sidebar:
  order: 1
---

Aura is a browsable product preview. Every section can be explored without signing in, using clearly labeled fictional data. Personal records and financial actions require authentication and applicable invitation, country, and security checks. The current deployed site may lag this source branch.

| Area | Current capability | Boundary |
| --- | --- | --- |
| Overview | Base wallet balances and supported Aave positions | Chains and protocols are authoritative; values depend on live reads |
| Deposit | Crypto receiving address and Aura tag page | Bank instructions require an active Bridge account and complete provider details |
| Send | Governed Base crypto transfer preparation and saved addresses | Wallet signing, policy, simulation, and settlement checks apply; bank payout execution is not connected |
| Swap | LI.FI asset search and route discovery through Aura's reviewed flow | A route is shown only when policy and exact-call preparation permit it; execution can remain paused |
| Earn and Borrow | Curated Aave market and position reads | New supply, withdrawal, borrowing, and repayment are paused until governed execution is ready; Sky and Morpho are not connected |
| Invest | Supported crypto routes | Tokenized stocks and metals require eligibility and a connected execution provider |
| Cards | Issuer-backed card projection, when available | Issuance, freeze, limits, countries, PIN, wallet provisioning, termination, and disputes need Bridge/Rain program and control adapters |
| Rewards | Availability information | Cashback and benefits need a contracted and funded provider program |
| Transactions and Insights | Aura workflow evidence plus available chain and Aave activity | Exports show their coverage; issuer card transaction feed is not connected |
| Settings and Support | Privy passkeys, recovery, wallet export, transaction limits, account lock, privacy controls, and support cases | Session management and passcode changes depend on identity-provider capabilities; assistant depends on configured AI availability |
| Aura tag payment page | Opted-in, verified linked crypto address | Bank transfer requires provider instructions; card payment requires an acquiring or payment-link provider |

A screen or database record is not proof that a regulated service is active. No bank account, payment card, securities trade, or reward is promised until its provider connection, country eligibility, terms, and operational controls are in place. Aura does not give regulated investment advice. Aave and swap rates can change, and onchain transactions may be irreversible.

See [sources of truth](/concepts/sources-of-truth/), [account controls](/safety/account-controls/), and [provider responsibilities](/company/provider-responsibilities/).

Last reviewed: 24 September 2026.
