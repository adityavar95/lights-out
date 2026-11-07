# Lights Out: audit and master plan

Written 2026-11-05. Baseline: 13 of 13 test suites pass on the working tree before any change. The tree already held about 20 uncommitted files; a patch and tar of that state sit in the session scratchpad.

How the findings were made: four read-only audits (systems, logic, UI/UX, domain research). A finding is a claim until reproduced. One high-severity claim has already been refuted (see "Refuted"), so implementers check each finding against the code before fixing it, and record any that don't hold.

IDs: `S` systems, `L` logic, `U` UI/UX, `F` feature. Where two audits found the same defect, the entry names both.

## 1. Executive teardown

### Critical

| ID | Where | Defect | What the user gets |
|---|---|---|---|
| U1 | `app.js:357`, `app.js:227` | A failed start-up fetch has no handler or goes into the closed calendar popover | A blank app with a working-looking ▶ and no message |

### High

| ID | Where | Defect | What the user gets |
|---|---|---|---|
| S-H1 / L-M14 | `replay.py:57` | Save temp name is per process, so threads saving one path collide | Intermittent 502 on `/api/season` at cold start; a skipped warm-up |
| S-H2 | `radio.py:164`, `multiviewer.js:500` | Every radio poll is an uncached OpenF1 request | Multiview uses up the budget; GPS replays silently downgrade |
| S-H3 / L-M2 | `multiviewer.js:299-316` | No recheck of the dialog after awaiting channels | Esc during load: audio with the viewer closed, a ghost tile on reopening |
| S-H4 / L-M13 | `app.js:221-225` | `loadSeason` has no stale check | Calendar shows one year while the app is on another |
| S-H5 / L-M1 | `replay.js:332` | ▶ while loading starts a second load | Double-click leaves a paused replay at 0; Simulate builds two races |
| L-H2 | `replay.js:48,410-445` | Changing session keeps `S.tele` and `S.lapsBy` | Race telemetry shown during Qualifying under an "OPENF1" label; blank LAST LAP |
| L-H3 | `multiviewer.js:450-454` | Switching the selected tile's stream restarts it | Picking an onboard jumps back to the session start |
| U2, U3 | `app.js:48,139,282,306` | No history, no hash handling, Simulate shares the replay's URL, stored mode beats shared links | Back leaves the app; links open the wrong thing |
| U4 | `circuitdeck.js`, `carsdeck.js`, `tracemodal.js` | Big panels don't take focus | Esc does nothing after a click; Tab walks behind the panel |
| U5, U6 | `replay.js:51-57`, `tower.js:15` | Shortcuts bail on button focus, ignore modifiers; Space does two things on a tower row | Click ▶, → does nothing; Ctrl+C changes the camera |
| U7, U8, U9 | `style.css`, `app.js:326` | Phone layout: 130 px sticky bar, 17 px sideways overflow, picker off-screen | The replay fills a third of the screen and is clipped |
| U10 / L-M11 | `replay.js:153`, `charts.js:81,147`, `strategylab.js:11` | Unrun races offer ▶, then blame "from 1996" | Misleading error; empty Standings mid-season |
| U11 | `replay.js:300`, `app.js:118,273`, `stream.js:150,168` | Errors say "Failed to fetch" with no Retry | Dead ends; Stream shows 19 identical red rows |
| U12 | `app.js:112,260`, `index.html:41` | CLS 0.76 desktop, 0.45 phone | Page jumps during load |
| U13, U14, U15 | `style.css:722`, `app.js:157`, `tower.js:14` | Invisible focus stops, no shortcut help or palette, unnamed tower rows | Keyboard and screen-reader users are lost |
| U16, U17 | `style.css:47,67,650` | HUD text and red text below AA | Illegible labels on bright ground; errors look like CTAs |

### Medium

Backend: S-M1 / L-M16 radio errors stored for ever, shown as "transcribing…"; S-M2 no process-wide OpenF1 limiter, one failure discards a whole build; S-M3 unfinished sessions rebuilt per request; S-M4 a client-supplied telemetry window can truncate the cache for everyone; S-M5 empty answers overwrite good fallbacks; S-M6 stale live state served after reconnect; S-M7 the 60 s poll keeps the F1 websocket open between weekends; S-M8 `_is_live` ignores `SessionStatus` and opens the feed; S-M12 `%2e%2e` passes the radio audio path check and the token goes to any path on the host; L-M15 elevation answer depends on cache state.

