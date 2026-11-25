# Audit phase 6 handover (25 Nov 2026)

Phase 6 of `docs/audit-fix-plan.md` is done. `scripts/test_all.py` is green (34 JS suites, test_server.py, tsc).

## What changed
- 6.1 `hud.js`, `reallap.js` and `strategylab.js` use `util.js` `fmtLap`; their local copies (which printed
  119.9996 s as "1:60.000") are gone. The HUD keeps its `'–:––.–––'` placeholder.
- 6.2 One `median` in `util.js` (NaN for an empty list), imported by `pace`, `whatif`, `season`, `ledgers`,
  `quali` and `story`.
  - `story.js` took the upper middle for an even count. Its medians only feed thresholds (typical lap × 3 for a red
    flag), never a lap that must be real, so it now averages like the rest. test_story still passes.
  - `season.js` returned `null` for an empty list. Its only empty case is `q.gap` with no gaps, which callers show
    only when `q.n` is set, so NaN is safe there. Its median asserts moved from test_season to test_util.
- 6.3
  - `app.js` imports `SESSIONS as ORDER` from share.js instead of repeating the list. The name is aliased because
    app.js already imports stream.js's `SESSIONS`, which is a different list of pairs.
  - `strategylab.js` imports `code` and `chip` from `charts.js`, where they were identical copies. `chip` is now
    exported. `drivers.js`'s `chip` takes a team, not a colour, so it stays.
  - `export` dropped from `scene3d.resetView`, `cars3d.dataTex` and `satellite.tileRange`. Nothing outside their
    modules used them.
  - `ledgers.js` `stewardParts`: the unused `label` is deleted.
- 6.4 The CI workflow's own tsc step is deleted, since `test_all.py` runs tsc.

## Tests
`test_util.mjs`: `fmtLap(119.9996)` is "2:00.000", `fmtLap(null)` is `''`, and median of an empty, odd and even list.

## Checked in the browser
agent-browser: `#2024/1/strategy` draws the lab with driver chips, and `#2024/1/replay` loads. `__errs` was empty
on both.

## Not checked
- The HUD lap clock (hud.js) was not seen while playing. Play needs a sim race.
- The real-lap labels (reallap.js) were not seen. They need the trace modal's real-lap comparison.

## Next
Phase 7: optional items. Each needs a yes or no from the user first.
