# Tests

Run all JS tests: `for f in tests/test_*.mjs; do node "$f"; done`. `scripts/test_all.py` runs everything, tsc included. `tests/test_server.py` also covers `/api/live/stream` by playing `tests/fixtures/live.jsonl` through `LIGHTSOUT_LIVE_PLAY`.

```bash
.venv/Scripts/python tests/test_server.py  # tests (plain asserts, no pytest)
node tests/test_live.mjs                   # live car-placement logic; streamLive parsing, ticket, failover
node tests/test_telemetry.mjs              # derived HUD telemetry (g-forces, tyres, ERS, DRS zones)
node tests/test_sim.mjs                    # race simulation physics (aero, DRS, tyres, full race)
node tests/test_player.mjs                 # player driving (steering, TC/ABS, gearbox) and AI racecraft
node tests/test_eras.mjs                   # era profiles: turbo lag, 2026 active aero / MGU-K taper, skirts, lap times by era
node tests/test_circuits.mjs               # auto aero trim, elevation grade, banking
node tests/test_globe.mjs                  # launch globe: lat/long on the sphere, tile blocks, the flight to a circuit
node tests/test_trace.mjs                  # distance-resampled lap telemetry, Δt, engineer insights, trace plot smoke test
node tests/test_vehicle.mjs                # 2025 car benchmarks: 0-100/200/300, 300-100 braking and its taper, lateral g at 75 and 250 km/h, trail braking, DRS reattach, brake bias
node tests/test_whatif.mjs                 # Strategy Lab what-if model (baseline exactness, optimiser, traffic, SC stops)
node tests/test_multiviewer.mjs            # F1 TV overlay timing (session names, telemetry lookup, lights-out sync)
node tests/test_lanes.mjs                  # lap-timing replay lanes (two-column grid, passing without overlap); GPS retime (steady pace, same path)
node tests/test_drivers.mjs                # Drivers tab season/career tallies (wins, podiums, poles, starts)
node tests/test_motion.mjs                 # motion.js: reduced motion ends at once, stagger order, countUp, a failed anime.js load, the globe's flight sheet
node tests/test_glass.mjs                  # Liquid Glass lens map and rim 9-slice
node tests/test_util.mjs                   # shared helpers (fetch cache TTL, error wording, CSV)
node tests/test_palette.mjs                # command palette matching and shortcut guards
node tests/test_pace.mjs                   # race trace, tyre-wear fits, undercut ledger
node tests/test_reaction.mjs               # start reaction game: hold range, personal best, verdicts
node tests/test_season.mjs                 # teammate head-to-head, cumulative points, title maths, supertime
node tests/test_spoilers.mjs               # spoiler-free mode: which races hide their result, reveal list
node tests/test_share.mjs                  # shareable link parsing, token stripping
node tests/test_ledgers.mjs                # pit-stop table, overtake classes
node tests/test_quali.mjs                  # qualifying parts and bests, deleted laps, practice long runs
node tests/test_moments.mjs                # replay key moments: safety car / red flag bands, lead changes, jump order
node tests/test_highlights.mjs             # Race Highlights reel: which moments, budget, overlaps, fake passes in the position feed
node tests/test_marks.mjs                  # scrubber pins: GPS, lap-timing and F1 TV event sources
node tests/test_story.mjs                  # the Why: lead changes through pit cycles, pit-call verdicts, red flags, slow stops
node tests/test_pitdata.mjs                # telemetry drawer maths: tyre bands, traction ellipse, shift lights, strip buffer
node tests/test_dash.mjs                    # cockpit wheel screen: shift lights
node tests/test_graphics.mjs                # stage settings: presets, validation of what localStorage holds; device tier rule, TRAA off in presets
node tests/test_play.mjs                    # Play: lap choices, stored setup and time-trial bests, the time trial's one-car race
node tests/test_app.mjs                     # app.js's static import graph reaches no three.js module; replayKind
npx -y -p typescript@7.0.2 tsc -p jsconfig.json  # type check of the // @ts-check modules (jsconfig.json files)
```
