# Handover after phase 0 (19 Nov 2026)

Branch / commits: master, nothing committed. New files: `docs/graphics-perf-review-plan.md`, this file,
`.trail/learnings/2026-11-19-claude-in-chrome-tab-behind-another-aditya.md`.

Done: tested the Brazil 2026 race replay in all five cameras and the globe; wrote the phased plan.

Measured: see Section 1 of `docs/graphics-perf-review-plan.md`.

Not done or not verified:
- Play (driving), Stream, night and wet races: not tested (phase 5).
- Frame rates in the user's own Chrome: not measurable, its window was behind another app (rAF 1-3/s).

Watch out:
- The resolution governor is in the `frame` loop of `src/static/scene3d.js` (~L215-238); `pixelRatio` at ~L51.
- `scene3d.js` exports `framesDrawn` and `frameStats`; import the module in the page to read them.
- Existing plans: `docs/graphics-60fps-plan.md` (items 15-24 overlap phases 2-4 here), `docs/tech-review-plan.md`
  (the 4k texture issue).
- User's rules: no loss in 3D picture quality for speed work; desktop only; agent-browser for browsing, never Playwright.

Next: phase 1 (speed), start with item 1 (the governor).
