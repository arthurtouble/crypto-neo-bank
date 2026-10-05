---
title: Sources of truth
description: "Which system has the final word on your balances, identity, controls, and transaction records: the blockchain, Privy, partners, or Aura."
---

Aura isn't the record of your balance. What you own, and whether a payment went through, is recorded on public blockchains, by services like Aave, Morpho, Hyperliquid, and Polymarket, and, later, by approved partners. Aura's own records still need protecting: your security settings, consent records, and transaction evidence.

## Who has the final word

| Data | Final word | What Aura does |
| --- | --- | --- |
| Wallet balance | The blockchain | Reads it, formats it, and shows it |
| Earn position | Aave's or Morpho's contract | Reads it and prepares supported actions |
| Perps and predictions accounts | Hyperliquid and Polymarket | Reads them and shows your balance and positions |
| Whether a transaction completed | The blockchain, or the partner | Tracks it, checks it, and explains problems |
| Who you are when you sign in | Privy | Protects your records and sessions |
| Control of your wallet | You, through Privy | Asks you to sign. Never holds a key |
| Your security settings | Your choices, stored by Aura | Applies them inside Aura and records changes |
| Future bank balance | The bank partner | Shows the partner's record |
| Identity verification | The partner, once live | Uses only the status it needs |
| Support chats | Intercom | Keeps the conversation, how it was handled, and the outcome |
| Product analytics | Aura | Measures a fixed list of events. Never used for balances |

## What can be rebuilt

Balances, Earn positions, and confirmed transactions can always be reread from the blockchain. Aura may keep a copy to load pages faster. Rebuilding can be slow, sources can disagree or be down, and past context is harder to recover than current balances.

## What can't be thrown away

Your security settings, saved recipients, waiting periods, the checks Aura ran, consent versions, support messages, and partner update records. Losing them wouldn't change your balance, but it could weaken your controls or stop us explaining what happened. We protect them with access controls, backups, restore tests, and clear retention and deletion rules.

## Checking against the source

When Aura's records and the source differ, the source wins. For a blockchain transaction, Aura checks the network, transaction hash, receipt, block, and expected result. For a partner update, it compares the partner's history with what you see. Differences go to our operations team. We never overwrite them silently.

## If something goes wrong

If Aura can't trust its own records, the affected features pause. Our team restores saved evidence, rereads the blockchain or partner, and records anything still unexplained. Your wallet doesn't depend on Aura's records, so you keep control of your assets.
