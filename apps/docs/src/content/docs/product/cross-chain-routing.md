---
title: Cross-chain routes
description: How cross-chain moves are quoted, signed, and tracked.
---

Swap can move a supported asset from one network to another. LI.FI finds the route and estimates output, fees, and timing. The quote expires after 45 seconds and is not a transfer.

Aura checks the assets, networks, amount, recipient, price impact, and your account controls before your wallet opens. Any token approval and the route are signed together, as one operation.

The first network confirming shows the route started. It does not prove the asset arrived. Aura shows the move as on its way until LI.FI reports delivery and Aura sees at least the minimum amount reach your wallet on the other network.

If delivery looks delayed, check the transaction in Activity and on both networks' explorers before retrying. Repeating a route can send funds twice. Open a support case with the transaction hash if it stays unresolved. Never share a private key or recovery phrase.
