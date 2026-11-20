# Improvement plan: stability, data, fan features, packaging (20 Nov 2026)

## Status

- [x] Phase 0: housekeeping and baseline (handover: `docs/handover/improve-0.md`)
- [x] Phase 1: server robustness (handover: `docs/handover/improve-1.md`)
- [x] Phase 2: LAN safety and caching (handover: `docs/handover/improve-2.md`)
- [ ] Phase 3: known bugs (frontend)
- [ ] Phase 4: F1 TV archive spike
- [ ] Phase 5: archive-backed replays (only on go)
- [ ] Phase 6: drop livef1, trim the exe
- [ ] Phase 7: dependency refresh and load time
- [ ] Phase 8: fan features
- [ ] Phase 9: code health and tests

## Baseline (phase 0, 20 Nov 2026, RTX 4080 laptop, `src/server.py` on 127.0.0.1:8086)

| Measure | Value |
|---|---|
| exe folder `dist/LightsOut` (stale build, Nov 7) | 1.1 GB; `_internal/static` 643 MB, `av.libs` 65 MB, `ctranslate2` 61 MB (no longer a dependency), `scipy` 47 MB, `onnxruntime` 38 MB, `timezonefinder_data` 33 MB |
| `/api/replay/2025/24?session=Race` cold / warm | 60.2 s / 0.034 s, 1.76 MB gzipped |
| `/api/replay/2024/7?session=Race` cold / warm | 59.9 s / 0.037 s, 1.73 MB gzipped |
| Home reload (agent-browser headed, 2040x1000) | first contentful paint 116 ms, load event 626 ms, 250 requests (132 under `/static/`), 55 KB transferred (revalidations) |
| `scripts/test_all.py` | 11.3 s, all suites pass |

Cold replays were taken right after server start, while `warm_up` also spends the OpenF1 budget.

## Context
Graphics/perf phases 0-8 are done (phase 8 has no handover yet). The user asked for a deep-dive improvement plan
for the rest of the app, built in phases, one fresh Claude session per phase to keep context small. Scope picked by
the user: stability & code health, data sources, fan features & UX, packaging & ops. Decisions taken:
- **No live phase this season.** Live timing has run only against stubs. It stays unverified and live-only features
  (broadcast-delay slider, SSE push) are out.
- **The user has F1 TV Access+**, so a spike tests whether their token reaches F1's timing archive.

