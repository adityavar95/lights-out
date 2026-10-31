---
title: "README Stream screenshots are a simulated F1 TV session: real viewer code, fake shaka, own 3D renders"
author: ADITYA
date: 2026-10-31
branch: master
cost: { minutes: 17, tokens: 178823 }
id: l-5cb8ea46
scope: repo
status: active
src: agent
touches:
  - src/static/multiviewer.js
  - README.md
  - src/static/style.css
---

## Decided
- The F1 TV viewer can't be shown with real video in a public README (F1 TV artwork/video), so `docs/screenshots/stream-*.jpg` were made by running the real `src/static/multiviewer.js` in headless Chrome (CDP, `--headless=new --use-angle=d3d11`) with request interception: a stand-in `shaka` served in place of the jsDelivr `shaka-player.compiled.js` (fake Player whose `getVariantTracks` lists 2160p50 HEVC / 1080p H.264 renditions and commentary / fx / tea audio, and whose `load` sets the `<video>` poster to a frame and defines `currentTime`), and mocked `/api/f1tv/account|channels|play|telemetry|radio`. Feed pictures are clean frames of the app's own 3D replay (`.mapwrap` fixed fullscreen, other children hidden, clipped to 1472x828). Radio texts are generic sample lines, not real transcripts. The README says all this in a NOTE above the section.
- Grid layout table in the README comes from running `arrange()` itself at 1584x828.

## Watch out
- Found while doing it: after a stream loaded, `load()` emptied `.mvmsg` but left its `loading` class, and `.mvmsg.loading` (later, same specificity) beat `.mvmsg:empty`, so an empty spinner pill sat over every playing tile. Fixed by resetting the class in `load()`.
- Real transcripts exist in `.cache/radio/` but were deliberately not used (F1 content, whisper mishearings).
