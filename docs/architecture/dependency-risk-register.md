---
title: Dependency risk register
description: Tracked dependency advisories, reachability, mitigations, and review dates.
---

Reviewed 22 September 2026. Owner: product security. Next mandatory review: 22 October 2026, or any Privy/wagmi/WalletConnect upgrade, whichever comes first.

| Advisory | Path | Assessment | Controls and disposition |
|---|---|---|---|
| `GHSA-w5hq-g745-h8pq` (`uuid` below 11.1.1) | Transitive: Privy → wagmi connectors → MetaMask utilities | Moderate. Aurel code doesn't call the vulnerable buffer-writing form. Forcing an incompatible major version under wallet SDKs could break authentication or signing. | Keep Privy/connectors current; never accept a caller-supplied UUID output buffer; review on every lockfile update and monthly until launch. Remove when the connector tree adopts the patched release. |
| `GHSA-vcc3-ghjq-m6fr` (`decode-uri-component` through 0.4.2) | Transitive: Privy → wagmi → WalletConnect/Reown → `query-string` | Moderate denial of service from malformed percent encoding in a wallet-connection path. No Aurel server endpoint imports it directly. | CSP, rate controls, bounded authenticated workflows, and customer-controlled wallet reconnection limit impact. Keep WalletConnect/Reown current; monitor upstream; review before launch. |
| `GHSA-ch52-4w7c-c8xp` (`http-cache-semantics`, no patched release) | Transitive: `apps/docs` → Astro and Starlight | High denial of service. Reached only through the public docs site's Astro tooling, not the customer app or money paths. | Ignored in `pnpm-workspace.yaml` `auditConfig.ignoreGhsas` since 3 October 2026 (owner's decision), so CI stays usable. Remove the ignore when Astro ships a patched release. Still decide before production launch. |
| `GHSA-vfj7-8cjw-p6xm` (`braces`, no patched release) | Transitive: `apps/web` → vinext's Vite plugins and `eslint-config-next` → `fast-glob` → `micromatch` | High denial of service from deeply nested brace patterns. Used by build and lint tooling on patterns in the repo, not on customer input. | Ignored in `pnpm-workspace.yaml` `auditConfig.ignoreGhsas` since 3 October 2026 (owner's decision). Remove the ignore when `braces` ships a patched release. Still decide before production launch. |

## Operating rule

- Run `pnpm audit --audit-level high` in CI and before production releases. A new High or Critical finding stops release. An advisory with no patched release can be ignored in `auditConfig.ignoreGhsas` only with the owner's approval and a row here; ignored rows are reviewed before production launch.
- A Moderate finding may ship only when this register names its path, reachability, compensating controls, owner, and next review, reviewed before public launch.
- Don't use package-manager overrides across wallet SDK major versions without a full authentication, recovery, connection, signing, and mobile regression pass.
