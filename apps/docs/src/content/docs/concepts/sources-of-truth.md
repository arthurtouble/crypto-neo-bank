---
title: Sources of truth
description: Which system has the final word on balances, identity, controls, and transaction records.
---

Aura isn't the record of your balance. Ownership and settlement live on public blockchains, in protocol contracts, and, later, with approved partners.

That lowers the risk of Aura losing track of your money. It doesn't mean Aura keeps nothing important. Your security settings, consent records, support cases, and transaction evidence still need protecting.

## Who has the final word

| Data | Final word | What Aura does |
| --- | --- | --- |
| Wallet balance | The blockchain | Reads it, formats it, and shows it |
| Earn position | The protocol contract | Reads it and prepares supported actions |
| Whether a transaction settled | The blockchain, or the partner | Tracks it, checks it, and explains problems |
| Who you are when you sign in | Privy | Protects your records and sessions |
| Control of your wallet | You, through Privy | Asks you to sign. Never holds a key |
| Your security settings | Your choices, stored by Aura | Applies them inside Aura and records changes |
| Future bank balance | The bank partner | Shows the partner's record |
| Identity verification | The partner, once live | Uses only the status it needs |
| Support chats | Intercom | Keeps the conversation, how it was handled, and the outcome |
| Product analytics | Aura | Measures a fixed list of events. Never used for balances |

## What can be rebuilt

Balances, protocol positions, and confirmed transactions can always be read again from the blockchain. Aura may keep a copy to load pages faster.

Rebuilding still takes effort. It can be slow, sources can disagree or be down, and past context can be harder to recover than current balances.

## What can't be thrown away

Your security settings, saved recipients, waiting periods, the checks Aura ran, consent versions, support messages, and partner update records aren't disposable. Losing them wouldn't change your balance, but it could weaken your controls or stop us explaining what happened.

So we protect them with access controls, backups, restore tests, and clear rules for how long we keep them and how we delete them.

## Checking against the source

When Aura compares its records with the source, the source always wins.

For a blockchain transaction, Aura checks the network, the transaction hash, the receipt, the block, and the expected result. For a partner update, it compares the partner's history with what you see. Differences go to our operations team. They are never silently overwritten.

## If something goes wrong

If Aura can't trust its own records, the affected features pause. Our team restores saved evidence, rereads the blockchain or partner, and records anything that's still unexplained.

Your wallet doesn't depend on Aura's records, so you keep control of your assets. That's an important safety net, but it doesn't excuse a gap in our records.
