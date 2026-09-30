---
version: alpha
name: Aura
description: A crypto-and-fiat money app. Calm, exact, and fast, in the spirit of Mercury and Stripe. Neutral greys, one ultramarine accent, Geist, balanced density, soft corners. Light and dark follow the device.
colors:
  canvas: "#f7f8fa"
  surface: "#ffffff"
  raised: "#ffffff"
  muted: "#f1f3f6"
  hover: "#ebeef2"
  text: "#0f1115"
  text-secondary: "#5b6270"
  text-tertiary: "#6c7280"
  line: "#e6e8ec"
  line-strong: "#d6d9df"
  primary: "#3d3fe0"
  primary-hover: "#3134c4"
  primary-pressed: "#292ba8"
  on-primary: "#ffffff"
  primary-soft: "#eeeefc"
  positive: "#0f7b52"
  positive-soft: "#e8f5ef"
  negative: "#c1372b"
  negative-soft: "#fcebe9"
  warning: "#9a5a00"
  warning-soft: "#fdf5e8"
colors-dark:
  canvas: "#0b0d11"
  surface: "#12151b"
  raised: "#181c23"
  muted: "#1b1f27"
  hover: "#222731"
  text: "#edeff3"
  text-secondary: "#a3a9b5"
  text-tertiary: "#7d8491"
  line: "#20242d"
  line-strong: "#2c313c"
  primary: "#8e90ff"
  primary-hover: "#a3a5ff"
  primary-pressed: "#7c7ef0"
  on-primary: "#0b0d11"
  primary-soft: "#1d1e47"
  positive: "#3ecf8e"
  positive-soft: "#10271d"
  negative: "#ff7a6b"
  negative-soft: "#2e1614"
  warning: "#f0ab4a"
  warning-soft: "#2a2114"
typography:
  display:
    fontFamily: Geist
    fontSize: 40px
    fontWeight: 600
    lineHeight: 44px
    letterSpacing: -0.02em
  amount-hero:
    fontFamily: Geist
    fontSize: 52px
    fontWeight: 600
    lineHeight: 56px
    letterSpacing: -0.02em
  amount:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: -0.02em
  title-1:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.02em
  title-2:
    fontFamily: Geist
    fontSize: 17px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: -0.01em
  title-3:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: -0.01em
  body:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  body-phone:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
  small:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
  caption:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  mono:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  sheet: 20px
  full: 9999px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  "7": 32px
  "8": 40px
  "9": 48px
  "10": 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: 36px
    padding: 0 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: 36px
    padding: 0 16px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: 0 12px
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: 20px
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.full}"
    height: 30px
    padding: 0 12px
  chip-selected:
    backgroundColor: "{colors.text}"
    textColor: "{colors.canvas}"
  nav-item:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    height: 36px
    padding: 0 10px
  nav-item-current:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.text}"
  menu-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    height: 76px
  menu-button:
    backgroundColor: "{colors.text}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    size: 56px
  sheet:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.sheet}"
    padding: 20px
  toast:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    width: 340px
---

# Aura

The code source of these values is `apps/web/public/design-tokens.css`; the full spec is `docs/product/design-system.md`; the rendered reference is `/design-system.html`. Change all four together. Screens are built to the journeys in `docs/product/redesign-journeys.md`.

## Overview

Aura is a money app for crypto and dollars. It should feel like Mercury or Stripe: calm, exact, professional, and fast. Information comes first, actions second, decoration never. Desktop and phone share these tokens but have different layouts: a sidebar, side panels, popovers, and tables on desktop; a floating menu button, full-screen steps, sheets, and lists on the phone. Light and dark follow the device and are designed equally.

## Colors

Neutral cool greys and one accent. Use the semantic names, never a literal colour.

- **Primary (ultramarine, `#3d3fe0`; dark `#8e90ff`):** the primary action, the current place in navigation, links, selection, and focus. Nothing else is blue.
- **Positive:** completed, money in. **Negative:** failed, errors, destructive actions. **Warning:** pending, unavailable, needs attention. Always with a word, never colour alone.
- Money out is the normal text colour with a minus sign, not red.
- Tertiary text is for timestamps and hints, and never sits on `muted`.
- Dark is its own palette: near-black canvas, lighter surfaces as they rise.

