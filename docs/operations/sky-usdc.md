# Sky USDC savings on Ethereum

The Earn card uses Spark's deployed [PSMVariant1Actions USDS wrapper](https://github.com/sparkdotfi/spark-user-actions#deployments) at `0xd0A61F2963622e992e6534bde4D52fd0a89F39E0`. Its `swapAndDeposit` call transfers Ethereum USDC, converts through the [USDS PSM](https://github.com/sparkdotfi/spark-user-actions/blob/master/src/PSMVariant1Actions.sol), and deposits USDS into Sky sUSDS for the customer's own wallet. `withdrawAndSwap` reverses this into Ethereum USDC. There is no separate customer USDC-to-USDS swap.

Sky deposits and withdrawals are `earn` [money actions](../architecture/money-actions.md) on Ethereum. The server verifies the wrapper's live `gem`, `dai`, `savingsToken`, and `psm` addresses, reads the smart wallet's USDC and sUSDS balances, and builds the exact approval and wrapper call as one batch. Calls bind the recipient to the customer's smart wallet and cap conversion loss or fees at 1% from USDC par. The verifier confirms the operation after 12 Ethereum confirmations with the expected USDC and sUSDS events. The card shows no APY promise.

Customers need USDC on Ethereum. Base USDC can be moved there first as a separate cross-chain route; the route and the Sky deposit are two actions.

Read-only mainnet inspection on 24 September 2026 confirmed the wrapper has deployed code and points to Ethereum USDC, USDS, sUSDS, and PSM `0xA188EEC8F81263234dA3622A406892F3D630f98c`. The PSM `tin` and `tout` were both zero at that observation. Neither the fees nor vault availability are guaranteed to remain so. No funded Sky action has been signed yet.
