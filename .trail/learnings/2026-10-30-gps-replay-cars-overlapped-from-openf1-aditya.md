---
title: GPS replay cars overlapped from OpenF1 position error; apart() pushes pairs aside with a side fixed per pair
author: ADITYA
date: 2026-10-30
branch: master
cost: { minutes: 16, tokens: 78522 }
id: l-aea8a98c
scope: repo
status: active
src: agent
touches:
  - src/static/scene3d.js
  - src/static/post.js
  - src/static/lanes.js
  - src/static/replay.js
  - tests/test_lanes.mjs
  - src/static/satellite.js
---

## Decided
- GPS replays (2023+) drew cars through each other in passes and side-by-side running: OpenF1 location is metres off and not in sync between cars (cached COTA 2026 race: 1,095 car-pair frames overlapping, ~6.5 min).
- `src/static/lanes.js` `apart(cars, sides)` pushes any overlapping pair apart across the car's direction of travel, half each, with the room tapering to 0 over 3 m past a car length. `replay.js` `spread` applies it in `gpsState` and `carsAt` (the heading positions 0.5 s ahead), with the direction taken from the car's own GPS over ±0.25 s. Parked cars (<1 m moved) are left alone. On real data, overlaps went 1,095 -> 10 (COTA) and 1,965 -> 38.
- The side is taken once the pair first needs room and kept in `S.sides` until they are more than CAR_L + 10 m apart, so noise in the lateral gap never flips one car through the other. It is reset after a seek (>5 s jump).
- `gpsPos` interpolates Catmull-Rom over the 0.5 s frames: straight lines cut up to ~0.8 m inside corners.
## Watch out
- `focus.js` telemetry still reads the raw `gpsPos`, not the spread position (at most ~1 m apart, only while alongside another car).
- Test with real data: count pairs with |along| < CAR_L and |across| < CAR_W per frame on `.cache/replay/<session>.json` (units are decimetres, so mpu 0.1).