Frontend: S-M9 current-season responses never refresh in a tab; S-M10 / L-M4 Stream billboard stuck on "Loading F1 TV…"; S-M11 ground workers survive circuit changes (up to ~256 MB each); S-M13 third-party code with no integrity check, and a jsDelivr outage blanks the whole page; L-M3 pit predictor shows "+-9.0s"; L-M5 / S-L18 Strategy lab TypeError on very short races; L-M6 shared drives make two cars with one id; L-M7 shared drives inflate starts and DNFs; L-M8 "+-1.000" gap; L-M9 today's race treated as run before it starts; L-M10 session picker defaults to a Race that hasn't run; L-M12 Watch and Next use the wrong season's list; L-M17 / S-L17 billboard not redrawn after sign-in.

UI: U18 selected Raw data tab 2.5:1; U19 tokens bypassed (347 colour literals, 0 font-size vars); U20 text down to 9 px; U21 touch targets 13-30 px; U22 active tab clipped; U23 Results hides Time on phones; U24 lap chart needs a mouse; U25 Δt axis smudge; U26 season leader labelled "World Champion"; U27 searches go blank; U28 Raw data opens empty; U29 sort is mouse only; U30 scrub bar reads raw seconds; U31 reduced motion partial; U32 .6 s bouncy panels; U33 popovers don't take focus; U34 career dialog unnamed, slow portrait; U35 red means everything.

### Low

Backend: S-L1 `race_info` outside `try` (bare 500, wrong 502); S-L2 unbounded year/round spends Jolpica quota; S-L3 count POST has no origin check; S-L4 licence body read before size check; S-L5 `/` not no-cache; S-L6 forged tokens can force feed reconnects; S-L7 token sent to any `recording_url`; S-L8 `PATH` grows on model reload; S-L9 season fallback search uncached; S-L10 MultiViewer outage skips fallbacks; S-L11 desktop spins for ever if the bind fails.

Frontend: S-L12 WebGL restore under the viewer; S-L13 one failed radio poll ends polling; S-L14 clip playback not exclusive, survives close; S-L15 explorer has no stale check; S-L16 countdown interval leak; S-L17 Stream listener leak, carsdeck stale catch; L-L1 `advance(0)` NaNs every AI car; L-L2 2023 "Sprint Shootout" alias; L-L3 ERS mode shown on pre-hybrid cars; L-L4 what-if "real" ignores penalties; L-L5 optimiser ranks a retired driver; L-L6 `launchAt` skips short stops; L-L7 PIT badge 22 s late; L-L8 "undefined-undefined" seasons; L-L9 Champion/Leader by calendar year; L-L10 withdrawn driver reads "PL"; L-L11 empty calendar keeps the old race; L-L12 422 shows "[object Object]"; L-L13 hero countdown lost on a failed fetch.

UI: U36 tabs ARIA; U37 heading order; U38 Stream card names; U39 four loading patterns; U40 brand link, default 10x, deck button text.

Repo: S-L19 local tool files not ignored; the `.ico` move is half staged; 7 files over the 500-line limit.

### Refuted

- L-H1 "blank flag pill in Practice/Qualifying": `startLights` is `out && a && b ? x : null`. `&&` binds tighter than `?:`, so it returns null when `lightsOut` is 0. Not a bug.

## 2. Feature and analytics expansion

Built from data the app already fetches unless noted. The numbers below come from the research run on small samples: direction, not calibration.

