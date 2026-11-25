# Audit fix plan (25 Nov 2026)

Every fix from the two audits of 25 Nov 2026: the whole-repo audit (backend read in full) and the follow-up on what it
skipped (all 92 frontend modules, build scripts, a browser run). Progress is in Status below. One phase per session,
in order; each phase ends with `scripts/test_all.py` green and a short handover in `docs/handover/audit-<n>.md`.

Line numbers are from the working tree on 25 Nov 2026 (branch `multiviewer-layouts`, uncommitted changes included) and
will drift: find each spot by the code quoted, not the number.

Items marked **(reviewer)** came from a read-only reviewer and were not re-read by hand: confirm the case in the code
before changing anything, and drop the item if it doesn't hold.

## Status

- [x] Phase 0: baseline (25 Nov: test_all green in ~13 s; pending work committed as 81893cc)
- [x] Phase 1: confirmed user-visible bugs (frontend), see `docs/handover/audit-1.md`
- [x] Phase 2: server safety and the F1 TV sign-in cache, see `docs/handover/audit-2.md`
- [x] Phase 3: stale results after a change (races between async work and the UI), see `docs/handover/audit-3.md`
- [x] Phase 4: 3D stage correctness and GPU leaks, see `docs/handover/audit-4.md`
- [x] Phase 5: per-frame waste, see `docs/handover/audit-5.md` (5.6 closed without a change)
- [x] Phase 6: lean: duplicates, dead code, small leftovers, see `docs/handover/audit-6.md`
- [ ] Phase 7: optional items (decide, then do or close)

## How to verify in the browser (every frontend phase)

- Start `src/server.py` and open it with agent-browser and an init script that records errors. `agent-browser console` does not
  show uncaught exceptions (CLAUDE.md):
  `window.__errs=[];addEventListener('error',e=>__errs.push(e.message),true);addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)))`
- Don't use `agent-browser wait`: it kills its daemon here. Sleep in the script instead.
- Check `__errs` is empty after each step of the phase's walkthrough.

---

## Phase 0: baseline

1. Run `.venv/Scripts/python scripts/test_all.py` and record the time and result. The audit saw all 34 JS suites, `test_server.py` and tsc pass.
2. Commit or stash the current uncommitted work first, so each phase's diff is only its fixes.

---

## Phase 1: confirmed user-visible bugs (frontend)

All six items were confirmed in the code. Item 1.1 was also reproduced in the browser.

### 1.1 Table sorting crashes (must)
- **Where:** `src/static/app.js:194` (`sortTable`), import on `app.js:4`.
- **Case:** clicking any `table.data` header throws `ReferenceError: cellOrder is not defined`, so no table sorts.
- **Change:** add `cellOrder` to the `./util.js` import on line 4.
- **Guard against a repeat:** add `src/static/app.js` to `jsconfig.json` `files`, and run tsc. If it reports more than
  `cellOrder`, fix those that are real, and leave `app.js` out of the list if the rest is noise (note which in the handover).
- **Test:** none new needed beyond tsc. Browser: Results tab, click "Pos" twice, rows reverse, `__errs` empty.

### 1.2 Race-control engineer calls never play in replays (must)
- **Where:** `src/static/audiodeck.js:45` (`rcSeen = ...length`) and the loop in `radioEvents` (~line 100).
- **Case:** on a session's first frame `rcSeen` is set past every message, so DRS / VSC / safety-car calls never fire
  in GPS or lap replays. Play works only because `simmode.js` appends messages while it runs.
- **Change:**
  - On a new `S`: `rcSeen = rc.filter(m => m[0] <= S.t).length` (messages already in the past stay silent).
  - In `updateAudioDeck`, when `!on` (a seek or a jump over 5 s), move `rcSeen` past every message with time
    <= `S.t` without calling `transmit`, so a forward scrub doesn't fire a backlog. A backward scrub should also pull
    `rcSeen` back to the first message after `S.t`.
- **Test:** export a small pure helper, e.g. `rcIndex(rc, t)`, and test it in a new `tests/test_audiodeck.mjs` only if
  audiodeck.js can be imported without three.js. If not, put the helper in `util.js` and test it in `test_util.mjs`.
  Cases: start mid-session, play past a message, seek forward over 3 messages, seek back.
