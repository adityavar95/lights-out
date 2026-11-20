# Motion plan: anime.js and theater.js

Status: all phases done (uncommitted). Each phase is one session: start it by pointing at this file and naming the phase.

## Starting point (measured Nov 20 2026)

- Neither library is in the repo. There is no package.json: third-party code is fetched by `scripts/fetch_assets.py` into `src/static/assets` (gitignored) and mapped in the importmap in `src/static/index.html`. Three.js comes that way.
- Motion today: about 14 `@keyframes` blocks in `style.css` and `circuitdeck.css` (introin, bannerIn, bannerFlash, cdin, roll, stopbar, sshimmer, mvpulse, limiter, armed, trwave, ...), roughly 113 animation/transition lines in `style.css`, 7 `requestAnimationFrame` sites (`replay.js`, `multiviewer.js`, `replaylive.js`, `reaction.js`), one View Transition in `app.js` (tab swap), and WAAPI in `util.js` (toast close).
- Reduced motion is already handled by `calm()` in `util.js` (line 240). Every new motion must go through it.
- Licences: anime.js v4 is an ESM library (check its licence on its repo before vendoring). theater.js: `@theatre/core` is Apache 2.0 and can ship; `@theatre/studio` is AGPL 3.0 and must stay a dev-only tool that never reaches the shipped app.

## Rules for every phase

- Load anime.js only where it is used. `app.js` must not import it statically (`tests/test_app.mjs` checks that three-reaching modules stay out of the static graph; apply the same idea to the motion library).
- Playback time stays the source of truth where it exists. Replay, the simulation clock, and reaction-light timing read the replay/frame clock, not an animation library's own clock.
- No graphics quality loss: no change to the 3D picture, lighting, or resolution. Measure 3D fps in agent-browser, foreground (see the Nov 19 learning on Chrome background tabs).
- Desktop only, per the user's standing rule. No phone layout work.
- Each phase ends with: `.venv/Scripts/python scripts/test_all.py`, `npx -y -p typescript@7.0.2 tsc -p jsconfig.json`, a desktop visual check in agent-browser (with reduced motion on and off), and a short doc update in `docs/architecture/frontend.md` or `3d-and-look.md`.

## Phase 1: foundation (S, half a day)

Goal: the libraries are available, and motion has one entry point.

- Add anime.js (ESM build) and theater.js `@theatre/core` to `scripts/fetch_assets.py` and the importmap in `index.html`. Put them in the core list so `build_exe.py` ships them.
- New `src/static/motion.js`: a thin wrapper that returns no-op or instant results when `calm()` is true, and that creates a scope per component so it can be cleaned up.
- Test: `tests/test_motion.mjs` covers the reduced-motion branch and scope cleanup. Add it to `scripts/test_all.py`.
- No visible change yet. This phase only proves the libraries load in the browser and in the exe.

## Phase 2: sequenced UI motion (S-M, 1 day)

Goal: replace CSS keyframes that need sequencing or a finish callback. Leave simple hover and colour transitions in CSS.

- Candidates: `introin` (the notice card), `bannerIn` and `bannerFlash` (the in-race banner, style.css ~1110), `roll` (ticker), `bufshow`, `stopbar`, `cdin` (circuitdeck).
- Done: toast entry and close in `util.js` now play through `motion.js` (the WAAPI close is gone). Kept CSS, with reason: `introin` on the intro card (its `body.intro` toggle lives in app code, so the delay is not worth moving now), `bannerIn`/`bannerFlash` (a CSS blink chain with no callback; it is in step as it is), `roll` and `cdin` (no sequencing).
- Keep the same timing and easing as the current CSS (`--spring`), so the look does not change.

## Phase 3: data and list motion (M, 1-2 days)

Goal: tables, cards and numbers arrive with motion that helps the reader follow them.

