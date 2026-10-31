# Graph Report - F1  (2026-10-30)

## Corpus Check
- 91 files · ~116,432 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 2, .css 2, .glb 1)

## Summary
- 1180 nodes · 3015 edges · 50 communities (47 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 64 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- App Shell & Tabs
- Procedural Audio
- Telemetry Trace
- Server & Dependencies
- F1 TV Stream Viewer
- Replay Backend
- Lap-Timing Lanes
- Circuit Deck
- Live Timing Client
- Sim Core & Mirror
- Strategy Lab
- Procedural Cars 3D
- Replay Frontend
- F1 TV Auth
- Trail Hook
- Race Sim Engine
- Tyre Model
- Textures & VFX
- Live Feed Backend
- 3D Circuit Builder
- Onboard & Camera
- Race Control
- Jolpica Cache & Tests
- RB22 Model
- Track Outlines
- Player Driving
- F1 TV Backend
- Tower & Decks
- Sim Runtime API
- Player Tests
- Pit Wall
- Features & Warm-up
- 3D Realism Audit
- Cars Deck
- HUD Panels
- Racecraft AI
- Data Sources
- First-Visit Intro
- PBR Surfaces
- Header & View Switch
- Lights Out Branding
- Hidden Pane Lessons
- Post-Processing
- Lap Car Placement
- Usage Counts
- RB22 Credits
- Live Timing Feed
- Syntax-Check Lessons
- Trail Learnings
- Community 49

## God Nodes (most connected - your core abstractions)
1. `el()` - 93 edges
2. `createRace()` - 53 edges
3. `get()` - 30 edges
4. `clamp()` - 29 edges
5. `render()` - 28 edges
6. `drive()` - 22 edges
7. `led()` - 22 edges
8. `setupReplay()` - 21 edges
9. `teamColor()` - 19 edges
10. `selectRace()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Live button (#livebtn)` --conceptually_related_to--> `Free live sessions`  [INFERRED]
  src/static/index.html → README.md
- `race()` --calls--> `createRace()`  [EXTRACTED]
  tests/test_circuits.mjs → src/static/sim.js
- `src/static/index.html` --references--> `Stream section (#stream)`  [EXTRACTED]
  .trail/learnings/2026-10-30-the-app-is-named-lights-out-aditya.md → src/static/index.html
- `Race picker popover (#calendar)` --conceptually_related_to--> `Race views (calendar, results, qualifying, lap chart, standings)`  [INFERRED]
  src/static/index.html → README.md
- `Footer data credits` --references--> `MultiViewer API`  [EXTRACTED]
  src/static/index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphics realism plan phases (colour, ground, trackside, cars)** — docs_graphics_realism_plan_neutral_tone_mapping, docs_graphics_realism_plan_asphalt_gravel_surfaces, docs_graphics_realism_plan_kerb_placement, docs_graphics_realism_plan_debris_fence, docs_graphics_realism_plan_smooth_trees, docs_graphics_realism_plan_satin_livery_paint, docs_graphics_realism_plan_brake_glow [EXTRACTED 1.00]
- **RB22 model provenance and adaptation** — src_static_models_credits_rb22_model, src_static_models_credits_cc_by_4_0, src_static_models_credits_agentiloop_f1, src_static_models_credits_livery_repaint [EXTRACTED 1.00]
- **F1 TV playback pipeline and fallbacks** — trail_learnings_2026_10_26_f1_tv_archive_videos_play_as_aditya_archive_hls_playback, trail_learnings_2026_10_26_f1_tv_pre_2025_videos_refuse_aditya_channel_null_fallback, trail_learnings_2026_10_26_f1_tv_pre_2025_videos_refuse_aditya_uhd_retry, src_f1tv, src_static_multiviewer [INFERRED 0.75]
- **F1 TV sign-in without server-side secrets** — trail_learnings_2026_10_26_f1_tv_sign_in_for_a_aditya_bookmarklet_signin, trail_learnings_2026_10_26_f1_tv_sign_in_for_a_aditya_oauth_redirect_rejected, trail_learnings_2026_10_26_f1_tv_sign_in_for_a_aditya_cookie_read_rejected, trail_learnings_2026_10_26_f1_tv_sign_in_for_a_aditya_live_shared_token [EXTRACTED 1.00]
- **Desktop pane measurement pitfalls** — trail_learnings_2026_10_26_profiling_the_app_in_the_desktop_aditya_hidden_pane_visibility, trail_learnings_2026_10_29_first_visit_intro_seeks_to_lap_aditya_hidden_pane_raf, trail_learnings_2026_10_26_profiling_the_app_in_the_desktop_aditya_reload_after_edit [INFERRED 0.65]
- **First-visit flow (intro, switch, control bar, usage counts)** — docs_ux_audit_intro, docs_ux_audit_view_switch, docs_ux_audit_control_bar, docs_ux_audit_usage_events, src_static_index_intro_card [INFERRED 0.85]
- **Data sources** — readme_livef1, readme_jolpica, readme_openf1, readme_multiviewer, readme_f1_circuits_geojson, readme_f1_live_timing [EXTRACTED 1.00]
- **Backend modules** — src_server, src_jolpica, src_replay, src_tracks, src_live [INFERRED 0.75]

## Communities (50 total, 3 thin omitted)

### Community 0 - "App Shell & Tabs"
Cohesion: 0.05
Nodes (103): Vanilla JS ES-module frontend, A, activate(), checkLive(), countdown(), drawn, drawTab(), endIntro() (+95 more)

### Community 1 - "Procedural Audio"
Cohesion: 0.06
Nodes (61): applyProfile(), audioReady(), build(), burst(), chain(), downshift(), drive(), duck() (+53 more)

### Community 2 - "Telemetry Trace"
Cohesion: 0.07
Nodes (62): SECTOR_COLORS, setCursor(), apexes(), CHANNELS, createRecorder(), delta(), ERS, fmt() (+54 more)

### Community 3 - "Server & Dependencies"
Cohesion: 0.07
Nodes (32): Tests (test_server.py, test_live.mjs), races(), car_telemetry(), circuit(), counts(), driver(), _elevation_at(), f1_schedule() (+24 more)

### Community 4 - "F1 TV Stream Viewer"
Cohesion: 0.08
Nodes (51): f1tv.py F1 TV backend, stream.js Stream page (F1 TV browse), F1 TV connect bar on Stream, Stream section (#stream), addTile(), applyQuality(), AUDIO, CODECS (+43 more)

### Community 5 - "Replay Backend"
Cohesion: 0.09
Nodes (26): Replay cache in .cache/replay, elevation(), _elevation(), find_session(), _finished(), gps_replay(), _gps_replay(), locations() (+18 more)

### Community 6 - "Lap-Timing Lanes"
Cohesion: 0.06
Nodes (28): GRID, lanes(), sideOf(), wrap(), CAR_W, err(), fitGeo(), mercator() (+20 more)

### Community 7 - "Circuit Deck"
Cohesion: 0.11
Nodes (32): build(), pick(), preview(), toggle(), aeroLabel(), annotate(), autoAero(), f1Coords() (+24 more)

### Community 8 - "Live Timing Client"
Cohesion: 0.09
Nodes (33): CHANNELS, feedTime(), fetchLive(), gps, gpsAt(), hasGps(), lapSeconds(), liveCar() (+25 more)

### Community 9 - "Sim Core & Mirror"
Cohesion: 0.09
Nodes (34): sim.js race simulation physics, makeMirror(), createCrews(), place(), rb22Ready(), APERTURE, cars, chassis() (+26 more)

### Community 10 - "Strategy Lab"
Cohesion: 0.13
Nodes (30): chip(), code(), renderStrategyLab(), draw(), update(), findBest(), positionChart(), warnings() (+22 more)

### Community 11 - "Procedural Cars 3D"
Cohesion: 0.12
Nodes (32): airfoil(), at(), bend(), build(), buildCar(), carbonDir, carbonNormal, CHANGES (+24 more)

### Community 12 - "Replay Frontend"
Cohesion: 0.16
Nodes (27): drawOutlineFromGps(), drawTrack(), gpsPitLane(), gpsPos(), gpsState(), intro(), lightsOut(), loadData() (+19 more)

### Community 13 - "F1 TV Auth"
Cohesion: 0.11
Nodes (7): claims(), valid(), f1tv_account(), fake_get(), _jwt(), Res, _z()

### Community 14 - "Trail Hook"
Cohesion: 0.12
Nodes (18): best(), entry(), flatLine(), fromPkg(), fs, globalRoot(), liveFiles(), newer() (+10 more)

### Community 15 - "Race Sim Engine"
Cohesion: 0.19
Nodes (24): neutralised(), createRace(), findAhead(), step(), timing(), aiPace(), aiStrategy(), createPit() (+16 more)

### Community 16 - "Tyre Model"
Cohesion: 0.11
Nodes (22): drive(), aquaplaneSpeed(), COMPOUNDS, stintLife(), surfaceGrip(), thermalGrip(), wearGrip(), before (+14 more)

### Community 17 - "Textures & VFX"
Cohesion: 0.16
Nodes (15): dataTex(), normalTex(), origin(), born(), createVfx(), self, fract(), hazeMat (+7 more)

### Community 18 - "Live Feed Backend"
Cohesion: 0.13
Nodes (11): _handle(), _idle(), inflate(), merge(), _put(), rows(), _run(), snapshot() (+3 more)

### Community 19 - "3D Circuit Builder"
Cohesion: 0.17
Nodes (15): buildCircuit(), cornerRuns(), crown(), densify(), frames(), gantry(), rand(), strip() (+7 more)

### Community 20 - "Onboard & Camera"
Cohesion: 0.16
Nodes (20): setRadar(), CAMERAS, FLAG, nextCamera(), setCameraUi(), setupOnboard(), setWheelAngle(), TYRE (+12 more)

### Community 21 - "Race Control"
Cohesion: 0.18
Nodes (17): controlStep(), createControl(), deploy(), safetyCar(), say(), vscDelta(), bankHelp(), carSpec() (+9 more)

### Community 22 - "Jolpica Cache & Tests"
Cohesion: 0.15
Nodes (9): Jolpica disk cache (SETTLED), F1 web app architecture overview, Project test suite, driver_career(), jolpica_fetch(), jolpica_rows(), _pages(), _settled() (+1 more)

### Community 23 - "RB22 Model"
Cohesion: 0.15
Nodes (18): axleOf(), bake(), buildRB22(), CORNERS, css(), dropTriangles(), MIRRORS, NOSE_PLATE (+10 more)

### Community 24 - "Track Outlines"
Cohesion: 0.20
Nodes (9): _clean_loop(), _geo_track(), _geojson(), _get(), lap_track(), mv_track(), _mv_track(), _mv_years() (+1 more)

### Community 25 - "Player Driving"
Cohesion: 0.18
Nodes (16): ASSISTS, GEAR_TOP, gearbox(), playerDrive(), powerShare(), rpmFor(), steer(), smooth() (+8 more)

### Community 26 - "F1 TV Backend"
Cohesion: 0.16
Nodes (7): channels(), F1TVError, play(), _search(), _stem(), videos(), f1tv_play()

### Community 27 - "Tower & Decks"
Cohesion: 0.18
Nodes (16): updateDecks(), renderFeed(), render(), setTyre(), simState(), COLUMNS, num(), plus() (+8 more)

### Community 28 - "Sim Runtime API"
Cohesion: 0.15
Nodes (4): R, predictRejoin(), trackPos(), minSpeed()

### Community 29 - "Player Tests"
Cohesion: 0.19
Nodes (15): RPM_LIMIT, brakeTest(), car, crash, fullTc, m, noTc, pts (+7 more)

### Community 30 - "Pit Wall"
Cohesion: 0.17
Nodes (14): setGhost(), banner(), COMPS, DIRECTOR, DRY, PACES, pct(), PIT_STATE (+6 more)

### Community 31 - "Features & Warm-up"
Cohesion: 0.15
Nodes (14): Usage counts endpoint (/api/count), drivers.js Drivers tab, Strategy lab what-if model, server warm_up background thread, Replay control bar menus, Season GPS warm-up and lap-timing fallback, Phone tab bar edge fade, Replay kind tags in race picker (+6 more)

### Community 32 - "3D Realism Audit"
Cohesion: 0.15
Nodes (10): Bare-carbon lower bodywork (2022+), Brake disc glow, Debris fence on barriers, Deferred graphics work, 3D graphics realism: audit and plan, Realistic kerb placement (apex inside, exit outside), Lit race-number decal (A9 bug), Existing PBR render pipeline (HDRI, CSM, MSAA, bloom) (+2 more)

### Community 33 - "Cars Deck"
Cohesion: 0.30
Nodes (13): spec(), badge(), CARS, era(), ERAS, loop(), pick(), preview() (+5 more)

### Community 34 - "HUD Panels"
Cohesion: 0.22
Nodes (12): chassis(), dash(), ERS_MODES, glass(), renderFocus(), renderRadar(), setupHud(), STATUS (+4 more)

### Community 35 - "Racecraft AI"
Cohesion: 0.33
Nodes (9): blocker(), CAR_L, clearance(), racecraft(), radar(), resolveContacts(), wrap(), proximity() (+1 more)

### Community 36 - "Data Sources"
Cohesion: 0.24
Nodes (10): livef1 dead ends, OpenF1 free-tier rate limit, GPS replay (2023 onwards), Jolpica F1, Lap-timing replay (1996 onwards), livef1, OpenF1, OpenF1 locked during live sessions (+2 more)

### Community 37 - "First-Visit Intro"
Cohesion: 0.22
Nodes (9): First-visit intro card, circuitdeck.css, src/static/index.html, Hero section (#hero), Import map (three.js 0.169.0 from jsDelivr), Intro card section (#intro), src/static/style.css, Shared glass surface recipe (+1 more)

### Community 38 - "PBR Surfaces"
Cohesion: 0.42
Nodes (7): Asphalt and gravel PBR surfaces, Poly Haven PBR texture sets, canvasTex(), photo(), rand(), speckle(), textures()

### Community 39 - "Header & View Switch"
Cohesion: 0.25
Nodes (8): Three-way view switch, flagcdn, Race views (calendar, results, qualifying, lap chart, standings), Live button (#livebtn), Race picker popover (#calendar), Season select (#year), Top bar (header), View switch (Analytics / Simulate / Stream)

### Community 40 - "Lights Out Branding"
Cohesion: 0.29
Nodes (7): Rename to Lights Out, Data explorer, bacinger f1-circuits GeoJSON, HTTP API, Lights Out app, MultiViewer API, Track maps

### Community 41 - "Hidden Pane Lessons"
Cohesion: 0.29
Nodes (5): README.md, Hidden desktop pane throttles timers and rAF, Hidden pane freezes intro fade-in and camera, Formula 1 named only for facts, Lights Out trademark not yet checked

### Community 42 - "Post-Processing"
Cohesion: 0.33
Nodes (5): blurShader, caShader, createPost(), dofShader, velocityShader

### Community 43 - "Lap Car Placement"
Cohesion: 0.50
Nodes (5): carsAt(), lapCars(), lapPos(), lapsState(), pointAt()

### Community 45 - "RB22 Credits"
Cohesion: 0.67
Nodes (3): AgentiLoop/F1 repository, CC BY 4.0 licence, rb22.glb "2026 Redbull RB22" by Tyler_Dave

### Community 46 - "Live Timing Feed"
Cohesion: 1.00
Nodes (3): F1 live timing (SignalR Core), Live GPS needs F1 TV, Free live sessions

### Community 48 - "Trail Learnings"
Cohesion: 1.00
Nodes (3): .trail folder, hook.cjs session-start hook, Learnings directory

## Ambiguous Edges - Review These
- `App named Lights Out` → `Lights Out trademark not yet checked`  [AMBIGUOUS]
  .trail/learnings/2026-10-30-the-app-is-named-lights-out-aditya.md · relation: rationale_for

## Knowledge Gaps
- **26 isolated node(s):** `f1`, `CC BY 4.0 licence`, `F1 TV token is per browser tab`, `Live feed shares one token across pollers`, `HUD and F1 TV viewer stay dark` (+21 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 337 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `el()` connect `App Shell & Tabs` to `Procedural Audio`, `HUD Panels`, `Cars Deck`, `F1 TV Stream Viewer`, `Telemetry Trace`, `Circuit Deck`, `Strategy Lab`, `Replay Frontend`, `Onboard & Camera`, `Tower & Decks`, `Pit Wall`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **What connects `f1`, `CC BY 4.0 licence`, `F1 TV token is per browser tab` to the rest of the system?**
  _26 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & Tabs` be split into smaller, more focused modules?**
  _Cohesion score 0.0501906941266209 - nodes in this community are weakly interconnected._
- **Why does `Vanilla JS ES-module frontend` connect `App Shell & Tabs` to `Sim Core & Mirror`, `Replay Frontend`, `Jolpica Cache & Tests`, `Features & Warm-up`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Should `Procedural Audio` be split into smaller, more focused modules?**
  _Cohesion score 0.05672926447574335 - nodes in this community are weakly interconnected._
- **Why does `F1 web app architecture overview` connect `Jolpica Cache & Tests` to `App Shell & Tabs`, `Server & Dependencies`, `F1 TV Stream Viewer`, `Replay Backend`, `Live Feed Backend`, `Track Outlines`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `App named Lights Out` and `Lights Out trademark not yet checked`?**
  _Edge tagged AMBIGUOUS (relation: rationale_for) - confidence is low._