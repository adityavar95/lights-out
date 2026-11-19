# Graphics and performance review (plan, 19 Nov 2026)

Follows `graphics-60fps-plan.md` (its phases 1-2 are built) and `tech-review-plan.md`.

**How this plan runs:** one phase per Claude session. A session starts by reading the latest handover in
`docs/handover/` (highest phase number), does only its own phase, and ends by writing `docs/handover/phase-N.md`
with the template at the bottom of this file, ticking its phase here, and committing on its own branch. The next
session starts from that handover alone, with no need for the earlier conversation.

## Status

- [x] Phase 0: review and plan (handover: `docs/handover/phase-0.md`)
- [x] Phase 1: speed (handover: `docs/handover/phase-1.md`; item 2 only partly met, see there)
- [x] Phase 2: ground and edges (handover: `docs/handover/phase-2.md`)
- [ ] Phase 3: camera look
- [ ] Phase 4: trackside life
- [ ] Phase 5: untested areas (Play, Stream, night, wet)

## 1. Measured (Phase 0)

Brazil 2026 race replay, RTX 4080 Laptop, Ultra defaults, agent-browser window in front at 2040x1000, frame timer
from `scene3d.js` `frameStats`.

| Camera | fps (120 Hz) | Frames > 17.5 ms | Main thread draw | GPU | Canvas width |
|---|---|---|---|---|---|
| Overview, playing | 60 | p95 31.6 ms | 3.3 ms | 1.2 ms | 1498 (floor) |
| Chase (2) | 120 | 0 % | 4.2 ms | 2.0 ms | 1812 |
| Cockpit (3) | 100 | 0.2 % | 5.3 ms | 3.4 ms | 2084 |
| T-cam (4) | 112 | 0.4 % | 5.3 ms | 3.0 ms | 2397 |
| Helicopter (5) | 119 | 0 % | 3.1 ms | 3.1 ms | 2756 |

Page load 3.7 s, 250 requests, 159 MB decoded (4k ground textures ~150 MB of it). JS heap 120 MB at the globe,
256-300 MB in a replay. No uncaught errors.

## 2. Found (Phase 0)

1. **Resolution governor stuck low.** The stage opens at 2x (4012 px canvas, 42 ms GPU), steps down to the 75 %
   floor, and stays there with GPU at 1-3 ms because each step down doubles `calmNeed`. It also only runs while frames
   are back to back, so a throttled window keeps 2x.
2. **Overview stutters**: p95 31.6 ms while playing (other cameras 12.5 ms).
3. **First frames after the globe closes** take 0.2-0.6 s each (pipelines compiling).
4. **The globe page loads the 4k ground textures** (~150 MB) before any circuit is shown.
5. **Satellite edge**: past the satellite square the ground turns into procedural farmland with dark field lines,
   joined by a blurry band.
6. **Chase**: motion blur smears the whole background at 112 km/h; grass verge is one flat green; stands empty.
7. **Helicopter**: satellite ground blurry up close, trees are blobs, hard edge between verge and satellite image.
8. **Cockpit**: a multi-coloured patch still shows on the lower steering wheel.

## 3. Phases

Each phase: build, run `scripts/test_all.py`, re-take the Section 1 table and screenshots of chase, cockpit, T-cam and
helicopter, write the handover. Picture changes must not cost frames and must not make the picture worse.

### Phase 1: speed (`scene3d.js`, `textures3d.js`)
1. Governor: start Auto at 1x not 2x; let it climb back sooner when GPU < 2 ms (reset `calmNeed` once a step up holds).
   Done when the canvas settles above 1x in every camera within 5 s.
2. Compile the circuit's pipelines with `compileAsync` before the globe closes (the `warmCockpit` pattern).
   Done when no frame after the globe closes takes over 100 ms.
3. Overview stutter: log frames > 20 ms with which `stats` part spiked, then fix that part (first suspect: CSS2D tags).
   Done when the overview's p95 is under 17 ms.
4. Load ground textures when a circuit is first shown, not on the globe page; the 2k set unless Ultra.

### Phase 2: ground and edges (`circuit3d.js`, `track3d.js`, `textures3d.js`)
5. Past the satellite square: fade into a muted tint of the image's own border, no farmland lines.
6. Grass verge: mowing stripes and a detail normal; soften the verge-to-satellite edge.
7. Satellite ground up close (helicopter): a detail texture keyed by the vegetation mask.

### Phase 3: camera look (`post.js`, `rb22.js`)
8. Motion blur in chase: cap per-pixel blur length so the background stays readable.
9. Cockpit wheel patch: find whether it is the dash texture or motion vectors, and fix it.

### Phase 4: trackside life (`trackside.js`, `circuit3d.js`)
10. Instanced crowd in the stands.
11. Trees: sharper atlas, crossed cards.

### Phase 5: untested areas
12. Measure and screenshot Play (driving), Stream, a night race and a wet race the same way; add what they show as
    new phases here.

## 4. How to measure

- Use agent-browser with its own session and its window in front (`--headed`, viewport 2040x1000). The user's Chrome
  throttles to 1-3 fps when its window is behind another app, so its numbers are not usable.
- In the page: `const m = await import('/static/scene3d.js')`; `m.framesDrawn()` over 5 s gives fps, `m.frameStats()`
  the ms per part, `document.querySelector('.trackmap canvas').width` the resolution. Keys 1-5 switch cameras.
- Start the replay with the "Play replay" button; a paused stage redraws 4 times a second by design.

## 5. Handover template (`docs/handover/phase-N.md`)

```
# Handover after phase N (date)
Branch / commits:
Done: (each item, with file:line)
Measured after: (the Section 1 table)
Not done or not verified, and why:
Watch out: (anything the next phase must know)
Next: phase N+1, start with item X
```
