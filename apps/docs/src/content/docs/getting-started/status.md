---
title: Product status
description: What Aura can do now and what requires a provider or release gate.
sidebar:
  order: 1
---

Aura is a browsable product preview. Every section can be explored without signing in, using clearly labeled fictional data. Anyone can sign in. Personal records require authentication, and financial actions also depend on feature availability and your account controls. The current Aura development site uses this branch; it is not a production release.

| Area | Current capability | Boundary |
| --- | --- | --- |
| Overview | Base wallet balances, Aave positions, and Ethereum Sky sUSDS | Chains and protocols are authoritative; values depend on live reads |
| Deposit | Crypto receiving address and Aura tag page | Bank instructions require an active Bridge account and complete provider details |
| Send | Governed Base crypto transfer preparation and saved addresses | Wallet signing, policy, simulation, and settlement checks apply; bank payout execution is not connected |
| Swap | LI.FI asset search and reviewed Base swaps and USDC bridges | Only routes that pass exact-call checks can be prepared; destination delivery needs separate confirmation |
| Earn and Borrow | Aave supply, withdrawal, borrowing, and repayment on Base; Sky USDC deposits and withdrawals on Ethereum | Wallet approval, network fees, and chain settlement apply; Morpho is not connected |
| Invest | Supported crypto routes | Tokenized stocks and metals require eligibility and a connected execution provider |
| Cards | Issuer-backed card projection, when available | Issuance, freeze, limits, countries, PIN, wallet provisioning, termination, and disputes need Bridge/Rain program and control adapters |
| Rewards | Availability information | Cashback and benefits need a contracted and funded provider program |
| Transactions and Insights | Aura workflow evidence plus available chain and Aave activity | Exports show their coverage; issuer card transaction feed is not connected |
| Settings and Support | Privy passkeys, recovery, wallet export, transaction limits, account lock, privacy controls, and support cases | Session management and passcode changes depend on identity-provider capabilities; assistant depends on configured AI availability |
| Aura tag payment page | Opted-in, verified linked crypto address | Bank transfer requires provider instructions; card payment requires an acquiring or payment-link provider |

A screen or database record is not proof that a regulated service is active. No bank account, payment card, securities trade, or reward is promised until its provider connection, country eligibility, terms, and operational controls are in place. Aura does not give regulated investment advice. Aave and swap rates can change, and onchain transactions may be irreversible.

See [sources of truth](/concepts/sources-of-truth/), [account controls](/safety/account-controls/), and [provider responsibilities](/company/provider-responsibilities/).

Last reviewed: 25 September 2026.