- **Browser:** a 2026 race replay seeked to just before a "DRS ENABLED" message, with audio on: one call plays.

### 1.3 Play setup card hangs when the entry list fails (must)
- **Where:** `src/static/playsetup.js:49` (`opts[0][0]`).
- **Case:** a Jolpica failure gives `[]`, and `opts[0][0]` throws. The card stays on "Loading track…" and the
  "No entry list" branch (~line 71) is unreachable.
- **Change:** `opts[0]?.[0] ?? ''`. Then confirm line 71's message shows.
- **Test:** add a case to `tests/test_play.mjs` (or wherever `setupCard` is covered) with `list: []`, if it can run
  without a DOM. Otherwise check in the browser by forcing the fetch to fail (e.g. a temporary 502 from a stubbed route).

### 1.4 A replay jumps ahead after the tab was hidden (must)
- **Where:** `src/static/replay.js:709-711` (`tick`).
- **Case:** rAF stops in a hidden tab. On return, `now - S.last` is minutes, so 2 min away at 10× skips 20 min, and
  `S.watched` counts `watched_60s` for an unwatched tab.
- **Change:** `const real = Math.min(0.5, Math.max(0, (now - S.last) / 1000));`, used for both `dt` (times speed) and
  `S.watched`. Keep the existing grid-lights rule and the sim's own 2 s cap.
- **Browser:** play at 10×, hide the tab 30 s (`document.visibilityState` via a second tab), come back: the clock has moved
  under a second.

### 1.5 The chequered flag is styled as a red flag (must)
- **Where:** `src/static/pitwall.js:95`.
- **Case:** `/RED/` matches inside "CHEQUERED", so "CHEQUERED FLAG" gets `data-kind="red"`.
- **Change:** `/\bRED\b/`. While there, decide on purpose which kind a chequered message should get (green or its own
  kind with a style in `style.css`).
- **Test:** if the kind choice can be pulled into a pure function (`bannerKind(text)`), test it in
  `tests/test_util.mjs` or a new file: "CHEQUERED FLAG", "RED FLAG", "SAFETY CAR DEPLOYED", "DRS ENABLED".

### 1.6 The picture-in-picture button shows the layout icon (nice, trivial)
- **Where:** `src/static/tvcontrols.js:19` and `:28` (two `pip` keys; the second wins).
- **Change:** rename the second (layout) key to `pipmode`, update its user(s) (`multiviewer.js:183`, grep `icon('pip')`),
  so the tile's browser PiP button gets the first icon back.
- **Browser:** open the F1 TV viewer, compare the PiP button and the layout switch icons.

---

## Phase 2: server safety and the F1 TV sign-in cache

### 2.1 Cross-site GETs can spend the OpenF1 and Jolpica quotas (must)
- **Where:** `src/server.py` `revalidate_static` (~line 649).
- **Case:** any web page can embed `<img src="http://127.0.0.1:8086/api/replay/2024/N">` for many races, so the server
  builds them all (about 30 OpenF1 requests each), and the user's own clicks then queue behind them for minutes. Driver ids
  under `/api/driver/` can likewise use up Jolpica's ~500 an hour.
- **Change:** in the middleware, return 403 when the path starts with `/api/` and
  `request.headers.get("sec-fetch-site") == "cross-site"`. Leave requests without the header alone (curl, tests, LAN tools).
  Keep the existing Origin check for POSTs.
- **Test (`tests/test_server.py`, beside the Origin tests ~line 860):** a GET to `/api/seasons` with
  `Sec-Fetch-Site: cross-site` gets 403; with `same-origin` and with no header it gets through.
- **Check:** WebView2 (desktop app) sends `same-origin` for the page's fetches. Open the desktop app once and load a race.

### 2.2 After signing in to F1 TV in the desktop app, replays already opened stay as they were (must)
- **Where:** `src/static/util.js:16-38` (`get` caches by URL only); sign-in and Disconnect in
  `src/static/multiviewer.js:125` and `:142` (`connectPanel`).
