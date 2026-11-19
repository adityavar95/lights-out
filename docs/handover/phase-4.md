# Handover after phase 4 (19 Nov 2026)

Branch / commits: `graphics-perf-phase-4`, made from `graphics-perf-phase-3` (not pushed, not merged): one commit for
phase 4 on top of phase 3's.

Done:
10. **Instanced crowd in the stands** (`src/static/trackside.js` L182-L203, added to `standMeshes` at L225): each seat
    (every 55 cm, 18 rows) gets a seated body box and a head box. A fifth of the seats are empty and there is an aisle
    every 11 m, so about 1150 people per stand. One stand's people are one merged geometry (~28k triangles), instanced at
    every stand like the stand and roof, so the whole crowd is **one draw call in the main pass and none in the
    shadows** (`shadow: false`; the roof's shadow still falls on them). `clearOf` (pit lane) and Settings' trackside
    toggle cover it because it is in `standMeshes` / `side.meshes`. Shirts come from a mostly dark, white and grey palette
    with muted team and flag colours. A fully saturated palette looked like confetti from the T-cam. The painted
    treads (the old shader crowd) stay under the people and fill the gaps.
11. **Trees** (`src/static/circuit3d.js` `broadleaf` L643; atlas `src/static/textures3d.js` `lush` L123-L143): a
    broadleaf crown is now 20 clumps of three crossed cards (same 60 cards, same triangles, same draw calls) in the
    crown's outer shell. Before, it was 60 cards at random angles, which made one even ball. The atlas's leaf cluster is
    now seven lobes with gaps between them, each with a dark core and a lit upper side, instead of one round disc. From
    the helicopter the crowns now read as clumps of light and shade with a broken outline. The wind sway
    (`crownMat.positionNode`) and the conifer, palm and arid trees are unchanged. Brazil is a broadleaf circuit.

Measured after (Brazil 2026 race, playing, RTX 4080 Laptop, Ultra, agent-browser headed 2040x1000, fast mode). A/B in
one browser run with the original three files swapped in and out on disk and a reload each time. Each reload resumed at
the same race moment (0:01:27, the start), so the frames are the same. Draw calls are `renderer.info.render.drawCalls`
per frame (all passes, shadows included). People/crowns/shadow draws were counted by wrapping `renderer.renderObject`
and tagging each call by camera (orthographic = shadow) and material.

| Run | Chase fps / draw / GPU / calls | T-cam fps / draw / GPU / calls | Helicopter fps / draw / GPU / calls (width) |
|---|---|---|---|
| after | 88 / 5.7 / 4.3 ms / 478 | 90 / 6.1 / 5.6 ms / 514 | 108 / 4.2 / 4.8 ms / 313 (3038) |
| before | 88 / 6.1 / 4.3 ms / 477 | 87 / 6.0 / 5.6 ms / 515 | 103 / 4.6 / 7.6 ms / 312 (3494) |
| after again | 90 / 5.7 / 4.4 ms / 478 | 88 / 5.9 / 6.1 ms / 519 | 104 / 4.0 / 7.6 ms / 313 (3458) |

Per-frame tally in all three cameras: `main:people` 1 (new), shadow people 0. Crowns: 2 main and ~5.5 shadow draws,
the same before and after. Triangles +0.39 M a frame (11.32 M vs 10.93 M in chase). fps, main-thread draw and GPU did
not change. The helicopter's GPU follows the governor's canvas width. Canvas widths in chase and T-cam were 3038 in all
runs. Screenshots are in the session notes folder `phase-4-screens/`: `ab-before-cam{2,4,5}` vs `ab-after2-cam{2,4,5}`
(same moment), plus `after2-cam4` and `after-straight-cam{2,4}` (crowd from T-cam and chase). Tests:
`scripts/test_all.py` all pass. No uncaught errors (window `error` listener).

Not done or not verified, and why:
- The crowd has no LOD. Each visible stand draws all its people even when far away. 0.39 M triangles cost nothing
  measurable on the 4080, but a weak GPU was not measured.
- People don't move (no wave or arm motion): that would mean per-vertex animation, which the task didn't ask for.
- Conifer and palm crowns are unchanged. Their sprays are already per branch, and only broadleaf looked like a blob.
- Not checked: night (the people are lit like everything else), wet, the low tier, other circuits' stands.
- `trail check` flags `textures3d.js:43`, which is phase 1's photo-loading change. The rule behind it is a general
  skill about placeholder images, so it doesn't apply here.

Watch out:
- Reloading in agent-browser resumed the replay at a saved race moment every time, which made same-frame A/B possible.
  Note the time (`/\d:\d\d:\d\d \//` in `innerText`) before comparing.
- `renderer.info` resets per render call. Set `info.autoReset = false` and reset once per rAF to get a frame's total.
  A paused stage draws 4 frames a second, so drop the zero frames.
- `broadleaf()` now draws fewer numbers from the seeded `rand()`. Tree placement re-seeds (`seed = 7`) after building
  the geometry, so the trees stand where they did.

Next: phase 5 (untested areas), start with item 12 (measure and screenshot Play, Stream, a night race and a wet race).
