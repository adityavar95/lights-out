---
title: "F1 TV pre-2025 videos refuse the INTERNATIONAL channelId and the 4K header; both fall back to the content's own HD feed"
author: ADITYA
date: 2026-10-26
branch: master
cost: { minutes: 6, tokens: 43827 }
id: l-53aa81bb
scope: repo
status: active
src: agent
touches:
  - src/static/multiviewer.js
  - src/f1tv.py
  - tests/test_server.py
---

## Decided
- `src/f1tv.py` `channels()` sends INTERNATIONAL as channelId null: CONTENT/PLAY with its channelId answers 403 "Video FER URL From AdditionalStreams - ... - 1025 - No Data Found in DB" on 2018-2024 races (checked 2018, 2020, 2021, 2024), while no channelId plays the same international feed. On 2025/2026 both give the identical manifest path, so null is safe there too.
- `play(uhd=True)` retries without `x-f1-override-video-stream` when F1 TV refuses: every video before 2025 answers 403 "... - 1033/1009 - No Data Found" (rights) to the 4K header; 2025+ return HDR_UHD_DASH on every channel, onboards included.
## Watch out
- The error text's middle number is F1 TV's event id (9472 = 2024 Bahrain); the last code tells the cause: 1025 = no stream for that channel, 1033/1009/1015 = no 4K rights.
- Pre-2025 videos come back as HLS (see the archive HLS learning); the frontend's `t.hls` path handles them in 4K mode.
- Claude in Chrome loses access to the app tab ("Cannot access a chrome-extension:// URL of different extension") once the viewer dialog opens; test play requests with fetch before opening the viewer.
