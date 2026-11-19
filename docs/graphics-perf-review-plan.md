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
- [x] Phase 3: camera look (handover: `docs/handover/phase-3.md`)
- [x] Phase 4: trackside life (handover: `docs/handover/phase-4.md`)
- [x] Phase 5: untested areas (handover: `docs/handover/phase-5.md`; Play-driving and Monsoon fps need re-taking, see there)
- [x] Phase 6: Play's page cost (handover: `docs/handover/phase-6.md`; Free Orbit and Helicopter within noise of the 10 % goal, see there)
- [x] Phase 7: wet ground (handover: `docs/handover/phase-7.md`; darker on screen only by 3-8 % in Monsoon's fog, see there)

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
    new phases here. Done: results in `docs/handover/phase-5.md`, new phases below.

### Phase 6: Play's page cost (`driverdeck.js`, `pitwall.js`, `hud.js`, `tower.js`)
Play spectating ran at 59-70 fps in every camera where the replay ran at 89-117 fps, with the same GPU time (4-6 ms)
and draw calls. A trace showed the renderer's main thread 84 % busy. About 7 ms of that is in rAF (what `frameStats`
measures). Another ~4-5 ms a frame goes to a full layout (370 of 1,097 objects dirty every frame), style, 7 paints and
re-raster of the panels, none of it in `frameStats`. A MutationObserver counted, per second: 1,235 `aria-pressed`
writes on the driver deck's assist buttons (`driverdeck.js:82`, every frame whether or not they changed), 260 on the
pit wall (`pitwall.js:122-154`), 3,000 radar `cx`/`cy` writes (`hud.js`), and the tower's 22 rows rebuilt 8 times a
second with every attribute (`tower.js`).
13. Re-take the Play numbers first, with nothing else rendering on the GPU (see the handover's Watch out): Play
    spectating, Play driving (the player's car; cameras picked from the deck's menu, not keys 1-5 or C), and the
    Simulation in Monsoon. Done when the table has all three with the five cameras.
14. Write deck and pit-wall states only when they change (`driverdeck.js:79-82`, `pitwall.js:122-154`), and find
    which writes dirty layout every frame (Performance panel's layout invalidations). Fix the biggest ones: unchanged
    writes, or `contain: layout paint` on panels that update in place. Done when Play spectating is within 10 % of the
    replay's fps in every camera and layout is under 0.5 ms a frame.
15. Add the page's own frame time to `frameStats` (rAF-to-rAF minus the measured parts), so a DOM cost shows up in
    the numbers instead of only in a trace. Done when the Section 4 snippet shows it.

### Phase 7: wet ground (`circuit3d.js`, `scene3d.js`)
In the wet (Brazil 2026's start on inters: wetness 0.35; the Simulation in Monsoon: rain 92 %, track 93-100 %) only
the track and the `wettable` materials' roughness change (`scene3d.js:728`). The mown verge (phase 2) stays the same
bright, dry green as in sunshine, and the satellite ground doesn't change at all, so under a grey monsoon sky the
grass beside the track reads as sunlit.
16. Darken the verge's and the satellite ground's colour with the same wetness value (wet grass and soil are about
    20-30 % darker), through a uniform like `wetLine`/`wetOff`; no new draw calls or passes. Done when a Monsoon
    helicopter screenshot shows darker grass and ground and the dry picture is unchanged pixel for pixel.

### Needs the user (design choices, not done)
- **Phase 1 item 2, the cars' first frames after the globe closes** (0.2-0.6 s hitches): either the globe waits
  for the race data before it closes, or the cars are drawn once out of sight first. Both change what the user sees
  or waits for.
- **Night brightness of the satellite ground and the crowd.** Under Settings' Night sky the satellite photo keeps
  its daylight (bare soil reads ~100/255 beside a ~30/255 track), and the instanced crowd (phase 4) is evenly lit and
  fully saturated across a whole stand, even outside the floodlights. Darkening them is a matter of taste: how dark,
  and whether stands away from the floodlights should go dark.
- **Floodlight beams** (pre-existing, `trackside.js:118`, `:255`): at night each beam is a flat see-through wedge
  that cuts straight through stands and roofs in chase and T-cam. Keep, soften, or remove.
- **Night backdrop**: the Night HDRI is a rocky desert hillside with stars, which doesn't look like São Paulo.
  Choosing another HDRI means choosing an asset.

### Found on the way (not graphics)
- Leaving Play while driving (header Races, or a `#…/replay` link) leaves `.mapwrap.driving` set, so the Races
  replay has no ▶ until a reload.
- In Play, C (`onboard.js` `nextCamera`) cycles into Free Orbit, which drops the focus and hands the player's car to
  the AI. Keys 1-5 also left the player's car with the AI.

## 4. How to measure

- Use agent-browser with its own session and its window in front (`--headed`, viewport 2040x1000). The user's Chrome
  throttles to 1-3 fps when its window is behind another app, so its numbers are not usable.
- In the page: `const m = await import('/static/scene3d.js')`; `m.framesDrawn()` over 5 s gives fps, `m.frameStats()`
  the ms per part (`rest` is the frame-to-frame time the parts don't cover: the page's layout, style and paint,
  and vsync or GPU waits), `document.querySelector('.trackmap canvas').width` the resolution. Keys 1-5 switch cameras.
- Check the CPU still boosts before a run: `(Get-Counter '\Processor Information(_Total)\% Processor Performance')`
  read ~175 % under load on the RTX 4080 laptop when clean and ~90 % once it stopped boosting, which slowed every
  main-thread part 3-4x (phase 6).
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
