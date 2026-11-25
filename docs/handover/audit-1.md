# Audit phase 1 handover (25 Nov 2026)

Phase 0 and Phase 1 of `docs/audit-fix-plan.md` are done. `scripts/test_all.py` is green (34 JS suites, test_server.py, tsc).

## What changed
- 1.1 `app.js` imports `cellOrder`. `src/static/app.js` is now in `jsconfig.json` `files`; tsc reported nothing else, so it stays.
- 1.2 New `rcIndex(rc, t)` in `util.js` (audiodeck.js imports three, so it can't be tested in node). `audiodeck.js` uses it
  on a new session and on every frame that isn't a play step (seek, jump over 5 s, pause), so passed calls stay silent and a
  backward seek re-arms them.
- 1.3 `playsetup.js` `pick`: `opts[0]?.[0] ?? ''`. An empty entry list now shows "No entry list for this race".
- 1.4 `replay.js` `tick`: real time per frame is capped at 0.5 s, for both `dt` and `S.watched`.
- 1.5 New `bannerKind(text)` in `util.js`, used by `pitwall.js`. "CHEQUERED" gets its own `chequered` kind, a white
  stripe (`style.css`, beside the other `.rcbanner` kinds); the banner background is always dark, so white works in both themes.
- 1.6 `tvcontrols.js`: the layout icon is now `pipmode` (used in `multiviewer.js` `seg`); `pip` is the tile's PiP button again.

## Tests
- `tests/test_util.mjs`: `rcIndex` (start, mid-session, play past, seek forward over three, seek back, empty) and `bannerKind`.

## Checked in the browser
- Results tab, 2024 R1: clicking "Pos" twice reverses the rows, no errors.
- `setupCard({list: []})` imported in the page: the button reads "No entry list for this race".

## Not checked in the browser
- 1.2 (hearing a DRS call after a seek), 1.4 (hiding the tab at 10x), 1.6 (comparing icons in the F1 TV viewer, needs a sign-in).
  Covered by the unit test (1.2) or small enough to read (1.4, 1.6).

## Next
Phase 2: server safety and the F1 TV sign-in cache.
