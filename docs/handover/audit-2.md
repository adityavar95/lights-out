# Audit phase 2 handover (25 Nov 2026)

Phase 2 of `docs/audit-fix-plan.md` is done. `scripts/test_all.py` is green (34 JS suites, test_server.py, tsc).

## What changed
- 2.1 `server.py` `revalidate_static`: an `/api/` request with `Sec-Fetch-Site: cross-site` gets 403. No header (curl, tests,
  LAN tools) and `same-origin` pass. The POST Origin check is unchanged.
- 2.2 New `forgetReplays()` in `util.js` drops every cached `/api/replay/` answer. `multiviewer.js` `connectPanel` calls it after
  the desktop sign-in stores the token and after Disconnect (this panel is shared by the viewer, Stream and commentary).
- 2.3 `assets.py`: `PINNED` (URL -> path under ASSETS) lists shaka, anime.js, theatre core and dataverse; `core()` fetches each
  with `HASHES[path]`. `write_three_hashes` is now `write_hashes` and records these four too. The four hashes in
  `asset_hashes.json` were taken from the local copies and matched a fresh download from jsDelivr on 25 Nov.
- 2.4 `replay.py`: `_recent_lock` (an RLock) inside `_sweep_recent`, and new `_recent_get` / `_recent_put` that sweep under it,
  used by `_gps_replay` and `archive_replay`. `server.py`: `_tickets_lock` around the ticket sweep and insert and the pop in `live_stream`.
- 2.5 Dropped the unused `request: Request` params of `f1tv_radio_model`, `count` and `assets_download`; `base64` and `hashlib`
  imported at the top.
- 2.6 `radio.py`: `TRANSCRIBE` and `"transcribe"` in the payload are gone; `radiopanel.js` no longer has `R.words`.

## Tests
- `tests/test_server.py`: cross-site GET 403, same-origin and no header pass; the real `core()` (kept as `_real_core`, since the
  file stubs `assets.core` early) gives every `.js` job a sha256; the radio tests no longer set `TRANSCRIBE` (the "off" case is now
  "model missing").
- `tests/test_util.mjs`: `forgetReplays` refetches a replay and leaves other answers cached. The earlier replay-abort test's last
  `get` now has a `.catch`, since the new test's replay aborts it.

## Checked in the browser
- agent-browser (Chromium), `#2024/1`: every `/api/` request answered 200/204, the replay included. curl with
  `Sec-Fetch-Site: cross-site` on `/api/seasons`: 403.

## Not checked
- The desktop app (WebView2) itself, and the 2.2 sign-in path (needs an F1 TV account). WebView2 is Chromium, which sends
  `same-origin` for the page's own fetches, as seen above.

## Next
Phase 3: stale results after a change.
