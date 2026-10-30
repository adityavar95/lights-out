---
title: "F1 TV viewer design: pixel-placed 16:9 tiles (arrange), hover-only chrome, one icon set; the user wants broadcaster-grade"
author: ADITYA
date: 2026-10-30
branch: master
cost: { minutes: 133, tokens: 1390013 }
id: l-4faa4fbc
scope: repo
status: active
src: agent
touches:
  - src/server.py
  - src/f1tv.py
  - src/static/multiviewer.js
  - src/radio.py
  - src/static/tvcontrols.js
  - tests/test_multiviewer.mjs
---

## Decided
- The user asked for the multiviewer to look professional, after Apple TV's F1 multiview, and gave full design freedom. `src/static/multiviewer.js` `arrange(n, W, H, gap, main)` places every tile in pixels as a true 16:9 rectangle: grid (the column count with the biggest tiles, rows centred) or focus (one big, the rest as thumbnails beside or under it, whichever leaves it bigger). `relayout` applies it on a ResizeObserver, and CSS transitions animate the moves. Tested in `tests/test_multiviewer.mjs` (16:9, inside, no overlaps, 2x2 for 4 in a tall window).
- Per tile: a team-colour label chip that is the stream menu (`field-sizing: content`); radio, settings, focus and remove as icon buttons, shown, like the control bar, only while the mouse moves (`.active`, from tvcontrols.js). The tile you hear gets a white ring, bright for 1.8 s as it changes (`.flash`).
- Header: grid/focus segmented switch, Team view (`teamView`: the race feed big plus the team's two onboards, Apple's preset), Add stream as the one white primary button.
- One line-icon set in `tvcontrols.js` `icon()`; no emoji in the UI. Red only for LIVE. The viewer uses the system UI face and its own `--mv-*` colour tokens (the Connect popover also opens from the Stream page, so `.mvconnect` defines them itself).
## Tried and ruled out
- The CSS grid of equal cells (`.mvgrid.spot`, `--cols`): in a tall window each 16:9 picture floated in black bands, and a 4th stream sat alone on a second row.
## Watch out
- A live stream's playhead is seconds since F1 TV's 2024-01-01 availabilityStartTime: show `getPlayheadTimeAsDate()`, not `fmtTime(currentTime)` ("24814:42:42").
- Telemetry that can't load (a live session, pre-2023) hides its panel; it used to print OpenF1's lock text on every tile. Thumbnails narrower than 380 px hide it too.
