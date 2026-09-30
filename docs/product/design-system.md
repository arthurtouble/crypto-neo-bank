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

The root layout loads `design-tokens.css` for the whole app. Areas rebuilt in phase 5 are styled from the tokens only; the rest still use `globals.css` and `product-system.css`, whose clashing variables were renamed `--legacy-space-*` and `--legacy-font-mono` so the two can load together. Don't mix them inside one area.

| Area | Where | Status |
| --- | --- | --- |
| App shell: sidebar, top bar, phone header, menu button and sheet, account menu, notifications, toasts, terms and account screens | `apps/web/src/app/shell.css`, classes prefixed `app` | Rebuilt |
| Overview: total, group chips, holdings table or list, holding detail, recent transactions, guest example, empty account | `apps/web/src/app/overview.css`, classes prefixed `ov`; the shared guest banner is in `shell.css` | Rebuilt |
| Deposit: the four ways as tabs (desktop) or rows (phone), receive, from a wallet, card, bank checklist and details | `apps/web/src/app/money.css`, classes prefixed `mx`, shared with Send and Swap | Rebuilt |
| Send: two tabs (to a person or wallet, to a bank account), amount and asset, recipient faces, a review step, progress in place, and a live summary column | `money.css` | Rebuilt |
| Swap: you pay and you receive with the asset picker (a dialog on desktop, a sheet on the phone), reverse, slippage, and the quote with its countdown, fees, and reference prices beside the form | `money.css`; the old swap styles are removed from `product-system.css` | Rebuilt |
| Earn: your positions growing live, then markets and vaults, each opening to deposit or withdraw | `money.css`, classes prefixed `er` | Rebuilt |
| Cards: the setup checklist beside a "Not issued" card, then the card (filled with the text colour; muted when frozen), details in a dialog (a sheet on the phone), controls, the allowance, and card activity | `apps/web/src/app/cards.css`, classes prefixed `cd`, on the `mx` parts in `money.css` (including the shared `mxDialog`) | Rebuilt |
| Transactions and Insights: search, type chips, and a status filter over the list; the receipt in the Overview's side panel (a pushed screen on the phone) with the action's steps; Export in a dialog (a sheet on the phone); full history; Insights' four numbers, the money in and out chart with its table, categories, and top card merchants. Money in is green, money out neutral | `apps/web/src/app/records.css`, classes prefixed `tx` and `in`, on the `mx` parts, the Overview's chips and side panel, and the shared `mxDialog` | Rebuilt |
| Settings and Support: Settings one area at a time (Security, Saved recipients, Aura tag, Notifications, This device, Your data), a side list on desktop and a row per area on the phone; setting rows with On/Off toggles and switches; Support's help and report-a-problem rows. Every section now shows its own labelled example data to guests; the shared example page is gone | `apps/web/src/app/settings.css`, classes prefixed `st`; the toggle and switch are `appToggle` and `appSwitch` in `shell.css` | Rebuilt |
| Landing and public pages: the landing page with the app's own guest screens (regenerated at 1280 × 800, labelled example data), an Aura tag's payment page, and the docs site, whose Starlight colours and fonts come from `design-tokens.css`. The favicons and the docs logo use the placeholder ring mark | `apps/web/src/app/public.css`, classes prefixed `ld` (landing) and `py` (pay page); `apps/docs/src/styles/aurel.css` | Rebuilt |

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
| Columns | Main column, plus a 340 to 360px side column (the live summary, recent transactions) | One column |
| Bottom clearance | 64px | 100px, so the menu button never covers content |

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
- Phone: 44px high, 16px text so the browser doesn't zoom.

### Amount entry

- Desktop: an amount field with the amount at 32px, the asset button (a pill with the logo and code) inside on the right, and "available · Max" below.
- Phone: its own screen. The asset pill at the top, the amount at 52px centred, "available · Max" below, and a 3 × 4 keypad (digits, decimal point, delete). The Continue button stays disabled until the amount is valid.