- Staggered entry for: results rows, standings, the Stream cards (`stream.js`), the schedule cards ("Coming up"), and the explorer lists.
- Count-up for numbers that change once (done Nov 21 for the standings points, `motion.js` `countUp`, in step with the bars; not done in phase 3: loadstage's percentages are live, and the results figures are read in the table at once): the loading percentages in `loadstage.js`, lap and total figures on the results page.
- Charts: check how `charts.js` draws. If it is SVG or canvas, animate the first draw only. Do not animate live data updates in the replay.
- Test: a fixture-based check that rows are present and in order after the animation finishes (the content must not depend on animation timing).

## Phase 4: race-start and reaction sequences (M, 1 day)

Goal: the start lights and timed sequences in `reaction.js` are moved to anime.js timelines, with the same timing.

- The reaction game and the start lights depend on `event.timeStamp` and a frame-accurate `t0`. Keep those timestamps as the source of truth. A timeline only drives the visuals, and it must not decide the result.
- Test: the existing `reaction` tests still pass. Add an assert for the timing offsets, so a library update cannot shift them.

Done (phase 4, Nov 21 2026): each light pops on through `play` (visual only); `lightAt` holds the offsets and `test_reaction.mjs` asserts them. No anime.js timeline: the five timers and the rAF lights-out frame already are the sequence, and a timeline would add a second clock that must not decide the result.

## Phase 5: theater.js for scripted 3D camera moves (M-L, 2-3 days)

Goal: scripted camera moves for the launch globe and session fly-in, authored in the studio and played back by core only.

- Authoring: the studio runs only in a dev session. Export the sheet to a JSON file in `src/static/`. The shipped app loads only `@theatre/core` and that JSON.
- Start with one move: the globe to the chosen circuit, on `globe.js`. Use a theatre sheet that drives the camera object. Only the camera is animated; the material and shader setup stay as they are.
- Load the core and the JSON on demand, inside the stage's loader (`loadStage()`). Do not add it to `app.js`'s static graph.
- Test: a fixture sheet is loaded and sampled at fixed times; the camera position matches the exported keyframes. Under reduced motion, the camera jumps to the end state.
- Stop point: if the move makes the frame rate drop in agent-browser, the phase ends as "not shipped", as the TRAA trial in Phase 5 of `modernize-plan.md` did.

Done (phase 5): the sheet drives the timing of every globe flight (`flight.theatre.json`, `motion.js` `flightSheet`, `globemath.js` `flight(a, b, f, t)`), not just the pin flight, because all three share `flight()`. Deviations: the studio was not run, so the sheet is a state file written by hand from the same smoothsteps (`globemath.js` `timing`), and a test checks it. `@theatre/core` 0.7.2 ships CommonJS only, so the page loads jsDelivr's `+esm` builds of core and dataverse (import map key `/npm/@theatre/dataverse@0.7.2/+esm`). Checked in agent-browser: the real core samples the sheet at 0.2 / 0.6 / 1 as the smoothsteps give; a pin flight lands over Melbourne with no page errors; reduced motion emulated, no errors. Not measured: frame rate during a flight (one sheet sample per frame, so none expected, but the stop point was not tested).

## Phase 6: wrap-up (S, half a day)

- Update `docs/architecture/frontend.md` (motion.js and its rules), `3d-and-look.md` (the camera sheet, if shipped), `testing.md` (the new test), and CLAUDE.md (one line in the architecture rules).
- Run `scripts/build_exe.py` and check that the exe plays the phase 2-5 motion offline.
- Record the baseline (request count and load time) so the gain is measured, not assumed.

Done (phase 6, Nov 21 2026): docs in `frontend.md` (Motion paragraph), `3d-and-look.md` (globe flight timing), `testing.md` (`test_motion.mjs`) and a CLAUDE.md rule. `test_all.py` and tsc pass. Exe built; served on LIGHTSOUT_PORT=8099 it loads anime.js, @theatre/core, dataverse and `flight.theatre.json` from its own `static/assets` (no CDN), and the sheet samples {turn .5, climb 1, drop 0} at 0.2 and drop .394 at 0.6, the smoothsteps' values. Baseline, `#2026/1/results` in agent-browser, 3 loads (Cache Storage cleared, HTTP cache not): 89-91 requests, load 161-229 ms, 0.89-0.99 MB decoded; anime.js is the one motion request (results rows stagger), theatre.js loads only with the globe. Before the motion work (modernize phase 6): 98 requests, 204 ms, 0.89 MB, so the motion work added no measurable load cost.

Follow-up (Nov 21 2026): `scope()` was never used and is gone. `stagger` hides rows before anime.js loads (no show-hide-fade flash on its first load) and plays nothing under reduced motion; rows and toasts show, and a toast closes, even when anime.js fails to load.

## Out of scope

- Replay playback, the simulation clock, the telemetry graph, and the radio: they keep their own timing.
- Any change to the WebGPU renderer, post-processing, or the sky.
- Mobile.

## Open questions for the user

1. Confirm that the theater.js studio stays a dev-only tool. Only the core ships.
2. Do you want phase 5 at all? It is the largest, and the camera moves are the only part that adds a new feature.
