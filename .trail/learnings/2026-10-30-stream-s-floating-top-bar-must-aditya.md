---
title: "Stream's floating top bar must not carry a gradient, and the viewer dialog must use inset 0, not 100vw"
author: ADITYA
date: 2026-10-30
branch: master
cost: { minutes: 27, tokens: 288194 }
id: l-3f357652
scope: repo
status: active
src: agent
touches:
  - src/static/tvcontrols.js
  - src/static/stream.js
  - src/static/style.css
---

## Decided
- `src/static/style.css`: on the Stream page the top bar floats over the billboard and turns into dark glass only through the `stopbar` scroll-driven animation. It animates background-color and backdrop-filter, starting from transparent.
- The viewer dialog `.mv` is sized with `inset: 0; width: auto; height: auto`, and `html:has(dialog.mv[open]) { overflow: hidden; }` locks the page scroll.

## Tried and ruled out
- A dark-to-transparent gradient under the top bar left a visible line across the artwork where it ended over the billboard's own top scrim (a Mach band). The bar has no gradient now; the billboard's `::after` scrim does that darkening.
- A 100vw-wide dialog put the page scrollbar over its right edge, which hid the header's More button.

## Watch out
- Hot-swapping stylesheets (changing a link's href) briefly lays the top bar out in three rows at phone width. Do a full reload before judging the layout.
- The tab only reaches Continue watching when an F1 TV replay is played past 30 s. `remember()` in `multiviewer.js` saves progress every 10 s and on close.
