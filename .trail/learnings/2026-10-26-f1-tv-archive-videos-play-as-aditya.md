---
title: "F1 TV archive videos play as HLS (no 4K); a full-catalogue sweep gets the IP 403'd"
author: ADITYA
date: 2026-10-26
branch: master
cost: { minutes: 17, tokens: 151326 }
id: l-abfd3e0b
scope: repo
status: active
src: agent
touches:
  - src/static/multiviewer.js
  - src/f1tv.py
---

## Decided
- `src/f1tv.py` `videos()` already maps past seasons: every race checked 1999-2023 has a full replay; 1981-1998 mostly highlights (0-6 full races a season); pre-1981 items have an empty Meeting_Name, so none map to a race.
- CONTENT/PLAY for archive content (seen 1995, 2010, 2019) returns `streamType: "HLS"` (Unified Streaming m3u8, H.264, 1080p at best; 2010 race tops at 576p25), not DASH. The x-f1-override-video-stream 4K header is ignored there. Shaka plays it as is.
- `src/static/multiviewer.js` `load` sets `t.hls`; 4K mode skips the 2160p minHeight restriction for HLS and `lock4k` locks an HLS tile to its best rendition. Before this, 4K on an archive video fell to 288p with a false "browser can't decode 4K" message.
## Watch out
- Hundreds of catalogue searches in a few minutes (one per race 1981-2026) got F1 TV answering 403 to everything from this IP; Jolpica also 429s. Probe a handful, not every race.
- The F1 TV token is per browser tab (sessionStorage): the bookmarklet connects the tab it was clicked in only.
