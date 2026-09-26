# Accounts and custody

Decision taken on 26 September 2026: the Aura account is the customer's **Privy embedded wallet**, and Privy pays gas for it. Banking and cards stay on direct Bridge and Rain adapters, so fiat and card programs do not depend on Privy.

## What the account is

- Every customer gets one Privy embedded Ethereum wallet at sign-in. Its address is the Aura account on Base and on every other EVM network.
- The server resolves it from Privy (`requireActionAccount` in `apps/web/src/lib/auth/wallet.ts`): the first embedded wallet, with its Privy wallet ID. It is never an external wallet the customer logged in with, and never an address the browser supplies.
- Privy's gas sponsorship upgrades the wallet in place (EIP-7702), so it can run batched, sponsored calls without a separate contract account.

## How a money action is sent

1. Aura's server prepares the exact calls and checks the customer's controls (see [money actions](money-actions.md)).
2. `POST /api/actions/:id/authorize` returns the Privy `wallet_sendCalls` request for those calls, with `sponsor: true`, the action ID as the idempotency key, and the action's expiry as the request expiry (`lib/actions/relay-request.ts`).
3. The browser signs that request with the customer's authorization key (`useAuthorizationSignature`).
4. `POST /api/actions/:id/submit` relays it to Privy with the signature and stores Privy's transaction ID as `relay_reference`. Privy rejects a signature over anything else, so the server cannot send what the customer did not sign.
5. `checkAction` asks Privy for the chain hash once the operation lands, then verifies it from chain evidence like any other action. Privy's answer is never proof of settlement.

If Privy's response is lost, the client retries the same signed request once; Privy does not send the same request key twice.

## Custody

- **Where the key lives.** Privy splits each private key into two shares. One is only decryptable inside a sealed AWS Nitro enclave that Privy operates; the other is released only when the customer authenticates. The key is rebuilt in enclave memory to sign, and only after the login and wallet rules pass.
- **Who can move funds.** Neither Aura nor Privy staff can extract a key without the customer's login. Whoever holds a customer's valid Privy session can sign as them, so account access is wallet access.
- **What that means for Aura.** Aura's server never stores customer Privy tokens and never holds signing keys. Money-moving actions should require a passkey or authenticator code, not only an email code (tracked below).
- **Trust.** Custody depends on Privy's enclave, login system, and continued operation. Describe the product as self-custodial with keys secured by Privy, not as a hardware-wallet equivalent.

## Leaving Privy

The account address is the Privy-held key, so leaving Privy means moving funds, not changing an owner.

- While Privy runs, each customer signs one move to their account at the next provider. `move-previous-account.tsx` is the same pattern, used for the migration below, and should be kept working.
- Customers can also export their private key through Privy.
- Plan any provider change well before Privy's shutdown or contract end; there is no path that works without Privy.

## Migration from the smart-wallet account

Earlier builds used a Privy Kernel smart wallet as the account. Customers who still have funds there see a "Move funds to your new account" panel on the wallet screen. It sends the old smart wallet's USDC, WETH, and ETH on Base to the embedded wallet in one approval, with gas paid by the old paymaster. `SmartWalletsProvider` and the Pimlico paymaster stay configured only until no smart wallet holds funds.

## What stays outside Privy

| Area | Provider |
| --- | --- |
| Bank accounts, KYC, bank payouts | Bridge, direct adapter |
| Cards | Rain, direct adapter |
| Swaps, invest, cross-chain moves | LI.FI route module |
| Earn | Aave v3 and Sky, built in Aura |
| Customer controls and limits | Aura's server |
| Balances | Read from the chain |

## Dashboard configuration

- Fee sponsorship: **Sponsor gas fees** (app pays), prepaid credits with a saved card, and every chain Aura sends from (Base, plus Ethereum for Sky).
- TEE execution is enabled.

## Open items

- Confirm the on-chain shape of the first sponsored operation (EntryPoint version, account encoding) and extend `user-operation.ts` if it differs.
- Require passkey or TOTP MFA before money-moving actions.
- Separate Privy apps for development and production, then HttpOnly cookies on the production domain.
- Privy crypto deposit addresses for exchange deposits on other networks.
