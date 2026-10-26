---
title: "Page theming: light-dark() tokens on :root with html[data-theme]; the HUD keeps its own dark scheme"
author: ADITYA
date: 2026-10-26
branch: master
cost: { minutes: 11, tokens: 207764 }
id: l-aa0dc17b
scope: repo
status: active
src: agent
touches:
  - src/static/style.css
  - src/static/index.html
  - src/static/app.js
  - src/static/charts.js
  - src/static/explorer.js
---

## Decided
- `src/static/style.css` defines every page colour once as `light-dark(light, dark)` on `:root`, and the scheme is chosen by `color-scheme` alone: `:root[data-theme=light]`, or the system preference when `html[data-theme]` is `auto` (`:root:not([data-theme=dark])` under the light media query). `app.js` `setTheme` cycles auto / light / dark from the header's `#themebtn` and remembers it in localStorage `f1theme`. One token block instead of a duplicated light override, and a third state (auto) for free.
- The 3D stage's HUD (`.mapwrap`, `color-scheme: dark`) and the F1 TV viewer (`.mv`) keep dark regardless: `light-dark()` resolves at the element that uses the token, so `var(--glass)` inside `.mapwrap` is the dark glass even in light mode.
- One glass recipe (`--glass`, `--glass-strong`, `--glass-blur`, `--hairline`, `--edge`, `--shadow`) is applied by a single selector list near the top of the file to every floating surface (cards, header, popovers, pills, tooltip); a surface that needs its own look overrides after it. Add new glass surfaces to that list rather than restyling them.
## Tried and ruled out
- A duplicated light-token block under `@media (prefers-color-scheme: light)` plus a copy under `[data-theme=light]`: two places to keep in sync for every token.
## Watch out
- `light-dark()` needs Chrome 123 / Safari 17.5 / Firefox 120; an older browser gets no colours at all.
- `.calendar` is a scrolling popover, so it is kept out of the `::before` specular-edge list: an `inset: 0` pseudo-element scrolls away with the content.
