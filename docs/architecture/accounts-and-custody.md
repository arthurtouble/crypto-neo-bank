# Accounts and custody

Decided 26 September 2026: the Aura account is the customer's **Privy embedded wallet**, with gas paid by Privy. Banking and cards stay on direct Bridge and Stripe Issuing adapters, so they don't depend on Privy. The card spends the wallet's USDC through an on-chain allowance to Bridge's card contract, signed like any other Aura action.

## What the account is

- One Privy embedded Ethereum wallet per customer, created at sign-in. Its address is the Aura account on Base and every other EVM network.
- The server resolves it from Privy (`requireActionAccount` in `apps/web/src/lib/auth/wallet.ts`): the first embedded wallet, with its Privy wallet ID. Never an external login wallet, never an address the browser supplies.
- Privy's gas sponsorship upgrades the wallet in place (EIP-7702), so it runs batched, sponsored calls without a separate contract account.

## How a money action is sent

1. The server prepares the exact calls and checks the customer's controls ([money actions](money-actions.md)).
2. `POST /api/actions/:id/authorize` returns the Privy `wallet_sendCalls` request, with `sponsor: true`, the action ID as idempotency key, and the action's expiry as request expiry (`lib/actions/relay-request.ts`).
3. The browser signs it with the customer's authorization key (`useAuthorizationSignature`).
4. `POST /api/actions/:id/submit` relays it to Privy with the signature and stores Privy's transaction ID as `relay_reference`. Privy rejects a signature over anything else, so the server can't send what the customer didn't sign.
5. `checkAction` asks Privy for the chain hash once the operation lands, then verifies it from chain evidence. Privy's answer is never proof of settlement.

If Privy's response is lost, the client retries the same signed request once; Privy doesn't send the same request key twice.

## Custody

- **Key.** Privy splits each private key into two shares: one decryptable only inside a sealed AWS Nitro enclave Privy operates, the other released only when the customer authenticates. The key is rebuilt in enclave memory to sign, only after the login and wallet rules pass.
- **Who can move funds.** Neither Aura nor Privy staff can extract a key without the customer's login. Whoever holds a valid Privy session can sign as the customer: account access is wallet access.
- **MFA.** Aura's server never stores customer Privy tokens or signing keys. Money leaves only once the customer has a passkey or authenticator app enrolled in Privy (`requireMoneyMfa`); an email or SMS code alone isn't enough. The server checks this before it prepares, relays, or pays out, and the app opens Privy's setup screen when it's missing. After enrollment, Privy asks for that factor before the key signs.
- **Trust.** Custody depends on Privy's enclave, login system, and continued operation. Describe the product as self-custodial with keys secured by Privy, not as a hardware-wallet equivalent.

## Leaving Privy

The address is the Privy-held key, so leaving Privy means moving funds, not changing an owner.

- While Privy runs, each customer signs one move to their account at the next provider. `move-previous-account.tsx` uses the same pattern for the migration below; keep it working.
- Customers can export their private key through Privy.
- Plan any provider change well before Privy's shutdown or contract end; no path works without Privy.

## Migration from the smart-wallet account

Earlier builds used a Privy Kernel smart wallet. Customers with funds there see "Move funds to your new account" on Overview (`dashboard.tsx`) and Send (`wallet-workspace.tsx`). It sends the old wallet's USDC, WETH, and ETH on Base to the embedded wallet in one approval, with gas paid by the old paymaster. `SmartWalletsProvider` and the Pimlico paymaster stay configured only until no smart wallet holds funds.

## What stays outside Privy

| Area | Provider |
| --- | --- |
| Bank accounts, KYC, bank payouts | Bridge, direct adapter |
| Cards | Bridge (card approval, cardholder, USDC collection) and Stripe Issuing (card, controls, authorizations, disputes), direct adapters |
| Swaps and cross-chain moves | LI.FI route module |
| Earn | Aave v3 and Morpho vaults on Base, built in Aura |
| Customer controls and limits | Aura's server |
| Balances | Read from the chain |

## Dashboard configuration

- Fee sponsorship: **Sponsor gas fees** (app pays), prepaid credits with a saved card, on every chain Aura sends from (Base, plus Ethereum for Tether Gold sends and swaps).
- TEE execution on.
- MFA: passkeys and authenticator apps on.

## Open items

- Confirm the on-chain shape of the first sponsored operation (EntryPoint version, account encoding); extend `user-operation.ts` if it differs.
- Confirm on dev that Privy prompts for the passkey on relayed sends. If not, add an explicit verification step before signing.
- Separate Privy apps for development and production, then HttpOnly cookies on the production domain.
- Privy crypto deposit addresses for exchange deposits on other networks.
