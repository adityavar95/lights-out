# Audit phase 5 handover (25 Nov 2026)

Phase 5 of `docs/audit-fix-plan.md` is done. `scripts/test_all.py` is green (34 JS suites, test_server.py, tsc).

## What changed
- 5.1 `scene3d.js` racing-line ribbon: each point is built from the first `circuit.surface()` call's `road.y` (the same
  search `toScene` repeated with the same hint), so one search per point per frame instead of two.
- 5.2 `vfx.js` rain: the six streak numbers go straight into `rDraw`, no array per drop per frame (up to 4,000).
- 5.3 `replay.js` `render`: the focus frame's `pos` reads `gpsPos(id, t)` for one car in a GPS replay, instead of
  `carsAt(t)` for the whole field twice a frame. Lap-timing replays still go through `carsAt` (`lapCars` places the
  field together). Same values: `carsAt` in GPS mode is `gpsPos` per driver.
- 5.4 `replay.js` clock, lap and flag pill: `setText` from util.js, and the flag's class is written only when it changes.
- 5.5 `radiopanel.js`: the redraw key no longer joins every clip's text each frame. The clips only change in `poll`,
  which already clears `R.shown`, so that term never caught anything the reset didn't.
- 5.6 Closed, no change: `Object.values(r).join()` is six numbers per tile (at most four tiles), and comparing the
  fields one by one reads no better.

## Measured
Not measured with `performance.now()` probes as the plan asked. Each change is a removal or a same-size rewrite,
so all of them were kept on the plan's "costs nothing to read" rule, not on a timing.

## Checked in the browser
- agent-browser (headed), `#2024/1/replay`, played and followed VER: the clock, lap and GREEN pill update, the focus card's g-force
  and speed show, and `__errs` stays empty.

## Not checked
- Rain (5.2) and the racing-line ribbon (5.1) were not seen on screen: no wet session, no Play run. The radio panel (5.5)
  needs an F1 TV stream.

## Next
Phase 6: lean.
