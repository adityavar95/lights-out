---
title: "Lap-timing replay lanes: pass side fixed per pair and pace steady per driver, or cars cut through each other"
author: ADITYA
date: 2026-10-26
branch: master
cost: { minutes: 12, tokens: 191315 }
id: l-c638d686
scope: repo
status: active
src: agent
touches:
  - src/static/lanes.js
  - tests/test_lanes.mjs
  - src/static/replay.js
  - CLAUDE.md
  - src/static/scene3d.js
  - src/static/racecraft.js
  - src/static/app.js
---

## Decided
`src/static/lanes.js` (pure) gives the lap-timing replay (`replay.js` `lapCars`, pre-2023 races) lateral offsets: a two-column grid (lap 1 starts from each car's slot behind the line) and the faster car of a close pair moving ~3.2 m aside. Passer = higher steady pace (`d.pace`, median lap time, set in `prepare`). Side = hash of the pair's ids. A final push-apart pass fixes chains (A passes B while B passes C). `carsAt` uses `lapCars` too, so the heading position 0.5 s ahead carries the lane.

## Tried and ruled out
- Side from the inside of the next corner (curvature at the car ahead): it flips mid-pass on slow closing speeds, so the passer jumped across the other car (stroll/giovinazzi, Abu Dhabi 2021).
- Passer from the current lap's speed (len / lap time): it flips when one car crosses its lap boundary, again putting two cars on one spot (gasly/bottas near the finish).
- Without the push-apart step, chains put two cars on the same side (bottas/leclerc, lap 1).

## Watch out
GPS (2023+), live and the Simulation do not go through this; only `mode === 'laps'`. Finished cars still stack at `pointAt(0)`. Verify by scanning `lapCars(t)` over the whole race for pair distances under ~2.4 m (expose `lapCars` temporarily on `window`; the pane is too small to judge visually).
