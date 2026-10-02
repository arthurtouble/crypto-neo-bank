---
title: Mainnet acceptance test plan
description: Acceptance evidence required before expanding supported mainnet workflows.
---

## Safety rules

- Use designated tester wallets and small amounts the tester can afford to lose.
- Verify network, token contract, amount, destination and fee in the wallet before signing.
- Automated tests are read-only and never sign or broadcast.
- Do not test unsupported assets or treat a source-chain receipt as proof of destination delivery.
- Record transaction hashes, not seed phrases, private keys, recovery secrets or one-time codes.

## Automated preflight

- `pnpm test:mainnet-readiness`: chain IDs, allowlisted USDC contract code, and a small read-only LI.FI route quote.
- `AURA_SMOKE_URL=<exact deployment origin> pnpm test:deployment`: headers, health, the app shell, and unauthenticated access boundaries.
- `pnpm test:recovery`: an isolated D1 schema recovery drill.

## Human journeys

1. New user: sign in with email, Google, Telegram, or a wallet, accept the terms, confirm the Aura account address (the Privy embedded wallet, the same on every EVM network), and review risk disclosures.
2. Recovery: sign out, use the configured recovery path, confirm the same account address, and inspect or export through Privy's customer flow.
3. Passkey: without a passkey or authenticator app, start a send; confirm it is refused with `mfa_required`, nothing is sent, and Privy's enrollment opens. Enroll, retry, and confirm Privy asks for the new factor before signing.
4. Receive: copy the address and scan the QR code, fund with a small Base amount, and compare against BaseScan.
5. Add from a wallet on Base: connect an external wallet, add a small amount on Base, and confirm it arrives in the account.
6. Add from a wallet on another network: from Ethereum, Arbitrum, Optimism, or Polygon, quote and send a small amount; confirm the same asset arrives on Base and that the source and Base states are shown separately.
7. Card funding: open Pay by card, complete a small card purchase in Privy's flow, and confirm the USDC arrives on Base.
8. Send: on Base, to an address, a saved recipient, an Aura tag, and an own linked wallet. Save a new address with a name while sending, and see it offered next time. Send a small amount of USDC to another network; check the amount received and fees in the review, and that the action completes only after delivery. Observe cooling for a new recipient, check the review, approve with the passkey, and confirm the action reaches `confirmed`. Confirm sends to the account's own address or a registered token contract are refused.
9. Swap and cross-chain: quote a route, check price impact and slippage, sign approval and route as one operation, and confirm source and destination states are shown separately.
10. Earn: Aave supply, withdraw an amount, and withdraw all, of USDC and WETH on Base; deposit, withdraw an amount, and withdraw all in each Morpho vault (Steakhouse Prime USDC, Gauntlet USDC Prime) on Base.
11. Controls: turn on account lock, a daily limit, and saved-recipients-only; confirm preparation is blocked. Pause an asset in the operations app and confirm actions in it are refused. Lock an account from the operations app; confirm sending stops, the customer is told, and only their passkey unlocks it.
12. Failure: reject a wallet prompt, let a quote expire, and let an action expire unsubmitted; verify clear recovery. Confirm Privy paid the gas for each action.
13. Support: open the in-app chat (Intercom), ask Fin about a recent transaction, reach the team, and use both report-a-problem paths without exposing secrets; ask to close the account and confirm the operator sees the verified Aura user ID.
14. Cards (once Bridge's card program and Stripe are connected): apply with Bridge, create the card, set a small allowance and confirm it on BaseScan, make a small purchase and confirm Bridge took exactly that amount, trigger a decline over the allowance, freeze and unfreeze (passkey), lower and raise the daily limit (passkey to raise), show card details (passkey), lock the account and confirm the card is frozen in Stripe, and dispute a settled purchase.

## 100-movement matrix

At least 20 movements for Base direct send and receive, and at least 10 for each routed USDC source and destination pair selected for launch. Include approval-required, customer-rejected, expired-quote, and destination-delay cases. A route isn't published because LI.FI can quote it; it must pass this matrix and have a recovery procedure.

Record for each: tester alias, build version, UTC time, source and destination chain, token contract, displayed amount and fees, wallet prompt comparison, action ID, transaction hash, destination evidence, duration, result, issue ID, and reviewer. Never put authentication material in the evidence file.

## Exit criteria

- At least 100 movements; at least 98% supported-flow completion.
- Every failure classified as customer action, Aura defect, provider/protocol issue, chain condition or expected policy block.
- All destination-delay exercises completed and recoverable.
- No unexplained transaction, unresolved critical/high defect or misleading state label.
- Independent security review completed before public launch.

The repository supplies the protocol and non-signing automation. Funded-wallet runs need an authorized human tester and are not claimed as complete here.
