# Handover after phase 3 (19 Nov 2026)

Branch / commits: `graphics-perf-phase-3`, made from `graphics-perf-phase-2` (not pushed, not merged): one commit for
phase 3 on top of phase 2's.

Done:
8. **Chase motion blur** (`src/static/post.js` `MAX_BLUR`, L15-L17): the longest streak went from 0.035 to 0.015 of
   the screen. At 0.035 a streak was ~90 px at a 2500 px canvas, and the 16 taps sat ~5 px apart, so fences, barrier
   boards and stands turned into ghosted bands. At 0.015 they stay readable and the near ground and kerbs still streak.
   The cap only cuts vectors longer than 0.015, so slow motion (overview, helicopter, pans) blurs as before.
9. **Cockpit wheel patch** (`src/static/rb22.js` `TYRE_PIE` and `wheelDecals`): it was the dash texture, not motion
   vectors. The steering wheel's decal sheet (`sw_decals`) has a fully saturated "TYRE PHASE" rotary-switch pie, and the
   model stretches it over the whole plate behind the TYRE and STRAT knobs. Pausing left it in place (so not the blur),
   and painting the wheel body's own 256 px texture magenta (`redbull_steeringwheel`) hit only the buttons and knob
   rings. The pie is now redrawn at 20 % saturation and 55 % brightness: its wedge lines and text stay, the rainbow goes.

Measured after (Brazil 2026 race, playing, RTX 4080 Laptop, Ultra, agent-browser headed 2040x1000, fast mode). A/B in
one browser run, the original two files swapped in and out on disk with a reload each time:

| Run | Chase fps / draw / GPU (width) | Cockpit fps / draw / GPU (width) |
|---|---|---|
| after | 101 / 4.1 / 7.1 ms (3466) | 79 / 7.3 / 5.6 ms (2980) |
| before | 108 / 3.8 / 5.8 ms (3242) | 82 / 7.0 / 4.9 ms (2784) |
| after again | 109 / 4.0 / 5.3 ms (3187) | 83 / 7.0 / 5.2 ms (2760) |

Same frames; GPU follows the governor's canvas width (the change costs nothing: one constant and one texture redraw at
load). Screenshots (same race moment, 0:02:10, ANT) are in the session notes folder `phase-3-screens/`
(`before-cam2` vs `after2-cam2`, `wheel-ab.png` before | after). Tests: `scripts/test_all.py` all pass.

Not done or not verified, and why:
- T-cam, overview and helicopter were not re-screenshotted; they only lose streaks longer than 0.015 of the screen,
  which in phase 2's screenshots only the chase and cockpit near ground reached.
- Not checked: Play (driving) at full speed, night, wet.

Watch out:
- `agent-browser open` on the URL already open (same hash) does not reload the page: the old modules keep running.
  Use `agent-browser eval "location.reload()"`. After a reload, the replay needs "Play replay" and then the ▶ in the
  bar (a real mouse click at ~148,921 in a 2040x1000 window).
- The car model (`rb22.glb`) only loads once the replay plays, so `bake` / `wheelDecals` changes show only then.
- Painting a texture region magenta and reloading quickly shows which material a patch is on.

Next: phase 4 (trackside life), start with item 10 (instanced crowd in the stands).
