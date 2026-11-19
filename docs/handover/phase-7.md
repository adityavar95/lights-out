# Handover after phase 7 (19 Nov 2026)

Branch / commits: `graphics-perf-phase-7`, made from `graphics-perf-phase-6` (not pushed, not merged): one commit.
`scripts/test_all.py` passes.

Done:
16. **The verge and the satellite ground darken in the wet.** One uniform, `wetDark` (`circuit3d.js:229-230`):
    1 when dry, `1 - 0.25 * wet` when wet, where `wet` is the same `(wetLine + wetOff) / 2` that sets the `wettable`
    roughness. It multiplies the ground's colour (`circuit3d.js:264`, satellite photo, its smeared border and the
    50 m grass tile) and the mown verge's (`:311`). It's returned from `buildCircuit` (`:511`) and set by
    `scene3d.js` `setWeather` (`:733`), and by `setTrack` (`:533`) when a circuit loads after the weather was set.
    No new draw calls, passes or textures. Soaked (Monsoon, wetness ~94 %) the albedo is ×0.765; Brazil's start on
    inters (wetness 0.35, ~0.3 average) ×0.93.

Measured after (Brazil 2026 replay at the start, wet 0.35, RTX 4080 Laptop, Ultra, Auto resolution, 2040x1000, one
agent-browser session with the window in front, CPU at 157-168 % performance). fps / p95 ms / draw ms / GPU ms /
rest ms / width. "before" is `HEAD`'s two files swapped in on disk and the page reloaded.

| Run | Free Orbit | TV Chase | Cockpit | T-Cam | Helicopter |
|---|---|---|---|---|---|
| after (1st load in the browser) | 94 / 12.6 / 3.7 / 4.9 / 5.2 / 3494 | 114 / 12.6 / 3.9 / 5.9 / 2.8 / 3004 | 104 / 12.6 / 6.1 / 5.5 / 2.3 / 2599 | 82 / 16.9 / 9.1 / 5.8 / 3.6 / 2989 | 76 / 16.7 / 6.7 / 4.9 / 3.6 / 3438 |
| before | 97 / 12.6 / 3.4 / 5.3 / 5.9 / 3494 | 119 / 12.4 / 3.8 / 5.7 / 2.6 / 2989 | 107 / 12.6 / 6.1 / 5.2 / 2.9 / 2586 | 111 / 12.5 / 4.0 / 6.8 / 3.3 / 2974 | 136 / 8.5 / 3.5 / 3.8 / 2.5 / 2974 |
| after again | 96 / 12.6 / 3.6 / 5.4 / 5.8 / 3494 | 113 / 12.5 / 3.8 / 6.3 / 3.2 / 3018 | 107 / 12.6 / 6.2 / 5.5 / 2.2 / 2604 | 113 / 12.5 / 4.1 / 6.8 / 3.4 / 2994 | 136 / 8.4 / 3.5 / 5.2 / 2.3 / 2994 |

"after again" is level with "before". The first run's slow T-Cam and Helicopter are main-thread `draw` (9.1 and
6.7 ms against ~4), not GPU, on the browser's first page: the same first-load slowdown phase 6 saw, not the shader
(one multiply).

Pictures (session notes folder `phase-7-screens/`):
- **Dry is unchanged pixel for pixel.** Brazil replay at 1:06:40 (`?t=4000`, on slicks, wet 0), paused, Helicopter,
  with the page's clock stopped by an init script (`performance.now()` returns a constant, so cloud shadows and the
  crowd draw the same frame every run). `before-frozen-2` vs `after-frozen-2`: 76 pixels differ, all inside
  1775-1784 × 26-36, the header's "NEXT Practice 1" countdown. Other pairs differ only in the tree crowns, which
  still sway between runs on the same code (`frozen-noise.png`: after vs after).
- **Wet is darker.** The Simulation, Spectate, Monsoon, wetness 100, paused once the RAIN badge was up; the same
  frame shot with `wetDark` at 0.765 and at 1 (a temporary `window.__wetDark` line, removed):
  `monsoon-ab.png` (Helicopter, top dry ground, bottom wet), `monsoon-chase-ab.png` (TV Chase).

Not done or not verified, and why:
- **On screen the darkening is small: 3-8 %, not 23 %.** Measured on the same frame: Helicopter verge 0.96, its
  satellite ground 0.97; TV Chase verge 0.92-0.97, far ground 0.99. Monsoon pulls the fog in to ~13 % of its dry
  distance (`setWeather`), and that grey veil plus AgX's curve take most of the albedo change. Trying 30 % (the
  top of the plan's 20-30 %) moved the near verge from 0.93 to 0.92 only, so 25 % was kept. Making the grass read
  clearly wet through the fog (darker still, less saturated, or a sheen) is a taste choice; listed under Next.
- The Simulation's Monsoon was checked; a replay's own rain (wetness ≤ 0.9 in `replayWeather`) uses the same path
  and wasn't shot separately.
- No new test: one uniform and one multiply per shader.

Watch out:
- **Stopped clock for pixel compares:** `agent-browser --init-script freeze.js` with
  `{ const t = 5000; performance.now = () => t; }` makes the 3D frame repeat across fresh browsers (the paused
  replay still draws, and the Helicopter camera still lands). Tree sway doesn't freeze; crop or mask it.
- The Simulation's Monsoon takes ~30-60 s of race time to rain: shots before the RAIN badge shows are still sunny.
- The scripts are in the session notes folder `phase-7-scripts/`: `shot.sh` (dry, `T=` and `INIT=`), `mshot.sh` + `monsoon.js` (Monsoon), `ab.sh`,
  after/before/after in one browser with files swapped on disk and `location.reload()` (an `open` on the same URL
  doesn't reload).

Next: the plan's phases are all done. What's left:
- **Needs the user** (plan section 3): the cars' first frames after the globe closes; night brightness of the
  satellite ground and the crowd; the floodlight beams; the Night HDRI. Plus, from this phase: whether the wet
  ground should read darker than the 3-8 % the Monsoon fog leaves of it.
- **Found on the way** (not graphics): leaving Play while driving leaves `.mapwrap.driving` set (no ▶ in the Races
  replay until a reload); C and keys 1-5 in Play hand the player's car to the AI.
- **The branch chain** `graphics-perf-phase-1` → `-2` → … → `-7`, each made from the one before, none pushed or
  merged into `master`. `graphics-perf-phase-7` holds all of them.
