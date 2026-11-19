# Handover after phase 5 (19 Nov 2026)

Branch / commits: `graphics-perf-phase-5`, made from `graphics-perf-phase-4` (not pushed, not merged): one commit,
docs only (this file and the plan's new phases 6-7). No code changed, so `scripts/test_all.py` wasn't run.

Done:
12. **Measured and screenshotted Play, Stream, a night race and a wet race** (agent-browser `--session p5 --headed`,
    2040x1000). Brazil 2026's own race counts as a wet race: the field starts on intermediates, so `weather.js`
    `replayWeather` sets wetness 0.35 (no rain falling). The Simulation's Monsoon (pit wall weather, track-wetness
    slider at 100) is the heavy wet case. Findings are now plan phases 6 (Play's page cost) and 7 (wet ground), plus
    a "Needs the user" list and a "Found on the way" list in `docs/graphics-perf-review-plan.md`.

Measured after (Brazil 2026, RTX 4080 Laptop, Ultra, Auto resolution). Draw calls are per frame, all passes, median.
Cameras by key in the replay: 1 Free Orbit, 2 TV Chase, 3 Cockpit, 4 T-Cam, 5 Helicopter.

| Run | Free Orbit | TV Chase | Cockpit | T-Cam | Helicopter |
|---|---|---|---|---|---|
| Replay, day (fps / p95 / draw / GPU / width / calls) | 95 / 12.6 / 3.6 / 4.8 / 3370 / 367 | 99 / 12.6 / 4.0 / 6.6 / 3370 / 346 | 74 / 16.7 / 5.7 / 4.1 / 2477 / 672 | 108 / 12.6 / 4.9 / 4.4 / 2849 / 275 | 110 / 12.6 / 3.4 / 3.8 / 2827 / 276 |
| Replay, Night sky | 89 / 12.6 / 3.8 / 5.0 / 3494 / 342 | 98 / 12.6 / 6.8 / 6.2 / 3494 / 287 | 93 / 16.6 / 5.0 / 8.0 / 3010 / 306 | 111 / 12.5 / 3.6 / 5.4 / 2980 / 284 | 117 / 12.5 / 3.3 / 4.8 / 2980 / 277 |
| Play, spectating (AI field) | 59 / 20.9 / 3.7 / 4.4 / 2947 / 338 | 64 / 16.8 / 3.7 / 4.4 / 2947 / 251 | 61 / 20.8 / 5.6 / 5.1 / 2540 / 349 | 68 / 16.7 / 5.4 / 4.1 / 2540 / 241 | 67 / 16.8 / 3.2 / 5.9 / 2921 / 197 |
| Play, driving ⚠ | — | 33 / 37.9 / 13.8 / 4.4 / 2229 / 348 | 36 / 37.6 / 10.2 / 3.4 / 2229 / 348 | 42 / 37.0 / 7.2 / 4.5 / 2563 / 219 | 44 / 25.7 / 4.8 / 5.2 / 2948 / 138 |
| Simulation, Monsoon ⚠ | 34 / 33.7 / 8.0 / 4.3 / 2841 / 338 | 39 / 41.5 / 8.1 / 4.7 / 2470 / 248 | 36 / 34.6 / 9.7 / 5.8 / 2841 / 324 | 38 / 37.7 / 6.4 / 5.6 / 2841 / 216 | 35 / 41.6 / 8.2 / 6.2 / 2841 / 262 |
| Stream | the 3D stage stops (0 frames). Scrolling the page: main thread ~17 % busy, 27 layouts in 3 s, no long frames | | | | |

⚠ Not comparable. Around then, a second agent-browser session (`p2`, a visible copy of the app playing the Brazil
replay, left by the phase-2 session) shared the GPU, which was at 82 °C. The control shows it: the replay itself
then ran at 33-50 fps (TV Chase 33, Helicopter 50) where it had run at 98-117. Monsoon with the weather set back to
Clear gave the same 35 fps, so rain doesn't cost these frames. The day, night and Play-spectating rows came first and
match phase 4's numbers, so they are taken as clean, but that isn't proven.

What the pictures show (screens in the session notes folder `phase-5-screens/`):
- **Night** (`night-cam*`, `night-look-*`, `crowd-night-crops.png`): no fps cost. Trees read well, with lit tops and
  dark undersides. The satellite photo keeps its daylight (bare soil ~100/255 beside a ~30/255 track). The instanced
  crowd is evenly lit and fully saturated across a whole stand, also away from the floodlights. The floodlight beams
  are flat see-through wedges that cut through stands and roofs. The Night HDRI is a rocky desert hillside.
- **Wet** (`day-cam*` at wetness 0.35, `monsoon-*`): the track darkens and reflects (strongly at night). The verge
  and the satellite ground don't change at all: dry, sunlit green under a monsoon sky. Rain streaks and spray draw.
- **Play** (`play-spectate-*`, `play-drive-*`, `monsoon-*`): picture as in the replay. A trace (Play spectating)
  showed the main thread 84 % busy, ~7 ms in rAF plus ~4-5 ms of layout, style, paint and raster that `frameStats`
  doesn't count. The cockpit's mirrors still double the draw calls once warm (672 in the replay's cockpit, day).
- **Stream** (`stream-top.png`, `stream-scrolled.png`): fine. The F1 TV viewer itself wasn't opened (no F1 TV
  connection in agent-browser).

Not done or not verified, and why:
- **No clean lap driven in Play.** Steering can't be scripted from outside the page, so "driving" means holding W
  (synthetic `keydown` on window) for ~25 s with the player's car (MANUAL DRIVE confirmed). The car runs off at
  Turn 1. Physics and the frame are the same as on track, but the camera's view isn't.
- Play-driving and Monsoon fps were taken under GPU sharing (above). Plan phase 6 item 13 re-takes them.
- I couldn't close `p2`: the auto-mode classifier refused (it isn't this session's browser). It may still be running.
- Only Brazil. A real night race (Singapore, Las Vegas) wasn't loaded, to spare OpenF1 requests. Night here is
  Settings' sky = Night on Brazil.

Watch out:
- **Check for other agent-browser sessions before measuring**: `agent-browser session list`. A visible one running
  the app halves the fps. Close it, or ask the user to.
- In Play, keys 1-5 and C take the car away from the player (see the plan's "Found on the way"). Pick cameras by
  clicking the deck menu's buttons: `[...document.querySelectorAll('button[aria-pressed]')].find(b => b.textContent.trim() === 'Cockpit').click()`.
  The menu has six: Free Orbit, TV Chase, Chase, Cockpit, T-Cam, Helicopter.
- After leaving Play mid-drive, the replay has no ▶ (`.mapwrap.driving` stays). Remove the class or reload.
- A replay link `#2026/20/replay?t=100` seeks there. Setting the sky: `(await import('/static/scene3d.js')).setGraphics({sky: 3})`
  (`'auto'` to undo; it persists in localStorage).
- To find a page's per-frame DOM writers, a 1 s `MutationObserver` over `document.body` counting `type + attribute +
  target path` works. Same-value `setAttribute` calls show up too.
- `agent-browser trace start` / `trace stop file.json` gives a Chrome trace (~200 MB for 4 s). Sum `dur` of `X`
  events per thread from `thread_name` metadata. `CrRendererMain`'s `Layout`, `Paint` and `UpdateLayoutTree` are
  the page's cost outside rAF.

Next: phase 6, start with item 13 (re-take Play driving, Play spectating and Monsoon with nothing else on the GPU).