| ID | Feature | Method | Data | UI |
|---|---|---|---|---|
| F1 | Race trace (gap evolution) | `y(L) = cum_ref(L) − cum_d(L)`, neutral laps shaded, stops marked | Jolpica `laps`, `pitstops` | Lap chart toggle |
| F2 | Race pace and tyre degradation | Drop lap 1, in/out, neutral and 2 s-off laps; fit lap time on tyre age; fuel correction 0.03 s/kg × 110 kg / laps; ± standard error. Don't relabel `raceModel.fits[].b` as degradation: it's relative and clamped | `raceModel`; OpenF1 `stints` compound for 2023+ | Strategy lab "Pace" |
| F3 | Undercut ledger | Stops within 5 laps; `gain = g0 − g1`; sign flip = worked; exclude neutral windows and lap holes; filter large swings | Jolpica `laps`, `pitstops` (2011+) | Strategy lab; a row loads the driver into the what-if |
| F4 | Real-lap telemetry compare | Integrate speed, scale to lap length, resample to 500 buckets, reuse `delta`, `insights`, `tracechart`, `lapRows`. Real channels lack g, ERS, lateral | OpenF1 `car_data` through `/api/telemetry` | Trace modal on GPS replays |
| F5 | Teammate head-to-head | Pair by constructor and round; last qualifying session both reached; median % gap; race only when both classified | Jolpica `results`, season `qualifying` | Driver cards, career dialog |
| F6 | Season trends | Cumulative points; alive if `leader − driver ≤ remaining`; per-team supertime `100·(best/fastest − 1)` | Season `results`, `sprint`, `qualifying` | Standings tab |
| F7 | Pit-stop league table | Team median and best, no lap-1 grid rows or practice; stationary time labelled partial, with row count | Jolpica `pitstops.duration`; OpenF1 `stop_duration` | Results tab |
| F8 | Track dominance map | 25 equal-distance mini-sectors coloured by fastest; under 0.02 s = tie. Needs F4's series, not the replay's 0.5 s frames | F4 | Trace modal mini-map |
| F9 | Shareable state and CSV | Hash carries session, moment, focus and comparison; shared CSV helper. Never a token in shared state | none | Copy-link button, CSV on new tables |
| F11 | Overtake ledger | Classify lap 1, pit-related (within 30 s of a stop), on-track; drop SC. No official count to validate against | OpenF1 `overtakes` (1 request per race) | Results tab |
| F13 | Keyboard layer | `?` sheet, `/` search, command palette over races, tabs and views | none | Global |
| F14 | Usage counts view | The existing per-day totals as a small table, new features added to `EVENTS` | `/api/counts` | Palette command |

Deferred, with reasons:
- F10 live battle forecast and pit rejoin: no live session is available to verify against; the live feed's real delta format can't be shown from code. Build at the next race weekend.
- F12 qualifying evolution and long runs: needs a new route and adds the least of the set. Next batch.

