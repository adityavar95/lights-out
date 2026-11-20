# Modernization plan: device tiers, on-demand loading, live push, type checks (21 Nov 2026)

Source: the read-only stack audit of 21 Nov 2026 (summary under "Audit verdict" below). The user asked to build every
recommended change, plus device-aware textures: **a strong desktop gets the best of everything, a phone gets a light
version**. One phase per session; the handoff doc carries state between sessions.

## Status

- [x] Phase 1: quick wins and baseline
- [x] Phase 2: device tiers (desktop best, mobile light)
- [x] Phase 3: load the 3D stage and Stream on demand
- [x] Phase 4: live feed as a push stream (SSE)
- [x] Phase 5: TRAA trial (ships only if the picture doesn't get worse)
- [x] Phase 6: wrap-up: docs, exe build, full check

Handoff (single, cumulative): `docs/handover/modernize.md`.

## How this plan runs

- Branch: `modernize`, made 21 Nov 2026 from `improve-phase-8` (HEAD `fff158f`). All phases work on it.
- **One phase per session.** Start by reading this file and `docs/handover/modernize.md`. Do only the next unticked
  phase. To start, the user types: *"Do phase N of docs/modernize-plan.md."*
- **End of a phase:** run `.venv/Scripts/python scripts/test_all.py` and `trail check`; append the phase's section to
  `docs/handover/modernize.md` and update its "Current state" block; tick Status here; commit on `modernize` (only the
  files the phase touched); then **stop and wait for the user's go** before any next phase.
- Every bug fix or new logic leaves a test (`tests/test_server.py` asserts or `tests/test_<module>.mjs`). UI changes get a
  headed agent-browser check with a window `error` listener (agent-browser console misses uncaught exceptions).
- **No graphics quality loss on desktop** (owner's rule). The desktop high tier must look identical or better: take
  before/after screenshots at the same hash, camera and preset.
- Measure 3D in a foreground headed agent-browser window (2040x1000); hidden or background windows throttle rAF.

## Audit verdict (what this plan builds and what it doesn't)

Kept as they are: Python + FastAPI, three.js WebGPU + TSL, vanilla ES modules with no bundler, file cache, uv,
PyInstaller folder build, pywebview, shaka 4.12.6, Parakeet ONNX on CPU, `requests`.
Rejected: a Rust or WASM rewrite (tried on `dev`, no speed gain), React/Svelte, a bundler, httpx swap, Electron (only if
live F1 TV inside the desktop app becomes a must), KTX2 on desktop (lossy: breaks the quality rule).

---

## Phase 1: quick wins and baseline (S, ~half a day)

1. **Baseline** (record in the handoff, re-measured in phase 6):
   - `#2026/1/results` cold and warm: requests, MB transferred, JS decoded, load event (agent-browser headed,
     `performance.getEntriesByType('resource')`).
   - `#2026/1/replay`: GPU memory (`nvidia-smi`), fps on the Ultra preset.
   - `/api/live` request count per minute per tab (1 a second today, `src/static/live.js:17`).
2. **`.python-version`** at the repo root with `3.14` (CI already pins 3.14 in `.github/workflows/test.yml`).
3. **Drop the direct `huggingface-hub`** line from `pyproject.toml`: `onnx-asr[hub]` brings it (`src/radio.py:79`
   imports it). `uv lock`, then check `uv.lock` still holds huggingface-hub and the radio route still transcribes a clip.
4. **Type checks without a build step:** a `jsconfig.json` (`checkJs`, `noEmit`, `strict: false`) and `// @ts-check`
   at the top of modules that don't import three first: `util.js`, `sim.js`, `vehicle.js`, `share.js`, `palette.js`
   (check each one's imports). Fix what it finds or annotate with JSDoc. Add a CI step to `test.yml`
   (`npx -y -p typescript@<pinned> tsc -p jsconfig.json`) and a matching line in `scripts/test_all.py` that skips with
   a notice when `npx` is missing.
   - Watch out: three.js is served through the import map, with no types; modules importing `three` need a `paths`
     entry or a `declare module` stub. Leave them unchecked this phase rather than type-check three's own files.
   - Overlaps the open "Phase 9: code health and tests" of `docs/improvement-plan.md`; note it there.

Done when: baseline recorded, `tsc` passes in CI and locally, all suites green.

## Phase 2: device tiers: desktop best, mobile light (M, 1-2 days)

What exists: `scene3d.js` `probeGpu` only tells hardware from software rendering (`high`). `textures3d.js` `photo`
loads 4k on the high tier with Ultra, else 2k/1k, falling back to Poly Haven's 1k CDN. The sky is always 4k
(`scene3d.js:27`), streamed at 1k when not downloaded (`:28`). Presets: Ultra, High, Medium, Low (`graphics.js:6-10`).

1. **One tier decision**, in `scene3d.js` beside `probeGpu`: `desktop` (hardware GPU, not mobile), `mobile`
   (`navigator.userAgentData?.mobile`, or a coarse pointer with a small screen, or `navigator.deviceMemory <= 4`) and
   `software`. Export it; a `?tier=mobile` URL override for testing. Unit-test the rule with fake navigator values.
2. **Desktop gets the best of everything:** Ultra is the default preset there, every Poly Haven set at 4k (including
   gravel, today 2k on high: `textures3d.js:203`) and the 4k sky. Verify the downloaded asset list covers this
   (`src/assets.py` `_missing`, "photo sets at both tiers' resolutions").
3. **Mobile gets the light version:** Low preset by default (users can still raise it), 1k photo sets, a 1k or 2k sky
   (Poly Haven publishes them: add the 2k sky files to `assets.py` or stream 1k as today), no supersampling, lower
   `carDetail`, mirrors off. Pick the exact numbers by measuring on emulated mobile and, if the user has one, a real
   phone over `LIGHTSOUT_LAN=1`.
4. The texture memory saving on mobile comes from smaller JPEGs, not KTX2 (no new toolchain).
5. Update the memory `desktop-only-for-now` scope note if the user widens mobile work beyond this tier.

Checks: desktop screenshots before/after identical (same hash, camera, Ultra); mobile tier in agent-browser device
emulation loads only 1k textures (resource list) and renders without errors; GPU memory on desktop unchanged.

## Phase 3: load the 3D stage and Stream on demand (M, 2-3 days)

Today every tab pulls the whole 3D stage: no module uses `import()` and `app.js:5` imports `replay.js` statically, so
even Results fetches ~130 MB of textures and a 20 MB sky (`docs/tech-review-plan.md`).

1. Map every caller of `setupReplay` and the other `replay.js` exports used in `app.js` (`trail callers setupReplay
   --depth all`); the 13 Nov review counted about a dozen that assume the stage exists.
2. Put the 3D stage behind one `loadStage()` promise in `app.js` (`import('./replay.js')` then `setupReplay`), awaited by
   the replay tab, Play, live, the globe's enter and deep links. Same for `stream.js` / `multiviewer.js` (shaka).
3. The default tab (Race replay) still loads the stage at once, so the gain is for links straight to other tabs and for
   Stream; measure it rather than assume it.

Checks: `#2026/1/results` cold: requests and MB vs the phase 1 baseline; every tab, deep link (career, strategy plan,
showroom car), the globe and Play still work in a headed browser with the error listener; no first-frame hitch added
when entering the replay (compare frame times).

## Phase 4: live feed as a push stream (M, 1-2 days)

Today each tab polls `/api/live` every second (`src/static/live.js:17`, `src/server.py:530`); `live.snapshot` already
copies once per feed message (`src/live.py:236`).

1. `GET /api/live/stream` in `server.py`: Server-Sent Events through Starlette's `StreamingResponse`, one event per new
   `_version`, keep-alive comments every 15 s, ends when the client goes. Keep `/api/live` for tables and as fallback.
2. `live.js`: `EventSource` with the F1 TV token. EventSource can't send headers, so pass it some other way that the
   server still never stores or logs (e.g. a short-lived one-time ticket from a POST); don't put the token in the URL.
3. Fall back to the 1 s poll when the stream errors.
4. Test without a live weekend: a recorded `.jsonl` fixture played through `live._play`; a `tests/test_server.py` case
   reads the stream and sees events in order; a `tests/test_live.mjs` case for the client's parsing.

Checks: replaying the fixture in the page shows the same tower and cars as polling; request count drops to one stream.

## Phase 5: TRAA trial (M, 1 day; may end as "not shipped")

1. In `post.js`, a TRAA path beside MSAA + SMAA, behind a graphics setting, off by default.
2. Known risk: `post.js`'s velocity buffer is blended by alpha and the sky's vector is rebuilt from the camera, so expect
   ghosting on smoke and sky (`docs/tech-review-plan.md`).
3. Side-by-side screenshots in a foreground window: fences, kerbs, car edges, smoke, sky, at rest and at speed. **Ships as
   the Ultra default only if nothing looks worse**; otherwise leave it as an opt-in setting or remove it, and record why.

## Phase 6: wrap-up (S, half a day)

1. Re-measure the phase 1 baseline; put before/after in the handoff.
2. Update `docs/architecture/frontend.md`, `backend.md`, `3d-and-look.md`, `testing.md` and `CLAUDE.md` (tiers,
   `loadStage`, `/api/live/stream`, `tsc`).
3. Build the exe (`scripts/build_exe.py`) and smoke-test it: launch, replay, Stream, Download assets.
4. `scripts/test_all.py`, `trail check`; ask the user before any PR or merge into `master`.
