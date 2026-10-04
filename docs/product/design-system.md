---
title: Aura design system
description: The redesign's visual language. Tokens for colour, type, spacing, sizes, radius, elevation, and motion, then components and patterns for desktop and phone, in light and dark.
---

Phase 4 of [the redesign](../overview/redesign.md), written on 29 September 2026 from the owner's picks in [redesign-direction.md](redesign-direction.md): Mercury and Stripe as the closest products, neutral greys with one **ultramarine** accent, **Geist** for type, balanced density, soft and subtle corners, light and dark following the device.

Three files hold the system, and they must agree:

| File | For | What it holds |
| --- | --- | --- |
| [`apps/web/public/design-tokens.css`](../../apps/web/public/design-tokens.css) | Code | Every token as a CSS variable, light and dark, with the phone overrides. The single source of values. |
| [`/design-system.html`](../../apps/web/public/design-system.html) | Review | The reference page: every token and component rendered, with a Device, Light, and Dark switch. |
| [`DESIGN.md`](../../DESIGN.md) | Coding agents | The same tokens in YAML, and the rules in short. |
| This document | People | The rules, the reasons, and the specs per device. |

Change a value in `design-tokens.css` first, then here, `DESIGN.md`, and the reference page, in the same pull request.

The root layout loads `design-tokens.css` for the whole app, and every area is styled from the tokens in its own stylesheet (the table below). The root layout also loads the shell and public-page stylesheets; the app-only areas (overview, money, cards, records, settings, markets) load from `src/app/app/layout.tsx`, after them, so the landing and payment pages don't download them. The pre-redesign `identity.css` and `product-system.css` are gone. `globals.css` still loads first with only the resets (box sizing, links, and form controls inheriting the font); the page canvas, text, selection, the one focus ring (2px `--color-focus`), and the few shared utilities (`srOnly`, `spin`, `sensitiveAmount`, `buildTag`) are in `shell.css`. Don't add to `globals.css`; new styles go in the area stylesheets.

