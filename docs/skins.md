# Skins and appearance

A skin is one JSON file in `apps/display/src/styles/skins/`. It names the thirteen colours from `tokens.css` for Daylight and for Dusk, two fonts from the bundled set, a radius scale, a card style, twelve person colours and, optionally, decor and a season. The display applies it as CSS variables on `<html>`, so every screen, sheet and card follows without knowing which skin is on.

Pick one in **Settings → Appearance**, or browse them all on the real screens at `/demo/skins` (works in mock mode) and press **Use this look on the wall**.

## The bundled twelve

| Skin          | Feel                                                                      | Season (with "Follow the season") |
| ------------- | ------------------------------------------------------------------------- | --------------------------------- |
| Mantel        | The original: warm greys, deep green by day, brass by night               |                                   |
| Slate         | Cool greys, clear blue, flat square-ish cards, geometric headlines        |                                   |
| Paper         | Cream stock, book serifs, brick red; lamp-lit sepia after dark            |                                   |
| Midnight      | Deep navy around the clock, sea-glass accent                              |                                   |
| Chalkboard    | Green board, chalk text, handwritten headings, doodled corners            |                                   |
| Poster        | A flyer: oversized condensed capitals, cream, a yellow block, heavy rules |                                   |
| Harvest       | Parchment, pumpkin and moss, leaves behind the cards                      | 15 Sep to 30 Nov                  |
| Frost         | Ice blues, crisp white cards, falling snow                                | 1 Dec to 28 Feb                   |
| Bloom         | Blush pink, lilac greys, petals                                           | 1 Mar to 31 May                   |
| Shore         | Sea-glass teal, bleached white, round corners, waves                      | 1 Jun to 31 Aug                   |
| Harvest Night | Halloween: near-black plum, pumpkin orange, bats                          | 24 Oct to 1 Nov                   |
| Lights        | The holidays: deep red by day, gold by night, a string of bulbs           | 1 Dec to 6 Jan                    |

With **Follow the season** on, the dated skin whose range contains today shows; the shortest range wins (Harvest Night over Harvest, Lights over Frost). Outside every range the chosen skin shows.

## What else Appearance sets

- **Accent**: a swatch or any colour. Replaces the skin's accent in both looks; the text-on-accent colour is picked for contrast.
- **Headline font**: any of the six bundled faces, over the skin's own.
- **Text size**: Compact (×0.92), Default, Large (×1.12), through `--text-scale`.
- **Import and export**: a skin as JSON. Export copies the current one; Import takes a pasted or chosen file, checks it against the schema and reports low-contrast pairs in plain words.
- **Create your own**: start from the current skin and change the eight colours that matter per look (background, cards, text, secondary text, accent, text on accent, warning, good); the rest are derived.

## Adding a skin

1. Copy a JSON file in `apps/display/src/styles/skins/` and give it a new `id` and `name`.
2. Set the colours. `pnpm test` runs a WCAG contrast check over every skin: text on every surface at 4.5:1, secondary text at 4.5:1, text on the accent at 4.5:1, the accent, warning and good colours at 3:1, hint text at 2.5:1. The test names the failing pair and mode.
3. Optional: `decor` names SVGs in `styles/skins/decor/` for `background` (a tiling pattern), `header` (a strip along the top) and `corners` (one ornament, mirrored into each corner), with an `opacity`. SVGs draw with `currentColor` so the skin's ink tints them.
4. Optional: `season: { from: "MM-DD", to: "MM-DD" }` (may wrap the new year).
5. Add the id to the order list in `styles/skins/index.ts` so it sits where you want in the grid.

Fonts are self-hosted in `apps/display/public/fonts/` (Fraunces, Manrope, Space Grotesk, Lora, Caveat, Archivo; SIL Open Font License). Adding one means a woff2 there, an `@font-face` in `styles/fonts.css` and an entry in `FONTS` in `packages/shared/src/skins.ts`.

## For kiosk tools and screenshots

`/?skin=<id>` pins a skin, `?mode=daylight|dusk` the look and `?screen=<id>` the first screen. `node e2e/skin-shots.mjs` (after `pnpm build`) regenerates the contact sheets in `docs/screenshots/v2-e-*.png`.
