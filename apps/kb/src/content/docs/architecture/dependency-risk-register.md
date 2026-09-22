---
title: Dependency risk register
description: Tracked dependency advisories, reachability, mitigations, and review dates.
---

Reviewed 22 September 2026. Production dependency policy blocks unresolved High or Critical advisories. Moderate transitive findings require a written reachability assessment, compensating controls, an upstream owner, and review before public launch.

| Advisory | Path | Private-beta assessment | Controls and disposition |
|---|---|---|---|
| `GHSA-w5hq-g745-h8pq` (`uuid` below 11.1.1) | Transitive through Privy → wagmi connectors → MetaMask utilities | Moderate. The vulnerable buffer-writing form is not called by Aurel application code. Forcing an incompatible major version beneath wallet SDKs could destabilize authentication or signing. | Keep Privy/connectors current; never accept a caller-supplied UUID output buffer; CI fails on High/Critical findings; review on every lockfile update and monthly during beta. Remove when the connector tree adopts the patched release. |
| `GHSA-vcc3-ghjq-m6fr` (`decode-uri-component` through 0.4.2) | Transitive through Privy → wagmi → WalletConnect/Reown → `query-string` | Moderate denial-of-service risk from adversarial malformed percent encoding in a wallet-connection path. No Aurel server endpoint imports this package directly. | Existing CSP, rate controls, bounded authenticated workflows, and customer-controlled wallet reconnection limit impact. Keep WalletConnect/Reown current; monitor upstream; review before expanding beyond the controlled beta. |

## Operating rule

Run `pnpm audit --audit-level high` in CI and before production releases. A new High or Critical finding stops release. Moderate findings may proceed only when this register names the dependency path, reachability, compensating controls, owner, and next review. Do not use package-manager overrides across wallet SDK major versions without a full authentication, recovery, connection, signing, and mobile regression pass.

Owner: product security. Next mandatory review: 22 October 2026 or any Privy/wagmi/WalletConnect upgrade, whichever comes first.