- **Case:** open 2021 Bahrain (lap-timing replay without a token), press "Sign in to F1 TV" in the desktop app (no page
  reload), open Bahrain again: the cached lap replay comes back, not the archive GPS replay.
- **Change:** export `forgetReplays()` from util.js, which deletes every `cache` key starting `/api/replay/`. Call it
  after the token is stored, and after Disconnect. The browser bookmarklet path reloads the page, so it needs nothing.
- **Test:** `tests/test_util.mjs`: stub `fetch`, call `get('/api/replay/2021/1?session=Race')` twice (one fetch), call
  `forgetReplays()`, call again (two fetches).

### 2.3 Hash-pin the page libraries other than three.js (should)
- **Where:** `src/assets.py` `core()` (~lines 117-135), `src/static/asset_hashes.json`, `write_three_hashes`.
- **Case:** shaka-player, anime.js and theatre (core and dataverse) are downloaded once without a hash check, then
  served `immutable` forever into the page that holds the F1 TV token.
- **Change:**
  - Record their sha256 next to the three.js ones (a key per file, e.g. `shaka/shaka-player.compiled.js`).
  - Pass each to `fetch(url, dest, sha)`.
  - Extend `write_three_hashes` (rename it `write_hashes`) to record these four too, so a version bump stays one command.
  - Watch out: jsDelivr's `+esm` builds (theatre) can be rebuilt by jsDelivr. A mismatch fails the first start with a
    clear error, which is the point. Note the re-record step in the docstring.
- **Test:** `test_server.py` already covers `fetch` with a sha (grep `sha256`). Add an assert that every `jobs` URL
  in `core()` that is code (`.js`) has a recorded hash.

### 2.4 Shared dictionaries changed by several threads without a lock (nice)
- **Where:** `src/replay.py:234-241` (`_sweep_recent`, and the `_recent` reads and writes in `_gps_replay` and
  `archive_replay`); `src/server.py:536-546` (`live_ticket`, `_tickets`).
- **Case:** a sweep in one thread pops a key while another thread's `sorted(..., key=lambda k: _recent[k][0])` reads it,
  which raises `KeyError` at the end of a 30-request build. Two tabs asking for a live ticket at once can hit
  "dictionary changed size during iteration".
- **Change:** `_recent_lock = Lock()` held inside `_sweep_recent` and around each `_recent[...] = ` / `.get`. A
  `_tickets_lock` held for the cleanup loop and the insert, and for the `pop` in `live_stream`.
- **Test:** the existing `_sweep_recent` and ticket tests (`test_server.py` ~1198 and ~1347) must still pass. No new
  threading test: it would be flaky.

### 2.5 Small server leftovers (nice)
- **Where:** `src/server.py:494`, `:704`, `:718` (unused `request: Request` params), `:644` (`import base64, hashlib` mid-file).
- **Change:** drop the three params and move the import to the top with the others.

### 2.6 `TRANSCRIBE` switch is always on (nice)
- **Where:** `src/radio.py:257`, `:268-274`; `src/static/radiopanel.js:58` (`R.words = r.transcribe`).
- **Change:** delete the constant and its `if TRANSCRIBE else None` branches, and drop `"transcribe"` from the payload.
  In radiopanel.js, remove `R.words` and its checks (grep `R.words`), as if always true.
- **Test:** the radio tests in `test_server.py` (~line 430-520) that read `r["transcribe"]` change with it.

---

## Phase 3: stale results after a change

Each of these is async work landing after the user moved on. Same pattern every time: capture what the work was for,
and drop the result if it no longer matches.

### 3.1 A season section can show the previous season's data (should) (reviewer)
- **Where:** `app.js:44` (`jol` reads `A.year` when called), `app.js:63`, `:84`, `seasonview.js:102`, `ledgers.js:121`, `:138`.
- **Case:** switch 2024 → 2025, open "Season trends" before the 2025 calendar lands, and 2024 tables are drawn under a 2025 heading.
- **Change:** `jol(kind, round, year = A.year)`. Have `seasonTrends` / `resultLedgers` take the year they were built
  for and pass it through. Drop the result if `A.year` moved on by the time it lands.
- **Browser:** throttle the network (or stub a slow `/api/season/2025`), switch the season, open the section at once.