| Area | Where | Status |
| --- | --- | --- |
| App shell: sidebar, top bar, phone header, menu button and sheet, account menu, notifications, toasts, terms and account screens | `apps/web/src/app/shell.css`, classes prefixed `app` | Rebuilt |
| Overview: total, group chips, holdings table or list, holding detail, recent transactions, guest example, empty account | `apps/web/src/app/overview.css`, classes prefixed `ov`; the shared guest banner is in `shell.css` | Rebuilt |
| Deposit: the four ways as tabs (desktop) or rows (phone), receive, from a wallet, card, bank checklist and details | `apps/web/src/app/money.css`, classes prefixed `mx`, shared with Send and Swap | Rebuilt |
| Send: two tabs (to a person or wallet, to a bank account), amount and asset, recipient faces, one To field for an address or @tag, a review step, and progress in place, in one column | `money.css` | Rebuilt |
| Swap: you pay and you receive, each with an asset dropdown grouped like the Overview (what you hold and its balance first on the side that pays), Max, reverse, and the quote with its countdown, dollar values, rate, fees and price difference, how far the price can move, and market prices beside the form. Once it's sent, the quote gives way to the progress and New swap | `money.css` | Rebuilt |
| Earn: your positions in dollars as last read, then markets and vaults, each opening to Deposit and Withdraw tabs | `money.css`, classes prefixed `er` | Rebuilt |
| Cards: the setup checklist beside a "Not issued" card, then the card (filled with the text colour; muted when frozen), details in a dialog (a sheet on the phone), controls, the allowance, and card activity | `apps/web/src/app/cards.css`, classes prefixed `cd`, on the `mx` parts in `money.css` (including the shared `mxDialog`) | Rebuilt |
| Transactions: the summary on top (four totals for 7D/30D/90D/1Y that narrow the list when tapped; the money in and out chart with its table and top card merchants behind one remembered toggle), then search, type chips, and a status filter over the list, grouped under day headings; the receipt in the Overview's side panel (a pushed screen on the phone) with the action's steps and bank updates, ending with a Reference and Copy; Export in a dialog (a sheet on the phone); one empty state with Add money when the account has no transactions. Money in is green, money out neutral | `apps/web/src/app/records.css`, classes prefixed `tx` and `in`, on the `mx` parts, the Overview's chips and side panel, and the shared `mxDialog` | Rebuilt |
| Settings and Support: Settings one area at a time (Security, Saved recipients, Aura tag, Notifications, This device, Your data), a side list on desktop and a row per area on the phone; setting rows with On/Off toggles and switches; Support's help and report-a-problem rows. Every section now shows its own labelled example data to guests; the shared example page is gone | `apps/web/src/app/settings.css`, classes prefixed `st`; the toggle and switch are `appToggle` and `appSwitch` in `shell.css` | Rebuilt |
| Perps: the perps account (value, then available to trade and you can withdraw as a two-figure line, `mkBalances`) with Add money and Withdraw; positions, orders, and history tabs, each position a block (`mkPerpPosition`: name, side and leverage and margin-mode badges, profit with percent at the right, then a four-column grid of caption-and-value facts, two columns on the phone, and TP/SL and Close); the market list with search and each market's max leverage; a perp's trading screen: breadcrumb with a market switcher, price and stats, a line or candle chart with ranges, the order book with depth bars (bids on the positive soft colour, asks on the muted fill, never red), a grouping menu (a small outlined button with the step, opening a raised list of steps, `mkGroupMenu`), and rows that highlight on hover and can be picked; and the order panel (Market or Limit, Cross or Isolated with a caption saying what it risks, Long or Short, amount with 25%, 50%, 75%, Max, what's available to trade beside the label and what Base USDC adds under the shortcuts, leverage slider and number, take profit and stop loss as price fields with a caption under each, size, margin, estimated fee, liquidation price, one button). Price fields (`mkPriceField`): a label with an optional text action (Mid), "$" inside the field, and a caption or error under it. The same form in a sheet on the phone with a keypad and Pay with USDC, and its steps in place; the Close sheet (Market or Limit, 25%, 50%, 75%, All as chips filling the row) and the TP/SL sheet. Gains are green, losses neutral | `apps/web/src/app/markets.css`, classes prefixed `mk`, on the `mx` parts and the shared `mxDialog`; sheets restate their styles under `.mkSheet` because dialogs render outside `.appFrame` | New
| Predictions: the predictions account (cash, positions with Sell and Collect, open orders with Cancel, a "Finish setup" note when setup was left part way; before setup, one line and Deposit only, so the markets come up sooner); categories, search, and Show more over the event cards, each binary card with its two outcomes and chances, a multi-outcome card with every outcome in a short scrolling list, and Up or Down cards with their window and a countdown; a market's page laid out like Polymarket's: the question, the chance chart with ranges 1H to All and what the chance was at the start, or for Up or Down the starting price, the current price with its distance above or below, the time left, and the live chart; the position and the rules on the left and the order panel on the right, always open (Buy or Sell, the outcome as two large choices with their price in cents, the amount with +$1, +$20, +$100, and Max, price, shares, pay from with what's available to spend in a caption under it (cash plus USDC on Base), To win in positive and equal to the shares to the cent, one button; with no USDC, a line with Add money); on the phone, Buy buttons under the chart open the same form in a bottom sheet with the amount at 52px centred and the keypad, and the Buy button held at the bottom of the sheet. Chips, the back link, chart periods, market titles, and the source link are 44px to tap on touch screens. The first outcome (Yes, Up) selected is filled positive, the second (No, Down) filled with the text colour; never red | `apps/web/src/app/predictions.css`, classes prefixed `pd`, on the `mk` parts in `markets.css` (the panel is also `mkOrderPanel`) and the shared `mxDialog` | New |
| Landing and public pages: the landing page with the app's own guest screens (regenerated at 1280 × 800, labelled example data), an Aura tag's payment page, and the docs site, whose Starlight colours and fonts come from `design-tokens.css`. The favicons and the docs logo use the placeholder ring mark | `apps/web/src/app/public.css`, classes prefixed `ld` (landing) and `py` (pay page); `apps/docs/src/styles/aurel.css` | Rebuilt |
| Operations console (`apps/ops`): the new look only, same layout. Its variables map to the tokens, Geist and Geist Mono, the sidebar's current page as a muted fill with an accent icon, the shared button, toggle, segmented, and chip looks, and dark mode with the device | `apps/ops/src/styles.css`, which imports `design-tokens.css` | Rebuilt |

## Principles

1. **Information first, actions second, decoration never.** A border, fill, or shadow has to mean something: a group, an object, or something that floats.
2. **One accent.** Ultramarine marks the primary action, the current place, links, selection, and focus. Nothing else is blue.
3. **Colour is meaning.** Green is completed or money in, red is failed or an error, amber is pending, unavailable, or needs attention. Never decoration.
4. **Money is exact.** Tabular figures, the currency or asset always shown, and a value that can't be read says Unavailable, never an old number or zero.
5. **One primary action per screen or panel.**
6. **Desktop and phone share tokens, not layouts.** A sidebar, side panels, popovers, and tables on desktop; a menu button, full-screen steps, sheets, and lists on the phone.
7. **Every state is designed:** loading, empty, error, unavailable, disabled, and blocked, in light and dark, at 390px and at 1440px.
8. **Fast.** Nothing waits on an animation, the layout never jumps when data arrives, and every action gives feedback within 120ms.

## Colour

Components use semantic tokens only, never a literal colour. Dark is its own palette, not an inversion: near-black canvas, surfaces step lighter as they rise, and the accent lifts to stay readable.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-canvas` | `#f7f8fa` | `#0b0d11` | Page background |
| `--color-surface` | `#ffffff` | `#12151b` | Cards, sidebar, inputs |
| `--color-raised` | `#ffffff` | `#181c23` | Sheets, popovers, side panels, toasts |
| `--color-muted` | `#f1f3f6` | `#1b1f27` | Selected nav item, segmented track, skeletons |
| `--color-hover` | `#ebeef2` | `#222731` | Hover on rows and neutral buttons |
| `--color-text` | `#0f1115` | `#edeff3` | Primary text |
| `--color-text-secondary` | `#5b6270` | `#a3a9b5` | Labels, supporting text |
| `--color-text-tertiary` | `#6c7280` | `#7d8491` | Timestamps and hints only |
| `--color-line` | `#e6e8ec` | `#20242d` | Dividers, card borders |
| `--color-line-strong` | `#d6d9df` | `#2c313c` | Input and button borders |
| `--color-accent` | `#3d3fe0` | `#8e90ff` | Primary action, current place, links, selection |
| `--color-accent-hover` | `#3134c4` | `#a3a5ff` | Primary hover |
| `--color-accent-pressed` | `#292ba8` | `#7c7ef0` | Primary pressed |
| `--color-on-accent` | `#ffffff` | `#0b0d11` | Text and icons on the accent |
| `--color-accent-soft` | `#eeeefc` | `#1d1e47` | Selected tint, info notes |
| `--color-positive` | `#0f7b52` | `#3ecf8e` | Completed, money in |
| `--color-positive-soft` | `#e8f5ef` | `#10271d` | Completed background |
| `--color-negative` | `#c1372b` | `#ff7a6b` | Failed, errors, destructive actions |
| `--color-negative-soft` | `#fcebe9` | `#2e1614` | Error background |
| `--color-warning` | `#9a5a00` | `#f0ab4a` | Pending, unavailable, needs attention |
| `--color-warning-soft` | `#fdf5e8` | `#2a2114` | Warning background |
| `--color-scrim` | 45% near-black | 55% black | Behind dialogs and sheets |
| `--color-focus` | accent | accent | Focus ring |
| `--color-qr` | `#0f1115` | `#0f1115` | QR code squares: dark in both themes, since many scanners can't read an inverted code |
| `--color-qr-background` | `#ffffff` | `#ffffff` | Behind a QR code |

**Pairings.** Every pairing below meets WCAG AA (4.5:1 for text) in both themes, checked on 29 September 2026:

- Text and secondary text on canvas, surface, raised, and muted.
- Tertiary text on canvas, surface, and raised. **Not on muted**: it drops to about 4.4:1.
- On-accent on accent. The accent as text or a link on canvas and surface.
- Each status colour as text on canvas, surface, and its own soft background.

Money in is shown with a plus sign and the positive colour. Money out has a minus sign in the normal text colour, not red: red means something failed.

## Type

**Geist** for everything, **Geist Mono** for addresses, hashes, and references. Both are self-hosted as variable fonts in `apps/web/public/fonts` (SIL Open Font License, `Geist-OFL.txt`), so the strict CSP (`font-src 'self'`) needs no change. Fallbacks are the system UI fonts.

- Weights: 400 regular, 500 medium, 600 semibold. No bold, no light.
- `font-variant-numeric: tabular-nums` on every number, everywhere.
- Sentence case. No all caps, no letter-spaced labels.
- Tracking: `-0.02em` at 22px and above, `-0.01em` from 15 to 20px, normal below.
- Prose measure: 60 to 75 characters.

| Style | Desktop (size / line) | Phone | Weight | Use |
| --- | --- | --- | --- | --- |
| Headline | 56 / 60 | 40 / 44 | 600 | The landing page's main heading, nowhere else |
| Display | 40 / 44 | 36 / 40 | 600 | The Overview total |
| Amount hero | 52 / 56 | 52 / 56 | 600 | Amount entry on the phone keypad |
| Amount | 32 / 36 | 32 / 36 | 600 | Amount fields, review totals |
| Title 1 | 22 / 28 | 20 / 26 | 600 | Page titles |
| Title 2 | 17 / 24 | 17 / 24 | 600 | Section and panel titles |
| Title 3 | 15 / 20 | 15 / 20 | 600 | Card titles, list group headings |
| Body | 14 / 20 | 15 / 22 | 400, 500 | Everything else |
| Small | 13 / 18 | 13 / 18 | 400, 500 | Secondary lines in rows, help text |
| Caption | 12 / 16 | 12 / 16 | 500 | Table headers, timestamps |
| Mono | 13 / 18 | 13 / 18 | 400 | Addresses, hashes, references |
| Input (phone) | — | 16 / — | 400 | Text inside inputs on the phone (`--text-input-phone`), so the browser doesn't zoom |

Money formatting: currency sign or asset code always shown; two decimals for fiat, up to six significant decimals for crypto, trailing zeros dropped; thousands separated. Addresses are shortened to the first six and last four characters (`0x5555…5555`) except on the address check step, where they're shown in full, in groups of four.

## Spacing

A 4px grid. Every gap, padding, and margin comes from the scale.

| Token | px | Typical use |
| --- | --- | --- |
| `--space-1` | 4 | Icon to label inside a chip |
| `--space-2` | 8 | Between related controls |
| `--space-3` | 12 | Row padding, label to input |
| `--space-4` | 16 | Card padding on the phone, between fields |
| `--space-5` | 20 | Card padding on desktop, between cards |
| `--space-6` | 24 | Between groups inside a page |
| `--space-7` | 32 | Desktop side margins |
| `--space-8` | 40 | Between major sections |
| `--space-9` | 48 | Empty-state padding |
| `--space-10` | 64 | Page bottom clearance |

### Margins and page layout

| | Desktop | Phone |
| --- | --- | --- |
| Side margins (`--page-pad-x`) | 32px | 20px (16px below 360px) |
| Top of page (`--page-pad-top`) | 28px under the top bar | 8px under the header |
| Between sections (`--gap-section`) | 20px | 18px |
| Content width | Up to 1120px, centred from 1440px | Full width |
| Columns | Main column, plus a 340 to 360px side column (the live summary, recent transactions). A page without a side column (Send) keeps the main column's width | One column |
| Bottom clearance | 64px | 100px plus the safe area, so the menu button never covers content |

## Sizes

| Token | Desktop | Phone | Use |
| --- | --- | --- | --- |
| `--control-height` | 36px | 44px | Buttons, segmented controls |
| `--control-height-lg` | 44px | 44px | Full-width primary actions, review confirms |
| `--input-height` | 40px | 44px | Text inputs, selects |
| `--row-height` | 56px min | 60px min | List and table rows |
| `--icon-size` | 18px | 20px | Icons (menu tiles 22px) |
| `--icon-stroke` | 1.6 | 1.6 | Icon stroke width |
| `--touch-min` | — | 44 × 44px | The smallest thing a thumb can hit |
| `--sidebar-width` | 232px (72px on tablet) | — | Sidebar |
| `--topbar-height` | 60px | 56px header | Top bar or header |
| `--side-column` | 360px | — | Side column, side panels (up to 440px for receipts) |
| `--menu-button` | — | 56px | The floating menu button, 22px above the bottom edge plus the safe area |

## Radius

Soft and subtle. Four tiers and a pill; nothing else.

| Token | px | Use |
| --- | --- | --- |
| `--radius-sm` | 6 | Buttons, inputs, nav items, chips inside tables |
| `--radius-md` | 8 | Notes, segmented controls, the amount field, popovers |
| `--radius-lg` | 10 | Cards, menu tiles, toasts, dialogs |
| `--radius-sheet` | 20 | Top corners of phone sheets only |
| `--radius-pill` | 999 | Filter chips, the asset button, avatars, the menu button |

## Elevation

| Level | Token | Use |
| --- | --- | --- |
| 0 | none | Canvas, rows, anything inside a card |
| 1 | `--shadow-1` (a hairline) with a `--color-line` border | Cards, secondary buttons |
| 2 | `--shadow-2` | Only what floats: side panels, sheets, popovers, dialogs, toasts, the menu button |

In dark, depth comes from the surface steps (canvas, surface, raised) more than from shadows.

## Motion

| Token | Value | Use |
| --- | --- | --- |
| `--duration-fast` | 120ms | Hover, press, toggles, tab switches |
| `--duration-base` | 200ms, `--ease-enter` | Side panels, sheets, popovers opening; toasts in |
| `--duration-exit` | 160ms, `--ease-exit` | Anything closing |

Motion explains where something came from or went. Side panels slide from the right, sheets from the bottom, pushed phone screens from the right. No page-load animations, no looping motion except a spinner inside a busy button. With reduced motion, durations are 0 and changes are instant.

## Breakpoints

Media queries can't read variables, so these are fixed values:

| Name | Width | Changes |
| --- | --- | --- |
| Phone | below 768px | Phone layouts: header, menu button and sheet, full-screen steps, lists |
| Tablet | 768 to 1023px | Desktop layouts with the sidebar narrowed to icons (72px, names in tooltips) and the side column below the main one |
| Desktop | 1024px and up | Full sidebar, side column beside the main one |
| Wide | 1440px and up | Content centred at 1120px |

Phone and desktop are different layouts, not one layout squeezed. Components below say what each device gets.

## Icons and brand

- [Lucide](https://lucide.dev) (`lucide-react`, already a dependency), stroke 1.6, drawn in the current text colour. The accent only for the current place.
- Icons sit beside a label. An icon alone is allowed only in the top bar (bell, search), with an accessible name and a tooltip.
- Asset and provider logos come from their owners, in a 24px circle (32px in lists). Without a logo, the asset code in a muted circle.
- The wordmark and app icon are placeholders (a ring with an accent dot, and "aura" in Geist semibold) until the brand is designed. No illustrations.

## Components

Each component is one per device where the devices differ. The reference page renders them all; class names there are prefixed `ds-` so they can't clash with the current screens.

In the app, the shared parts are React components in `apps/web/src/components`, so each is built once: `StatusDot` (a status), `LoadingState`, `LoadingScreen` (the whole screen, before the app can draw), `Notice` (with an optional Try again), and `Unavailable` (`states.tsx`), `CopyButton`, `MoneyPage` and `SignedOutPanel` (a money section's page and its guest panel), and `Sheet` (every dismissible dialog: the dialog that is a bottom sheet on the phone, and the side panel for a holding or a receipt). Their styles are in `shell.css` (`appStatus`, `appState`, `appUnavailable`, `appIconDisc` for the 32px round icons) and `money.css` (`mxNote`, `mxDialog`). Money, amounts, dates, and addresses are written by `apps/web/src/lib/format`, in one locale, and the operations console uses the same formatters.

### Buttons

| Variant | Look | Use |
| --- | --- | --- |
| Primary | Accent fill, on-accent text | The one main action. One per screen or panel. |
| Secondary | Surface fill, strong border | Other actions |
| Ghost | Accent text, no border | Low-emphasis links: View all, Max |
| Destructive | Surface fill, negative text | Remove, close the account. Confirmed in a dialog. |

- Desktop: 36px high, sized to the label, 14px medium. Primary actions in a side column or review are full width at 44px.
- Phone: 44px, and the step's main action is full width at the bottom of the screen, above the safe area.
- Disabled: 45% opacity, not clickable, and the reason is shown next to it. Busy: the label stays, a small spinner replaces the icon, and the button ignores taps.
- An icon only when it helps recognition (Send, Deposit). Never an arrow at the end.

### Inputs

- Label above, always visible, never a placeholder in its place. Help text below in small secondary text.
- Error: a red border and 1px ring, and the message below in red, linked with `aria-describedby`. Validate on blur and on submit, not while typing.
- Addresses and references in Geist Mono.
- Phone: 44px high, 16px text (`--text-input-phone`) so the browser doesn't zoom.

### Amount entry

- Desktop: an amount field with the amount at 32px, the asset button (a pill with the logo and code) inside on the right, and "available · Max" below.
- Phone: its own screen. The asset pill at the top, the amount at 52px centred, "available · Max" below, and a 3 × 4 keypad (digits, decimal point, delete). The Continue button stays disabled until the amount is valid.

- Prediction buys (Polymarket's layout): "Amount" on the left and the dollar amount on the right at 32px, with quick adds (+$1, +$20, +$100, Max) under it; on the phone, the amount at 52px centred over the keypad. Only a valid amount stays in the field: digits, one decimal point, two places.

### Segmented control

Two to four options that switch a view in place: Send's "To a person or wallet" and "To a bank account", the Transactions summary's periods. A muted track, the selected option on the surface with a hairline shadow.

### Toggles and switches

A setting that saves as soon as it changes: a checkbox drawn as a 40 × 24 switch (`appSwitch`) inside a row that labels it. Settings uses it for every on/off choice. The On/Off pill button (`appToggle`, `aria-pressed`), filled with the accent when on, is only for the card's freeze. Tightening applies at once; loosening asks for the passkey first, so the control only moves once that succeeds.

### Filter chips

Pills that filter a list, with an optional total: the Overview groups, Transactions types. The selected chip is filled with the text colour. A chip whose total can't be read says Unavailable.

### Recipient faces

On Send, saved recipients, own wallets, and recent addresses as a row of 40px circles with an initial or logo and a name below. The selected one is filled with the accent. Scrolls sideways on the phone.

### Cards

A surface with a line border, `--radius-lg`, and shadow 1. A card groups things that belong together; it's never a decoration. A card title is Title 3, with at most one ghost action on the right (View all). Padding 20px on desktop, 16px on the phone.

### Lists and rows

- A row: a 32px icon or logo circle, a title and a small secondary line, and on the right the amount and, below it, a status or time.
- 56px minimum on desktop, 60px on the phone. Hover fills with `--color-hover` on desktop. The whole row is the tap target.
- Rows are separated by a line, inside a card or directly on the page.
- A list of choices that open in place uses rows too: Deposit's four ways, each with what it's for, sit beside the open one on desktop and above it on tablet and phone. The selected row has the accent-soft fill.

### Tables (desktop)

Caption-size secondary headers, numbers right-aligned, tabular figures. Rows open their detail in a side panel. On the phone, a table becomes a list of rows.

### Summary and review

Label-value rows: the label secondary on the left, the value on the right. The total or "arrives" row last, in semibold. The primary action at the bottom. Fees that Aura pays say "Paid by Aura" in positive. An address is shown in full in groups of four on desktop, and as its first and last four characters (`0x5555…5555`) on the phone. A refusal (a limit, a switch, a paused asset) shows in red above the button, not as a toast.

### Statuses

A 6px dot and a literal word: Completed (positive), Pending or the provider's step (warning), Failed or Declined (negative), Not sent (secondary). Never a colour without a word.

### Notes and banners

- A note: a soft background in the status colour (warning, error, or info in accent-soft), a 16px icon, and one or two short sentences. At most one link or button.
- A banner: full width at the top of the page, for things about the whole page: example data for guests, an expired session, a missing source.
- Guest banner: "Example data. Values and activity here are fictional." with "Create account or sign in", the only primary sign-in button on the page. Other guest actions keep their own label (Chat, Tell us) or a secondary "Sign in to …" button, and open sign-in; a page that only describes settings has no second button.

### Toasts

On the raised surface with shadow 2, a status icon, a title, one line, and a close button. Desktop: bottom right. Phone: top, below the header. They report the outcome of something the customer just did: saved, sent, failed, cancelled; and, per the journeys, money received and security changes. A money action's result shows on its progress card instead, never twice. Errors stay 8 seconds, others 5; an outcome the customer must act on stays until closed. A new toast stacks under the ones still showing, so two notices arriving together both stay readable; only a repeat of the same message takes the earlier one's place. Field hints, load failures, and live progress stay where they happen. (`useToast`, `apps/web/src/components/toast.tsx`.)

### Navigation

- **Desktop sidebar.** 232px, the surface colour, a line on its right. The wordmark at the top, then the twelve sections as 36px items: an 18px icon and the name. The current item has a muted fill, text colour, and an accent icon. Tablet: 72px, icons only, names in tooltips.
- **Desktop top bar.** 60px: the page title or search (⌘K) on the left, the bell and the avatar menu on the right. The bell's unread count is a small accent pill on the bell's top-right corner, never over the bell. The avatar shows the first letter of the account's email or name; with no letter (an email like 3@…), a person icon.
- **Phone header.** 56px: the section title, and the bell on the right. In a step, a back button on the left and the step's title instead.
- **Phone menu button.** A 56px circle, filled with the text colour, floating bottom centre with shadow 2. It hides during a step, and otherwise stays put: no hiding on scroll, focus, or overlap. Every page ends with 100px clear plus the safe area, so the customer can always scroll any button above it (owner, 2 October). Hiding it on focus moved it under the finger as the field lost focus, and hiding it on scroll or overlap didn't hold up on a real phone.
- **Phone menu sheet.** From the bottom, `--radius-sheet` top corners, a grab handle. "Menu" and the email at the top, the twelve sections as tiles three per row (a 22px icon above the name, the current tile outlined in accent), and Sign out at the bottom.

### Overlays

| | Desktop | Phone |
| --- | --- | --- |
| Details (receipt, asset, vault) | Side panel from the right, 360 to 440px, raised, shadow 2; the list stays visible | A pushed full screen with a back button |
| Short choices (Export, sign-in, account) | Popover under its button, `--radius-md` | Bottom sheet |
| Long choices (assets, recipients) | Side panel with search | A full screen with search |
| Confirmations (remove, close, lock) | Centred dialog, 400px, scrim | Bottom sheet with the actions full width |

Every overlay traps focus, closes with Escape and a visible close button, returns focus to what opened it, and has a title and description for screen readers. Phone sheets also close by swiping down or tapping the scrim.

### Money flow parts

- **Steps (phone).** A thin progress bar of segments under the header, one per step.
- **Review.** "You send" and the amount at 32px, then the summary rows, then any note (irreversible, other network), then the primary button: "Confirm and send". It opens the device's passkey prompt.
- **Timeline.** A vertical list of steps: done in positive (filled), current in accent (ring), to come in line-strong (ring), each with a time or estimate.
- **Address check (B2).** The address in full in Geist Mono, groups of four, the network, and a hint to send a small test amount first.

## Patterns

The journeys in [redesign-journeys.md](redesign-journeys.md#shared-patterns) set the behavior. This is how each looks.

| Pattern | Look |
| --- | --- |
| Loading | A skeleton of the real layout in `--color-muted`, same sizes as the content, so nothing jumps. A shimmer only without reduced motion. Buttons keep their label and show a spinner. |
| Empty | A centred block inside the area it fills: a Title 3 line saying what will appear, one short sentence, and the one action that fills it. |
| Unavailable | The value's place says "Unavailable" in warning, with what's left out named nearby. Never the last value, never zero. |
| Error | An error note in place of the failed part, with Try again. The rest of the page keeps working. |
| Blocked | Shown before the customer starts: a centred block saying why, and one next step (Go to security, Add passkey). |
| Guest | The guest banner, fictional example data, and every action opens sign-in, then returns. |
| Live price chart | An Up or Down market's price, one tick a second: one line in the accent, the price to beat as a dashed `--color-text-tertiary` line labelled at the left, the last price as an accent dot with its value in an accent pill at the right edge, the window's start and latest time under it, and the source with the time of the last tick. After 15 seconds without a tick, the current price says "Unavailable"; the chart never shows a stale price as live. No animation beyond the line moving with each tick. |
| Setup checklist | A card of numbered steps: done ones with a positive check, the current one expanded with its one button, later ones muted. |

## Emails

Notice emails (`apps/web/src/lib/notifications/email.ts`) follow the same system. Email clients can't read CSS variables, so the colours, radii, and font stack are copied from the tokens and inlined. `tests/unit/notification-email.test.ts` fails if they drift from `design-tokens.css`.

- One column, 520px wide, on the canvas colour: the wordmark, one card, then a caption footer.
- In the card: a caption label for the kind (Money received in positive, Didn't go through in negative, Security in the accent, Completed in secondary), the title in title-1, the message in body, and one primary button, **Open in Aura**.
- The footer says which notices the customer can turn off. Security notices are always sent.
- Dark mode uses the dark tokens in clients that support `prefers-color-scheme`.
- Every email has a plain-text copy with the same words and the link written out.

## Accessibility

- WCAG 2.2 AA. Text contrast 4.5:1, large text and UI parts 3:1, in both themes.
- A visible focus ring on everything focusable: 2px `--color-focus`, 2px offset.
- Every action works with a keyboard. Desktop has ⌘K search (B4): actions first (send, send to a bank, add money, swap, lock the account), then pages, chosen with the arrow keys and opened with Enter. An action opens where it happens; nothing moves money or changes a control from the search.
- 44 × 44px minimum targets on the phone and other touch screens (`--touch-min`): chips, segmented controls, copy buttons, the toast close button, and the landing page's links. Desktop with a mouse keeps its density.
- Status is never colour alone: a word goes with it.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`. The theme choice (`aurel-theme` in local storage, `data-theme` on `<html>`) overrides the device.
- `axe` finds no serious or critical issues on the reference page (`tests/e2e/product.spec.ts`), and each rebuilt screen keeps its e2e checks.

## Quality bar

Every screen meets this on desktop and phone, in light and dark, before it ships. Agreed on 4 October 2026 for the polish pass; the [review checklist](#review-checklist) below is the short version.

`pnpm sweep` checks the parts a machine can: it opens every page in the menu and the landing page, as a guest and signed in, in light and dark, at each width below plus 640px (1280px at 200% zoom), and writes what it finds to `output/sweep/report.md`: sideways scrolling, clipped text, touch targets under 44px, content under the floating menu button, axe issues (at 390 and 1280px), console errors, and failed requests. `AURA_SWEEP_ONLY=/app/send,/app/swap pnpm sweep` checks just those pages; `AURA_SWEEP=strict` fails on any finding. The rest (states, money, copy, keyboard) is checked by hand and by each feature's e2e spec.

**Layout and touch**

- No sideways scrolling and no clipped text at 320, 375, 390, 430, 768, 1024, 1280, and 1440px wide.
- Touch targets at least 44 × 44px on the phone (`--touch-min`), with space between neighbours.
- Nothing under the notch, the home bar, or the floating menu button: pages use the safe-area insets and end 100px clear of the button.
- At 200% browser zoom, text still reads and nothing overlaps.
- Long values (large balances, long names, addresses) wrap or shorten on purpose, never by accident.

**States**

- Loading is a skeleton of the real layout.
- Empty has one button that fills it.
- A value that can't be read says Unavailable, never an old number.
- An error sits next to the part that failed and says what to do.
- Paused, locked, blocked, and over-limit show before the customer starts, not on the review screen.
- The guest view shows labelled example data, and the same example appears the same way in every feature.

**Money**

- Every amount shows its currency or asset, in tabular figures.
- Fees, minimums, and what the customer gets are on the review screen, above its button.
- Every payment that can't be undone keeps its review screen.
- The result is shown once, on the progress card.

**Controls and copy**

- One primary button per screen or panel; a disabled button says why.
- Every string follows the [content guide](content-style-guide.md) and its [glossary](content-style-guide.md#glossary); buttons are verbs.
- The same action uses [the same word](content-style-guide.md#the-same-word-for-the-same-action) in every feature.

**Accessibility**

- axe finds no issues; text contrast is 4.5:1 in both themes.
- Everything works by keyboard with a visible focus ring, and focus is never hidden under the floating menu button (WCAG 2.4.11). Dialogs and sheets keep focus inside and close with Escape.
- Icon buttons, statuses, and amounts have names a screen reader reads.
- Reduced motion is honoured.

**Design system**

- Tokens only, and styles in the area stylesheet. Nothing new in `globals.css`, `identity.css`, or `product-system.css`.
- No console errors and no failed requests on any screen.

## Don'ts

From the owner's brief and the [Impeccable](https://impeccable.style) anti-pattern list:

- No gradients, glass, glows, blobs, or noise textures.
- No second accent colour, and no blue that isn't the accent.
- No cards inside cards, and no rows of identical feature cards.
- No emoji, no illustrations, no decorative icons.
- No centred body text, all caps, or letter-spaced labels.
- No literal colours or one-off sizes in a screen: tokens only.
- No hover-only actions. No arrow icons inside buttons.
- No spinners where a skeleton fits, and no animation that makes the customer wait.
- No red for money out. Red means failed.

## Review checklist

- Can the screen's purpose and primary action be seen in five seconds?
- Is there exactly one primary button in each screen or panel?
- Does every border, fill, and shadow mean something?
- Is every number tabular, with its currency or asset, and does unread data say Unavailable?
- Does it follow its journey in [redesign-journeys.md](redesign-journeys.md) on both devices?
- Are loading, empty, error, unavailable, disabled, and blocked designed?
- Does it meet the [quality bar](#quality-bar) at every width from 320px to 1440px, in light and dark, at 200% zoom, with a keyboard and a screen reader?
- Does every string pass the [glossary](content-style-guide.md#glossary)?
- Are only tokens used, and do the reference page, `DESIGN.md`, and this document still agree?
