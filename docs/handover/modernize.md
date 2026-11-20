# Modernization handoff (cumulative)

Read this and `docs/modernize-plan.md` at the start of every session. Each phase appends its section at the end and
updates "Current state". This is the one handoff file for the whole plan.

## Current state

- Branch: `modernize` (from `improve-phase-8`, HEAD `fff158f`, 21 Nov 2026).
- Done: phase 1, phase 2, phase 3, phase 4 (21 Nov 2026).
- Next: **Phase 5** (TRAA trial). Start a new session and type: *"Do phase 5 of docs/modernize-plan.md."*
- Rule: after each phase, stop and wait for the user's go.

## Before phase 1: watch out

- The branch was created with **uncommitted changes from `improve-phase-8` already in the working tree**: `docs/architecture/3d-and-look.md`,
  `docs/architecture/frontend.md`, `src/static/{app,charts,ledgers,pace,palette,replay,scrubmarks,stream,tower,util}.js`,
  `src/static/index.html`, `src/static/style.css`, `tests/test_{live,marks,multiviewer,pace}.mjs`. They are not part of this
  plan. Ask the user whether to commit them first (on `improve-phase-8` or as the first commit here) before committing
  anything; never sweep them into a phase commit with `git add -A`.
- `docs/modernize-plan.md` and this file are not committed yet; phase 1 commits them with its own work.
- The memory `desktop-only-for-now` was narrowed on 21 Nov: a mobile *light tier* (phase 2) is now in scope; other mobile
  layout work still waits for the user.

## Decisions taken in the planning session (21 Nov 2026)

- The user asked to build every change the audit recommended, one phase per session, stopping after each.
- Device textures: "desktop with great resources gets everything best; mobile gets a light version" (the user said
  "slow"; read as light/low, confirm in phase 2 if unclear). Desktop high tier = Ultra, all 4k sets, 4k sky.