### 3.2 Live view loses its top bar after the Play card (should) (reviewer)
- **Where:** `replay.js` `reset()` (~361-387); the `setup` class is added at ~260 and removed only in `showRace` / `startPlay`.
- **Case:** open Play (the card shows), press LIVE: `.hud-top` and `.hud-deck` stay hidden (`style.css` ~901).
- **Change:** `ui.stage.classList.remove('setup')` in `reset()`.
- **Browser:** needs a live session or `LIGHTSOUT_LIVE_PLAY=<recording>` (`live.py`). Check that the HUD shows.

### 3.3 Momentum strip keeps the old session (should) (reviewer)
- **Where:** `replay.js:1034-1038`, `prepare` (~828).
- **Case:** follow a driver in the Race, switch the session select to Qualifying: `S.momFor` is still `gps:44`, so the
  Race laps are drawn against Qualifying's length.
- **Change:** `S.momFor = null` in `prepare`, next to `S.towerAt = 0`.

### 3.4 A superseded stream load paints "Playback error 7000" (should) (reviewer)
- **Where:** `multiviewer.js:681` (the `catch` after `player.load`).
- **Case:** switching a tile's stream (or 4K) during a load interrupts the first load, and its error overwrites the
  new load's "Loading…".
- **Change:** at the top of the `catch`: `if (!M.tiles.includes(t) || t.pick.value !== ch) return;` (use whatever
  the load captured). Shaka code 7000 is LOAD_INTERRUPTED and can also be ignored by code.
- **Test:** `tests/test_multiviewer.mjs` if `load` can be reached with a fake player (the README screenshots used a
  fake shaka, see the learning on it). Otherwise browser only.

### 3.5 Strategy lab shows plans for the old overtaking setting (nice) (reviewer)
- **Where:** `strategylab.js:62` (`findBest` result check).
- **Change:** capture `S.pass` with the driver at the start, and return early if either changed.

### 3.6 Two quick radio-pin clicks play both clips (nice) (reviewer)
- **Where:** `replay.js:564-570`.
- **Change:** `const call = ++clipCall;` before the `await fetch`, and after it `if (call !== clipCall) return;`.

### 3.7 Focusing a nearby car doubles its engine sound (should)
- **Where:** `src/static/audio.js:298-305`.
- **Case:** voice 0 takes the newly focused car, but the ambient voice that already played it keeps it, so two voices
  play one car.
- **Change:** after the voice-0 reassignment, free any other voice with that id:
  `for (const v of voices.slice(1)) if (v.id === want[0]?.id) { ramp(v.out.gain, 0, 0.05); v.id = null; }`
- **Test:** if the voice assignment can be pulled out as a pure function (`assign(voices, want)` returning ids), test it:
  hero taken from an ambient slot, hero unchanged, hero gone.

---

## Phase 4: 3D stage correctness and GPU leaks

Follow CLAUDE.md's 3D rules (`csmSync`, no WebGL fallback) and the user's rule that the picture must not get worse
(memory: no graphics quality loss). Compare before and after screenshots of the same replay moment.

### 4.1 Machines without a GPU still load the heaviest assets (should) (reviewer)
- **Where:** `cars3d.js:401` (`const TYRES = deviceTier() === 'desktop'`, decided at import), `rb22.js:26`
  (`teamModel`), against `scene3d.js:116` (`tier = deviceTier(probeGpu())`).
- **Case:** on SwiftShader, llvmpipe or Basic Render Driver, `scene3d` knows the tier is `software`, but these two
  see `desktop`. So they load the 4096 px tread maps and nine full-size team GLBs.
- **First, decide:** should `software` get the full cars at all? `graphics.js` says software means "no
  supersampling" only. If full cars are intended there, this item becomes "make both modules read the same tier", with
  no behaviour change on real GPUs.
- **Change:** keep the probed tier in one place (a `let` in `graphics.js` set by `init3d`, read through a getter).
  Make `TYRES` a function read when tyres are built, not a module-load constant.
- **Test:** `tests/test_graphics.mjs` for the getter (default before probing, the value after setting it).