Not building: AWS-style opaque scores and car ratings (private data), Monte Carlo win odds (whatif's exactness is the point), GG plots from real laps (differentiated noise), season-wide lap analysis from Jolpica (~360 of 500 req/h).

## 3. Roadmap

Rules: no two concurrent agents edit one file. Each agent reproduces a finding before fixing it, keeps documented decisions in `CLAUDE.md`, adds a test for new non-trivial logic, and runs the suites it touched. No commits.

### Milestone 1: correctness and reliability (parallel)

| WP | Owns | Items |
|---|---|---|
| A Backend | `src/*.py`, `tests/test_server.py`, `.gitignore` | S-H1, S-H2, S-M1 to M8, S-M12, S-L1 to L11, L-M15, S-L19 ignore entries |
| B Shell and data views | `app.js`, `util.js`, `stream.js`, `drivers.js`, `charts.js`, `explorer.js`, `strategylab.js`, `carsdeck.js`, `tests/test_drivers.mjs` | U1, S-H4, U2, U3, U10 (views), U11, U26-U29, U38, S-M9, S-M10, S-L15 to L17, L-M4, L-M5, L-M7, L-M9, L-M10, L-M12, L-M17, L-L4, L-L5, L-L8 to L13 |
| C Replay and viewer | `replay.js`, `tower.js`, `multiviewer.js`, `tvcontrols.js`, `commentary.js`, `scene3d.js`, `tests/test_multiviewer.mjs` | S-H3, S-H5, L-H2, L-H3, U5, U6, U10 (▶), U15, U30, S-M11, S-L12 to L14, L-M8, L-L1 (tick), L-L2, L-L6, L-L7 |
| D Simulation and decks | `strategy.js`, `simmode.js`, `vehicle.js`, `sim.js`, `telemetry.js`, `tracemodal.js`, `tracechart.js`, `circuitdeck.js`, `pitwall.js`, sim tests | L-M3, L-M6, L-L1 (advance), L-L3, U4, U25 |

### Milestone 2: interface system (sequential)

| WP | Owns | Items |
|---|---|---|
| E Tokens and layout | `style.css`, `circuitdeck.css`, `index.html` | U7-U9, U12, U13 (CSS), U16-U22, U31, U32, U35, U36, U37, S-M13 |
| F Keyboard layer | new `palette.js`, `tests/test_palette.mjs`, `app.js`, `style.css` | F13, F14, U13, U14, U22, U33, U39, U40 |

### Milestone 3: analytics (two parallel waves)

| Wave | WP | Owns | Items |
|---|---|---|---|
| 1 | G Race analysis | new `pace.js`, `tests/test_pace.mjs`, `charts.js`, `strategylab.js`, new `analytics.css`, `index.html` | F1, F2, F3 |
| 1 | J Real-lap telemetry | `trace.js`, `tracemodal.js`, `tracechart.js`, `replay.js`, `tests/test_trace.mjs` | F4, F8 |
| 2 | H Season | new `season.js`, `tests/test_season.mjs`, `drivers.js`, `analytics.css` | F5, F6 |
| 2 | K Ledgers and sharing | `charts.js`, `app.js`, `src/server.py`, `src/replay.py`, `style.css`, new `share.js`, `tests/test_share.mjs` | F7, F9, F11 |

### Milestone 4: verification

Every suite, a browser pass with `agent-browser`, `trail check`, then the changelog below and `CLAUDE.md` updated.

Not in this plan: splitting the seven over-long files. It's a large, behaviour-neutral diff on a tree with uncommitted work, and it would make the fixes above hard to review. New code goes in new modules instead.

## 4. Task tracking

The live checklist is the app's task list for this session. Changelog below.

## 5. Completion changelog

Finished 2026-11-06. Nothing is committed. All 19 test suites pass (13 before this work, 6 new); `trail check` reports no conflicts, though it read only the first 400 KB of the diff.

**Fixed.** Every Milestone 1 and 2 item above, with these exceptions:
- Refuted, unchanged: L-H1 (flag pill), U40's 10x default (deliberate for the start lights), U40's empty take-control button (not visible).
- S-M8 partly: `_is_live` requires a running status but still opens the feed for a race within ±3 days of today, or the first ▶ on a live session would 404. `Aborted` counts as running because OpenF1 stays locked during a red flag.
- S-M12: URL length is capped, the audio response isn't, since the host is fixed.
- S-L2: bounds are in `check_season` in `server.py`, not in `jolpica.py`.
- Telemetry files already truncated in `.cache/replay` (S-M4) aren't detected: delete them by hand if a driver's telemetry looks short.

**Found during implementation, also fixed.**
- `save()`: a unique temp name alone failed 1173 of 1200 replaces on Windows; it also retries now (0 of 400).
- Stream read a 2025 show as LIVE NOW: F1 TV gives some shows an end date decades ahead (2061 measured).
- Jolpica's qualifying rows scramble at 100-row page boundaries.
- OpenF1's pit `lap_number` is the in-lap in races and the out-lap in qualifying and practice.
- From the final pass: one Esc closed both a popover and a big panel; Explore dropped focus to the page body.

**Built.** F1, F2, F3, F4, F5, F6, F7, F8, F9, F11, F13, F14.

**Measured.**
| Check | Result |
|---|---|
| CLS, Results, 1440 / 375 | 0.786 → 0.004 / 0.951 → 0 |
| Stage at 375 px | 250 px at y=368 → 406 px at y=216 |
| Race trace final gaps, Mexico 2026 | exact: HAM −0.799, ANT −4.006, NOR −11.778 |
| Cumulative points, 2024 | top 10 equal the real standings |
| Overtakes, Mexico 2026 | 273 rows: 50 lap 1, 106 pit, 113 on track, 4 neutral |
| Real-lap integration vs official sectors, median / p90 | US GP Qualifying 0.090 / 0.197 s, US GP Race 0.104 / 0.306 s, round 17 Race 0.066 / 0.168 s |
| Replay frame rate | 88 fps at 1440x900, RTX 4080; no earlier baseline measured on this machine |

The research figure of 0.014 s for real-lap accuracy did not reproduce. The dominance tie margin went from 0.02 s to 0.05 s as a result, an estimate from those residuals rather than a calibration.

**Not verified.**
- The F1 TV viewer, signed in: S-H3, L-H3, S-L13, S-L14, clip errors, tile keys, shaka under its new integrity hash in real use (the script itself loads). Commentary too.
- A live session: live merge, `/api/live/status` and the OpenF1-locked messages ran against stubs only.
- The exe build; WebGL restore (S-L12) and ground worker termination (S-M11) at runtime.
- Real touch devices; Stream, Strategy, Lap chart and Drivers in light theme on a phone; the new CSV buttons by click (`toCsv` has tests).

**Known limits left in.**
- Compounds aren't shown in the pace table: fetching them can trigger the ~30-request GPS build.
- Wet-qualifying flag in supertime misses mixed sessions (Spa 2023 at 4.5 %).
- Teammate comparison skips rounds with shared drives, so the 1950s and 60s are thin.
- Opening a shared link strips its params, so a reload loses the moment.
- Lows from the final pass: trace picker labels clip at 1440, phone sort buttons under 24 px, a few overridden CSS rules, one three.js shader warning (X3595), Drivers lists 11 reserves with no starts.

**Not done.** F10 and F12 (deferred above). The over-long files are longer: `replay.js` 812, `multiviewer.js` 807, `server.py` 597, `app.js` 553. Splitting them should follow the commit, not precede it. The `style.css` token migration is only partial by design: rules move when they're next touched.

---

# Three.js r187 WebGPU migration (2026-11-06, branch `3d-graphics-upgrade`)

## 6. Teardown of the WebGL stack

Audited from source, not from the notes. Everything below needs a port, because a WebGPU renderer has no GLSL `onBeforeCompile`, no `ShaderMaterial`, no `EffectComposer` and no `gl_PointSize`.

| Construct | Where | Replacement |
| --- | --- | --- |
| `WebGLRenderer` (x2, two GPU contexts) | `scene3d.js:55`, `carsdeck.js:132` | one `WebGPURenderer`, two `CanvasTarget`s |
| `EffectComposer` + passes, `overrideMaterial` velocity | `post.js:142-235` | `RenderPipeline`, one `pass()` + `mrt()` |
| `CSM` + per-material patch (`csmSync`) | `scene3d.js:103,230` | `CSMShadowNode`; `csmSync` deleted |
| `Sky`, `RGBELoader`, `WebGLCubeRenderTarget`, `Clock` | `scene3d.js:78,131,200,221` | `SkyMesh`, `HDRLoader`, `CubeRenderTarget`, `Timer` |
| `onBeforeCompile` | `track3d.js:35`, `cars3d.js:143`, `circuit3d.js:182,298` | node materials |
| `ShaderMaterial`, `gl_PointSize` | `vfx.js:130`, `mirror.js:48` | `PointsNodeMaterial.sizeNode`, `MeshBasicNodeMaterial` |
| `WebGLRenderTarget`, nested render in `onBeforeRender` | `mirror.js:45,68` | `RenderTarget`, rendered from the master loop |
| Transmission heat haze | `vfx.js:27` | `viewportSharedTexture` backdrop |

Spec points that don't match r187, checked on the CDN: `tsl/display/MotionBlurNode.js` is a 404 (it is `MotionBlur.js`), `timerLocal` is not exported (`time`), `RGBELoader.js` is a stub (`HDRLoader.js`).

## 7. Migration blueprint

1. `scripts/pin_three.mjs` crawls the import graph from the addons the app really imports and rewrites the integrity block in `index.html`, so no hash is typed by hand.
2. `scene3d.js` owns the renderer, both surfaces and the only animation loop; `showroom.js` registers with it. `init3d` stays synchronous (it probes for a GPU and throws as before); GPU work waits on `ready`.
3. `post.js` keeps its API (`setSize/focus/reset/setMps/render`). The two things a stock node would lose are kept as ports: the motion blur's velocity weighting (keeps a tracked car sharp) and the thin-lens depth of field.
4. Materials port one for one so the physically based choices stay (real racing-line attribute, photo textures, wetness).
5. Telemetry and UI extend `hud.js`, `tower.js`, `palette.js` rather than adding a parallel system.
6. Verification in a headed browser; report and changelog appended here.

## 8. Verification report (2026-11-06, RTX 4080 Laptop, Chrome WebGPU, headed agent-browser)

| Check | Result |
|---|---|
| Node suites (19, including new `test_pitdata`) and `tests/test_server.py` | Pass |
| Import map, SRI, modules | Loads; 17 files pinned at 0.187.0 |
| Console and uncaught errors on a replay through all five hotkey cameras, showroom, tier and sky keys, plus a Simulation | None after the fixes below |
| Replay cameras: Overview, Chase, Cockpit, T-Cam, Helicopter | Screenshot-checked |
| Sun shadows (CSM) | Visible once the bias was fixed; checked in Chase only with ambient light off |
| Showroom on the shared renderer | Renders, with pins and rig button. Airflow, other rigs and other eras not exercised |
| Telemetry drawer, tower gains and stops, driver cycling | Working in replay and Simulation |
| Golden hour sky | Screenshot-checked. Overcast and Night not viewed |
| Frame time | **60 fps not met during play.** Replay at Ultra about 20-25 ms, Simulation at 10x 36 ms, stopped at 6-10 ms. Tiers barely change it (33-41 fps), so the post chain isn't the limit. Measured with DevTools attached |

Not exercised: sparks, smoke, rain, DOF focus, the minimap readout with real data (only its empty message was seen), loading overlay failure text, device-loss recovery, live timing, the F1 TV viewer, the packaged exe, `desktop.py`, weaker GPUs.

Seen once and not reproduced: a Simulation stopped by itself at 0:01:56, and pressing play continued it normally. A dark blob over the focused car appeared in two replay screenshots; a NaN guard was added to the post chain and it wasn't seen again, but the source was not found.

## 9. Changelog

Runtime bugs found and fixed: inherited shadow bias removed every car shadow; mirror camera threw on the read-only `reversedDepth`, freezing the cockpit view; sparks' MRT node failed to compile in the mirror's target (now layer 2); showroom depth buffer stayed 300x150; `Return()` values, `gl_PointCoord`, depth-copy format and sized points on WebGPU.

Departures from the brief: AO multiplied in rather than `builtinAOContext`; bloom threshold 2.5, not 0.85; custom weighted motion blur, not stock; worker `terminate()` instead of AbortController; six cameras (TV Chase stays in the menu); C now opens the showroom and T the drawer, with the old trace on Shift+T; AgX with a saturation grade, since AgX alone turned red liveries salmon.

Not done from the brief: no animated DRS flap (no flap mesh exists); wheel spin and steer on the RB22 only (older cars' geometry is merged); GLB `redbull_carbon*` materials keep their original look, and tread and sidewall materials were not extended; airflow is illustrative, not computed; replay data has no core temperatures or harvest, so those read as modelled or blank there; touched files were read in full, the rest of the 20.5k lines grepped rather than read.

### Follow-up audit, Nov 6 2026

Black smoke: reproduced by spawning smoke in front of the chase camera on Ultra. It went away on Medium, which has no AO. The sprites overwrote the MRT normal without writing depth, and GTAO blackened them. GTAO now reconstructs normals from depth and the normal target is gone. This also explains the dark blob in section 8, so its NaN guard was removed.

AI speed envelope: recomputed for every car every physics step, 26 % of CPU at 10x. Now cached per track sample while grip holds. CPU in it fell from 2157 ms to 406 ms per 8 s trace, and `tests/test_sim.mjs` from 20 s to 7.5 s.

Also fixed: rain streaks crossed the sky at 10x (camera velocity now capped at 100 m/s); the visor's iridescence thickness used property names three ignores.

Viewed with no fault: sparks, rain, spray-free wet track, Overcast and Night settled, all five cameras, 1996 and 2010 cars. 1975 round 4 correctly says it has no outline. One washed-out, blurred frame was seen right after switching to Overcast on a wet track and did not recur.
