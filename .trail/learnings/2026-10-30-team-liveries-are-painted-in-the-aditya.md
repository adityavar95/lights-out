---
title: Team liveries are painted in the paint shader from car-relative position; material clones drop it
author: ADITYA
date: 2026-10-30
branch: master
cost: { minutes: 33, tokens: 255412 }
id: l-2325ae19
scope: repo
status: active
src: agent
touches:
  - src/static/textures3d.js
  - src/static/circuit3d.js
  - src/static/scene3d.js
  - src/static/mirror.js
  - src/tracks.py
  - tests/test_server.py
  - src/static/post.js
  - src/static/cars3d.js
  - src/static/rb22.js
  - src/static/carsdeck.js
---

## Decided
- `src/static/cars3d.js` `LIVERIES` / `livery(team, color, year)`: each team's scheme (base, second colour below a line or behind a point, accent band, nose tip), matched on the team's name with a regex, for 2022+ only. Earlier seasons get a scheme made from the team colour.
- `paintMat` draws the livery in its shader in "livery space": u along the car (0 rear, 1 nose), v up (0 floor, 1 top). The matrix `userData.toCar` maps mesh-local positions into it. It comes from the era geometry's bounds for the procedural cars and from the paint mesh's transform for the RB22 (`withRB22`). One shader serves both models, with no UV-atlas painting.
- The RB22 paint texture (`rb22.js` `paintTexture`) is now transparent except for the race number, whose alpha is mixed over the livery.
## Watch out
- `carsdeck.js` clones materials so the race scene's CSM patch doesn't leak into the preview. `clone()` loses `onBeforeCompile` and the userData uniforms, so the livery paint (`userData.livery`) must not be cloned.
- `util.js` `teamColor`'s fallback must be `hsl(h, 65%, 58%)` with commas: three.js's Color can't parse the space-separated form, and teams missing from TEAM_COLORS rendered as white cars.
- Check liveries by rendering each team with `buildCar` into an offscreen WebGLRenderer contact sheet in the page. No node test can import three (bare specifier).