### Segmented control

Two to four options that switch a view in place: Send's "To a person or wallet" and "To a bank account", Deposit's four ways on desktop, Insights periods. A muted track, the selected option on the surface with a hairline shadow.

### Toggles and switches

A setting that saves as soon as it changes. An On/Off pill button (`appToggle`, `aria-pressed`), filled with the accent when on, for settings read aloud as a button; or a checkbox drawn as a 40 × 24 switch (`appSwitch`) inside a row that labels it. Tightening applies at once; loosening asks for the passkey first, so the control only moves once that succeeds.

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

### Tables (desktop)

Caption-size secondary headers, numbers right-aligned, tabular figures. Rows open their detail in a side panel. On the phone, a table becomes a list of rows.

### Summary and review

Label-value rows: the label secondary on the left, the value on the right. The total or "arrives" row last, in semibold. The primary action at the bottom. Fees that Aura pays say "Paid by Aura" in positive.

### Statuses

A 6px dot and a literal word: Completed (positive), Pending or the provider's step (warning), Failed or Declined (negative), Not confirmed (secondary). Never a colour without a word.

### Notes and banners

- A note: a soft background in the status colour (warning, error, or info in accent-soft), a 16px icon, and one or two short sentences. At most one link or button.
- A banner: full width at the top of the page, for things about the whole page: example data for guests, an expired session, a missing source.
- Guest banner: "Example data. Values and activity here are fictional." with a Sign in button.

### Toasts

On the raised surface with shadow 2, a status icon, a title, one line, and a close button. Desktop: bottom right. Phone: top, below the header. They report the outcome of something the customer just did: saved, sent, failed, cancelled; and, per the journeys, money received and security changes. Errors stay 8 seconds, others 5; an outcome the customer must act on stays until closed. Field hints, load failures, and live progress stay where they happen. (`useToast`, `apps/web/src/components/toast.tsx`.)

### Navigation

- **Desktop sidebar.** 232px, the surface colour, a line on its right. The wordmark at the top, then the ten sections as 36px items: an 18px icon and the name. The current item has a muted fill, text colour, and an accent icon. Tablet: 72px, icons only, names in tooltips.
- **Desktop top bar.** 60px: the page title or search (⌘K) on the left, the bell and the avatar menu on the right.
- **Phone header.** 56px: the section title, and the bell on the right. In a step, a back button on the left and the step's title instead.
- **Phone menu button.** A 56px circle, filled with the text colour, floating bottom centre with shadow 2. It hides during a step. It stays put while typing: hiding it on focus moved it under the finger as the field lost focus, so taps meant for a form button opened the menu. The page leaves 100px clear at the bottom instead.
- **Phone menu sheet.** From the bottom, `--radius-sheet` top corners, a grab handle. "Menu" and the email at the top, the ten sections as tiles three per row (a 22px icon above the name, the current tile outlined in accent), and Log out at the bottom.

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
| Setup checklist | A card of numbered steps: done ones with a positive check, the current one expanded with its one button, later ones muted. |

## Accessibility

- WCAG 2.2 AA. Text contrast 4.5:1, large text and UI parts 3:1, in both themes.
- A visible focus ring on everything focusable: 2px `--color-focus`, 2px offset.
- Every action works with a keyboard. Desktop has ⌘K search (B4).
- 44 × 44px minimum targets on the phone.
- Status is never colour alone: a word goes with it.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`. The theme choice (`aurel-theme` in local storage, `data-theme` on `<html>`) overrides the device.
- `axe` finds no serious or critical issues on the reference page (`tests/e2e/product.spec.ts`), and each rebuilt screen keeps its e2e checks.

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
- Does it work at 390px and 1440px, in light and dark, with a keyboard and a screen reader?
- Are only tokens used, and do the reference page, `DESIGN.md`, and this document still agree?