### 4.2 A pit crew can appear beside a car stuck in the run-off (nice) (reviewer, not seen happen)
- **Where:** `scene3d.js:986` (`c.v < 1.5 && |road.lat| > half + m(3)`), `pit3d.js:114-117` (4 slots).
- **Case:** in Play, a crashed car stopped in the gravel gets a crew that never leaves. Four of those use up the slots,
  and real stops get no crew.
- **Change:** have `pitLane()` expose `onLane(x, z)`, a nearest-distance test against its lane points, and use it
  instead of the lateral-offset test.
- **Check:** confirm it first. Crash a sim car into a wall, stop, and look for a crew. If none shows, close the item.

### 4.3 GPU objects not freed on a circuit switch (nice) (reviewer)
- **Where:** `circuit3d.js:748` (`tex.checker.clone()` in `gantry()`), `trackside.js:89`, `:143` (`tecpro`, `beam`
  materials local to their blocks), `trackside.js:327-338` (`dispose`).
- **Change:** add the clone to `g.userData.mats` (or dispose it in `circuit.dispose`). Hoist `tecpro` and `beam` so
  `dispose()` frees them.
- **Check:** `renderer.info.memory` (textures, geometries) after 10 switches between the same two circuits should be
  flat, not climbing. The audit's JS-heap reading (600-920 MB swinging) was inconclusive. Use `renderer.info` (see the
  learning on profiling in the browser pane).

### 4.4 Foliage depends on which circuit is opened first (nice) (reviewer)
- **Where:** `textures3d.js:218` (`foliage()` uses the shared `rand`), `:76`.
- **Change:** reseed at the top of `foliage(kind)`: `seed = 1 + ['lush', 'palm', 'arid'].indexOf(kind);`
- **Check:** screenshot Spa opened first and Spa opened after Singapore: identical trees.

### 4.5 Opening the car showroom twice quickly builds it twice (nice) (reviewer, unconfirmed)
- **Where:** `carsdeck.js:78`, `showroom.js:239-241`.
- **Case:** toggling the CARS panel twice before `ready` resolves runs `create()` twice, which leaks a canvas, an
  OrbitControls and a ResizeObserver.
- **Change:** keep the first `create()` promise and return it to the second caller.

---

## Phase 5: per-frame waste

Measure first with temporary `performance.now()` probes (the learning on profiling: PerformanceObserver returned
nothing here), then remove the probes. Keep a change only if it measurably helps, or costs nothing to read.

| # | Where | What | Change |
|---|---|---|---|
| 5.1 | `scene3d.js:835-840` | racing-line ribbon calls `circuit.surface()` twice per point per frame | build the point from the first call's `road.y` |
| 5.2 | `vfx.js:313-314` | rain: a new 6-number array per drop per frame (up to 4,000) | write `rDraw[o]` to `rDraw[o + 5]` directly |
| 5.3 | `replay.js:1067`, `focus.js:30-31` | focus frame recomputes every car's position (`carsAt`) twice per frame | memoise `carsAt` per `t` for the frame, or reuse `render`'s result |
| 5.4 | `replay.js:1040`, `1042`, `1050-1051` | clock, lap and flag text and class written every frame | `setText` / `setAttr` from util.js |
| 5.5 | `radiopanel.js:106` | `said.map(...).join()` over ~150 clips every frame while open | redraw on `said.length` plus a counter bumped by `poll` |
| 5.6 | `multiviewer.js:784` | `Object.values(r).join()` per tile per frame | compare the few fields shown directly |

---

## Phase 6: lean

### 6.1 One lap-time formatter (should)
- **Where:** `hud.js:195` (`lapT`), `reallap.js:17` (`lapTime`), `strategylab.js:12`; keep `util.js:184` `fmtLap`.
- **Case:** 119.9996 s prints "1:60.000" in the local copies. `fmtLap` already handles it.
- **Change:** read `fmtLap`'s signature and null handling first, then import it in all three and delete the copies.
  Keep hud.js's `'–:––.–––'` placeholder.
- **Test:** `tests/test_util.mjs`: `fmtLap(119.9996)` is "2:00.000" (add it if not there).

### 6.2 One `median` (nice)
- **Where:** copies in `pace.js`, `whatif.js`, `season.js`, `ledgers.js`, `quali.js`, `story.js`. The `story.js:20` copy takes the upper
  middle for an even count, the others average the two middles.
