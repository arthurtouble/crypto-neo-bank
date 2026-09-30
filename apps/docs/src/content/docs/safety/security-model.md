---
title: Security model
description: How Aura protects sign-in, checks each transaction before you confirm, and verifies it on the blockchain after.
---

No single safeguard stops every loss, so we use several layers. We assume browsers, software libraries, partners, protocols, and people can all make mistakes or be attacked. None of these checks gives us control of your wallet or makes a transaction reversible.

## Signing in

Privy runs sign-in and your wallet. You sign in with your email or a wallet. Our server checks your Privy sign-in on every protected request and never trusts an identity your browser claims.

Signing in proves you can access the account, not that a transaction is safe. So you also need a passkey or an authenticator app before money can leave your account, and you confirm each money action with it. Someone with only your sign-in can't move money.

## Before you confirm

Our server builds every money movement. It checks that the feature is on and the asset isn't paused, applies any [controls](/safety/account-controls/) you've set, and builds the exact transaction.

If you have a daily limit, we value the amount in US dollars:

- USDC counts as $1.
- EURC, tokenized stocks, and Tether Gold use their Chainlink price feed, if it's recent enough.
- ETH and WETH use a recent ETH price from Kraken, and cbBTC a recent BTC price.
- Anything else uses the value in the quote for the swap or move.

If we can't find a value, we stop the action. An unknown value never passes as a small one, and we never use an estimate from your browser.

You confirm any token approval together with the action it allows, as one step. Swap quotes stay on our server, so your browser can't change the transaction.

## Signing

You review the transaction in Aura, then confirm with your passkey or cancel. We send the signed request to Privy, which submits it and pays the network fee. Aura never holds your keys and can't sign for you.

## After you submit

A transaction hash means something was sent to the network, not that you got the result you expected. The blockchain, or the partner, decides whether a movement settles. We read the blockchain ourselves and mark a movement **Completed** only when:

- it came from your wallet and contains exactly what we prepared;
- it's in a block on the network; and
- the expected transfer, deposit, or withdrawal appears.

On Base that's usually within seconds, as in mainstream wallets. We keep checking until the network makes it final, about 20 minutes later on Base, and the receipt shows when it is. If the result changed before then, we would mark it failed.

For a move between networks, we also wait for LI.FI to report delivery, and check that at least the minimum amount reached your wallet on the other network.

If we don't get a transaction hash in time, the action shows as **Not confirmed**, not failed. Check your activity before you try again. What each status means: [transactions and their status](/product/transaction-lifecycle/). Our database is never the final record of your balance.

## How we separate access

- Customer features need a verified sign-in.
- Our operations tools are a separate app with their own staff sign-in, limited to a named list of staff and checked on every request. If it isn't set up, nobody has access. Your Aura sign-in never opens these tools.
- We record every change our staff make, such as locking or closing an account, with who made it.
- Production secrets stay on the server, never in the browser or our source code.
- Partner updates must carry a valid signature and timestamp before we process them.

## Records and monitoring

Changes that matter for security leave a record we can review after an incident. Every money movement keeps its transaction hash and the checks we ran. Scheduled checks flag stuck movements and failed partner updates. Monitoring can't prevent every attack, and we can't promise to spot one straight away.

Your ownership of your assets doesn't depend on our database. If we can't trust our records, the affected features pause; see [sources of truth](/concepts/sources-of-truth/#if-something-goes-wrong).

## Where Aura's protection ends

Our controls only apply to money movements we prepare. They can't stop a transaction signed in another app or with an exported key, and they don't freeze your wallet. Controls built into the wallet itself are planned, not live.

They also can't remove risk from smart contracts, stablecoins, price feeds, bridges, networks, partners, phishing, malware, or your own decisions. See [what could go wrong](/safety/threat-model/). To report a problem, see [report a security issue](/safety/report-a-security-issue/).
