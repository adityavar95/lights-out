# Audit phase 3 handover (25 Nov 2026)

Phase 3 of `docs/audit-fix-plan.md` is done. `scripts/test_all.py` is green (34 JS suites, test_server.py, tsc).

## What changed
- 3.1 `app.js`: `jol(kind, round, year = A.year)` and `jolFor(year)`, a fetch bound to one season. The Results and Standings tabs
  capture `A.year` when they start and pass `jolFor(year)` to `resultLedgers` and `seasonTrends`, whose sections load only when
  opened. So a section always shows the season its heading names. No extra "drop if A.year moved" check: with the year bound the
  data matches the heading, and the tab's existing `key` check already skips drawing for a season the user left.
- 3.2 `replay.js` `reset()` removes the `setup` class, so live (or any view) after Play's setup card gets its HUD back.
- 3.3 `replay.js` `prepare`: `S.momFor = null`, so a session switch on the same car redraws the momentum strip.
- 3.4 `multiviewer.js` `load`: the `catch` returns when the tile was closed or switched, or on shaka 7000 (LOAD_INTERRUPTED, e.g. a 4K
  toggle reloading the same channel).
- 3.5 `strategylab.js` `findBest`: captures `S.pass` with the driver and drops the result if either changed.
- 3.6 `replay.js` `playClip`: a `clipCall` counter; a clip whose fetch was overtaken by a newer click doesn't play.
- 3.7 New pure `voiceIds(have, want)` in `util.js` (audio.js keeps its helpers there, like rcIndex). `audio.js` maps its result onto
  the voices: a freed voice fades out, a newly assigned one is `fresh`. A hero taken from an ambient voice frees that voice.

## Tests
- `tests/test_util.mjs`: `voiceIds` for a hero taken from an ambient voice, an unchanged hero, a hero from voice 2, no cars.
- 3.1-3.6 have no new tests: each is a one-line guard in DOM or worker code with no harness.

## Checked in the browser
- agent-browser, `#2024/1/standings`: "2024 season trends" opens with 2024 charts; `#2024/1/results` draws its ledgers; `__errs` empty.

## Not checked
- The slow-network season switch itself (3.1), live after the Play card (3.2, needs a live session or `LIGHTSOUT_LIVE_PLAY`),
  stream switching (3.4, needs F1 TV), radio-pin double clicks (3.6, needs F1 TV), and the engine voices by ear (3.7).

## Next
Phase 4: 3D stage correctness and GPU leaks.