## Typography

Geist for everything, Geist Mono for addresses, hashes, and references, both self-hosted in `apps/web/public/fonts`. Weights 400, 500, and 600 only. Tabular figures on every number. Sentence case, no all caps. On phones, body is 15/22, display 36/40, title-1 20/26. Money always shows its currency or asset; unread values say Unavailable.

## Layout

A 4px spacing grid. Breakpoints: phone below 768px, tablet 768 to 1023px (sidebar 72px, icons only), desktop from 1024px, wide from 1440px.

- Desktop: sidebar 232px, top bar 60px, page padding 28px top and 32px sides, content up to 1120px, a 340 to 360px side column, 20px between sections.
- Phone: header 56px, 20px side margins (16px below 360px), 18px between sections, a 56px floating menu button bottom centre, and 100px clear at the bottom.
- Controls are 36px on desktop and 44px on the phone; inputs 40px and 44px; rows at least 56px and 60px; touch targets at least 44 × 44px.

## Elevation & Depth

Three levels. Level 0 is flat (canvas, rows). Level 1 is a line border with a hairline shadow (cards, secondary buttons). Level 2 is a soft large shadow, only for what floats: side panels, sheets, popovers, dialogs, toasts, and the menu button. In dark, depth comes mostly from the surface steps.

## Shapes

Soft and subtle: 6px for buttons and inputs, 8px for notes, segmented controls, and popovers, 10px for cards, tiles, toasts, and dialogs, 20px for the top corners of phone sheets, and pills for chips, the asset button, avatars, and the menu button. Nothing else.

## Components

- **Buttons:** primary (accent fill), secondary (surface, strong border), ghost (accent text), destructive (negative text). One primary per screen or panel. Full width at 44px for review confirms and the phone's bottom action. Disabled buttons say why nearby.
- **Inputs:** label above, help or error below; errors get a red border and message tied with `aria-describedby`.
- **Amount entry:** desktop, a 32px amount field with the asset pill inside; phone, its own screen with a 52px amount and a keypad.
- **Segmented control** switches a view in place; **filter chips** filter a list and may carry totals.
- **Toggles and switches** save a setting as soon as it changes: an On/Off pill, accent when on, or a 40 × 24 switch inside a labelled row.
- **Cards** group related things with a line border and 10px radius; never nested, never decorative.
- **Rows:** icon or logo, title and secondary line, amount and status on the right. Tables on desktop become lists on the phone.
- **Statuses:** a dot and a literal word.
- **Notes** (soft status background, icon, short text) and **banners** (page-wide: guest example data, expired session, missing source).
- **Toasts:** raised, one line, close button; bottom right on desktop, top on the phone.
- **Navigation:** desktop sidebar with ten sections, each an icon and a name, current item muted with an accent icon. Phone: no tab bar; the menu button opens a sheet of ten tiles, three per row, with Log out at the bottom.
- **Overlays:** details in a side panel on desktop, a pushed screen on the phone; short choices in a popover or bottom sheet; confirmations in a dialog or bottom sheet. All trap focus and close with Escape.
- **Money flows:** amount, then who, then a review with "Confirm and send" and the passkey; progress as a timeline in place.

## Do's and Don'ts

- Do use tokens only. Don't use literal colours or one-off sizes in a screen.
- Do show loading as a skeleton of the real layout, empty with the action that fills it, and unread data as Unavailable.
- Do keep a visible 2px accent focus ring and full keyboard support.
- Don't use gradients, glass, glows, blobs, emoji, illustrations, or decorative icons.
- Don't add a second accent or any blue that isn't the accent.
- Don't nest cards or build rows of identical feature cards.
- Don't hide actions behind hover, and don't put arrow icons inside buttons.
- Don't animate for decoration; honour reduced motion.
