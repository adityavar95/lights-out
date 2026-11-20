# Handover after improvement phase 3 (20 Nov 2026)
Branch / commits: `improve-phase-3`, from `improve-phase-2`.

Done:
1. `src/static/replay.js` `reset`: clears `.mapwrap.driving` and the driving keys. Render used to clear them, but it waits for the next load's data.
2. `src/static/onboard.js` `nextCamera` skips Free Orbit (it is only called while driving). In Play, `replay.js` `setMode('overview')` keeps `S.selected` on the player's car, so key 1 no longer hands the car to the AI, and keys 2-5 stay on it.
3. `src/static/lanes.js` `parked(n)`: finished cars park past the line in two columns (±3.2 m), in finishing order (`replay.js` `lapsState`, through the new `lapPlace`). `focusFrame` now reads `carsAt` (the spread GPS or in-lane lap positions), so the telemetry matches the drawn car. `lapPos` is gone.
4. `src/static/util.js` `signed(v, dp, zero)` replaces the 8 copies. `cellOrder` (used by `app.js` `sortTable`) reads `−`, `-`, `±` and a trailing `s` or `%` as numbers. The ledgers' ASCII-minus workaround is gone.
5. Shift+T (`tracemodal.js`) checks `covered()`. `palette.js` `modal()` is exported (its class is now `dcareer ${cls}`, and the palette's own callers pass `pdlg`), and `drivers.js` `career` uses it, so keys pressed inside the dialog stop there. `app.js` `endIntro` removes the intro's Esc listener.
6. `src/static/showroom.js` `showCar`: if the car fails to build, the note panel shows `failed(e, retry)` instead of the view freezing.
7. `src/static/util.js` `get`: a new race's `/api/replay/` aborts the one still downloading. A race's `&laps=1` and GPS replays share one controller, so they don't abort each other. An aborted body rejects instead of caching `{}`.

Tests: `tests/test_util.mjs` (signed, cellOrder, the replay abort) and `tests/test_lanes.mjs` (parked spots). `scripts/test_all.py` is green.

Not done or not verified, and why:
- The headed agent-browser check only covered the home page loading with no page errors, which shows every changed module imports. Items 1-3, 5 and 6 were not driven by hand: leaving Play mid-drive, C and 1-5 while driving, a finished lap-timing race, Shift+T over the career dialog, and a forced showroom failure. No screenshots.
- Finished cars have no "ahead" point, so they keep their last heading (same as before).

Watch out:
- In Play, Free Orbit now keeps a selected car (the player's). Code that assumes overview means `S.selected === null` may act differently.
- `modal()` no longer adds `pdlg` by itself.

Next: a quick headed pass over phase 3's items 1, 2 and 5, then phase 4, item 1.
