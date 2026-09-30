---
title: Security model
description: How Aura protects sign-in, preparing transactions, signing, and settlement.
sidebar:
  order: 1
---

No single safeguard can stop every loss, so we use several layers, each with a clear job. We assume browsers, software libraries, partners, protocols, and people can all make mistakes or be attacked.

## Signing in

Privy runs sign-in and your wallet. You sign in with your email or a wallet. Our server checks your Privy sign-in on every protected request. It never trusts an identity your browser claims.

Signing in proves you can access the account. It doesn't prove a transaction is safe. So we also check each money movement before you confirm.

## Passkey

You need a passkey or an authenticator app before money can leave your account. You confirm each money action with it. Someone with only your sign-in can't move money.

## Preparing a transaction

Our server builds every money movement. It checks that the feature is on and applies any controls you've set. Then it builds the exact transaction and records what it should do on the blockchain.

If you've set a daily limit and we can't value the amount, we block the movement. An unknown value never passes as a small one.

## Signing

You review the transaction in Aura, then confirm with your passkey or cancel. We send the signed request to Privy, which submits it and pays the network fee. We never hold your keys and can't sign for you.

## Settlement

The blockchain, or the partner, decides whether a movement settles. We then read the blockchain ourselves. We mark a movement complete only when:

- what was signed matches what we prepared;
- it's in a block on the network; and
- the expected transfer or deposit appears.

We keep checking until the network makes it final, about 20 minutes later on Base, and show you when it is.

For a move between networks, we also wait for it to arrive. Our database is never the final record of your balance.

## Your controls

These are all optional and off until you turn them on. Changes apply right away, and we keep a record of them.

| Control | Starts as | What it does |
| --- | --- | --- |
| Emergency lock | Off | Stops every send, swap, and Earn move, including ones you started but haven't confirmed. Unlocking needs your passkey |
| Daily limit | Off | Caps the US dollar value you send in any 24 hours, including to your own linked wallets. Swaps within your own account and Earn don't count |
| Saved recipients only | Off | Lets you send only to recipients you've saved |
| Wait before new recipients | 4 hours | When saved recipients only is on, a newly saved recipient can't receive until the wait ends |

See [account controls](/safety/account-controls/).

## How we separate access

- Customer features need a verified sign-in.
- Our operations tools are a separate app with their own staff sign-in. Only a named list of staff can use them. We check that sign-in on every request. If it isn't set up, nobody has access. Your Aura sign-in never opens these tools.
- We record every change our staff make, such as locking or closing an account, with who made it.
- We check networks, assets, and contracts before you confirm.
- Our production secrets stay on the server. They're never in the browser or our source code.
- Updates from partners must carry a valid signature and timestamp before we process them.

## Records and monitoring

Changes that matter for security leave a record we can review after an incident. Every money movement keeps its transaction hash and the checks we ran. Scheduled checks flag stuck movements and failed partner updates.

Monitoring helps us find and explain problems. It can't prevent every attack, and we can't promise to spot one straight away.

## Recovery

If we can't trust our records, the affected features pause. Our team restores saved evidence, reads the blockchain or partner again, and records anything still unexplained.

Your ownership of your assets doesn't depend on our database. We still back up your settings and records and test restoring them, because losing them could weaken your controls.

## Where Aura's protection ends

Our controls only apply to money movements we prepare. They can't stop a transaction signed in another app or with an exported key. Controls built into the wallet itself are planned, not live.

They also can't remove risk from smart contracts, stablecoins, price feeds, bridges, networks, partners, phishing, malware, or your own decisions. See the [threat model](/safety/threat-model/).

To report a problem, see [report a security issue](/safety/report-a-security-issue/).
