---
title: Cards and controls
description: How the Aura card works, how you get one, and the controls you'll have.
---

:::note[Not available yet]
Aura cards are built but not live. They're waiting for Bridge to approve our card program. Until then, the Cards page says **Cards are coming soon**. Cashback and rewards aren't offered.
:::

The Aura card is a virtual Visa card. It spends the USDC in your Aura account on Base. Bridge approves you for the card, and Stripe issues it. Each account can have one card.

## Getting a card

1. **Verify your identity.** Bridge verifies you once, under **Deposit > Bank**, for both your bank account and your card.
2. **Apply with Bridge.** On the Cards page, select **Apply with Bridge**. Bridge checks you're eligible on its own page. Select **Check status** to see its decision, or what it still needs from you.
3. **Create your card.** Once you're approved, select **Create my card**. You need a passkey on your account, and your account can't be locked. Bridge's approval lasts 24 hours. If it runs out before you create the card, Bridge asks you to confirm your details again.

Your card starts with a daily limit of 500 USD. You can raise it to 10,000 USD a day.

## How payments are paid

Nothing is moved onto the card in advance. Instead, you set a **spending allowance**: the most the card can take from your USDC. You confirm it with your passkey, like any other action. It shows in Transactions as **Card allowance set**, and it doesn't count toward your daily sending limit.

When you buy something, Bridge takes exactly the purchase amount from your USDC at that moment. A purchase is declined if:

- the card is frozen;
- it would go over the card's daily limit;
- it's more than your allowance or your USDC balance.

The Cards page shows your allowance and your USDC balance, read from Base. If Base can't be read, they show **Unavailable**, never zero.

## Controls

- **Freeze card** stops all payments straight away. Unfreezing needs your passkey. You can't unfreeze while your account is locked.
- **Daily limit.** Lowering it applies at once. Raising it needs your passkey.
- **Locking your account** in Settings also tries to freeze your card.

We notify you, in the app and by email or browser if you turned those on, when a card is created, unfrozen, or its limit is raised.

## Card details

Select **Show card details** and confirm with your passkey to see the card number, expiry date, and security code. Stripe shows them in its own secure frame, for 15 minutes at most. Aura never sees or stores your card number.

## Apple Pay and Google Pay

Adding the card to your phone's wallet is built but switched off. It needs Stripe to give us access, and it hasn't been tested with a real wallet yet.

## Card activity

The Cards page lists your card payments: pending holds, declines, paid, refunds, and disputes. Transactions lists them too, with everything else that moves money in your account. Filter by **Card** to see only card activity. A payment's receipt links to the Base transaction in which Bridge took your USDC.

## Disputes

You can dispute a settled payment on your card within 110 days of it. Choose a reason:

- I didn't make this payment;
- I didn't get what I paid for;
- I was charged twice;
- I canceled it;
- something else.

You can send a dispute only once, so include everything. If you think someone else has your card, freeze it first. Visa's process can take weeks. Any credit goes back to your USDC on Base.

## Where card records come from

Stripe owns the card itself: its controls, approving payments, settling them, and disputes. Bridge owns your approval and takes payments from your USDC. Aura keeps only which card is yours. Everything else on the Cards page is read from Stripe and Base each time.

If Aura can't read Stripe, it says so. It never makes up a status.
