# 3D graphics: steady 60 fps and a better picture (plan, Nov 2026)

Phase 1 is built, Phase 2 partly; phases 3 and 4 are not. Phase 1 came first because every later phase adds cost.

## 1. Measured (13 Nov 2026)

Play, Melbourne 2026, 22 cars, spectating, 1212x860 canvas at resolution 1, RTX 4080 Laptop, Chromium via agent-browser.

- Chase camera at the start, default settings (Ultra, auto resolution, 1940x1376): 51 fps, median frame 16.9 ms, p95 29 ms.
- The same settings swing between 23 and 75 fps through a lap. Main-thread time per frame runs from 8 to 29 ms.
- The GPU is not what limits it: half resolution with every effect off still takes 6.8 ms of main thread a frame.
- Turning shadows off saved about 6 ms of 17.5 ms. No other single switch moved the number beyond the noise.
- The scene holds 2,723 objects and 1,807 meshes; the main pass draws 200 to 500 calls and up to 2.4 M triangles.

A 6 s CPU profile (it slows everything, so read the shares, not the times):

| Share of main thread | Where | Cause |
|---|---|---|
| 16 % | `scene.updateMatrixWorld` (`multiplyMatrices` alone 14 %) | every static circuit and trackside object recomposes its matrix each frame |
| 15 % | `sim.js` `R.advance` (`drive` 11 %, `envelope` 3 %) | physics for 22 cars on the render thread |
| 26 % | `post.render`: the scene pass, shadows (4 %) and ~25 render calls a frame | draw-call and binding overhead, one full-screen pass per effect |
| 8 % | `replay.js` `render` | tower, HUD and label DOM writes |
| ~6 ms a frame | browser layout, 164 layouts in 90 frames | `frame()` reads `offsetParent` / `clientWidth` after DOM writes: a forced layout every frame |
| ~3.5 ms each | style recalculation, paint | HUD and CSS2D labels |

The GPU process's main thread was 78 % busy in the same trace. GPU time per pass is not measured yet (step 1).

## 2. Seen in the screenshots

- Cockpit: the arms are plain tubes in the car's own colour, the gloves are capsules with no fingers, and a rainbow-coloured
  patch shows under the steering wheel (looks like a bug).
- Chase: asphalt and grass are flat up close; the grass verge is one green.
- Helicopter: tree cards smear, the satellite ground is blurry, and the stands are empty boxes.

## 3. Phase 1: steady 60 fps (done, 13 Nov 2026)

The first profile misled on two counts. The profiler inflated JavaScript against native code, and the test window ran
3 to 4 times slower whenever it was not the foreground window. Timed in the page itself, drawing was 85 % of the main
thread; the simulation was 0.4 ms and the static scenery's matrices were nothing. The 16 % of matrix work was the cars:
each is 116 objects, most of them in a detail level that is hidden.

Built:

- **Frame timer.** `scene3d.js` `timed` / `frameStats`: milliseconds a frame for scene, draw, tags, sim, page and the
  GPU (timestamp queries). Settings' frame rate counter shows them.
- **Hidden detail levels get no matrices.** The loop picks each car's level itself, before the matrix update.
- **Merged shadow casters.** One per far car, five per RB22, on a layer only the sun sees. The three near cascades went
  from 200 to 385 draws each to about 110.
- **RB22 range** 100 m to 60 m (57 draws a car). Settings' car detail doubles it.
- **Mirrors** redraw one a frame, in turn.
- **No forced layout** in `frame()`.
- **Resolution governor** on GPU time, both ways, in place of the one drop at 40 fps.

Measured in a full-screen-sized window (2040x1000 CSS px, 120 Hz), old and new back to back, first 20 s of the race:

| | Before | After |
|---|---|---|
| Main thread a frame, median | 7.5 ms | 6.4 ms |
| Frames over 16.7 ms, chase, after the start | 8 to 9 % | 0.2 to 0.6 % |
| Cockpit: frames over 16.7 ms | 10 % | 0.4 % |
| Cockpit: main thread a frame | 9.8 ms | 7.2 ms |
| Resolution it settles at | 2.00x | about 1.67x |

Not built, because the timer showed no need: the simulation cache, merging static scenery, folding the post passes,
and the per-frame allocations.

Open: on a 120 Hz screen frames alternate between 8.3 and 16.7 ms. Settings' frame rate limit at 60 evens that out; it
is not the default because the limiter gives 48 fps on a 144 Hz screen.

## 4. Phase 2: driver and cockpit (partly done, 13 Nov 2026)

Built:

- **The rainbow patch** was the motion blur smearing the steering wheel's labels: as a transparent material they wrote
  a motion vector of their own. They now keep the wheel's (`rb22.js` `decalMaterial`), and the labels on the buttons
  are readable again. The Red Bull Racing logo left on that texture is cleared too.
- **Gloves** with a back of the hand, four curled fingers and a thumb, in the livery's accent colour (dark grey when
  the accent is near white or black). Still one mesh a car.
- **Sleeves**: an accent cuff edged in dark and a seam, so an arm no longer reads as a pipe in the car's paint.
- **Helmet**: the race number on both sides.

Left for later:

10. A six-point harness of our own (the model's belts show) and shoulders that are not a lathe profile.
11. A wrist joint, and a finger pull on the paddle at each gear change (needs the fingers as separate meshes).
12. Helmet designs per driver beyond the number: national colours, a tinted visor strip.
13. Rain drops and dirt on the visor, a faint visor edge.

Not checked by eye: the helmet's number (no camera gets close enough to the helmet's side without moving it by hand).

## 5. Phase 3: environment

15. Grass: mowing stripes, a detail normal map, tufts at the track edge.
16. Asphalt: skid marks into braking zones, marbles off the line, patch seams, worn kerb paint.
17. Trees: a sharper atlas, crossed cards with normals, wind sway in the vertex shader.
18. Ground: a detail texture over the satellite image, keyed by the vegetation mask that already exists.
19. Stands: an instanced crowd with flags; marshals at their posts; a pit building with garages.
20. Air: height fog for distance, cloud shadows drifting over the ground, sun shafts at golden hour, floodlight cones at night.

## 6. Phase 4: cars and image

21. Wet track reflects the cars (screen-space reflections, WebGPU makes them possible now).
22. Temporal anti-aliasing in place of MSAA plus SMAA, if the timer says it is cheaper. It also steadies the fences.
23. Tyres: sidewall and tread normal maps, graining and marbles picked up over a stint.
24. Exposure that adapts in tunnels and at night; a sun flare; light film grain.

## 7. Checks

- `scripts/test_all.py` stays green.
- Before and after each step: the frame timer's p95 in the five cameras, and screenshots of chase, cockpit, T-cam and helicopter.
- Delete `.cache/replay/*.json` only if a step changes the replay payload (none here should).

## 8. Left out

- A WebGL fallback, and new eras of modelled cars: not asked for.
- Real tyre and sponsor logos: trademarks.
