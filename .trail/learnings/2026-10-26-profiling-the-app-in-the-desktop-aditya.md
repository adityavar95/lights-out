---
title: "Profiling the app in the desktop browser pane: in-code timers, not PerformanceObserver; GPU ImageBitmaps die with their worker"
author: ADITYA
date: 2026-10-26
branch: master
cost: { minutes: 46, tokens: 433274 }
id: l-5af35ae7
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - README.md
  - docs/graphics-realism-plan.md
  - pyproject.toml
  - src/f1auth.py
  - src/f1tv.py
  - src/jolpica.py
  - src/live.py
  - src/replay.py
  - src/server.py
---

## Decided
- Main-thread cost was measured with temporary `performance.now()` probes logged to the console (setTrack, buildCircuit sections, post.render > 25 ms) and a 5 ms setInterval gap detector, then removed. Numbers on the 2026 US GP default page: race switch 1.3-1.9 s blocked -> 0.1-0.2 s (terrain IDW grid, shader recompiles after dispose, fitGeo + tile decode now in `src/static/groundwork.js`).
- 4K multi-stream checks: `video.getVideoPlaybackQuality()` deltas per tile over 15-20 s, plus counting `WebGL2RenderingContext.prototype.drawElements` calls to see whether the hidden 3D stage still draws (it drew ~174k calls/s under the F1 TV viewer before `util.js` `covered()`).

## Tried and ruled out
- PerformanceObserver `longtask` / `long-animation-frame` (buffered or not) returned nothing in the Claude desktop browser pane, even across a 600 ms block.
- Resource Timing for F1 TV / Esri requests: transferSize is 0 (no Timing-Allow-Origin), the 250-entry buffer fills on first load (call `performance.setResourceTimingBufferSize`), and requests made inside a worker don't appear in the page's list.

## Watch out
- The pane flips `document.visibilityState` to hidden when the user hides it: timers throttle to 1 s and rAF stops, so gap measurements show ~1000 ms gaps that mean nothing. Check `visibilityState` in every measurement; a screenshot makes it visible again.
- An ImageBitmap from `transferToImageBitmap()` of a GPU-accelerated OffscreenCanvas in a worker becomes invalid once the worker is terminated (black satellite ground, 'invalid mailbox name' / 'glCopySubTextureCHROMIUM' GL warnings). `satellite.js` uses `getContext('2d', {willReadFrequently: true})` (CPU canvas) for that reason.
- After editing modules, `location.reload()` the pane: a dynamic `import()` in the console returns the page's already-loaded (old) module.
