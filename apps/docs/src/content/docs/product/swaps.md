---
title: Swap
description: How Aura searches assets and reviews cross-chain routes.
---

Aura searches supported assets and asks LI.FI for available swap and cross-chain routes. A quote is a time-sensitive proposal, not a completed transaction. Prices, fees, liquidity, and destination delivery can change before signing.

The governed swap flow checks asset identity, contract targets, approvals, account policy, and exact transaction calls before a wallet can be asked to sign. Some routes are unavailable because those checks or destination settlement evidence are incomplete. Aura does not send a raw provider transaction directly from an unreviewed browser quote.

A token swap may require a separate onchain approval. Review each wallet prompt, including the spender and allowance. An approval can remain after a swap fails or is cancelled; you can revoke it separately. For cross-chain routes, source-chain confirmation does not establish that the destination asset arrived. Aura shows the route state until supported destination evidence is available.

The wallet and chains remain authoritative for balances and transactions. [Check current availability](/getting-started/status/) before relying on a route.
