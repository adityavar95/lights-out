---
title: "Stream rows show only a weekend's sessions, race first; F1 TV's F1 Kids copies look like sessions"
author: ADITYA
date: 2026-10-30
branch: master
cost: { minutes: 6, tokens: 90777 }
id: l-56bd158d
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - README.md
  - pyproject.toml
  - src/f1tv.py
  - src/live.py
  - src/radio.py
  - src/replay.py
  - src/server.py
  - src/static/app.js
  - src/static/cars3d.js
---

## Decided
- `src/static/stream.js` `fill`: a weekend's row holds `sessionsOf(videos)` newest first, so the race leads. F1 TV's shows, press conferences, analysis and highlights are left out on purpose, as the user asked for less noise and a more opinionated page. A weekend with no sessions falls back to all its videos.
- Cards are titled by session (`named`), because the row heading already names the grand prix. The billboard's h1 is `r.raceName`, not F1 TV's title.
- Red is used only for LIVE on Stream. The theme switch and the next-session countdown are hidden there.

## Watch out
- F1 TV files kids' versions of sessions ("2026 Singapore GP - F1 Kids", "... - F1 Kids Sprint") as REPLAY with "GP" in the title. `sessionsOf` must exclude /kids/, or a row shows "Race" twice. This is covered in `tests/test_multiviewer.mjs`.
- If highlights are wanted back, add them as a separate row; mixing them into the weekend rows was the noise that was removed.
