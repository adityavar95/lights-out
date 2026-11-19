# Handover after phase 1 (19 Nov 2026)

Branch / commits: `graphics-perf-phase-1` off master (not pushed, not merged): the plan and phase-0 handover, then the
phase 1 commit. `.trail/` is gitignored here, so the phase-0 learning file stays uncommitted.

Done:
1. **Governor** (`src/static/scene3d.js`): Auto starts at 1x (`pixelRatio` L53, `autoScale` is now a factor on the
   display's own pixels, clamped to the 75 % floor and the 4K budget `budgetOf` L51). Steps up after 30 calm frames
   when GPU < 2 ms (else `calmNeed`); a step down doubles `calmNeed` only if a step up was undone within 3 s, else
   resets it to 120 (L241). Done: Brazil canvas went 1998 → 2445 → 3233 px in the first 6 s of play and stayed above
   1x (1998) in every camera.
2. **Warm before the globe closes** (`scene3d.js` `warmStage` L605, `globe.js` L173): the globe's Play waits for the
   photos to land (4 s cap) and for `warmFor` to compile one mesh per circuit material into the scene pass, then fades.
   `warmable()` is shared with `warmCockpit`. **Not met** (see below).
3. **Overview stutter**: measured, no code change. Overview p95 is 12.6 ms (target < 17); its few 20-29 ms frames have
   no main-thread part spiking (per-frame `timed` parts all normal), so nothing to fix in `stats`; the CSS2D tags take
   0.3-0.4 ms. Phase 0's 31.6 ms p95 was most likely the governor stuck at the floor plus a slow browser run (below).
4. **Ground photos later** (`src/static/textures3d.js` `photo` L43, `load` L218; `scene3d.js` `loadPhotos` L593, called
   at L217 on the first frame the stage is seen, and by `warmStage`): the bare address's globe page now fetches 5 MB
   instead of 159 MB (it builds the latest race under the globe, so `setTrack` alone wasn't enough). 4k for Ultra (or a
   Custom tuned from it) on the high tier; else 2k (gravel 1k on the low tier, as before). High/Medium/Low on a strong
   GPU drop from 4k to 2k, as the plan asked.

Measured after (Brazil 2026 race, playing, RTX 4080 Laptop, Ultra, agent-browser headed 2040x1000, display 240 Hz;
screenshots in the session notes folder `phase-1-screens/after-cam1-5.png`):

| Camera | fps | p95 | Frames > 17.5 ms | Main thread draw | GPU | Canvas width |
|---|---|---|---|---|---|---|
| Overview (1) | 91 | 12.6 ms | 1.8 % | 3.5 ms | 4.5 ms | 3233 |
| Chase (2) | 109 | 12.6 ms | 0 % | 4.3 ms | 5.7 ms | 3233 |
| Cockpit (3) | 92 | 12.6 ms | 1.3 % | 5.8 ms | 5.2 ms | 2418-2798 |
| T-cam (4) | 98 | 12.6 ms | 0.2 % | 4.3 ms | 4.8 ms | 2781 |
| Helicopter (5) | 96 | 12.6 ms | 0.4 % | 4.3 ms | 4.6 ms | 3198 |

Fps sits a little under phase 0 in chase and helicopter because the canvas is now 1.4-1.6x instead of 0.9-1.4x (a
sharper picture, GPU 4.5-5.7 ms, under the governor's 8 ms line). Screenshots: road, kerbs, trees, cockpit as before,
at the higher resolution. Tests: `scripts/test_all.py` all pass. No uncaught errors.

Not done or not verified, and why:
- **Item 2's "no frame over 100 ms after the globe closes" is not met.** Globe → Play to a circuit when the page had
  already drawn one: no frame over 50 ms through the fade and close until the cars arrive (before: 470 and 1504 ms in
  the fade, then 412-1029 ms). What remains is the cars: they come with the race data, 0.3 s (cached) to 15 s (OpenF1)
  after the close, and their first frames take 0.25-0.95 s (`setCars` 60-210 ms plus 120-150 ms draws compiling); on a
  fresh page twice (the procedural grid, then the RB22 rebuild). Tried and dropped: (a) warming the cars before
  adding them to the world: 266-337 ms frames, worse than cold, because compiling while the stage shows competes with
  its frames; (b) `warmStage` waiting up to 3 s for the cars: a cached race's cars took 5 s, so it only delayed the
  fade; (c) uploading the photos with `renderer.initTexture` and (d) drawing one stage frame under the globe: neither
  changed the after-close frames. A real fix means building and compiling the grid before the stage shows (the globe
  waiting for the race data, or a hidden first frame for the cars) — a design choice for the user.
- **The agent-browser window has two speeds.** In this session one run had draw 9-12 ms and 40-58 fps everywhere;
  after a reload it was 3.5-5.8 ms (phase 0's numbers). Compare numbers within one run only. It also went `hidden`
  (rAF 0) twice when another window came in front: check `document.visibilityState` before measuring and re-front it
  (`SetForegroundWindow` on the "Chrome for Testing" window).
- Not tested: a Settings tier change after the photos have loaded (they keep the resolution they loaded at until a
  reload); a monitor with devicePixelRatio > 1.

Watch out:
- Driving the globe in agent-browser: pins and its Play button need real mouse clicks (`mouse move/down/up`); script
  `.click()` on a pin does nothing. The globe turns for a moment after opening, so read a pin's position right before
  clicking. The card's Play is the button with text `▶ Play` (its parent is `.gplay`).
- `performance.getEntriesByType('resource')` stops at 250 entries and the globe's tiles fill it: call
  `performance.setResourceTimingBufferSize(5000)` first.
- `agent-browser profiler stop` dropped the daemon with a 12 s profile; in-page timing worked instead.

Next: phase 2 (ground and edges), start with item 5 (past the satellite square).
