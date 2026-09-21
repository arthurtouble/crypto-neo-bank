# Aurel Design System

## Product character

Aurel should feel calm, exact, and discreet: a modern private-finance product whose confidence comes from clarity rather than ornament. The interface is not trying to look “crypto,” imitate a trading terminal, or perform luxury through decorative excess.

The product promise is expressed in the interface:

- Independent: no house token, no promoted asset, and no visual bias toward a provider.
- Legible: assets, providers, custody, risk, and status are named plainly.
- Controlled: important actions have review states, context, and recovery paths.
- Human: copy is specific, spacing is composed, and not every idea is placed inside a card.

## Anti-slop contract

These are implementation constraints, not mood-board suggestions.

1. Information first, actions second, decoration last.
2. A container must communicate grouping, hierarchy, or interactivity. Do not wrap content in a card merely to fill a grid.
3. Use one primary action per region. Secondary actions should be visibly subordinate.
4. Do not use gradient blobs, glass panels, neon glows, fake metrics, testimonial filler, or rows of identical feature cards.
5. Avoid symmetry by default. Let content determine width, height, and rhythm.
6. Use no more than three radius tiers: 10px controls, 18px panels, 26px feature surfaces.
7. Serif is an accent, not a shortcut to “premium.” It is reserved for a rare editorial phrase or quotation.
8. Product language must describe a real state: “Bridge approval required” is better than “Coming soon.”
9. Motion must explain entry, exit, focus, or spatial continuity. Never animate a surface just to make it feel alive.
10. Every screen must include loading, empty, error, disabled, and narrow-screen behavior before it is considered complete.

## Typography

- **Instrument Sans** — navigation, titles, controls, prose, and product UI. It is neutral without feeling generic.
- **Newsreader** — selective editorial emphasis on the marketing site. Never use it for dashboard headings or numerical data.
- **Fragment Mono** — balances, wallet addresses, provenance labels, keyboard hints, and system state.

Use sentence case. Avoid centered body copy, all-caps headings, and exaggerated tracking. Numerical columns should use the mono face and align consistently.

## Color and themes

Components consume semantic tokens, never literal theme colors:

- `--canvas`: page background
- `--surface`: primary grouped content
- `--surface-raised`: popovers and dialogs
- `--surface-muted`: hover, selection, and secondary controls
- `--text`, `--text-secondary`, `--text-tertiary`: information hierarchy
- `--hairline`, `--hairline-strong`: separators and input boundaries
- `--accent`, `--positive`, `--warning`, `--danger`: meaning, not decoration

Dark mode is a separately composed palette—not an inverted light theme. Black is used for the canvas, elevated grays establish depth, and muted text remains readable without becoming bright white.

## Layout and surface rules

- Prefer whitespace or a hairline separator to another panel.
- Keep text measure near 60–75 characters for explanatory prose.
- Dense financial rows should be scannable before they are beautiful.
- Use broad feature surfaces sparingly; small facts belong in rows, not mini-cards.
- Preserve a clear reading order on mobile. Never rely on hover to expose an essential action.

## Interaction and motion

- Fast feedback: 120–160ms.
- Component transitions: 180–220ms.
- Page-level entry: no more than 420ms, used once.
- Use a decelerating ease for entry and a faster ease for exit.
- Respect `prefers-reduced-motion` globally.
- Dialogs trap focus, close with Escape, expose a visible close action, and announce a title and description.

## Reusable implementation brief

Use this brief when generating or reviewing a new Aurel screen:

> Design a production financial interface for Aurel using the existing semantic tokens and type system. Begin with the user’s decision and the information required to make it. Use whitespace and separators before containers. Permit one primary action in each region. Use Instrument Sans for the interface, Fragment Mono only for data and state, and Newsreader only for rare editorial emphasis. Do not add gradient blobs, glassmorphism, generic feature-card grids, ornamental badges, fake metrics, or filler copy. Every status must be precise and every interaction must include focus, disabled, error, empty, loading, mobile, dark-mode, and reduced-motion behavior. The result should feel composed by a product designer, not decorated by a template.

## Review checklist

- Can a user identify the screen’s purpose and primary action in five seconds?
- Is every card earning its border and background?
- Is the hierarchy still clear in monochrome?
- Are provider, custody, and risk boundaries explicit?
- Does the screen work at 390px without hiding essential information?
- Do light and dark themes both preserve contrast and elevation?
- Can every interaction be completed with a keyboard and understood by assistive technology?
- Are demo or provider-gated functions labeled honestly?

## References

- [Apple Human Interface Guidelines: Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Radix UI Dialog accessibility behavior](https://www.radix-ui.com/primitives/docs/components/dialog)
- [Nielsen Norman Group: Visual Design Principles](https://media.nngroup.com/media/articles/attachments/Principles_Visual_Design-A4.pdf)
