# Audit phase 4 handover (25 Nov 2026)

Phase 4 of `docs/audit-fix-plan.md` is done. `scripts/test_all.py` is green (34 JS suites, test_server.py, tsc).

## What changed
- 4.1 Decided: `software` (SwiftShader, llvmpipe, Basic Render Driver) does **not** get the desktop's 4096 px tread maps or the
  nine team GLBs. `graphics.js` keeps the probed tier (`setTier`, called by `init3d`; `currentTier()` falls back to the
  GPU-less `deviceTier()` before the probe). `cars3d.js` `TYRES` is now a function read when tyres are built, and `rb22.js`
  `teamModel` reads `currentTier()`. No change on a real GPU.
- 4.2 Not reproduced in the browser (crashing a sim car into the gravel wasn't tried), but the case holds in the code for any
  car standing still more than 3 m off the track, including a GPS replay's retirements. `circuit3d.js` `onLane(p)`: within
  6 m of the pit lane's centre line (segment distance, x/z), `null` before a lane is set. `scene3d.js` uses it and falls
  back to the old lateral test only when there is no lane.
- 4.3 The gantry's cloned checker texture goes into `g.userData.mats` (freed by `circuit.dispose`). `trackside.js`: `tecpro`
  is hoisted out of its block, and `dispose()` frees it and `lampBeam`.
- 4.4 `textures3d.js` `foliage(kind)` reseeds `rand` per kind, so the atlases don't depend on which circuit opened first.
- 4.5 `showroom.js` `openShowroom`: one `create()` promise however often the panel toggles, and a close during the create
  no longer leaves the deck drawing into a hidden panel (`wanted`).
- Extra (found in the browser check, already there before this phase): `TypeError: ... reading 'fromEquirectangular'` on every
  replay open. `setDaylight` / `setWeather` called `loadSky` before `renderer.init()` had made `pmrem`. `loadSky` now returns
  until then; the ready handler loads `skyIndex()`'s sky itself, so the sky the session asked for still comes up.

## Tests
- `tests/test_graphics.mjs`: `currentTier()` before and after `setTier`.
- 4.2-4.5 have no new tests: GPU/DOM code with no harness.

## Checked in the browser
- agent-browser (headed), `#2024/1/replay`, then 6 switches between `#2024/1/replay` and `#2024/2/replay`: `__errs` empty,
  `renderer.info.memory` flat (70 textures, 423 MB, 28 render targets; geometries 127/132 alternating). Bahrain renders as before.
- agent-browser's `--init-script` takes a file path, not inline code (inline gave an EOF and no recorder).

## Not checked
- A before/after texture count (only "flat after" was measured), a software-GPU machine (4.1), a car stuck in gravel in Play
  (4.2), the showroom double toggle (4.5), and Spa-first vs Singapore-first trees side by side (4.4).

## Next
Phase 5: per-frame waste.
