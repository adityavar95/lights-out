# Handover after phase 2 (19 Nov 2026)

Branch / commits: `graphics-perf-phase-2`, made from `graphics-perf-phase-1` (not pushed, not merged): one commit for
phase 2 on top of phase 1's commits.

Done:
5. **Past the satellite square** (`src/static/circuit3d.js` ground `colorNode` L240-L263): the farmland (crop cells
   and dark hedge lines) is gone. Past the image, each border pixel now runs outwards as a soft smear (`satBlur`
   L235: the same image sampled clamped at mip `satLod`, set in `satellite()` L580 so the image is ~8 texels across).
   It turns into the image's mean colour, 20 % greyed, over 0.15 of the image's width (L250-L252). The band between
   the image and the land beyond went from 0.08 to 0.03 of the width (L247), because the smear starts out matching
   the image's edge. Seen at Brazil (city all round) and Silverstone (fields): no lines and no visible seam. A 16-texel
   smear left radial streaks at the horizon, hence 8.
6. **Grass verge** (`circuit3d.js` L293-L312): mowing stripes along the road, ~3 m passes at 0.84/1.08 brightness,
   faded to their mean where they get finer than a pixel (`fwidth`). The old ones were cross-wise at 0.9/1.08 and
   didn't show. The ground photo's normal map is now a detail normal (`verge.normalNode` L302; before, the verge had
   no relief). The green is less saturated (0.52, 0.56, 0.38). Over its outer half the verge blends into the satellite
   image under it (`vergeSat`, ragged with 4 m noise, L308-L309), so it no longer ends on a hard line.
7. **Satellite ground up close** (`circuit3d.js` L236-L238, L254-L262; mask texture built in `satellite()` L581-L583;
   `scene3d.js` `setGround` L779 now passes `g.mask`): the vegetation mask from `groundwork.js` (512 px, 1 = green)
   is now a GPU texture (`VEG` L128 is the all-green stand-in). On vegetation the detail is the grass tile's speckle,
   as before. Elsewhere it is the gravel photo's stones (its luminance over its own top-mip mean, 60 % strength). The
   ground photo's tuft normals are full strength on vegetation and half strength elsewhere (car parks and roofs no
   longer get grass relief).

Measured after (Brazil 2026 race, playing, RTX 4080 Laptop, Ultra, agent-browser headed 2040x1000). **The whole
session ran in the window's slow mode** (main-thread draw 7-17 ms; phase 1 measured 3.5-5.8 ms in a fast run), so
compare with phase 1's table only by ratio. Screenshots are in the session notes folder `phase-2-screens/`.

| Camera | fps | p95 | Frames > 17.5 ms | Main thread draw | GPU | Canvas width |
|---|---|---|---|---|---|---|
| Overview (1) | 49 | 27.5 ms | 64 % | 7.8 ms | 3.1 ms | 2509 |
| Chase (2) | 36 | 37.7 ms | 99 % | 14.5 ms | 3.6 ms | 2509 |
| Cockpit (3) | 30 | 41.7 ms | 100 % | 17.4 ms | 5.5 ms | 2885 |
| T-cam (4) | 48 | 29.4 ms | 67 % | 12.2 ms | 5.0 ms | 2885 |
| Helicopter (5) | 60 | 25.0 ms | 26 % | 7.8 ms | 4.8 ms | 3318 |

A/B in one browser run (Brazil; the original files were swapped in and out on disk, with a reload each time):

| Run | Overview fps / GPU | Chase fps / GPU (width) | Helicopter fps / GPU (width) |
|---|---|---|---|
| after | 56 / 3.2 ms | 42 / 5.3 ms (3014) | 48 / 4.1 ms (3014) |
| before | 55 / 3.3 ms | 40 / 3.8 ms (2620) | 50 / 4.0 ms (3014) |
| after again | 56 / 3.5 ms | 40 / 4.8 ms (2889) | 47 / 3.6 ms (2889) |

Same fps. GPU time follows the governor's canvas width, not the new shader. Silverstone helicopter: GPU 4.2 ms after,
4.1 ms before, at the same 2620 width. Tests: `scripts/test_all.py` all pass. No uncaught errors.

Not done or not verified, and why:
- **Fast-mode numbers.** The window stayed in its slow mode all session, through ~10 reloads. The fps column is
  limited by the main thread (CPU), which this phase didn't touch.
- **Item 7 is subtle in the helicopter.** The ground still looks soft there: the imagery is ~1 m a pixel, and the
  camera's motion blur (phase 3, item 8) smears it further while playing. The detail shows when paused and close.
  Stronger detail would fight the image's own content, so I left it.
- One hard line remains on Brazil's pit straight (outside of the main straight). It is in the satellite image itself:
  the real grass meets a grandstand roof there. The verge's blend reaches the image's colour before that line.
- Not checked: night, wet (wet only changes `roughness`, and the new `normalNode`s don't touch it), the low tier
  (gravel at 1k: its mip 12 clamps to the top level, which still works), a circuit with no satellite image (then
  `satOn` is 0 and the verge and ground shaders are as before, apart from the stripes and the verge normal).

Watch out:
- Strip UVs (`strip()` L61): u is across the strip in metres / tileM, v along it. The old verge stripes used v, so
  they ran across the road.
- `satellite()` reads `texture.image.width` before the upload: `onUpdate` closes the ImageBitmap, and after that its
  width reads 0.
- Each satellite-image swap must also set `satBlur` and `vergeSat` (the loop in `satellite()`), or they keep the
  coarse first image.
- Debugging a shader here: `scene3d.js` exports no scene handle. Swapping a node's output for a flat colour
  (`vec3(1, 0, 0)`) and reloading was the quickest check.

Next: phase 3 (camera look), start with item 8 (motion blur in chase).
