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

1. New user: authenticate, enroll passkey, create or connect wallet, review risk disclosures.
2. Recovery: sign out, use the configured recovery path, confirm the same public address, inspect/export through Privy’s customer flow.
3. Receive: copy and QR address, fund with a small Base amount, refresh and compare against BaseScan.
4. Direct send: save destination, observe cooling policy, preview/simulate, verify wallet prompt, sign, follow receipt.
5. Cross-chain: request supported native USDC route, verify exact approval, sign approval and route, distinguish source from destination state.
6. Aave: verify market and position, prepare supply/withdraw and borrow/repay only with understood liquidation risk.
7. Controls: turn on account lock and saved-destination-only; confirm preparation fails closed; turn off only after reauthentication.
8. Failure: reject a wallet prompt, use insufficient gas, allow a quote to expire and verify clear recovery.
9. Support: submit normal and urgent cases without exposing secrets; verify operator triage.

## 100-movement matrix

Allocate at least 20 movements to Base direct send/receive and at least 10 to each published routed USDC source/destination combination selected for launch. Include approval-required, customer-rejected, expired-quote, insufficient-gas and destination-delay cases. A route is not published merely because LI.FI can quote it; it must pass this matrix and have a recovery procedure.

For each movement record: tester ID alias, build version, UTC time, source/destination chain, token contract, displayed amount/fees, wallet prompt comparison, approval hash, route hash, destination evidence, duration, result, issue ID and reviewer. Never place sensitive authentication material in the evidence file.

## Exit criteria

- At least 100 movements; at least 98% supported-flow completion.
- Every failure classified as customer action, Aurel defect, provider/protocol issue, chain condition or expected policy block.
- All destination-delay exercises completed and recoverable.
- No unexplained transaction, unresolved critical/high defect or misleading state label.
- Independent security review completed before public launch.

This repository supplies the test protocol and non-signing automation. Funded-wallet execution requires an authorized human tester and is intentionally not claimed as complete here.