Sources: three read-only surveys (open items in every plan/handover/learning, backend+build, frontend non-3D) and
web research:
- F1's `livetiming.formula1.com/static` archive returns 401 since ~15 Oct 2026, and the FastF1 mirror holds only 2021-22
  ([FastF1#978](https://github.com/theOehrly/Fast-F1/issues/978)). FastF1 3.9 logs in with F1 TV Access
  ([release](https://newreleases.io/project/github/theOehrly/Fast-F1/release/v3.9.0),
  [auth docs](https://docs.fastf1.dev/api_reference/accounts_auth.html)), and other projects send the F1 TV token on
  archive requests ([olamva/f1#384](https://github.com/olamva/f1/pull/384)).
- Similar apps (undercut-f1, Paddock Live, Monaco, F1ReplayTiming) all have broadcast-delay sync. It's out here
  because it's live-only.
- Jolpica's limits are 4 req/s burst and 500/h sustained, with no rate-limit headers; it answers 429.

## How this plan runs (copy into the plan doc in phase 0)
- Phase 0 copies this file to `docs/improvement-plan.md`, with a **Status** checklist. That doc is the source of truth.
- One phase per session. Start by reading `docs/improvement-plan.md` and the newest `docs/handover/improve-N.md`
  (the `phase-N.md` names belong to the graphics plan). Do only that phase.
- End by writing `docs/handover/improve-N.md` from the template below, ticking Status, and running
  `scripts/test_all.py` and `trail check`. Commit on branch `improve-phase-N`, made from the previous phase's branch.
  Phase 0 branches from `graphics-perf-phase-8`.
- Every bug fix leaves a test (`tests/test_server.py` asserts, or `tests/test_<module>.mjs`). UI changes get a headed
  agent-browser check with a window `error` listener. Every change follows the no-graphics-quality-loss rule.
- To start a session, the user types: *"Do phase N of docs/improvement-plan.md."*

Handover template:
```
# Handover after improvement phase N (date)
Branch / commits:
Done: (each item, with file:line)
Measured after: (baseline table from phase 0, the rows this phase touches)
Not done or not verified, and why:
Watch out:
Next: phase N+1, start with item X
```

## Phase 0: Housekeeping and baseline (docs + 1 script change)
1. Write `docs/handover/phase-8.md` and its Status line in `docs/graphics-perf-review-plan.md` from the 2 phase-8
   commits (`git show --stat 9200022 2dd6c52`) and the cockpit-mirrors learning. Fix phase-7's stale "none merged"
   line (master has `b1e1052`).
2. Move the root `AUDIT_AND_MASTER_PLAN.md` and `implementation.md` into `docs/` (the fan roadmap's rule).
   `CLAUDE.md` names `CONTEXT.md` and `docs/adr/`, which don't exist. Remove those references, unless the user wants them.
3. `scripts/test_all.py:17-19`: run every suite, then report all failures and exit 1 (CI behaviour is otherwise unchanged).
4. Baseline table (kept in the plan doc):
   - exe folder size and the size of each part
   - cold and warm `/api/replay` time on one GPS race
   - first-paint time and the request count of a reload (agent-browser network log)
   - `test_all` time
5. (Done before phase 0: this doc was written by the planning session; commit it with phase 0.)

## Phase 1: Server robustness (`src/replay.py`, `src/server.py`, `src/live.py`, `src/jolpica.py`, `src/tracks.py`)
1. `_throttle` (`replay.py:40-48`) sleeps for up to 60 s while holding `_sent_lock`. Through the 40-thread pool, that
   stalls every OpenF1 user and even `StaticFiles`. Fix:
   - sleep outside the lock: reserve a slot, then wait
   - `warm_up` (`server.py:718`) yields to user requests
   - timeout `(5, 30)`, not 120 s
   - a 503 "busy, retry in Ns" when the wait would be long
2. `_is_live` (`server.py:318`) opens SignalR and waits up to 5 s inside a 404 path. Check `scheduled_session` first.
3. Validate `driver` with `Query(ge=1, le=99)` (`server.py:474`, `:586`). Each new number costs quota and a cache file.
4. Jolpica `_pages` (`jolpica.py:69-76`): retry once on 429/5xx with backoff.
   - Learning: qualifying rows scramble at the 100-row page boundary, so `drivers.js` `numbered` miscounts. Fix it here with a test.
5. `tracks._mv_years` (`tracks.py:63-65`): remember a MultiViewer failure for 5 min, so requests don't each wait out a 30 s timeout.
6. Bound the caches that never shrink: `REPLAY_LOCKS`/`ELEVATION_LOCKS`/`PITLANE_LOCKS`, `radio._texts/_errors/_rows`,
   `f1tv._cache`, `server.season` `lru_cache(None)`, `_recent` eviction (`replay.py:291`).
7. `/api/live` deep-copies all state every poll (`live.py:217-220`). Serialise once per feed message. Test against
   the existing stubs only; it's not checked live.
Tests: a mocked throttle under concurrency, the 503, the driver bounds, the 429 retry, the qualifying boundary.

## Phase 2: LAN safety and caching (`src/server.py`, `src/desktop.py`, `index.html`)
1. The server binds `0.0.0.0` with no auth (`desktop.py:87`, `server.py:747`). Any LAN device can start the 600 MB
   asset download or the 2.5 GB model download. Fix:
   - default to `127.0.0.1`, with `LIGHTSOUT_LAN=1` to open it (update the CLAUDE.md "LAN:" line and the README)
   - POSTs require a same-host Origin
2. `server.py:630` sends `no-cache` for all of `/static`. Send `public, max-age=31536000, immutable` for
   `/static/assets/` (hash-pinned by `asset_hashes.json`) and keep `no-cache` for the app's modules.
3. Replays are re-gzipped on every request (`server.py:334`, `:644`). Write a `.json.gz` beside each cached replay
   and serve it with `Content-Encoding: gzip`. `/api/sessionlaps` (`:355`) reads a small cached subset, and
   `_replay_grid`/`ledgers` read one `lru_cache`'d header (`replay.py:373`, `ledgers.py:63`).
4. CSP: the inline `index.html:23` script breaks once CSP is enforced. Move it to an external file. Enforcing CSP
   stays a separate, later decision (T4.6 headed sweep).
Measure: the baseline's reload request count and warm replay time.

## Phase 3: Known bugs (frontend)
1. Leaving Play mid-drive leaves `.mapwrap.driving` set, so the Races replay has no ▶.
2. In Play, C (`onboard.js` `nextCamera`) cycles into Free Orbit, and keys 1-5 hand the player's car to the AI.
3. Finished cars stack at `pointAt(0)` in lap-timing replays (lap-timing-lanes learning). `focus.js` telemetry reads
   raw `gpsPos`, not the spread position.
4. `sortTable` (`app.js:165-174`) misorders `−1.2 s` (a Unicode minus). Add one `signed()` to `util.js` and use it in
   the 8 copies (`ledgers.js:238`, `strategylab.js:10`, `trace.js:95`, `tracemodal.js:353,400`, `season.js:80`,
   `teledrawer.js:89`, `charts.js:210`). `sortTable` also accepts `−`.
5. Shift+T (`tracemodal.js:102`) fires behind the career dialog. Add the `covered()` check, and give
   `drivers.js:151` the `palette.js` `modal()`. Remove the intro's Esc listener on close (`app.js:268`).
6. The showroom freezes silently if the model fails (`showroom.js:257`). Use try/catch → `failed(e, retry)`.
7. `get()` cancels the previous `/api/replay/` fetch when a new one starts (`util.js`), so fast race clicks don't run
   parallel 5 MB downloads.
Each item gets a test where the logic is pure (sort, signed, the abort), otherwise a headed browser check.

## Phase 4: F1 TV archive spike (scratchpad only, no app code)
Question: does the user's F1 TV token (Access+) make `livetiming.formula1.com/static/<year>/.../Index.json`,
`Position.z.jsonStream`, `CarData.z.jsonStream` and `TimingData` answer 200, and in which header? Check FastF1 3.9's
`_api.py`/auth code for the exact header and cookie.
- The token comes from the user through an env var at run time. It's never written to disk, a log, or the handover
  (the X-F1-Token rule).
- Measure: which feeds answer, years covered (2018-2026), size and time per session, how long a token lasts (FastF1: ~4 days).
- Compare with OpenF1: GPS rate, gaps, ~30 requests per replay.
- Output: a go/no-go with numbers in the handover. If it's no-go, phase 5 is skipped.

## Phase 5 (only on go): archive-backed replays (`src/replay.py`, new `src/archive.py`)
- When the request carries `X-F1-Token`, `gps_replay` builds from the archive's Position/CarData. Otherwise, or on
  401/404, it falls back to OpenF1. Same payload format, so the frontend stays the same.
- Any payload change means clearing `.cache/replay/*.json` (CLAUDE.md rule).
- Pre-2023 seasons get GPS replays if the archive has them.
- Tests: a parser on a small recorded fixture, plus the fallback on 401.

## Phase 6: Drop livef1, trim the exe (`pyproject.toml`, `src/server.py`, `scripts/build_exe.py`, `src/assets.py`)
1. livef1 is used only for pre-2023 session rows and `/f1schedule` (`server.py:74-81,138,150`), yet it pulls in
   ipython, scipy, timezonefinder and more, ~150 MB. Build those rows from the Jolpica race rows `calendar_ics`
   already reads (`jolpica.py:124-146`). Remove livef1 (and pandas if unused) and `--collect-all livef1`. Update the
   CLAUDE.md dead-ends line.
2. The exe ships 643 MB of assets out of 1.1 GB. Ship only the core assets, and let the in-app Download assets button
   (`assets.start`) fetch the rest. When frozen, `ASSETS` writes under `.cache`, not `_internal`, so Program Files
   installs work. The user should confirm which assets are core: a first run without the extra assets looks plainer
   until they download.
3. Clean rebuild (`dist/` from Nov 7 still has faster_whisper/ctranslate2). Measure the size against the baseline.
   Smoke-run the exe.

## Phase 7: Dependency refresh and load time
1. Check the newest three.js (we're on r187, `assets.py:19`, sha in `asset_hashes.json`), shaka-player 4.12.6,
   fastapi/starlette, uvicorn, pywebview and onnxruntime. Bump each one separately.
   - three.js: before/after screenshots with the frozen-clock script (phase-7 handover Watch out) and the Section 4 fps
     table. Drop the bump if the picture or the fps get worse.
2. Measure first paint after phase 2's caching. Only if it's still slow, `import()` the showroom, F1 TV viewer, trace
   modal, Strategy lab, Raw data and reaction game from `app.js:4-21`.
   - The tech-review plan deferred lazy loading "until a phone layout": this redoes it for desktop, and only with numbers.

## Phase 8: Fan features (no live)
1. Deep links in `share.js` `TABS`: driver career (`#…/drivers?career=<id>`), Strategy lab plan (`?stops=`),
   showroom car. A visible entry point for the reaction game, which today is reachable only from the palette.
2. Add-to-calendar: `/api/calendar` (`server.py:117`) already exists. If no button links to it, add one to the
   schedule view.
3. A5 any-pair head-to-head and A4 radio pins on the replay timeline (`fan-roadmap.md:72-78`). Reuse
   `reallap.js`/`trace.js` and `radiopanel.js` clips.
4. Favourite driver/team: remember one, pre-focus it in replays, put it first in tables (localStorage, like
   `spoilers.js`).

## Phase 9: Code health and tests
1. Move routing (`route`, `syncHash`, `address`, `app.js:77-96,539-571`) into `router.js`, with
   `tests/test_router.mjs` covering Back/Forward and deep links. Move theme/team colours out of `app.js`.
2. One `modal()` and one `typing()` in `util.js`. Replace the 4 modal copies and 3 typing checks.
3. Add tests for the untested pure modules (`racecontrol.js`, `simmode.js`, `optimiser.js`) and for the backend gaps:
   - `radio.clip_url` traversal on the audio route
   - a mocked `_gps_replay` build
   - `pitlane`, `elevation`, `session_events`
   - `by_address` 400
   - `revalidate_static` headers
4. Drop the `export` keyword from the 14 exports used only in their own file. Check each with `trail callers`.
5. A node contrast test of the `--dp-*` text/background pairs (AA).
Splitting `replay.js`/`scene3d.js` (both ~1060 lines) is out: high risk, and only the router extraction earns its keep.

## Needs the user (not scheduled)
- Graphics taste items left from the graphics plan: the globe-close hitch, night ground and crowd, floodlight beams,
  the Night HDRI, and how dark wet ground should read.
- Making the repo public, the trunk choice (master/main/dev), Esri offline terms, the "Lights Out" trademark, and a
  test run on a machine without Python.
- An update check on launch (GitHub release tag), only once releases exist.
- Live: verify on a 2027 weekend; broadcast-delay slider and SSE then.

## Verification (per phase)
- `.venv/Scripts/python scripts/test_all.py` is green, and the new tests fail before the fix.
- UI phases: headed agent-browser at 2040x1000 with a window `error` listener. Screenshots go in the handover.
- Phases 2, 6, 7 re-take the phase-0 baseline rows. Phase 7 also re-takes the fps table.
- `trail check` before each commit.
