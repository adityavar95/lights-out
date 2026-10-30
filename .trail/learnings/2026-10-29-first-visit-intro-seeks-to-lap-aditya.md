---
title: "First-visit intro seeks to lap 1's start; the hidden preview pane freezes its fade-in and camera"
author: ADITYA
date: 2026-10-29
branch: master
cost: { minutes: 10, tokens: 87530 }
id: l-125ed13e
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - src/f1tv.py
  - src/jolpica.py
  - src/server.py
  - src/static/app.js
  - src/static/drivers.js
  - src/static/index.html
  - src/static/stream.js
  - src/static/style.css
  - src/static/util.js
---

## Decided
- `src/static/replay.js` `intro` starts the latest race at lap 1's start minus 6 s: a GPS replay begins ~90 s before lights out (all lap-1 entries in `data.laps` start at t = 90 on the cached races checked), so t = 0 is cars sitting on the grid. Lap-timing replays have no `laps` feed and start at 0.
- `src/static/app.js` `startIntro` runs on a visit with no hash and no `f1seen` in localStorage, or with `#intro` (to see it again). It waits for `showRace`'s promise (`A.shown`): started earlier, showRace's late "Press ▶" hint lands over the playing replay.
- The header Live button now shows only while a session is live; its between-sessions "Latest session" opened the race the default page already shows.
## Watch out
- In the desktop app's hidden preview pane, requestAnimationFrame barely runs: the intro card stays at opacity 0 (its CSS animation fills backwards) and the chase camera stays at the overview. Each screenshot draws one frame, so a burst of screenshots shows it moving in. Check it in a visible browser before calling it broken.