- **Change:** one `median` in `util.js`, imported by all six. First check whether story.js relies on its upper-middle
  rule (e.g. it must return a real lap, not an average). If so, keep that one under another name (`upperMedian`) with
  a comment saying why.
- **Test:** `test_util.mjs`: empty, odd, even. The modules' own tests must still pass.

### 6.3 Other duplicates and dead code (nice)
- `share.js:6` `SESSIONS` repeats `app.js:43` `ORDER`: export one, import it in the other.
- `code` and `chip` are defined in several modules: merge only where the copies are identical. Leave them where they differ on purpose.
- Remove `export` from `scene3d.resetView`, `cars3d.dataTex` and `satellite.tileRange`, after grepping `src`, `tests` and the html.
  `cars3d.tyreMaker` and `clusterTris` keep theirs if Phase 4 or a new test uses them.
- `ledgers.js:226`: delete the unused `label` in `stewardParts`.

### 6.4 CI runs tsc twice (nice)
- **Where:** `.github/workflows/test.yml` runs `npx ... tsc`, and `scripts/test_all.py` runs it again.
- **Change:** delete the workflow's tsc step. `test_all.py` fails the job if tsc fails.

---

## Phase 7: optional items (decide, then do or close)

Left out of the audit counts as small. Each needs a yes or no from the user before any work.

- **7.1 Caches that only grow** (`radio._errors`, `radio._texts`, `radio._rows`, `f1tv._cache`, `REPLAY_LOCKS`):
  one entry per clip, weekend or session, so a season is a few thousand small entries. Suggested: no change, add a
  `shortcut:` comment naming the limit (a server running for weeks).
- **7.2 `#f1tv=` takes any value** (`app.js` `takeToken`): a crafted link can sign the tab in with someone else's
  token. The server checks every token anyway, so this is low risk. Suggested: store it only if it looks like a JWT
  (three dot-separated base64url parts), one line.
- **7.3 Logic with no test in the 3D and replay modules:** `scene3d`, `circuit3d`, `cars3d`, `rb22`, `vfx`, `trackside`, `pit3d`,
  `audiodeck`, `replaylive`, `focus`, `input`, `simmode`, `hud`, `audio` have no test. Cheapest wins: the pure functions
  touched in Phases 1, 3 and 4 (`rcIndex`, voice assignment, `clusterTris`, `tyreMaker`, `createCrews` slots). Already
  covered where those phases add tests; nothing more unless the user wants it.

---

## Where each finding went

| Audit finding | Phase item |
|---|---|
| First audit 1: replay cache ignores F1 TV sign-in | 2.2 |
| First audit 2: cross-site GETs spend quotas | 2.1 |
| First audit 3: unpinned page libraries | 2.3 |
| First audit 4: unlocked shared dicts | 2.4 |
| First audit 5: `TRANSCRIBE` always on | 2.6 |
| First audit 6: server leftovers | 2.5 |
| Second audit 1: table sorting | 1.1 |
| Second audit 2: race-control calls | 1.2 |
| Second audit 3: Play card hangs | 1.3 |
| Second audit 4: tab-return jump | 1.4 |
| Second audit 5: chequered = red | 1.5 |
| Second audit 6: tsc doesn't see app.js | 1.1 |
| Second audit 7: doubled engine voice | 3.7 |
| Second audit 8: "1:60.000" / formatter copies | 6.1 |
| Second audit 9: wrong-season section | 3.1 |
| Second audit 10: live HUD hidden | 3.2 |
| Second audit 11: momentum, stream error, strategy lab | 3.3, 3.4, 3.5 |
| Second audit 12: device tier | 4.1 |
| Second audit 13: GPU leaks | 4.3 |
| Second audit 14: per-frame waste | 5.1-5.4 |
| Second audit 15: PiP icon | 1.6 |
| Second audit 16: pit crew in run-off | 4.2 |
| Second audit 17: radio-pin double play | 3.6 |
| Second audit 18: lean | 6.2, 6.3, 6.4 |
| Left-out smaller items | 4.4, 4.5, 5.5, 5.6, 7.1, 7.2 |
