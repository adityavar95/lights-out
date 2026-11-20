# Lights Out: implementation roadmap

Written 2026-11-11 from a read-only audit of `master` at `4a15da0`, in two passes on the same day. No source file was changed. The `dev` branch (Rust port) is out of scope.

The second pass re-opened the first pass's Confirmed High and Medium rows at their cited lines (all held; Carried rows such as P1 and F3 were not measured again), read the parts the first pass had only swept by script, and added findings B14-B20, S6-S7, P11-P12 and F11-F13 with their tasks. Section 5 lists what was checked and found sound, so nobody audits it a third time.

**Progress (2026-11-11, branch `roadmap-phase-1`, uncommitted).** Phase 1 is written: T1.1-T1.7 and T1.9-T1.12. T1.8 is closed with no change: the owner decided the desktop app keeps listening on the LAN, as `server.py` does (S1 stands as an accepted risk; T1.9's address check still applies to it). B3 was reproduced first (Jolpica returns no drivers for a season not yet started). All suites pass with the new asserts. T1.1 was checked in a browser against an OpenF1 that fails in 20 ms; the browser checks of T1.10's retry, T1.11 and T1.12 are still owed.

**Phase 2 so far (same branch, uncommitted).**

- *Written, with asserts:* T2.1 (hidden tabs and other views stop polling), T2.3 (radio transcripts kept in memory), T2.6 (past seasons' F1 TV weekends in `.cache/f1tv`), T2.7 (fetch cache capped at 200), T2.8 (this season's session list asked again after 6 h; a failed refresh keeps the old list).
- *T2.2, measured and closed with no change:* a race-sized live state (131 kB as JSON, synthetic) takes 3.9 ms to deep-copy and 1.1 ms to encode, under the 5 ms bar.
- *T2.4, measured and written:* on the largest replay on disk (5.2 MB) read and parse took 81 ms, encoding 48 ms and gzip 22 ms, so 129 of about 151 ms was avoidable. `/api/replay` now sends a built replay's file as stored (`replay.saved_replay`). The second half (`_replay_grid`, `ledgers.overtakes`) is dropped: each parses the file once per driver or race before its own disk cache takes over.
- *T2.13, confirmed and written:* three adds no dispose listener to a render target's texture (`three.webgpu.js`, `isRenderTargetTexture`), so the old sky's two `.dispose()` calls freed nothing: neither the cube background nor the PMREM environment. `loadSky` now keeps and disposes the targets. Checked in a headed browser: five sky changes, the stage still draws, no errors or warnings. GPU memory before and after was not measured.
- *T2.5, measured and written:* six small OpenF1 requests took about 650 ms each on a new connection and 190 ms each on a kept one, so about 450 ms of each of a build's ~30 requests was the connection. `replay.openf1` now uses one `requests.Session`. A whole cold build was not timed before and after.
- *T2.9, measured (P1, P11):* headed Chrome, 1920x1080 window, Ultra with 2x supersampling (3756x1700 canvas), 2024 Chinese GP, temporary probes since removed. Mean ms per frame:

  | Mode | Frame interval | Scene frame (CPU) | of which three's render | Replay `render` | Physics |
  |---|---|---|---|---|---|
  | GPS replay, overview, 1x / 10x | 13.1 / 14.0 | 4.9 / 4.9 | 4.3 / 4.3 | 0.8 / 0.8 | - |
  | GPS replay, follow camera, 1x / 10x | 13.0 / 11.6 | 5.6 / 4.5 | 5.2 / 4.0 | 1.0 / 1.0 | - |
  | Simulation, follow, dry, 1x / 10x | 15.4 / 16.0 | 5.9 / 5.2 | 5.3 / 4.7 | 0.7 / 0.8 | 0.3 / 1.9 |
  | Simulation, follow, monsoon, 1x / 10x | 15.1 / 15.5 | 6.6 / 5.6 | 5.8 / 4.8 | 0.8 / 0.8 | 0.3 / 1.7 |

  **P1 did not reproduce:** every mode ran at 62-86 frames a second, against the 20-25 ms and 36 ms recorded on Nov 5-7 (window size then unknown; a 4K window was not tried now). The largest CPU cost is inside three's own render call (draw submission and the shadow cascades), 4-6 ms; nothing of the app's own is over 2 ms. **P11 is closed with no change:** `vfx.update` is 0.1 ms dry and 0.4 ms in a monsoon, `updateCars` 0.4-0.5 ms, both under the 1 ms bar.
- *T2.10, measured and closed with no change (P9):* with the four stage `:has()` rules the frame interval was 12.4 and 12.1 ms; with them deleted live it was 32.2 and 13.7 ms. They cost nothing measurable.
- *T2.12, part 1 measured and written (B14):* after a new grid, the longest `post.render` on the first switch to the follow camera was 36, 40 and 35 ms before, and 16, 18, 17 and 16 ms once `disposeCars` stopped disposing the shared haze material. Part 2 (B15, re-warming after an MSAA change) measured and closed with no change: headed Chrome, 2026 Brazilian GP replay, Edge smoothing off then on, then the Cockpit camera. Worst frame gap in the first 60 frames after the switch was 154-196 ms without the re-warm and 162-192 ms with it (three runs each, after a reload); the first gap 104-117 ms and 96-104 ms. No ~2 s stall reproduced, so the change was not kept. Not checked: a 4K window or a different sample count.
- *T2.11, written (optional, first seam only):* live timing (`showLive`, `applyLive`, `msFrac`, `liveRender`) moved from `replay.js` to new `src/static/replaylive.js`, which gets the state and helpers through `setupLive`. `replay.js` is 922 lines, still over 500, and the 3D files are untouched. All suites pass. In a headless browser, clicking LIVE raised no page error; the overlay was blank, the same as before, and no live data was seen, so the live path is not verified beyond that. The headed pass is not done.
- *Still to do in Phase 2:* T2.1's hidden-tab behaviour was not checked in a browser.

**Phase 3 so far (same branch, uncommitted).**

- *T3.2, written with an assert:* MultiViewer's year list and outlines and the GeoJSON set are saved under `.cache/tracks` as fetched, and read back when the request fails. Seen written in a real run (`mv_49_2019.json` for Shanghai); starting the server with the network off was not tried.
- *T3.7, written with asserts:* `/api/stints/{year}/{round}` (one OpenF1 request, then on disk) and `pace.js` `compoundOf`. The Strategy lab's pace table shows the compound in each stint cell and in its CSV. It is not a lazy section as the task assumed: the table draws at once and the compounds join it when they land. Checked in a browser on the 2024 Chinese GP (Medium, Hard, Hard for the winner).
- *T3.8, written, step 1 was enough:* the two indoor rigs bake three's `RoomEnvironment` after clearing the renderer's target and MRT; the sunset rig keeps the sky. Headed browser: the RB22 renders under all three rigs with no errors or warnings, and the race stage behind is unaffected. Only the 2026 car was looked at, not a 1955 or 2004 one.
- *T3.9, written with an assert:* the header asks for next season's calendar when this one has no session left, and its click opens that season. Not seen in a browser, since this season still has sessions to come.
- *T3.1, written with asserts (the owner's call: ask first):* nothing fetches the speech model unasked any more. The radio payload says `model` (`ready`, `missing`, `downloading`, `failed`); the panel shows a note with a Download button (Try again after a failure), which posts to `/api/f1tv/radio/model` (same-origin only), and polls while it downloads. Clips play either way; they read "Team radio" until the model is there. Checked in a browser with a made-up feed (the three states and the one POST); a real 2.5 GB download and the panel inside a signed-in viewer were not run.
- *T3.5, written with asserts and checked in the browser:* a replay link's `t`, `focus` and `session` stay in the address while the replay is still at that moment and leave once it plays or seeks away (`share.js` `held`, `app.js` `pending`); a reload returned to 3000 s with VER followed. Known limit: on a race whose GPS replay isn't cached, the lap-timing stand-in's clock differs, so the moment can leave the address when GPS takes over.
- *T3.3, written with asserts and checked in the browser:* `quali.js`, `/api/sessionlaps`, and two Results sections (Qualifying evolution, Practice long runs). Every driver's Q1/Q2/Q3 was compared with Jolpica on five qualifying sessions (2023 Australia, 2024 Imola and Abu Dhabi, 2026 rounds 18 and 19): all match to the millisecond except Lawson's Q1 at 2026 round 19, where Jolpica has no Q1 time for him but has his Q2 and Q3. A time over 107 % of its part's best is dropped, since a slow lap is left standing when a driver's real one is deleted. Fetch the laps was clicked once (2024 Imola Practice 3: built, no long runs, as expected of a qualifying-practice session). A sprint weekend offers Practice 1 only; an unrun round and a pre-2023 race get neither section. Not covered: sprint qualifying, and a weekend whose qualifying has run but whose race hasn't (no such weekend today).
- *Waiting:* T3.4 and T3.6 need a live weekend.

**Phase 4 (2026-11-12, same branch, uncommitted).**

- *Written, with asserts:* T4.1 (`scripts/test_all.py` and `.github/workflows/test.yml`; the server test stubs `assets.core` and asserts its 503 on its own), T4.2 (`asset_hashes.json` holds 17 sha256s for three.js; `fetch` rejects a mismatch and leaves nothing behind; regenerate with `assets.write_three_hashes()` after a bump). The hashes come from the local copies the app already fetched, not from an independent download, so they pin what this machine got and not what jsDelivr serves.
- *Written, with asserts:* T4.3 (non-empty checks on the sky, ISO and photo scrapes, and `_heavy()` run on the real files), T4.7 (`tracks.track` falls back when MultiViewer raises), T4.9 (`today()` and the fresh-season check read the clock per call; a test crosses New Year).
- *T4.4, written:* `f1:drawer`, `graphicsTier` and `nextRig` removed (no listener or caller); the Sprint Shootout name lookup is one helper in `server.py`; `index.html` and `f1tv.py`'s docstring no longer name jsDelivr or the site as the player. B10: the F1.com schedule route answered 200 for 2024 on Nov 12, so the button stays.
- *T4.10, written, not run in a browser:* a device lost twice within a minute stops the loop and shows the words instead of reloading (`scene3d.js` `restartOrGiveUp`); with no device, Cars says why (`showroom.js` `create`, `openShowroom`, `showCar`).
- *T4.5, not done:* `CLAUDE.md` names `CONTEXT.md` and `docs/adr/`, which do not exist. The spec leaves creating them or dropping the sentence to the owner.
- *T4.6, part written (report-only):* `index.html`'s boot script and handlers moved to `boot.js`; the policy is sent as `Content-Security-Policy-Report-Only` on `/` and `*.html` with the import map allowed by hash (`server.py` `IMPORTMAP_HASH`). Checked: the page boots (seven tabs, no boot failure). Not checked: the policy's violations in the console (agent-browser's console showed none, and the listener must attach before load), the hash match under enforcement, and `launcher.html`. Its inline handlers and script moved to `launcher.js` (`data-call` attributes): seven buttons wired, the away panel opens on click, no errors in the browser. The app's own `el()` handlers are JS properties, which a CSP does not block. Enforcing waits for the headed sweep. The stale server on port 8086 predates this change.
- *Not done in Phase 4:* T4.8 (release checks: a built exe on a machine without Python, the Esri terms, the trademark search: all the owner's to run). The optional T2.11 remains open.
- *T1.11 code read, browser check not run:* `downloads.js` `refresh` retries every 5 s while a download is watched.
- *Browser checks still owed* for T4.9 and T4.10 and the T1.10-T1.12 items noted above. All JS and Python suites pass (`scripts/test_all.py`, 27 files).

**How to read this.** Every finding has an ID and a status:

- **Confirmed**: the code was read at the cited line today.
- **Suspected**: follows from the code, but needs a reproduction before anyone fixes it. The Nov 5 audit had one High finding refuted, so treat these as claims.
- **Carried**: left open by `AUDIT_AND_MASTER_PLAN.md` (Nov 5-6). Items that audit fixed are not repeated here.

**What was read.**

- *Line by line:* all of `src/*.py` and `scripts/*`; `app.js`, `util.js`, `scene3d.js`, `post.js`, `vfx.js`, `showroom.js`, `mirror.js`, `sim.js`, `track.js`, `stream.js`, `radiopanel.js`, `commentary.js`, `downloads.js`, `graphics.js`; the load, live, play and track-drawing paths of `replay.js`; the load and play paths of `multiviewer.js`; the dispose paths of `circuit3d.js`, `cars3d.js`, `rb22.js` and `trackside.js`; `simmode.js`'s set-up.
- *Run, not only read:* the simulation with degenerate inputs from a scratch script outside the repo. Section 5 says exactly what ran; it was the test suite's flat stadium, dry, AI drivers only, with no elevation data and no real pit lane.
- *Swept by script:* every route against its callers in both directions, `EVENTS` against `count()` calls, storage keys written against keys read, `graphics.js` options against what applies them, `index.html` ids against the scripts and styles, `shortcut:` and TODO comments, `:has()` rules, timers and observers, open GitHub issues (none) and `docs/ux-audit.md`.
- *Not reviewed for logic:* `vehicle.js`, `racecraft.js`, `strategy.js`, `tyres.js`, `eras.js` (exercised by that run and by five passing suites, not read); the geometry builders of `circuit3d.js`, `cars3d.js`, `trackside.js`, `textures3d.js`; `audio.js`; `glass.js`; `tvcontrols.js`; `palette.js`; `settings.js`; `live.js`; `style.css` beyond its `:has()` rules.
- *Every other static module* (about 45, among them `circuits.js`, `weather.js`, `player.js`, `whatif.js`, `explorer.js`, `loadstage.js` beyond its stage logic, and the decks) was covered only by the script sweeps and by its own test suite where it has one.

**Baseline.** 25 of 25 node suites and `tests/test_server.py` pass (run again in the second pass). `git status` shows this file and `s1.png` untracked, nothing else.

---

## 1. Executive architecture summary

### Current state

| Layer | What it is | Size |
|---|---|---|
| Backend | FastAPI, sync routes on Starlette's thread pool, 32 routes in `src/server.py`. No database: JSON files under `.cache/` written through `replay.save()` (atomic), plus `.cache/jolpica.sqlite` | 11 modules, 2,300 lines |
| Frontend | Vanilla ES modules served from `/static`, no build step. three.js 0.187 WebGPU, shaka-player 4.12.6 | 79 modules, 16,500 lines JS, 1,700 lines CSS |
| Desktop | `src/desktop.py` (pywebview) and a PyInstaller folder build | 120 lines |
| Tests | Plain asserts: 25 node files and one Python file. No runner, no CI | 3,000 lines |

**Entry points.** `src/server.py` (browser, port 8086), `src/desktop.py` (launcher window, also the exe), `scripts/build_exe.py`, `scripts/fetch_assets.py`, `scripts/tile_list.py`.

**Data flow.** The page asks only its own server. The server asks six upstreams and caches each differently:

| Upstream | Used for | Limit | Cache |
|---|---|---|---|
| Jolpica | calendar, results, laps, standings | ~500 requests/h | sqlite for settled races; 5 min in memory plus last-answer files for this season |
| OpenF1 | GPS replays, telemetry, radio list, ledgers | 30 requests/min; answers 401 to everything while a session is live | one JSON file per finished session |
| MultiViewer, GeoJSON | track outlines | none known | process memory only |
| F1 live timing (SignalR) | live tower, live GPS with a token | none known | process memory, 6 s buffer |
| F1 TV | catalogue, play URLs, licences | IP blocked after a few hundred searches | process memory only |
| jsDelivr, Poly Haven, Esri, Google Fonts | page libraries and 3D assets | none known | `src/static/assets/` |

### Tech stack health

- **Good.** Tests are green. Error handling at upstream boundaries is consistent (plain-word 4xx/5xx details). Cache writes are atomic. Inputs from the URL are bounded (`check_season`, the radio clip URL check, the licence host check). The page builds DOM with `el()`; the only three `innerHTML` sites (`hud.js:94`, `onboard.js:64`, `tvcontrols.js:49`) set static SVG strings, and no `DOMParser`, `srcdoc` or `document.write` exists, so upstream text (radio transcripts, F1 TV titles, race control) cannot inject markup.
- **Weak.** Six packages the code imports directly are not declared (B4). three.js is downloaded with no hash check (S2). 41 of 79 static modules are imported by no test, among them `app.js`, `replay.js` and every 3D module. Nothing runs the tests automatically.
- **By design, not debt.** Top-rendition-only video, the fixed 1 s start-light hold, the what-if model's limits, in-memory-only F1 TV token. These are recorded decisions in `CLAUDE.md` and are left alone.

### Critical blockers

Nothing blocks the build or daily use. Three things block a **public release**:

1. **Esri tiles ship inside the exe with Esri's offline terms unchecked** (recorded on Nov 7 as the user's choice, with the check still owed). See T4.8.
2. **The live paths have only run against stubs**: live Widevine in the browser and in WebView2, the licence proxy, the guessed `HDR_UHD_DASHWV` stream type, live feed merging. See T3.6.
3. **The name "Lights Out" has not been checked for trademarks** (`docs/ux-audit.md` item 10).

---

## 2. Gap and improvement matrix

Severity is impact on a user, not effort. "Task" links to section 3.

### 2.1 Bugs and tech debt

| ID | Sev | Status | Where | Finding | Task |
|---|---|---|---|---|---|
| B1 | High | Confirmed | `replay.py:461-473`, `server.py:296-300`, `replay.js:382-384` | When OpenF1 is unreachable (a connection error, not its "no data" answer), a 2023+ race returns 502 and the page shows a failure. The lap-timing replay from Jolpica would have worked: the fallback only runs for `ReplayUnavailable`, and the page only asks for `?laps=1` when GPS is slow, not when it fails fast | T1.1 |
| B2 | High | Confirmed | `jolpica.py:91-95`, `server.py:175-187`, `server.py:603-606` | `races()` has no fallback. If Jolpica is down when the server starts, every route that calls `race_info` (track, replay, elevation, F1 TV, telemetry) answers 502 for this season and `warm_up` returns at once. The last good list is already on disk at `.cache/jolpica/{year}_races_None.json`, but only `/api/jolpica` reads it | T1.2 |
| B3 | Med | Suspected | `jolpica.py:81-83` | `driver_career` calls a driver "active" only if they are in this year's driver list. If that list is empty before round 1, every driver counts as retired and their career goes into the 365-day sqlite cache, so it stays stale all season. Needs a check of what Jolpica returns in January | T1.6 |
| B4 | Med | Confirmed | `pyproject.toml` | `requests`, `pandas`, `websockets`, `numpy`, `huggingface_hub` and `basef1` are imported directly but not declared. They arrive through `livef1`, `fastapi` and `onnx-asr[hub]` today; an upstream change removes them without warning | T1.3 |
| B5 | Med | Confirmed | `replay.py:90-111`, `replay.py:158-165` | `_lists` keeps a season's OpenF1 meetings and sessions for the life of the process. A schedule change or a corrected end date is never seen, and the LIVE button (`scheduled_session`) reads this list. The desktop app can run for days | T2.8 |
| B6 | Low | Suspected | `live.py:46-52`, `live.py:128-130` | `merge` calls `int(k)` on every key of a dict update to a list. One non-numeric key raises, `_run` catches it and reconnects every 5 s for as long as the feed sends it. Never seen against the real feed | T1.7 |
| B7 | Low | Confirmed | `teledrawer.js:52`, `scene3d.js` `graphicsTier`, `showroom.js` `nextRig`, `f1tv.py:1-6`, `index.html:71` | Dead wiring: `f1:drawer` is dispatched and nothing listens; two exports are referenced nowhere; `f1tv.py`'s docstring still says playback stays on F1 TV's site; the boot-failure message still blames `cdn.jsdelivr.net` though the libraries are now served locally | T4.4 |
| B8 | Low | Confirmed | `server.py:392`, `412`, `432` | The "Sprint Qualifying is Sprint Shootout in 2023" lookup is written three times. (`/api/telemetry` does not need it: the page sends OpenF1's own session name) | T4.4 |
| B9 | Low | Confirmed | `CLAUDE.md` (Agent skills), `AUDIT_AND_MASTER_PLAN.md` §7 | Docs name files that do not exist: `CONTEXT.md`, `docs/adr/`, `scripts/pin_three.mjs` | T4.5 |
| B10 | Low | Suspected | `explorer.js:4`, `server.py:113-119` | Raw data's "F1.com schedule" button calls a livef1 scrape. `CLAUDE.md` lists livef1's formula1.com scraping as a dead end, so the button may always fail. Not requested during this audit | T4.4 |
| B11 | Low | Carried | `replay.js` 989, `scene3d.js` 881, `multiviewer.js` 785, `cars3d.js` 708, `circuit3d.js` 701, `server.py` 641, `app.js` 567, `style.css` 1507 | Eight files are over the 500-line rule. Against the Nov 6 figures `replay.js` (812), `server.py` (597) and `app.js` (553) have grown; `multiviewer.js` (807) has shrunk | T2.11 |
| B12 | Low | Confirmed | `app.js:21`, `util.js:7` | `today` and the "this season" pattern are computed once per tab, in UTC. A tab left open past midnight keeps yesterday's "has it run" answers; past New Year it stops refreshing the new season | T4.9 |
| B13 | Low | Confirmed | `assets.py:56-58`, `95-96`, `106-109` | The asset downloader finds what to fetch by running regexes over the page's JavaScript (`hdri('…')`, `photo('…' … high ? … : …)`, `const ISO = {…}`). Renaming any of those changes the download set silently; only the photo regex has an assert | T4.3 |
| S1 | Med | Confirmed, decision | `server.py:641`, `desktop.py:87`, `server.py:565-566`, `582-583`, `live.py:166-167` | Both entry points listen on every interface. The origin checks only stop browsers: any LAN device can start the 600 MB download, spend the OpenF1 and Jolpica budgets, and read live GPS unlocked by another user's F1 TV token (the token itself is never returned). **Decided Nov 11: keep LAN access** (T1.8), so the exposure is accepted | T1.8 |
| S2 | Med | Confirmed | `assets.py:36-52`, `54-69`, `index.html:64-69` | three.js (two builds and the addons they import) is fetched from jsDelivr on first run and served as the app's own code with no hash check. The Nov 6 audit pinned these 17 files with SRI (S-M13); moving them to local files dropped it. shaka is still checked in the browser (`multiviewer.js:84`) | T4.2 |
| S3 | Low | Confirmed | `f1tv.py:142` | The licence proxy follows redirects. `requests` strips `Authorization` on a cross-host redirect but not the custom `ascendontoken` header, so a redirect off formula1.com would carry the user's subscription token | T1.4 |
| S4 | Low | Confirmed | `server.py:122-132` | `/api/jolpica/{year}/laps` with no `round` pages a whole season: about 240 requests of the ~500 an hour. No page asks for it, but nothing refuses it | T1.5 |
| S5 | Low | Confirmed | `server.py` (no header middleware), `app.js:414-423` | No Content-Security-Policy. The F1 TV token sits in `sessionStorage`, so any script injection would reach it. Exposure today is small because the page builds no HTML from data | T4.6 |
| B14 | Low | Confirmed; the stall is Suspected | `scene3d.js:540-541`, `vfx.js:18`, `31` | `disposeCars` disposes each car's heat-haze material, but every car shares one module-level `hazeMat`. Each grid rebuild (every race or session opened, and again when the RB22 model lands) throws its compiled shader away. `warmCockpit` skips it (`readsViewport`), so it is rebuilt synchronously the first time a camera comes within 60 m of a car | T2.12 |
| B15 | Low | Suspected | `scene3d.js:306-311`, `515-529` | A change of MSAA makes a new `createPost` with another sample count. The pipelines `warmCockpit` built were for the old pass and nothing builds them again, so the next switch to a close camera may bring back the ~2 s stall the warm-up exists to prevent | T2.12 |
| B16 | Low | Confirmed | `replay.js:248-256` | Live timing asks the feed once. If that answer has no `DriverList` yet, or the feed's first connection failed, the stage says "No live timing data yet." or "Live timing unavailable" and never asks again: no retry and no Retry button, unlike every other load failure | T1.10 |
| B17 | Low | Confirmed | `downloads.js:22-26` | While a download runs, the button polls `/api/assets` from a `setTimeout`. One failed poll (the server restarted, a dropped connection) rejects with nothing catching it: polling stops and the button stays disabled on "Downloading N%" until the page is reloaded | T1.11 |
| B18 | Low | Suspected | `scene3d.js:125`, `206` | A lost GPU device reloads the page, with no limit. A device that is lost again on every start (a driver crash loop) would reload for ever, and each reload drops the replay moment (F6). Never exercised (F9) | T4.10 |
| B19 | Low | Suspected | `scene3d.js:284-287`, `showroom.js:104-121`, `170-171`, `carsdeck.js:71`, `128` | With no GPU device, `ready` is null or still resolves (its `catch` returns), so opening Cars runs `create()` with `pmrem` undefined: `setRig` throws, `openShowroom` rejects unheard, and the panel shows an empty preview with no words. The race stage does say why in the same case | T4.10 |
| B20 | Low | Confirmed; how often it shows is Suspected | `scene3d.js:451`, `606`, `610-623`, `loadstage.js:26-29`, `replay.js:259`, `637` | `setTrack` terminates a ground worker that is still fetching, but only the worker's own handlers call `stageDone('ground')` and settle `setGround`'s promise. The "Satellite ground N%" row then stays in the loading box, which only hides once every stage has finished, and `setGround` never returns. The next `setGround` clears it; none comes when the next view is live timing or a race with no track map | T1.12 |
| S6 | Low | Confirmed | `server.py:565-566`, `582-583` (no `Host` check anywhere) | The two POST guards compare `Origin` with `Host`, and nothing checks `Host` itself. A page on a domain whose DNS answer is switched to 127.0.0.1 or the LAN address (DNS rebinding) is same-origin with the server: it passes both guards and can read every GET, including `/api/live` with token-unlocked GPS | T1.9 |
| S7 | Low | Confirmed | `desktop.py:70-72`, `85`, `96` | The desktop app uses whatever already answers on its port as the app, and gives that page `Api.f1tv_login`, which returns the subscription token | none: a program that can bind the port already runs as the user |

### 2.2 Performance and scalability

| ID | Sev | Status | Where | Finding | Task |
|---|---|---|---|---|---|
| P1 | High | Carried | `AUDIT_AND_MASTER_PLAN.md` §8 | 60 fps is not met while playing: 20-25 ms a frame in a replay on Ultra, 36 ms in a Simulation at 10x, on an RTX 4080. Quality tiers barely move it, so the cost is on the CPU side. The cause has not been found | T2.9 |
| P2 | Med | Confirmed | `replay.js:272-280`, `app.js:532`, `stream.js:295-300`, `radiopanel.js:55` | Nothing checks `document.hidden`. A hidden tab on live timing asks `/api/live` every second, which keeps F1's websocket open on the server for ever (`live.IDLE` is never reached). Stream's two timers run on every page once Stream has been opened, and one of them (`loadNext`, `stream.js:202-207`) asks `/api/f1tv/{year}/{round}` every 5 minutes, which is the server's cache lifetime for it, so each tick is an F1 TV search | T2.1 |
| P3 | Med | Confirmed | `live.py:176-179`, `server.py:283`, `468`, `489`, `502` | Each `/api/live` poll deep-copies the whole feed state under the lock, then serialises it. `_is_live`, `/api/live/track` and `/api/live/table` take the same full copy to read one or two topics. Cost unmeasured (no live session during the audit) | T2.2 |
| P4 | Med | Confirmed | `radio.py:46-52`, `142`, `231` | Each radio poll opens and parses one transcript file per clip, and stats each one again under the lock. A race has several hundred clips, and the panel polls every 8 s | T2.3 |
| P5 | Low | Confirmed, measured | `replay.py:216-217`, `358-364`, `server.py:41-43`, `ledgers.py:55-58` | A cached replay is parsed from disk and serialised again on every request: 75 ms + 51 ms for a 5.3 MB file. `_replay_grid` and `ledgers.overtakes` parse the whole file to read two and four fields | T2.4 |
| P6 | Low | Confirmed | `replay.py:53` | `openf1()` opens a new TLS connection per request; a GPS build makes about 30. Unmeasured | T2.5 |
| P7 | Low | Confirmed | `f1tv.py:18`, `38-39` | Past seasons' F1 TV catalogue is cached in memory only. Every restart searches all ~24 weekends again, against a service that blocks an IP after a few hundred searches | T2.6 |
| P8 | Low | Confirmed | `util.js:3-21` | `get()` keeps every response outside four URL prefixes for the life of the tab. Each race opened leaves its Jolpica lap table (~1,000 rows) in memory | T2.7 |
| P9 | Low | Suspected | `style.css:126`, `128`, `1086-1087` | Four `:has()` rules apply to the 3D stage; two have no subject before `:has(`, so they match against every element. `CLAUDE.md` records one `:has()` rule that restyled ~700 elements per frame. These four have not been measured | T2.10 |
| P10 | Low | Suspected | `replay.py:39-47`, all sync routes | `_throttle` sleeps while holding its lock, so each caller waiting on OpenF1 holds one of 40 pool threads, for up to a minute. Warm-up, Stream and a replay build together could delay `/api/live` polls. Not reproduced | T2.9 |
| P11 | Low | Confirmed by reading, cost unmeasured | `vfx.js:273-275`, `284-285`, `296`; `scene3d.js:756-880`; `radiopanel.js:98` | Garbage made every frame on hot paths: one array literal per live spark and per raindrop (up to 4,000 six-number arrays a frame in rain) and two `Vector3` clones of the camera; about six `Vector3`s per car plus `Object.entries(cars)`; and, while the radio panel is open, a key string built from every clip's text. Candidates for P1's unexplained CPU time, not proven causes | T2.9 |
| P12 | Low | Suspected | `scene3d.js:408-411` | Each sky change makes a `CubeRenderTarget`, keeps only its `.texture` as the background, and later disposes that texture, never the target. If three frees a target's depth attachment only through the target's own `dispose`, each change of sky leaves one behind on the GPU. Not confirmed in three's source | T2.13 |

### 2.3 Missing and incomplete features

| ID | Sev | Status | Where | Finding | Task |
|---|---|---|---|---|---|
| F1 | Med | Confirmed | `radio.py:55-67`, `219`, `radiopanel.js` | Opening the radio panel can start a 2.5 GB model download with no question and no download state: until it finishes, clips just read as pending (a failed download does surface, as a per-clip error). `TRANSCRIBE` is a module constant, though the payload already carries a `transcribe` flag the page reads | T3.1 |
| F2 | Med | Confirmed | `tracks.py:43-45`, `80-95` | Track outlines are never written to disk. Restart without network and a replay that is fully cached has no circuit to draw. Together with B2 this means the app cannot start offline at all | T3.2 |
| F3 | Med | Carried | AUDIT §5 "Not verified", `f1tv.py:120-129`, `multiviewer.js:566`, `desktop.py` | Live paths never exercised against a real session; see blocker 2 | T3.6 |
| F4 | Low | Carried | AUDIT §2 (F12) | Qualifying evolution and long-run pace: deferred, needs one new route | T3.3 |
| F5 | Low | Carried | AUDIT §2 (F10) | Live battle forecast and pit rejoin: deferred until a live weekend | T3.4 |
| F6 | Low | Carried | `app.js:426-449`, AUDIT §5 "Known limits" | Opening a shared link strips its moment from the address, so a reload loses it | T3.5 |
| F7 | Low | Carried | AUDIT §5 "Known limits" | Tyre compounds are not in the pace table, because asking for them can start a 30-request GPS build | T3.7 |
| F8 | Med | Confirmed | `tests/`, repo root | No CI and no single test command (26 commands in `CLAUDE.md`). 41 of 79 static modules are imported by no test; some of those are still exercised indirectly (`racecontrol.js` through `tests/test_sim.mjs`). On the backend, `assets.py`'s download list, `desktop.token_of` and `tracks.track()` with MultiViewer down are untested | T4.1, T4.7 |
| F9 | Low | Carried | AUDIT §8 "Not exercised" | The packaged exe, GPU device-loss recovery, weaker GPUs and real touch devices have not been checked since the WebGPU migration | T4.8 |
| F10 | Low | Confirmed | `server.py:550` | Usage counts live in `.cache/counts.json`, so clearing the cache deletes them. A recorded `shortcut:`; no task unless the counts start to matter | none |
| F11 | Low | Confirmed | `showroom.js:16-23`, `86-102` | The showroom's three lighting rigs declare two environments (`room`, `sunset`) but both bake the same outdoor sky: the pit garage and the wind tunnel reflect a sunset. A recorded `shortcut:`: three's `RoomEnvironment` bake compiled to an empty output struct on WebGPU, "cause not found". A later learning (Nov 7) traced the same error in the showroom's own draw to an MRT left on the renderer; `scene3d.js` clears it before both of its bakes (lines 274, 402) and the bake at `showroom.js:96` does not | T3.8 |
| F12 | Low | Confirmed | `app.js:250-254` | The header's next-session countdown reads only this year's calendar, so from the season's last race until New Year it shows nothing, though next season's calendar is usually published by then. A recorded `shortcut:` | T3.9 |
| F13 | Low | Confirmed | `tracks.py:110`, `ledgers.py:33`, `scripts/build_exe.py:19`, `index.html:10`, `whatif.js:6`, `replay.js:418` | Six of the 22 recorded `shortcut:` limits, each with its upgrade condition written beside it (the rest are in rows above or are recorded design choices; `grep -rn "shortcut:" src scripts` lists all 22): a GeoJSON outline has no start line or direction, so a lap replay on one may run the wrong way; the first overtake stands in for a missing start message; the exe transcribes on the CPU; no `og:image`; the what-if model has no tyre cliff; the start-light hold is a fixed 1 s | none: each waits for the condition its comment names |

---

## 3. Phased implementation roadmap

Phases run in order. Inside a phase, tasks are independent unless "Depends on" says otherwise. Every task ends with all suites green:

```bash
for f in tests/*.mjs; do node $f || break; done
```

```bash
.venv/Scripts/python tests/test_server.py
```

Browser checks use headed `agent-browser` with a window `error` listener added first, since its console does not show uncaught exceptions.

### Phase 1: stabilization and critical fixes

#### T1.1 Fall back to the lap-timing replay when OpenF1 fails (B1)
- **Target files:** `src/static/replay.js`
- **Actionable spec:** In `loadData` (line 382), race `gps.catch(() => null)` against the 1.5 s timer instead of `gps` itself. The next line then asks for `?laps=1` whenever GPS has not produced data and `standIn` is true, which now covers a fast failure. Keep `data ??= await gps`, so a session with no lap replay still shows the original error. The existing `gps.then(swapToGps, removeNote)` already handles a GPS request that failed. No server change: a failed fetch is dropped from `util.get`'s cache, so the next ▶ tries GPS again.
- **Complexity and risk:** Low. No breaking change. A lap replay may now appear where an error used to; the mode label already says which one is playing.
- **Verification:** Start the server with `replay.OPENF1` set to `http://127.0.0.1:9/` (a closed port, refused at once; an unroutable host would hang for the 120 s timeout and pass without the fix). Open a 2024 race with no file in `.cache/replay`. The lap replay plays, the label loses "GPS replay loading…" once the GPS request fails, and no error overlay shows. A 2024 Qualifying session still shows the failure with Retry.

#### T1.2 Use the last saved calendar when Jolpica is down (B2)
- **Target files:** `src/jolpica.py`, `tests/test_server.py`
- **Actionable spec:** Split `races()` into the cached fetch and a wrapper. The wrapper calls the cached fetch; on any exception it reads `.cache/jolpica/{year}_races_None.json` (the file `server.last_or_fetch` already writes, same row shape) and returns it as a tuple, held for 5 minutes so each request in an outage does not wait out a Jolpica timeout first; after that the next call tries Jolpica again. If the file is missing, re-raise. `jolpica.py` only reads the file; it does not import `save`, which would be a circular import.
- **Complexity and risk:** Low. A calendar served from the file can be up to one restart old, which the existing `shortcut:` comment already accepts.
- **Verification:** New asserts: with `jolpica_fetch` stubbed to raise and a temp file holding two races, `races(year)` returns them, a second call inside 5 minutes does not fetch, and one after it does; with no file it raises. By hand: block `api.jolpi.ca`, start the server, load `/`, and the latest race's track and cached replay open.

#### T1.3 Declare the packages the code imports (B4)
- **Target files:** `pyproject.toml`, `uv.lock`
- **Actionable spec:** Add `requests`, `pandas`, `websockets`, `numpy`, `huggingface-hub` and `basef1` to `dependencies`, each with a lower bound at the version now in `uv.lock` (2.34.2, 3.1.0, 17.3, 2.5.4, 2.4.0, 0.2.0). Run `uv lock`.
- **Complexity and risk:** Low. The lock file should change only in the project's own dependency list. If the resolver moves any package version, stop and report it.
- **Verification:** `uv sync --locked` succeeds. `git diff uv.lock` shows no version changes. Both test commands pass.

#### T1.4 Stop the licence proxy following redirects (S3)
- **Target files:** `src/f1tv.py`, `tests/test_server.py`
- **Actionable spec:** Pass `allow_redirects=False` to `requests.post` in `license()` (line 142). A 3xx answer goes back to shaka as it is and fails the licence request with its status.
- **Complexity and risk:** Low. Breaks playback only if F1's licence server really redirects, which cannot be checked outside a live session; note that in T3.6's checklist.
- **Verification:** New assert with `f1tv.requests.post` stubbed to capture its keyword arguments: `allow_redirects is False`.

#### T1.5 Refuse season-wide lap and pit-stop requests (S4)
- **Target files:** `src/server.py`, `tests/test_server.py`
- **Actionable spec:** In `jolpica()` (line 123), after the `kind` check: if `kind` is `laps` or `pitstops` and `round is None`, raise `HTTPException(400, "Pick a round: a season of lap times is over 200 Jolpica requests.")`. Every caller in the page passes a round (`app.js:44`, `49`, `ledgers.js:115`, `explorer.js` ROUND group).
- **Complexity and risk:** Low. Breaks only a hand-typed URL.
- **Verification:** `client.get("/api/jolpica/2024/laps").status_code == 400`, and `?round=1` still reaches the stubbed fetch.

#### T1.6 Do not cache an active driver's career as settled (B3)
- **Target files:** `src/jolpica.py`, `tests/test_server.py`
- **Actionable spec:** Reproduce first: check what `jolpica_fetch(year, "drivers")` returns for a season with no race run. If it can be empty, make `active` true when the driver is in this year's list or last year's.
- **Complexity and risk:** Low. One extra cached request per career dialog. Drivers who retired last season are refetched from the live client for one more year.
- **Verification:** New assert with `jolpica_fetch` stubbed: empty list for this year and the driver present last year gives a query on `jolpica_client`, not `SETTLED`.

#### T1.7 Ignore non-index keys in live list updates (B6)
- **Target files:** `src/live.py`, `tests/test_server.py`
- **Actionable spec:** In `merge`, in the list branch, skip keys where `k.isdigit()` is false.
- **Complexity and risk:** Low. Drops data only where the old code would have thrown.
- **Verification:** `merge([{"a": 1}], {"_kf": True, "0": {"a": 2}}) == [{"a": 2}]`.

#### T1.8 Keep LAN access in the desktop app (S1): decided
- **Decision (owner, Nov 11):** keep LAN access. `desktop.py` keeps binding `0.0.0.0`; `server.py` is unchanged. No code change for this item.
- **Follow-up:** document in `README.md` that the exe's server is reachable from the LAN at `http://<lan-ip>:8086`, and that the first run may raise a Windows firewall prompt. The LAN exposure in S1 (download start, OpenF1/Jolpica budget use) is accepted, so mitigations are T1.9 (refuse hostname requests) only.
- **Target files:** `README.md`
- **Verification:** `README.md` names the LAN address and the firewall prompt; `desktop.py` still binds `0.0.0.0`.

#### T1.9 Refuse requests addressed to a domain name (S6)
- **Target files:** `src/server.py`, `tests/test_server.py`
- **Actionable spec:** In the existing `revalidate_static` middleware (line 529), before `call_next`: take `request.url.hostname`; let the request through if it is `localhost`, ends in `.localhost`, or `ipaddress.ip_address()` accepts it; otherwise answer 400 "Open Lights Out by its address (http://127.0.0.1:8086), not a name." A rebinding attack needs a DNS name, never an IP literal, so LAN access by address keeps working. `tests/test_server.py:603` builds `TestClient(server.app)`, whose host is `testserver`: give it `base_url="http://127.0.0.1:8086"`, and change the two same-origin asserts that send `Origin: http://testserver` (lines 631, 634) to that address.
- **Complexity and risk:** Low. **Breaking:** the server reached by a machine name (`http://my-pc.local:8086`) or through a reverse proxy is refused. `README.md` and `CLAUDE.md` document the LAN address by IP only. Add an allow-list variable only when someone needs one.
- **Verification:** New asserts: `Host: evil.example:8086` gives 400 on `/api/counts` and on `POST /api/assets/download`; `Host: 192.168.1.5:8086`, `localhost:8086` and `[::1]:8086` reach the route. All existing asserts pass with the new `base_url`.

#### T1.10 Keep asking when live timing has nothing yet (B16)
- **Target files:** `src/static/replay.js`
- **Actionable spec:** In `showLive` (lines 248-256), wrap the first `fetchLive()` in a loop: while the answer has no `topics.DriverList` and `token === S.token`, show the same words with the spinner (`setOverlay(text, true)`), wait 5 s and ask again. A thrown fetch keeps its `showFailed(e, showLive)` Retry. Once `DriverList` arrives the function carries on as now. With T2.1 the loop also waits while the tab is hidden.
- **Complexity and risk:** Low. Each ask keeps F1's feed open on the server, which is what a user sitting on the live view wants; leaving the view changes `S.token` and ends the loop.
- **Verification:** By hand, since `replay.js` has no tests. The LIVE button is hidden outside a session (`app.js` `checkLive`), so click it from the console: `document.getElementById('livebtn').click()`. Block `livetiming.formula1.com`, start the server and click: the overlay says live timing is unavailable and keeps its spinner. Unblock it: the live view opens within about 10 s with no click. Opening a race meanwhile stops the requests (server log).

#### T1.11 Keep the download button polling through a failed poll (B17)
- **Target files:** `src/static/downloads.js`
- **Actionable spec:** In `refresh()` (line 22), catch a failed fetch or a non-JSON answer. If this page has seen a download run (`watched`), try again in 5 s; if not, return as now (no answer, no button).
- **Complexity and risk:** Low.
- **Verification:** By hand: start a download, stop the server for 10 s and start it again. The button leaves "Downloading N%" within 5 s of the server's return and reads "Download assets" (a restarted server has no download running, and files already fetched are skipped on the next press).

#### T1.12 Close the ground's loading row when its worker is cancelled (B20)
- **Target files:** `src/static/scene3d.js`
- **Actionable spec:** In `setGround` (line 610), keep the promise's `done` beside `groundWorker` in one module variable, as a function that terminates the worker, calls `stageDone('ground', 'cancelled')` and resolves the promise with `{}`. `setTrack` (line 451) and the top of `setGround` (line 606) call it in place of `groundWorker?.terminate()`, and the worker's own `onmessage` and `onerror` clear it. `setGround` already returns quietly on an answer with no image.
- **Complexity and risk:** Low. `stageDone` with a note marks the row finished, so the box hides 1.6 s later as for any other stage.
- **Verification:** Headed browser, cold tile cache (a circuit not opened before): open a race and, while "Satellite ground" still shows a percentage, click LIVE from the console as in T1.10. The loading box goes within 2 s. Open a race again: its ground loads as before.

### Phase 2: core architecture and performance

Tasks marked **measure first** start with a number. If the number shows no problem, close the task and record the number; do not build the fix.

#### T2.1 Stop polling from hidden tabs (P2)
- **Target files:** `src/static/replay.js`, `src/static/app.js`, `src/static/stream.js`
- **Actionable spec:** `replay.js` live poll loop (line 273): skip the fetch while `document.hidden`. `app.js` `checkLive`: return early while hidden. `stream.js` both intervals (lines 295, 300): return early while hidden or while `document.body.dataset.section !== 'stream'`. No new helper; it is one condition in four places. The server then closes F1's feed after `live.IDLE` (120 s) as designed.
- **Complexity and risk:** Low. The desktop app's preview pane reports hidden when the user hides it (recorded learning), which is the wanted behaviour. On return, live GPS has a gap of over `BUFFER` seconds; confirm `live.js` `gpsAt` falls back to mini-sector placement instead of interpolating across it.
- **Verification:** On live timing, hide the tab for 3 minutes: the server log shows no `/api/live` request after the first seconds, and `live._status["connected"]` is false. Show the tab: the tower updates within 2 s.

#### T2.2 Cut the cost of a live poll (P3), measure first
- **Target files:** `src/live.py`, `src/server.py`, `tests/test_server.py`
- **Actionable spec:** Measure `snapshot()` with `_state` filled to race size (20 cars, 6 s of `Position` and `CarData`). If it is over ~5 ms: give `snapshot()` an option that returns the JSON string built under the lock (no deep copy) for `/api/live`, and have `_is_live`, `live_track` and `live_table` read just their topics under the lock, as `live.status()` and `live.radio()` already do.
- **Complexity and risk:** Medium. Serialising under the lock holds the feed thread for the dump's duration; the measurement must show that is shorter than the copy it replaces. The `/api/live` payload must stay byte-compatible.
- **Verification:** Before and after timings recorded in the PR. Existing live asserts pass. `tests/test_live.mjs` passes against a payload captured from the new route.

#### T2.3 Keep radio transcripts in memory (P4)
- **Target files:** `src/radio.py`, `tests/test_server.py`
- **Actionable spec:** Add a module dict `url -> {text}`. `entry()` returns from it, else reads the file and stores a hit. The worker stores the result after `save`. `queue_clips` checks the dict before `_path(u).exists()`. Entries are a sentence each, so no eviction is needed.
- **Complexity and risk:** Low. Deleting `.cache/radio/parakeet` while the server runs no longer forces a re-transcription until restart; say so in the `CLAUDE.md` radio note.
- **Verification:** New assert: after one `radio()` call with a transcript on disk, a second call with `Path.read_text` patched to raise still returns the text. Existing radio asserts pass.

#### T2.4 Serve cached replays without re-encoding (P5), measure first
- **Target files:** `src/replay.py`, `src/server.py`, `src/ledgers.py`, `tests/test_server.py`
- **Actionable spec:** Measure one `/api/replay` request for a cached 5 MB race end to end, gzip included. If parse plus dump (126 ms measured in isolation) is over a fifth of it: when the session's cache file exists, `race_replay` returns its bytes with `media_type="application/json"`. Separately, keep each replay's `start` and `duration` in a small dict when it is built or first loaded, and have `_replay_grid` read that instead of parsing the file.
- **Complexity and risk:** Medium. `replay()` is also called by `warm_up` and wrapped by tests, so the byte path must be a branch in the route, not a change to `replay()`'s return type. Files on disk use default JSON separators, about 8 % larger before gzip.
- **Verification:** The served body parses to the same object as before for one cached session. Timings recorded. `/api/telemetry` for an uncached driver no longer reads the replay file (assert with `read_text` patched).

#### T2.5 Reuse one HTTP connection to OpenF1 (P6), measure first
- **Target files:** `src/replay.py`, `tests/test_server.py`
- **Actionable spec:** Time a cold GPS build. Then make `openf1()` use one module-level `requests.Session` and time it again; keep the change if it saves over ~5 % of the build. `tests/test_server.py:480` stubs `rp.requests.get` and must stub the session's `get` instead.
- **Complexity and risk:** Low. Three worker threads share the session; urllib3's pool is thread-safe for plain GETs.
- **Verification:** Both timings in the PR. All replay asserts pass.

#### T2.6 Keep past seasons' F1 TV catalogue on disk (P7)
- **Target files:** `src/f1tv.py`, `tests/test_server.py`, `CLAUDE.md`
- **Actionable spec:** In `videos()`, for `year < date.today().year` and a non-empty result, write the list to `.cache/f1tv/{year}_{name}.json` with `replay.save`, where `name` is the whole race name reduced to `[a-z0-9]` (not `_stem`: its six characters would give the United States and United States West one file), and read that file before searching. This season keeps its 5-minute memory cache.
- **Complexity and risk:** Low. A past season's catalogue that F1 TV later extends is not seen until the file is deleted; add that to `CLAUDE.md`'s cache notes.
- **Verification:** New assert with `requests.get` stubbed: two `videos(2020, …)` calls with `_cache` cleared between them make one search. By hand: restart the server, open Stream on 2024, and the log shows no F1 TV searches.

#### T2.7 Cap the page's fetch cache (P8)
- **Target files:** `src/static/util.js`, `tests/test_util.mjs`
- **Actionable spec:** After inserting in `get()`, if the map holds more than 200 entries, delete the oldest key (a `Map` iterates in insertion order). The per-prefix `KEEP` rule stays.
- **Complexity and risk:** Low. A view reopened after 200 other requests fetches again.
- **Verification:** New test: 201 distinct URLs through a stubbed `fetch` leave 200 entries, and the first URL is fetched again when asked.

#### T2.8 Refresh this season's session list (B5)
- **Target files:** `src/replay.py`, `tests/test_server.py`
- **Actionable spec:** Store `(fetched at, rows)` in `_lists`. For the current year, fetch again when the entry is over 6 hours old; on `OpenF1Locked` or an empty answer keep the old rows. Past years stay for the process lifetime.
- **Complexity and risk:** Low. Two extra OpenF1 requests every 6 hours.
- **Verification:** New assert with `openf1` stubbed and the stored time moved back 7 hours: `_sessions(this_year)` returns the new rows; with the stub raising `OpenF1Locked` it returns the old ones.

#### T2.9 Find what a playing frame costs (P1, P10, P11), measure first
- **Target files:** none until measured; results appended to `AUDIT_AND_MASTER_PLAN.md`
- **Actionable spec:** In a headed browser on a GPS replay at 1x and 10x and a Simulation at 10x, time with temporary `performance.now()` probes (`PerformanceObserver` returns nothing in the pane, per a recorded learning): `replay.js` `render` split into `gpsState`/`lapsState`, `updateCars`, tower, HUD; then the renderer's own frame, split in `scene3d.js` `frame` into `vfx.update`, `scene.updateMatrixWorld`, `renderMirrors`, `post.render` and `labels.render`. Run the Simulation once dry and once in rain (the pit wall's monsoon call): P11's raindrop arrays only exist in rain. If `vfx.update` or `updateCars` shows over 1 ms, the fix is to write into the typed arrays by index and reuse module-level vectors, as `mirror.js` `render` already does. Record the top three costs per mode. Separately, for P10, start the server cold, open Stream and ▶ a race not on disk, and log `/api/live/status` latency. Each cost found becomes its own task with its own number.
- **Complexity and risk:** Low to measure. The fixes are unknown, so they are not estimated here.
- **Verification:** A table of per-part milliseconds for each mode, taken without DevTools attached, in the audit document.

#### T2.10 Measure the stage's `:has()` rules (P9), measure first
- **Target files:** `src/static/style.css`
- **Actionable spec:** With a replay playing, record style-recalculation time per frame; then again with lines 126, 128 and 1086-1087 disabled. If the difference is over 0.5 ms a frame, replace each with a class the script already knows how to set (`.stage-ready` exists; the tower knows when it has rows), and give 1086-1087 an explicit subject.
- **Complexity and risk:** Low. Visual regressions in the empty-tower and loading states.
- **Verification:** Both numbers in the PR. Screenshots of the stage with no race, loading, and playing match before and after.

#### T2.11 Split the files over 500 lines (B11)
- **Target files:** `src/static/replay.js` first; new `src/static/replaylive.js`
- **Actionable spec:** **Optional; no user-visible gain.** Do it only if the 500-line rule is to be enforced. Start with the one clean seam: live timing in `replay.js` (`showLive`, `applyLive`, `msFrac`, `liveRender`, lines 243-314) moves to a new module that receives `S`, `ui` and the helpers it calls. Leave the 3D files alone: their state is shared too widely to cut without a design.
- **Complexity and risk:** High for its size. `replay.js` has no tests and its functions share module state, so the diff is behaviour-neutral only by inspection.
- **Verification:** All suites pass. Headed pass: a GPS replay, a lap replay, a Simulation and live timing (or its "No live timing data yet" state) open with no page errors.

#### T2.12 Keep compiled shaders across grid rebuilds and MSAA changes (B14, B15), measure first
- **Depends on:** T2.9's probes
- **Target files:** `src/static/scene3d.js`
- **Actionable spec:** Two changes, each kept only if its number moves. (1) Delete `c.haze.material?.dispose();` in `disposeCars` (line 541): the material is `vfx.js`'s one shared `hazeMat` and lives as long as the page; the per-car geometry on the line above is still disposed. (2) In `setGraphics`, after the MSAA branch makes a new `createPost` (lines 306-311), call `warmCockpit(carsToken)` so the close cameras' pipelines are built for the new pass. Measure first: the time of the first frame with a car inside 60 m after switching race (1), and the first frame after switching to the cockpit after an MSAA change (2).
- **Complexity and risk:** Low. One material is never freed, by design. `warmCockpit` already drops out when the grid changes under it.
- **Verification:** Both first-frame times before and after, in the PR. No WebGPU validation error in the console (window `error` listener added first) across two race switches and one MSAA toggle.

#### T2.13 Free the old sky's render target (P12), confirm first
- **Target files:** `src/static/scene3d.js`
- **Actionable spec:** First read `CubeRenderTarget` and the WebGPU backend's texture disposal in `src/static/assets/three/build/three.webgpu.js`: does disposing a target's `.texture` also free its depth attachment and render-context data? If it does, close the task and record that. If not, in `loadSky` (lines 408-411) keep the `CubeRenderTarget` in a module variable and call `dispose()` on the previous one where `oldBack.dispose()` is called now.
- **Complexity and risk:** Low.
- **Verification:** Press L (next sky) 20 times with a pause for each to land. `renderer.info.memory.textures` (read through `agent-browser eval` on a temporary global) is the same after the 20th as after the 2nd.

### Phase 3: missing features and completeness

#### T3.1 Ask before downloading the speech model, and show it (F1)
- **Target files:** `src/radio.py`, `src/server.py`, `src/static/radiopanel.js`, `tests/test_server.py`
- **Actionable spec:** **Needs the owner's decision:** transcripts starting on their own is the recorded choice (`radio.py:217`). If agreed: `radio()` adds `model: "ready" | "missing" | "downloading" | "failed"` to its payload (`MODEL_DIR` has the encoder file, or `_load` is running, or it raised). While `missing`, `queue_clips` is not called. The panel shows "Transcripts need a 2.5 GB download" with a button that posts to a new same-origin `POST /api/f1tv/radio/model` (the same origin check as `/api/assets/download`), which starts `_load` on the worker thread. Clips stay playable without words meanwhile. No percentage: `snapshot_download` gives none without a custom progress class.
- **Complexity and risk:** Medium. **Behaviour change:** transcripts no longer start on their own on a fresh install; installs that already have `.cache/parakeet` see no difference.
- **Verification:** With `MODEL_DIR` pointed at an empty temp folder: the payload says `missing`, no worker job is queued, and the POST from another origin is 403. In the browser: the panel shows the prompt, clips play, and after the download the words appear.

#### T3.2 Keep track outlines on disk (F2)
- **Depends on:** T1.2
- **Target files:** `src/tracks.py`, `tests/test_server.py`
- **Actionable spec:** In `_mv_track`, `_mv_years` and `_geojson`, write each successful answer to `.cache/tracks/` with `replay.save` and read it when the request raises `requests.RequestException`. The `lru_cache` layer stays in front.
- **Complexity and risk:** Low. `tracks.py` gains an import from `replay.py`; check there is no cycle (`replay.py` does not import `tracks`).
- **Verification:** New assert with `tracks._get` stubbed to raise after one good call and the `lru_cache`s cleared: `mv_track` still returns the outline. By hand: with the network off, start the server and open the latest cached race; the circuit draws and the replay plays.

#### T3.3 Qualifying evolution and long runs (F4, was F12)
- **Target files:** new `src/static/quali.js`, new `tests/test_quali.mjs`, `src/static/charts.js`, `src/static/analytics.css`
- **Actionable spec:** A pure module over the laps array of a qualifying or practice GPS replay (`/api/replay/{y}/{r}?session=…`, already cached once built, so no new route is needed if the view is offered only when that replay is on disk or loaded). Qualifying: each driver's best lap per segment against the session's running best. Practice: stints of 5 or more consecutive timed laps within 3 % of the stint median, with their mean and slope. Draw in the Results tab's section list, opened on demand like the ledgers.
- **Complexity and risk:** Medium. Opening it for a session that is not cached costs a 30-request GPS build, so the section must say so and ask before it starts, as the pace table's known limit already notes.
- **Verification:** `tests/test_quali.mjs` with a hand-made laps array: segment bests and one long run detected, an out-lap excluded. Browser check on a cached qualifying session against the official segment times.

#### T3.4 Live battle forecast and pit rejoin (F5, was F10)
- **Depends on:** T3.6 run on a live weekend
- **Target files:** `src/static/live.js`, `src/static/tower.js`, `tests/test_live.mjs`
- **Actionable spec:** Not specified further on purpose. The Nov 5 audit deferred this because the live feed's interval format cannot be read from code, and that has not changed. First step on a live weekend: save one `/api/live` payload per minute for a race, then write the spec from the saved data.
- **Complexity and risk:** High. Unknown feed format.
- **Verification:** Saved payloads replayed through `tests/test_live.mjs`.

#### T3.5 Keep a shared link's moment across a reload (F6)
- **Target files:** `src/static/app.js`, `src/static/share.js`, `tests/test_share.mjs`
- **Actionable spec:** In `route()`, after `openMoment(link)`, keep the link's `t`, `focus`, `session` and `cmp` in the address until the user plays, seeks or changes race; then `syncHash` drops them as now. `address()` gets the pending params from one module variable.
- **Complexity and risk:** Medium. `syncHash`, Back and Forward are easy to break; the Nov 6 work on history (`amend`, `A.routing`) must still give one Back step per change.
- **Verification:** `tests/test_share.mjs`: a round trip of a hash with a moment. Browser: open a link with `?t=`, reload, land on the same moment; press ▶ and the params leave; Back returns to the previous view in one step.

#### T3.6 Live-weekend verification pass (F3)
- **Target files:** `AUDIT_AND_MASTER_PLAN.md` (results); fixes become their own tasks
- **Actionable spec:** During one live session, with an F1 TV account, check and record: live Widevine playback in Chrome and in the exe's WebView2; the licence proxy's status codes, including whether F1 answers with a redirect (T1.4); which `streamType` a 4K request returns, then delete or keep the `HDR_UHD_DASHWV` guess (`f1tv.py:120-129`); live radio clips arriving in the panel; `/api/replay` answering 409 and the page switching to live timing; the tower against F1's own timing for one lap. Save one `/api/live` payload for T3.4.
- **Complexity and risk:** Low to run, but only possible on a race weekend.
- **Verification:** A dated checklist with a pass, fail or "not offered by F1 TV" for each line.

#### T3.7 Tyre compounds in the pace table (F7)
- **Target files:** `src/ledgers.py`, `src/server.py`, `src/static/strategylab.js`, `tests/test_server.py`
- **Actionable spec:** A `/api/stints/{year}/{round}` route through the existing `_openf1_ledger` and `ledgers._feed(session, "stints")`: one OpenF1 request, cached on disk, no GPS build. The pace table asks for it when its section opens and adds a compound column; without it (pre-2023, OpenF1 locked) the column is left out.
- **Complexity and risk:** Low. Follows the pit-stop ledger's pattern exactly.
- **Verification:** Route asserts copied from the stationary ledger's (2022 gives 404, stubbed feed gives rows). Browser: a 2024 race's pace table shows compounds that match the tower's.

#### T3.8 Give the showroom's indoor rigs an indoor environment (F11)
- **Target files:** `src/static/showroom.js`
- **Actionable spec:** Two steps, stopping at the first that works. (1) In `environment()` (line 86), clear the renderer's target and MRT before the bake, as `scene3d.js` `clearWarmTarget` does before its own two (`const {renderer} = shared(); renderer.setRenderTarget(null); renderer.setMRT(null);`), then for `kind === 'room'` bake three's `RoomEnvironment` (`three/addons/environments/RoomEnvironment.js`, which `assets.py` `_three` fetches once it is imported) and keep the sky for `'sunset'`. This tests the likely cause: a warm-up's leaked MRT matching no texture of the bake's target. (2) If that still compiles to an empty output struct, bake a studio of our own instead: a dark box seen from inside with bright ceiling panels, all `MeshBasicMaterial` (unlit, so no light nodes). If both fail, close the task and leave the `shortcut:` comment, with what was tried added to it.
- **Complexity and risk:** Medium. The cause is inferred from a learning about a neighbouring draw, not shown for this bake. Changes how every car looks under two of the three rigs.
- **Verification:** Headed browser with a window `error` listener: open Cars and step through the three rigs on a 1955, a 2004 and a 2026 car. The garage and tunnel rigs show panel reflections, not a horizon; no WebGPU validation error; the race stage's sky is unchanged afterwards.

#### T3.9 Count down to next season's first session (F12)
- **Target files:** `src/static/app.js`, `tests/test_multiviewer.mjs`
- **Actionable spec:** In `nextSession` (line 250), when `upcoming(races)` is empty, fetch `/api/jolpica/${year + 1}/races` once (`check_season` allows next year, and `server.py` serves it from `last_or_fetch`) and tick on that list. An empty answer leaves the button hidden, as now. Remove the `shortcut:` comment on line 253.
- **Complexity and risk:** Low. One more Jolpica request per tab, only once the season is over. The click opens Stream on the header's season, which has no Coming up row for next year: point it at Stream with next year's season instead.
- **Verification:** New assert on `stream.js` `upcoming` (add it to the `stream.js` import on line 3 of `tests/test_multiviewer.mjs`; no suite imports it today): a list whose only future session is in next year's rows returns it. By hand in December, or with the system clock moved past the last race: the header shows next season's first session.

### Phase 4: polish, testing and hardening

#### T4.1 One test command and CI (F8)
- **Target files:** new `scripts/test_all.py`, new `.github/workflows/test.yml`, `CLAUDE.md`
- **Actionable spec:** `scripts/test_all.py` runs each `tests/*.mjs` with `node` and then `tests/test_server.py`, prints one line per file, and exits non-zero on the first failure. The workflow runs it on push and pull request on `windows-latest` (the paths and `save()`'s replace retry are Windows behaviour) with Python 3.14, `uv sync --locked` and Node 22. `tests/test_server.py` calls `client.get("/")`, which runs `assets.core()` and downloads three.js on a clean runner; stub `server.assets.core` in that test so CI needs no network.
- **Complexity and risk:** Low. The stub must not hide the 503 path, which has its own assert to add.
- **Verification:** `python scripts/test_all.py` passes locally in under 30 s. The workflow is green on a pull request, and a deliberately broken assert turns it red.

#### T4.2 Check three.js against known hashes (S2)
- **Target files:** `src/assets.py`, new `src/static/asset_hashes.json`, `tests/test_server.py`
- **Actionable spec:** A committed JSON map of `relative path -> sha256` for every file `_three()` fetches. `fetch()` takes an optional expected hash, checks the temp file before `os.replace`, and raises on a mismatch. A missing entry for a three.js path is an error, so a version bump forces the file to be regenerated (document the one-line command that writes it from a trusted download). shaka keeps its browser-side `integrity` attribute. Fonts, flags, textures and tiles are data, not code, and stay unchecked. The alternative is the Nov 6 design, an `integrity` block in the import map; it is enforced on every load but needs a script to regenerate it.
- **Complexity and risk:** Medium. A wrong hash file makes the first start fail with 503; the boot-failure text (T4.4) must say so.
- **Verification:** New asserts: `fetch` with a matching hash writes the file; with a wrong one it raises and leaves nothing behind. By hand: delete `src/static/assets/three`, load `/`, and the page starts.

#### T4.3 Fail loudly when the asset scrape finds nothing (B13)
- **Target files:** `src/assets.py`, `tests/test_server.py`
- **Actionable spec:** Assert a non-empty result for the `hdri(` and `ISO` regexes, as the `photo(` one already does. Add a test that runs `_heavy()` against the real static files with `tile_list.json` stubbed to one tile and checks at least one sky, one texture set and the tile are listed.
- **Complexity and risk:** Low.
- **Verification:** The new test passes; renaming `hdri(` in a scratch copy of `scene3d.js` makes it fail.

#### T4.4 Remove dead wiring and stale text (B7, B8, B10)
- **Target files:** `src/static/teledrawer.js`, `src/static/scene3d.js`, `src/static/showroom.js`, `src/static/index.html`, `src/f1tv.py`, `src/server.py`, `src/static/explorer.js`
- **Actionable spec:** Before deleting each export, `trail callers` it and grep for its name. Delete the `f1:drawer` dispatch, `graphicsTier` and `nextRig` if still unreferenced. Reword `index.html:71` to name the server's first-start download instead of jsDelivr. Rewrite `f1tv.py`'s module docstring to match what the module does. Put the Sprint Shootout lookup in one function in `server.py` and call it from the three routes. For B10: request `/api/season/{year}/f1schedule` once; if it fails, remove the button and the route.
- **Complexity and risk:** Low.
- **Verification:** All suites pass. The unused-export sweep reports no name that is referenced nowhere. The existing route asserts for events, F1 TV telemetry and radio still pass.

#### T4.5 Make the docs match the repo (B9)
- **Target files:** `CLAUDE.md`, `AUDIT_AND_MASTER_PLAN.md`
- **Actionable spec:** In `CLAUDE.md`'s Agent skills section, either create the `CONTEXT.md` it names or drop the sentence; the choice is the owner's. In the audit's §7, add one line saying `pin_three.mjs` and the SRI block were replaced by `assets.py` (and by T4.2 once done). Update `CLAUDE.md` for every task above that changes a cache, a route or a default.
- **Complexity and risk:** Low.
- **Verification:** Every path `CLAUDE.md` names exists (`grep -o` the backticked paths and `ls` them).

#### T4.6 Add a Content-Security-Policy (S5)
- **Depends on:** T4.2 (libraries local and pinned)
- **Target files:** `src/server.py`, `src/static/index.html`, `src/static/launcher.html`, new `src/static/boot.js`, `tests/test_server.py`
- **Actionable spec:** Move `index.html`'s inline boot-timer script and its inline `onclick`, `onerror` and `onload` handlers into `boot.js`. Then send, on `/` and `/static/*.html`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https:; worker-src 'self' blob:; frame-ancestors 'none'`. Start with `Content-Security-Policy-Report-Only`, read the console through every view, then enforce.
- **Complexity and risk:** High. shaka (MSE blobs, licence requests), WebGPU, the glass filters' data-URL maps, Wikipedia portraits, Esri and F1 TV images, the bookmarklet and pywebview's injected `window.pywebview` each need an exception found by testing. An import map must stay inline, which needs a hash in `script-src`.
- **Verification:** With the policy enforced, a headed pass through a replay, a Simulation, Stream, the viewer (signed in), Drivers and the launcher shows no CSP violation in the console. An assert checks the header is present on `/`.

#### T4.7 Tests for the untested pure logic (F8)
- **Target files:** `tests/test_server.py`
- **Actionable spec:** `tracks.track()` is tested for its OpenF1 and MultiViewer sources but not for MultiViewer raising: with `tracks._get` stubbed to raise `requests.RequestException`, assert it falls to the lap, and with no lap to `_geo_track`. Add `desktop.token_of` (a good cookie, a malformed one, an empty token), importing it without starting a window. DOM modules stay untested: the repo has no DOM harness and adding one is not justified by this list.
- **Complexity and risk:** Low.
- **Verification:** The new asserts pass, and each fails when its target's logic is inverted by hand. If importing `desktop` needs a display, leave `token_of` out and say so.

#### T4.8 Release checks (F9, blockers 1 and 3)
- **Target files:** `scripts/build_exe.py`, `README.md`; results in `AUDIT_AND_MASTER_PLAN.md`
- **Actionable spec:** Build the exe and run it on a machine with no Python: launcher, app window, a replay, a Simulation, F1 TV sign-in, a replay stream, quit. Run the browser app on an integrated GPU and on a phone. Read Esri's World Imagery terms on redistributing tiles offline; if they do not allow it, the owner decides: bundling the tiles was their choice on Nov 7, and the fallback is for `build_exe.py` to leave `assets/tiles` out so the exe streams tiles as a fresh clone does. Search "Lights Out" in the relevant trademark registers before any public release.
- **Complexity and risk:** Low to run. Leaving tiles out makes the exe ~200 MB smaller and need a connection for satellite ground.
- **Verification:** A dated checklist. If tiles are excluded, `dist/LightsOut` contains no `tiles` folder and the ground still loads online.

#### T4.9 Read the date when it is needed (B12)
- **Target files:** `src/static/app.js`, `src/static/util.js`, `tests/test_util.mjs`
- **Actionable spec:** Make `today` in `app.js` and `FRESH` in `util.js` functions that read the clock when called.
- **Complexity and risk:** Low.
- **Verification:** `tests/test_util.mjs` with the clock stubbed across a year boundary: a `/api/jolpica/{new year}/races` response older than 5 minutes is fetched again.

#### T4.10 Say so when the 3D view cannot start or keeps failing (B18, B19)
- **Depends on:** T4.8's device-loss check, which shows whether B18 is real
- **Target files:** `src/static/scene3d.js`, `src/static/showroom.js`
- **Actionable spec:** (1) `scene3d.js` line 206: before `location.reload()`, read a `sessionStorage` entry holding the last two reload times; if both are under 60 s old, do not reload: append the existing `.empty` paragraph with "The graphics device keeps failing. Reload the page to try again." and stop the animation loop. Otherwise store the time and reload. (2) `showroom.js` `openShowroom`: if `shared().pmrem` is missing after `await ready`, put the same "3D view needs WebGPU or WebGL2" words in `host` and return without calling `create`; `showCar` returns at once while `S` is null (line 240 reads `S.token` today).
- **Complexity and risk:** Low. `sessionStorage` blocked: wrap in `try`, and fall back to today's unconditional reload.
- **Verification:** Device loss: open `chrome://gpucrash` in another tab while a replay is paused; the page reloads once and the stage returns. Do it three times inside a minute; the third leaves the message, not a reload. No GPU: start Chrome with `--disable-gpu --disable-software-rasterizer`, open Cars: the panel says why instead of showing an empty box, and the console has no uncaught error.

---

## 4. Suggested order and effort

| Phase | Tasks | Rough size | Gate before the next phase |
|---|---|---|---|
| 1 | T1.1 to T1.12 | Twelve small changes, each under 20 lines plus its assert where the file has tests | Suites green; T1.8 decided |
| 2 | T2.1 to T2.10, T2.12 after T2.9, T2.13, then T2.11 if wanted | Five small changes, six measurements, one source check | Each measured task has its number recorded |
| 3 | T3.1, T3.2, T3.5, T3.7, T3.9 any time; T3.3 and T3.8 next; T3.6 then T3.4 on a live weekend | Three medium features, three small, one checklist | T3.6's checklist filled in |
| 4 | T4.1 first (it guards everything after), then the rest; T4.10 after T4.8 | One runner, one workflow, four hardening changes, two checklists | CI green on `master` |

T4.1 is cheap and protects every other task. If only one thing is done out of order, do that one first.

---

## 5. Checked and found sound

Read or run in the second pass, with nothing to fix. Listed so the next audit can skip them.

| Area | What was checked | Result |
|---|---|---|
| Simulation stability | On the test suite's flat stadium, dry, AI drivers only, no elevation data or real pit lane: 3-lap races of 20 cars with 1955, 1983, 2004, 2016 and 2026 cars at steps of 1/60 s, 0.5 s and 2 s (the cap `replay.js:622` allows); a 2-lap race of 34 cars; a 1-lap race with every outline point doubled | Every race finished with every car classified, no non-finite value in position, speed, revs, tyre or battery state, no car over 30 m off the centre line at the finish |
| Simulation, short runs | 10 s on a 120 m square track (mostly under the start lights); one step each of -1 s and NaN followed by a normal one | No non-finite value. Too short to say more |
| Simulation with nothing to run on | An empty grid and an empty outline both throw inside `sim.js` and `track.js` | Unreachable from the page: `simmode.js:40-42` refuses both first, in plain words |
| Replay with no track map | `drawTrack` with no outline calls `setTrack([])`, which leaves the 3D circuit null | `prepare` (`replay.js:703-706`) draws a stand-in oval before `setCars`, so `updateCars` never meets a null circuit |
| 3D memory on a circuit or grid switch | The dispose paths were read: `circuit3d.js` `dispose`, `trackside.js` `dispose`, `cars3d.js` and `rb22.js` per-car `dispose`, `mirror.js` `disposeMirror`, the `stale` circuit, the satellite bitmap's `close`, `post.js` rebuild targets. Whether every object the builders make reaches those lists was not traced | Each path frees its own list and keeps what is shared; the slips found are B14, B20 and, if confirmed, P12 |
| Page elements | Every `id` in `index.html` against the scripts and styles | Every one is used (the seven `tabbtn-*` through `aria-labelledby`) |
| Server memory | `replay._recent` (several MB an entry) | Pruned on every insert (`replay.py:276-278`) |
| Usage counts | `server.EVENTS` against every `count()` call, the two dynamic ones included | All 19 events are sent; none is sent that the server refuses |
| Browser storage | Every `localStorage` and `sessionStorage` key written against keys read | Each of the 13 keys (11 local, 2 session) is both written and read |
| Graphics settings | Every option in `graphics.js` `DEFAULTS` against `scene3d.js`, `post.js`, `circuit3d.js` `show` and `settings.js` | Each is applied somewhere |
| Routes | The 32 routes against the page's requests, both ways | Every route has a caller and every request has a route; the one doubtful route is B10 |
| Radio clip proxy | `radio.clip_url` | Host, scheme, path, double encoding and traversal are all checked before the token is sent |
| Issue tracker | `gh issue list` on `adityavar95/lights-out`; `docs/ux-audit.md` | No open issues; the audit's one open item is the trademark check (blocker 3) |
