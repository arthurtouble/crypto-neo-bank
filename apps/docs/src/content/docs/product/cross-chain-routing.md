---
title: Cross-chain routes
description: How USDC bridge routes are reviewed and tracked.
---

Swap can find supported USDC routes between Base and another network. A LI.FI quote estimates output, fees, timing, and any token approval. It expires and is not a completed transfer.

Aura checks the asset, networks, amount, spender, contract calls, and account controls before asking the wallet to sign. An ERC-20 approval is a separate transaction. Its allowance can remain if the later route fails or is cancelled. Review both wallet prompts and keep native gas for each step.

Source-chain confirmation shows that the route transaction ran. It does not prove that USDC arrived on the destination chain. Bridges and relayers can delay or fail delivery. Aura tracks the route reference, source transaction, and supported destination evidence separately.

If delivery appears delayed, check the source transaction, route status, destination address, and destination explorer before retrying. Repeating a route can send funds twice. Open a support case with the route reference and transaction hash if it remains unresolved; never share a private key or recovery phrase.