- KTX2 stays out on desktop (lossy). Mobile uses smaller JPEGs instead, so no new encoder toolchain.
- Electron, a Rust backend and a bundler stay rejected (see the plan's "Audit verdict").

## Template for each phase's section

```
## Phase N: <name> (date)
Commits: <hash> <subject>
Done: <what changed, with file:function>
Measured: <before -> after>
Tests: <suites run, new tests>
Not done or not verified, and why:
Watch out: <traps the next session needs>
Next: Phase N+1
```

## Phase 1: quick wins and baseline (21 Nov 2026)
Commits: see git log (phase 1 commit on `modernize`)
Done:
- `.python-version` = 3.14.
- `pyproject.toml`: direct `huggingface-hub` dropped; `uv.lock` still holds it through `onnx-asr[hub]`. Radio checked: a SAPI
  WAV ("Box box, box this lap for hard tyres.") through `radio.transcribe` came back word for word.
- `jsconfig.json` (`checkJs: false`, `noEmit`, `strict: false`, `files` = the five modules) + `// @ts-check` on `util.js`,
  `sim.js`, `vehicle.js`, `share.js`, `palette.js`. Fixes, all JSDoc or casts, no behaviour change: `palette.js` SHORTCUTS
  type and the search input cast; `share.js` `clean` param type and `String()` for the `t` param; `sim.js` thermal window as a
  `[number, number]` tuple; `util.js` `globalPrivacyControl` through `any`.
- CI (`.github/workflows/test.yml`) and `scripts/test_all.py` run `npx -y -p typescript@7.0.2 tsc -p jsconfig.json`;
  test_all skips with a notice when `npx` is missing.
- `docs/improvement-plan.md` phase 9 notes the overlap.
Measured (RTX 4080 laptop, user's dev server on 8086, agent-browser headed 2040x1000):
| Measure | Value |
|---|---|
| `#2026/1/results` cold (8 s after open) | 173 requests, 23.1 MB transferred, 26.6 MB decoded (5.5 MB JS), load event 1724 ms; 184 requests by 25 s |
| `#2026/1/results` warm (reload) | 173 requests, 0.06 MB transferred, load event 413 ms |
| `#2026/1/replay` Ultra (default preset), 40 s after open | 239 fps (rAF, likely the 240 Hz panel cap), 228 resources / 159 MB decoded, GPU memory 3951 -> 5272 MiB system-wide (+1.3 GB; the results page was already open), no window errors |
| Requests per minute per idle tab | 1 (`/api/live/status`, `app.js` `checkLive` every 60 s). During a live session `replaylive.js` polls `/api/live` 1 s after each answer: up to 60/min (from the code; no live session to measure) |
Tests: `scripts/test_all.py` all green, tsc included.
Not done or not verified, and why: the live-session request count is read from the code, not measured (no session live).
Watch out:
- Resource Timing's buffer (250) fills on the replay page: call `performance.setResourceTimingBufferSize(10000)` before counting.
- A long `agent-browser eval` (60 s promise) times out the daemon at ~30 s: set a marker, sleep in the script, read again.
- `checkJs` stays false: only files with `// @ts-check` are checked; imported modules are typed from their JSDoc but not
  reported. Modules importing `three` stay unchecked (no types for the import map).
Next: Phase 2

## Phase 2: device tiers: desktop best, mobile light (21 Nov 2026)
Commits: see git log (phase 2 commit on `modernize`)
Done:
- `graphics.js` `deviceTier(gpu, env)` (pure): `?tier=desktop|mobile|software` forces one; a software renderer name gives
  `software`; `userAgentData.mobile`, a coarse pointer with a screen under 768 px, or `deviceMemory <= 4` give `mobile`;
  else `desktop`. `defaultsFor(tier)`: the Low preset on mobile, Ultra elsewhere; `clean`/`loadGraphics` take that base.
- `scene3d.js`: `export let tier` (module load: no GPU name; `init3d` adds it from `probeGpu`, which now returns the name);
  `high = tier === 'desktop'` (so a phone no longer supersamples and gets the near car LOD and the 4096 satellite ground);
  `loadPhotos` loads 4k on desktop at any preset (was: only Ultra/Custom), 1k otherwise (software was 2k/1k); the sky
  streams 1k first on mobile, local 4k first elsewhere. Settings' Reset uses `defaultsFor(tier)`.
- `textures3d.js`: `photo` lost its per-set `low` arg; `load(res)` takes '4k' or '1k'.
- `assets.py` `_heavy`: **bug fixed**: its regex only matched the gravel line, so Download assets listed gravel at 2k/1k
  and never the 4k sets the desktop loads (asphalt, grass, gravel 4k were on this machine from an earlier fetch). Now every
  `photo('...')` set at 4k and 1k. 2k is no longer used or downloaded (old 2k folders can be deleted by hand).
Measured (agent-browser headed, `#2026/1/replay`, 40 s after open, no window errors in either):
| Tier | Sky | Photo sets | Preset |
|---|---|---|---|
| desktop (2040x1000) | local 4k | all nine maps 4k | Ultra |
| `?tier=mobile` (Pixel 7 emulation) | streamed 1k | all nine maps 1k (asphalt/grass 1k from the CDN: not downloaded here yet) | Low |
Tests: `tests/test_graphics.mjs` (tier rule with fake navigator/screen/pointer, override, mobile defaults);
`tests/test_server.py` asserts every set at 4k and 1k in `_heavy`. `scripts/test_all.py` all green, tsc included.
Not done or not verified, and why:
- Desktop before/after screenshots and GPU memory not taken: at Ultra on desktop the code path is unchanged (4k photos, 4k sky,
  `high` true). Desktop on High/Medium/Low now also gets 4k photos (more GPU memory there, ~+0.5 GB vs 2k, arithmetic).
- No real phone tested. agent-browser `set device` emulates size and UA only (no coarse pointer, no `userAgentData.mobile`),
  so the natural detection stayed desktop there; the mobile check used `?tier=mobile`.
- Mobile numbers (Low preset, 1k) are the plan's; not tuned by measuring a phone.
Watch out:
- `deviceMemory <= 4` also puts a 4 GB desktop on the mobile tier (as planned).
- The tier is read on every load; a stored `lo-graphics` still wins over the tier's defaults.
Next: Phase 3

## Phase 3: load the 3D stage and Stream on demand (21 Nov 2026)
Commits: see git log (phase 3 commit on `modernize`)
Done:
- `app.js` has no static import of `replay.js`, `globe.js` or `carsdeck.js` any more (all three reach three.js). `loadStage()`
  (one promise: `import('./replay.js')`, `setupReplay`, then the staged race and its session list) runs from `activate('replay')`
  and `setSection('analytics')` while the replay tab is active (covers Play, the replay tab, deep links to it, live),
  from `loadGlobe()` (the globe shares the stage's renderer, so the stage loads first, as before), and from palette stage commands.
- `selectRace` calls `stageRace(...)` instead of `showRace`: it records the race and shows it only if the stage is up; the
  stage shows it when it loads. `A.shown` is gone: `shown()` loads the stage and resolves with `showRace`'s promise.
  `moment()`/`ended()` read `{}`/false with no stage. `globeOpen()` is true from `showGlobe` until the globe module answers,
  so a bare address isn't rewritten to a race hash while the globe loads.
- `replayKind`/`REPLAY_KINDS` moved from `replay.js` to `util.js` (the race list tags races without the stage).
- Stream: shaka was already on demand (`multiviewer.js` `loadShaka` injects the script on first play); `stream.js` and
  `multiviewer.js` are plain JS with no three, so they stay static. #stream now loads no 3D at all.
Measured (agent-browser headed 2040x1000, user's dev server, fresh session, 8 s after open):
| `#2026/1/results` cold | Phase 1 | Phase 3 |
|---|---|---|
| Requests | 173 | 97 |
| Decoded | 26.6 MB (5.5 MB JS) | 0.89 MB (0.41 MB JS) |
| Transferred | 23.1 MB | 0.59 MB |
| Load event | 1724 ms | 303 ms |
| Stage/textures fetched | yes | none |
First click on the Replay tab from Results (rAF gaps over 15 s): HEAD worst 3758 ms, 4 frames over 50 ms; phase 3 worst
3183 ms, 14 frames over 50 ms (the extra ones are 300-560 ms: compiling the stage's JS, which HEAD did at page load).
Results page itself: no frame over 50 ms in either.
Checked with a window error listener, no errors: Results link (no stage), Replay tab click (race shown, Press ▶ hint), #stream
cold (132 cards, no stage), bare address (globe, 23 pins, address stays bare), globe pin → ▶ Play (replay playing),
`#2026/1/drivers?career=max_verstappen` (career open, no stage), `#2026/1/replay?car=2022` (showroom on RB18 2022, 3 of 4 runs),
`#2026/1/replay?t=1200&focus=VER` (session list filled), and in a running tab `#stream`, `#2026/1/strategy`, `#2026/1/sim`.
Tests: new `tests/test_app.mjs` (app.js's static import graph reaches no three.js module, nor replay.js/scene3d.js; replayKind
cases). `scripts/test_all.py` all green, tsc included.
Not done or not verified, and why:
- One run of the car link opened the showroom on 2024 (MCL38) instead of 2022; four other runs (one traced) opened 2022 and
  HEAD opened 2022. Not reproduced; watch for it.
- The Live button path (`onStage(R => R.showLive())`) not exercised: no session live.
- `docs/architecture/frontend.md` not updated (phase 6 does the docs).
Watch out:
- Anything new in `app.js` that touches the stage goes through `R` (null until loaded), `onStage(f)` or `shown()`; a static
  import of a three-reaching module fails `tests/test_app.mjs`.
- Option if the extra mid-size hitches on the first Replay click matter: prefetch `import('./replay.js')` in idle time once
  a non-replay tab has drawn (costs the ~5 MB JS again, not the textures, which `setupReplay` starts).
Next: Phase 4

## Phase 4: live feed as a push stream (SSE) (21 Nov 2026)
Commits: see git log (phase 4 commit on `modernize`)
Done:
- `server.py`: `GET /api/live/stream` (`live_stream` → `live_events`): a `StreamingResponse` of `text/event-stream`. It
  checks `live.snapshot` every 0.5 s and sends one `data:` event when the shared copy changed (identity of `topics`: a new
  copy per feed message) or connected/error/auth changed, so a burst of feed messages is one event; a `: keep-alive`
  comment after 15 quiet s. Starlette cancels it when the client goes. Each check refreshes `last_request`, so the feed
  stays open while someone listens. `/api/live` stays (first state, explorer, fallback).
- Token: `POST /api/live/ticket` (X-F1-Token → `{ticket}`, `secrets.token_urlsafe`, 30 s, single use, memory only in
  `_tickets`); the stream takes `?ticket=`. The token is never in a URL; the access log shows only the spent ticket.
- `server.py` `__main__`: `timeout_graceful_shutdown=2`, else an open stream holds Ctrl+C. desktop.py's server is a daemon thread.
- `live.js` `streamLive(onData, onFail)`: asks a ticket only with a token, opens `EventSource`, on error closes it and calls
  onFail once. `replaylive.js` `showLive`: `follow()` opens the stream while the tab is visible and closes it when hidden
  (as the old poll skipped hidden tabs) or when the view's token changes (rAF loop); on a stream error it falls back to the
  old 1 s `poll()` for the rest of that live view.
- Fixture `tests/fixtures/live.jsonl` (subscribe reply + two LapCount updates).
Measured: live view against the fixture (server on 8099 with `LIGHTSOUT_LIVE_PLAY`, agent-browser headed, window error
listener): one `/api/live` (first state) + one `/api/live/stream`, no further requests over 20 s (was 1 per second per tab);
"● LIVE · Test GP · Race", no errors. curl: events stream unbuffered, not gzipped (Starlette excludes text/event-stream).
Tests: `tests/test_server.py` plays the fixture through `snapshot`'s thread (`LIGHTSOUT_LIVE_PLAY`) and reads
`live_events` directly: laps 1, 2, 3 in order, none repeated, a keep-alive seen; ticket issue/expiry. `tests/test_live.mjs`:
`streamLive` parses events, closes and fails over once, puts the ticket in the URL only when a token exists.
`scripts/test_all.py` all green, tsc included; `trail check` no conflicts.
Not done or not verified, and why:
- No real live session or full recording (no `.cache/live` on this machine): the tower/cars comparison against polling used a
  three-message fixture (one driver, no TimingData/GPS). Record a weekend with `LIGHTSOUT_LIVE_RECORD=1` and replay it to compare.
- The fallback poll and the hide/show close/reopen were not exercised in the browser (unit-tested for the error path only).
- The ticket route's single use is tested by the dict pop, not by two stream requests (TestClient can't end an endless stream).
Watch out:
- TestClient buffers whole responses, so it hangs on `/api/live/stream`: test `live_events` directly.
- Each open stream copies nothing extra (`_shared`), but serializes the whole snapshot per event (≤ 2 a second).
Next: Phase 5
