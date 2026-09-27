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

Run `pnpm test:mainnet-readiness` to verify chain IDs, allowlisted USDC contract code and a small read-only LI.FI route quote. Set `AURA_SMOKE_URL` to the exact deployment origin and run `pnpm test:deployment` for headers, health, guest browsing and unauthenticated access boundaries. Run `pnpm test:recovery` for an isolated D1 schema recovery drill.

## Human journeys

1. New user: sign in with email or a wallet, accept the terms, confirm the Aura account address (the Privy embedded wallet, the same on every EVM network), and review risk disclosures.
2. Recovery: sign out, use the configured recovery path, confirm the same account address, and inspect or export through Privy's customer flow.
3. Passkey: without a passkey or authenticator app, start a send; confirm it is refused with `mfa_required`, nothing is sent, and Privy's enrollment opens. Enroll, retry, and confirm Privy asks for the new factor before signing.
4. Receive: copy the address and scan the QR code, fund with a small Base amount, refresh and compare against BaseScan.
5. Add from a wallet on Base: connect an external wallet, add a small amount on Base, and confirm it arrives in the account.
6. Add from a wallet on another network: from Ethereum, Arbitrum, Optimism, or Polygon, quote and send a small amount; confirm the same asset arrives on Base and that the source and Base states are shown separately.
7. Card funding: open Pay by card, complete a small card purchase in Privy's flow, and confirm the USDC arrives on Base.
8. Send: on Base, send to an address, a saved recipient, an Aura tag, and an own linked wallet. Save a new address with a name while sending, and see it offered next time. Send a small amount of USDC to another network; check the amount received and fees in the review, and that the action is complete only after delivery. Observe cooling for a new recipient, check the review step, approve with the passkey, and confirm the action reaches `confirmed`. Confirm a send to the account's own address or to a registered token contract is refused.
9. Swap and cross-chain: quote a route, check price impact and slippage, sign approval and route as one operation, and confirm source and destination states are shown separately.
10. Earn: Aave supply and withdraw of USDC and WETH on Base; deposit, withdraw an amount, and withdraw all in each Morpho vault (Steakhouse Prime USDC, Gauntlet USDC Prime) on Base.
11. Controls: turn on account lock, a daily limit, and saved-recipients-only; confirm preparation is blocked. Pause an asset in the operations console and confirm actions in it are refused.
12. Failure: reject a wallet prompt, let a quote expire, and let an action expire unsubmitted; verify clear recovery. Confirm Privy paid the gas for each action.
13. Support: submit normal and urgent cases without exposing secrets; verify operator triage.

## 100-movement matrix

Allocate at least 20 movements to Base direct send/receive and at least 10 to each published routed USDC source/destination combination selected for launch. Include approval-required, customer-rejected, expired-quote and destination-delay cases. A route is not published merely because LI.FI can quote it; it must pass this matrix and have a recovery procedure.

For each movement record: tester ID alias, build version, UTC time, source/destination chain, token contract, displayed amount/fees, wallet prompt comparison, action ID, transaction hash, destination evidence, duration, result, issue ID and reviewer. Never place sensitive authentication material in the evidence file.

## Exit criteria

- At least 100 movements; at least 98% supported-flow completion.
- Every failure classified as customer action, Aurel defect, provider/protocol issue, chain condition or expected policy block.
- All destination-delay exercises completed and recoverable.
- No unexplained transaction, unresolved critical/high defect or misleading state label.
- Independent security review completed before public launch.

This repository supplies the test protocol and non-signing automation. Funded-wallet execution requires an authorized human tester and is intentionally not claimed as complete here.
