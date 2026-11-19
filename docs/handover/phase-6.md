# Handover after phase 6 (19 Nov 2026)

Branch / commits: `graphics-perf-phase-6`, made from `graphics-perf-phase-5` (not pushed, not merged): one commit.
`scripts/test_all.py` passes.

Done:
13. **Re-took Play spectating, Play driving and the Simulation in Monsoon** with nothing else on the GPU
    (`agent-browser session list` empty, only `p6`). Every run got a fresh browser, and the window was brought to the
    front first. Before and after were run back to back for each row: the four changed files were swapped for their
    `HEAD` copies for "before". Table below.
14. **Per-frame DOM writes only when something changed.** `util.js:50-51` adds `setAttr` / `setText`, which compare
    before they write. A same-value `setAttribute`, `dataset`, `title` or `textContent` write still fires a mutation
    and dirties style and layout. They are used in `driverdeck.js` (`updateDriverDeck`, plus `setStatus`, which
    rebuilds the status lights only when one changes), `pitwall.js` (`updatePitwall`; `banner` and the panel's
    `hidden` are guarded), `hud.js` (`renderFocus`: `who` is rebuilt only when driver, position or headshot change;
    radar dots and ring; guarded `hidden`) and `tower.js` (`renderTower`'s row attributes and texts).
    Measured in Play spectating, TV Chase:
    - Mutations: ~16,000 a second before, ~5,500 after. Most of what's left is the radar's 22 dots moving (`cx`/`cy`
      every frame, real changes) and the CSS2D tags' `style`.
    - Layout per drawn frame (Chrome trace): 1.07 ms before (115 of 1,105 objects dirty), 0.50 ms after (~50 dirty).
    - Style recalculation: 0.68 ms before, 0.58 ms after.
15. **`frameStats().rest`** (`scene3d.js:266`, `:342-345`): the frame-to-frame time of frames drawn back to back,
    less the timed parts. It covers the page's layout, style and paint plus vsync or GPU waits. It isn't in `stats`,
    so the resolution governor's `busy` sum is unchanged. Settings' fps counter and the Section 4 snippet show it.
    Docs: `3d-and-look.md` frame budget, plan Section 4.

Measured after (Brazil 2026, RTX 4080 Laptop, Ultra, Auto resolution, 2040x1000). fps / p95 ms / draw ms / GPU ms /
rest ms / width. Before → after for each Play row; driving has no Free Orbit (it hands the car to the AI).

| Run | Free Orbit | TV Chase | Cockpit | T-Cam | Helicopter |
|---|---|---|---|---|---|
| Replay (reference, old files) | 102 / 12.6 / 3.5 / 5.3 / 5.5 / 3494 | 109 / 12.6 / 3.9 / 5.5 / 3.0 / 3006 | 109 / 12.6 / 5.3 / 5.7 / 2.6 / 2592 | 108 / 12.6 / 4.1 / 6.8 / 3.5 / 2981 | 132 / 8.5 / 3.1 / 4.1 / 2.8 / 2981 |
| Play spectating, before | 92 / 12.6 / 3.3 / 5.3 / 6.9 | 104 / 12.6 / 3.2 / 5.7 / 4.7 | 99 / 12.6 / 5.2 / 4.4 / 4.6 | 114 / 12.5 / 3.4 / 5.5 / 3.8 | 107 / 12.6 / 3.2 / 5.5 / 4.5 |
| Play spectating, after | 93 / 12.6 / 3.2 / 5.1 / 6.1 / 3063 | 109 / 12.6 / 3.6 / 5.8 / 3.9 / 2634 | 109 / 12.5 / 5.3 / 4.2 / 2.8 / 2272 | 120 / 12.4 / 3.6 / 6.2 / 3.1 / 2613 | 114 / 12.5 / 3.3 / 5.2 / 3.8 / 3005 |
| Play spectating, after (2nd run) | 83 / 16.6 | 117 / 12.5 | 106 / 12.6 | 118 / 12.5 | 113 / 12.5 |
| Play driving, before | — | 69 / 16.7 / 4.2 / 5.9 / 7.2 | 47 / 25.0 / 9.9 / 5.7 / 8.1 | 51 / 25.0 / 4.8 / 3.1 / 9.1 | 73 / 16.7 / 2.7 / 3.9 / 8.0 |
| Play driving, after | — | 75 / 16.7 / 4.3 / 6.0 / 5.9 / 2663 | 50 / 25.0 / 9.9 / 5.8 / 7.2 / 2663 | 65 / 16.8 / 5.9 / 4.2 / 6.6 / 2663 | 84 / 12.6 / 2.8 / 6.1 / 6.4 / 3063 |
| Monsoon, before | 81 / 16.7 / 3.7 / 5.3 / 6.7 | 95 / 12.6 / 4.7 / 6.3 / 3.9 | 91 / 12.6 / 6.1 / 5.3 / 3.1 | 98 / 12.6 / 4.3 / 5.0 / 3.6 | 103 / 12.6 / 3.3 / 6.4 / 4.8 |
| Monsoon, after | 85 / 12.6 / 3.5 / 5.3 / 6.6 / 3063 | 101 / 12.6 / 4.5 / 6.3 / 3.1 / 2647 | 101 / 12.6 / 6.3 / 5.7 / 2.3 / 2647 | 115 / 12.5 / 3.9 / 4.8 / 4.3 / 2647 | 115 / 12.5 / 3.4 / 4.3 / 4.1 / 2647 |

Phase 5's Play numbers (59-68 fps spectating, 33-44 driving, 34-39 Monsoon) were mostly not Play's own cost. Phase
5's GPU sharing and, as found here, the CPU losing its boost (see Watch out) explain most of the gap. Clean, Play
spectating was already within ~10 % of the replay before this phase. After it: TV Chase, Cockpit and T-Cam are level
with the replay or above it. Free Orbit is 93 vs 102 (−9 %; 83 on a second run). Helicopter is 114 vs 132 (−14 %),
but the replay's Helicopter alone read 111-132 across this session's clean runs.

Not done or not verified, and why:
- **Item 14's "within 10 % in every camera" isn't proven for Free Orbit and Helicopter.** The run-to-run spread is
  ±10 % in those two, the same size as the gap. Layout is 0.50 ms a frame, right at the 0.5 ms goal.
- **What's left of layout:** hiding the radar's SVG dropped it to 0.40 ms. `contain: strict` on `.radar` and the
  g-force SVG changed nothing (no relayout boundary), so it wasn't kept. `replay.js` still writes the clock, lap
  count, flag pill and `.startlights` `hidden` every frame (~100 a second each). Those are outside this phase's four
  files, cheap, and the replay pays for them too.
- **Driving is still the heaviest Play state** (cockpit 50 fps: draw 9.9 ms with the mirrors; page 1.6 ms against
  0.8 when spectating, from `pollInput`, the ribbon and the player's HUD). Driving still means holding W (synthetic
  keydown) and running off at Turn 1, as in phase 5.
- No new test: `setAttr` / `setText` are one comparison each. The changed panels were checked by eye only through
  the counters (no visual change is expected: same values, fewer writes). No uncaught errors (window `error`
  listener).

Watch out:
- **The laptop's CPU stops boosting on and off.** `\Processor Information(_Total)\% Processor Performance` reads
  ~130-175 % under load when clean and ~85-90 % when throttled (GPU at ~80-87 °C, on AC). Then every main-thread
  part (draw, page, tags) takes 3-4x as long, and the replay drops from ~110 to 20-35 fps. This happened twice this
  session, once mid-run. Check the counter before each run, and re-take any row whose `draw` jumps over ~6 ms
  outside the cockpit. Now in plan Section 4.
- Reloading the page many times in one agent-browser session seemed to slow it too. A fresh `open` per run is
  cleaner. The `.js` files are served `no-cache`, so swapping files between runs works.
- `document.hasFocus()` reads false in agent-browser even when its window is in front and fast, so it says nothing.
  Bringing the window to front: Win32 `SetForegroundWindow` after an Alt tap.
- An `eval` over ~45 s times out the agent-browser daemon. Store the result on `window` and read it later.
- The scripts are in the session notes folder `phase-6-scripts/`: `run.js` measures one mode in five cameras,
  `go.sh` runs one mode in a fresh browser, `pair.sh` runs before/after pairs, `mo.js` counts mutations, `tr.py` /
  `lt.py` read a trace.

Next: phase 7, start with item 16 (wet verge and satellite ground).
