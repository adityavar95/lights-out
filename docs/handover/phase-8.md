# Handover after phase 8 (20 Nov 2026, written afterwards by improvement phase 0)
Branch / commits: `graphics-perf-phase-8`: `9200022` (globe, glass, styles), `2dd6c52` (style and module refinements).
No session handover was written at the time; this is rebuilt from the two commits and the cockpit-mirrors learning.

Done:
- Globe (`globe.js`, `globemath.js` `namesFit`, `index.html`, `style.css`): a seeded CSS star sky and a page poster
  the globe fades in over on its first frame (`unposter`); pin names shown only where they fit (`labels`); the
  dossier card leads with the round and date; a longer flight (3 s) when entering from high up; the home distance
  3.9 -> 3.45. `tests/test_globe.mjs` covers `namesFit`.
- Small style and markup refinements across `glass.js`, `hud.js`, `tower.js`, `onboard.js`, `tracemodal.js`,
  `multiviewer.js`, `showroom.js`, `scene3d.js`, `charts.js`, `teledrawer.js`, `circuitdeck.js`, `app.js`.
- Cockpit mirrors measured, not changed: ~150-180 extra draws and ~4M triangles a frame from full-detail RB22 cars
  (learning `2026-11-19-cockpit-mirrors-add-170-draws-and-aditya.md`).

Measured after: not re-taken (no fps table for this phase).
Not done or not verified, and why: the mirror cost has no fix (a cheaper car level would visibly swap the car;
merging meshes is risky for ~35 % fewer draws). The phase-8 changes were not screenshot-checked in a handover.
Watch out: count draws with `renderer.info` (autoReset false) when the CPU is throttled.
Next: the graphics plan is finished; work continues in `docs/improvement-plan.md`.
