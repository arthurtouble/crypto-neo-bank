---
title: Aura content standard
description: Writing and claims standard for product, support, docs, and marketing.
---

Applies to the product, docs, support messages, and legal summaries.

## Rules

1. Start with what the reader needs to know or do.
2. Use familiar verbs: send, receive, review, sign, save, pause.
3. One idea per sentence. Keep most interface sentences under 18 words.
4. Name a partner where the customer's money goes or a result comes from: Aave, Morpho, Hyperliquid, Polymarket, Bridge, Privy, Base, or the customer's wallet. Never name a tool that works behind the scenes (LI.FI, Layerswap, Relay, Gamma, Alchemy).
5. Keep implementation language out of customer copy. The [banned words](#banned-words) never appear; the [glossary](#glossary) says what to write instead.
6. Don't narrate the interface. Labels say what an action does.
7. State limits beside the decision they affect, not in a generic disclaimer.
8. Use sentence case. No slogans, stacked adjectives, or claims we can't prove.
9. Say “you” for the customer. Say “we” only for something Aura itself does (“We never hold your money”), never in an error. Use “customer” only in operational or legal text.
10. Keep precise terms when precision protects the reader, and explain them once in plain language.

## Glossary

Agreed on 4 October 2026 for the polish pass. The left column is what the app said before; write the middle one. Keep the original term only where the right column allows it.

| Seen in the app | Say instead | Keep the term when |
| --- | --- | --- |
| "on the Base network", "Base network" | "on Base", once, where it decides where money can go | Receiving or sending, where the wrong network loses money |
| Bridge, bridging, "Bridge fee" | "Move from another network", "Moving fee" | Never in customer copy (Bridge is also a partner's name) |
| Cross-chain | "Between networks" | Never |
| Network fee "in ETH" | "Network fee" with the dollar amount | Name the asset only if it's paid separately |
| Gas | "Network fee" | Never |
| Protocol, liquidity | Aave or Morpho by name; "Withdrawals depend on how much is available" | Never |
| Provider | The partner's name, or drop it | Never |
| Tokenized stocks, token | "Stocks", or the asset's name | Legal disclosures that must name the instrument |
| Settled, settling, settlement, finality | "Completed", "Pending" | Card holds ("not final yet, can change") |
| Transaction hash, tx | "Transaction" (the link is View transaction) | Never |
| Slippage | "Price can move by up to 0.5%" | Explained once on review screens |
| Leverage, margin, liquidation price | Keep, each with one plain line the first time it appears | Perps only |
| Long, short, reduce-only, TP/SL | "Long (price goes up)", "Short (price goes down)", "Take profit", "Stop loss"; drop "reduce-only" | Perps only |
| Odds, "price to beat" | "Chance", "Starting price"; keep "shares" | Predictions only |
| Passkey | Keep, explained once in Settings | It's Apple's and Google's word |
| Deposit (adding money to Aura) | "Add money" | Earn, where you deposit into Aave or Morpho |
| Insufficient balance, insufficient funds | "Not enough [asset]. You have [amount]." | Never |
| "We couldn't read … from X", "We couldn't load …" | "X can't be loaded right now." with a Try again button | Never |
| "Something went wrong" | What failed and what to do | Only when nothing more is known, followed by what to do |
| Please, sorry, oops | Drop them | Never |

### Banned words

These never appear in customer copy: the app, notices, emails, public docs, and marketing. Operators' screens in the ops app may keep precise terms.

rail, intent, orchestration, provider, protocol, route (as a noun), cross-chain, onchain, settlement, projection, nonce, control plane, posture.

`pnpm copy:check` (`scripts/check-copy.mjs`) finds these, the glossary's other old terms, and "we" in errors, in the web app's strings and the public docs (not the legal documents, whose wording the owner decides). Each file may have no more than `scripts/copy-baseline.json` allows, and `test:unit` fails if one gains a finding. When a feature's copy is fixed, `pnpm copy:check --update` lowers its count. A line that needs the term on purpose ends with a `copy-check: allow` comment.

## The same word for the same action

A customer who learns a word in one place should find it everywhere. Use these, in every feature:

| Action | Word | Not |
| --- | --- | --- |
| Put money into Aura | Add money | Deposit, Fund, Top up |
| Put money into Earn | Deposit | Add, Supply |
| Take money out of Earn | Withdraw | Redeem, Remove |
| Move money to someone | Send | Transfer, Pay (except the payment page) |
| Exchange one asset for another | Swap | Convert, Trade, Exchange |
| Look before paying | Review | Preview, Check |
| Approve with a passkey or wallet | Confirm | Sign, Approve, Submit |
| Load again after a failure | Try again | Retry, Reload, Refresh |
| Leave a sheet or dialog without acting | Cancel (before a choice), Close (after one) | Dismiss, Exit |
| Finish a flow | Done | OK, Finish |
| Start and end a session | Sign in, Sign out | Log in, Log out |
| A finished movement | Completed | Settled, Final, Success |
| Not finished yet | Pending | Processing, Settling, In flight |
| Didn't happen | Failed, or Not sent when nothing left the wallet | Error, Rejected |

Buttons are verbs, and one primary button leads each screen or panel. A disabled button says why next to it.

## Messages and states

- **Error:** what failed, then what to do. "Polymarket's markets can't be loaded right now." with a Try again button. Don't repeat "Try again" in the sentence when the button is there. Put it next to the part that failed.
- **Unavailable:** a value that can't be read says "Unavailable", never an old number or zero, and names what's missing nearby.
- **Blocked before starting:** say why, and the one thing to do: "Add a passkey to send money." Show it before the customer fills a form, not after Confirm.
- **Empty:** what will appear here, and the one button that fills it: "Your transactions will show here." Add money.
- **Guest:** example data is labelled "Example" and is the same across features (the $12.00 card payment at Corner Cafe appears in Cards and Transactions alike).

## Amounts and addresses

- Every amount shows its currency or asset: "$25.00", "0.01 ETH". Dollar amounts have two decimals.
- Fees, minimums, and what the customer gets appear on the review screen before Confirm.
- On the phone, addresses show "0x", the next 4 characters, and the last 4 ("0x12ab…cdef", from `shortAddress` in `apps/web/src/lib/format`), with a Copy button that copies the full address.

## Rewrite prompt

> Rewrite this for Aura, a calm financial product. Preserve every factual limit and warning. Lead with what the reader needs. Use plain English, active voice, sentence case, and short sentences. Remove filler, hype, repeated ideas, implementation jargon, and instructions that the interface should make obvious. Prefer concrete nouns and familiar verbs. Do not add claims, reassurance, urgency, or friendliness that the source does not support. Keep legal meaning intact. Return only the revised copy.

## Review checklist

- Can someone understand the action without helper text?
- Is the first sentence the most useful one?
- Is every claim supported by the current product?
- Does the risk appear before confirmation, not after?
- Could any label be two words shorter?
- Does every word pass the [glossary](#glossary), and does each action use [the same word](#the-same-word-for-the-same-action) as everywhere else?

Based on GOV.UK’s interface-writing guidance: start with less, put important words first, one idea per sentence, and fix the interface before explaining it with copy.
