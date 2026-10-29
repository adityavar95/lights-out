---
title: Jolpica refuses driver standings without a season; Wikipedia portraits need pilicense=any; Stream rows load eagerly
author: ADITYA
date: 2026-10-29
branch: master
cost: { minutes: 21, tokens: 244265 }
id: l-e3eb7667
scope: repo
status: active
src: agent
touches:
  - src/f1tv.py
  - src/static/stream.js
  - src/static/util.js
  - src/static/drivers.js
  - src/jolpica.py
---

## Decided
- `src/jolpica.py` `driver_career`: Jolpica answers 400 "Missing one of the required parameters ['season_year']" to `/drivers/{id}/driverstandings`, so a career's championship positions come from each season's own `driverstandings` table (`jolpica_fetch`, disk-cached once the season is over, 4 threads for Jolpica's ~4 req/s). `/drivers/{id}/results` works without a season. A cold career (Alonso, 23 seasons) takes ~10 s, then it's cached.
- `src/static/drivers.js` `portraits`: Wikipedia's pageimages with `pilicense: 'any'`; the default (free images only) left out about half the 1950s grid, including champion Mike Hawthorn (fair-use photo).
- `src/static/stream.js` loads every weekend row of the season, three at a time, instead of on scroll.
## Tried and ruled out
- Loading Stream rows with IntersectionObserver: it never fires while the browser isn't painting (the desktop app's hidden preview pane), so rows sat on skeletons.
## Watch out
- The row queue must start after the rows are in the page: `next()` stops on a detached row (that's how it stops when the season changes).
- F1 TV's image resizer drops a few of the ~500 thumbnails a modern season asks for at once (22 of 497 once); they load on retry (`retry` in `stream.js`).
- FP1-only reserve drivers (e.g. 2026 Herta, Vesti) have no Wikipedia url in Jolpica's driver list, so their cards keep initials. Guessing the article from the name could show the wrong person.
