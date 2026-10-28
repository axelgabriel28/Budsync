# Budsync brand and interface guide

## Positioning

Budsync helps individuals and organizations keep wallets, transactions, budgets, and supporting receipts organized. The tagline is **Stay in Sync With What Matters.** The approved ribbon-shaped `b` logo is the only logo mark; its proportions and internal geometry must remain intact.

## Logo usage

- Light surfaces: `public/budsync-logo-light.png` (black horizontal wordmark).
- Dark surfaces: `public/budsync-logo-dark.png` (white horizontal wordmark).
- App and browser icon: `public/icon-192.png`; matching sizes are `icon-180.png` and `icon-512.png`.
- Keep clear space around the logo at least one quarter of the emblem width. Do not stretch, recolor, add effects, or place text over the mark.

## Color

| Token | Value | Use |
| --- | --- | --- |
| Black | `#0B0B0B` | Primary text, dark canvas, key actions |
| Charcoal | `#1F1F1F` | Dark cards |
| Graphite | `#6B6B6B` | Secondary text |
| Silver | `#D9D9D9` | Borders, dividers, soft highlights |
| Off-white | `#F5F5F5` | Light canvas and secondary surfaces |
| White | `#FFFFFF` | Light cards and dark text |

Light and dark application tokens live in `src/Fluid.css`. Landing page tokens live in `src/LandingPage.css`. Colors used for financial charts, statuses, and interaction states stay within this grayscale range.

## Typography and spacing

Use **Plus Jakarta Sans** for product and editorial headings; use DM Sans for compact controls and dense financial records. Desktop display text scales from 48 to 80 px with `clamp()`. Body copy is 15–17 px; captions are 12–14 px. Use uppercase tracked micro labels sparingly to orient users. Cards use 16–24 px corner radii, controls use 12 px, and major promotional containers may use up to 32 px. Preserve generous spacing around totals, but keep transactions and receipt records compact enough to scan.

## Components and motion

Buttons, cards, inputs, navigation, dialogs, and status messages use shared CSS tokens. Primary actions are black in light mode and high contrast in dark mode. Focus indicators remain visible for keyboard users. Hover and press transitions should finish within 150–250 ms. Reveal motion may take 250–400 ms. All optional motion must respect `prefers-reduced-motion`.

The landing page at `/welcome` contains illustrative interface previews with empty balances. It must never imply that sample transaction activity is real. The authenticated app keeps its existing data, finance calculations, local persistence, and optional sync behavior.

## Responsive layout

Design for 320 px phones, 768 px tablets, and desktop widths above 1024 px. Keep touch targets at least 44 px where practical. The sidebar becomes a compact mobile navigation; the landing page stacks its feature cards and dashboard preview on small screens. Long financial values must wrap or shrink without clipping.
