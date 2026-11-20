# Handover after improvement phase 1 (20 Nov 2026)
Branch / commits: `improve-phase-1`, from `improve-phase-0`.

Done:
1. `src/replay.py` `_throttle`: a caller reserves its send time under `_sent_lock` and sleeps outside it (it used to
   sleep up to 60 s holding the lock, queueing every OpenF1 user). `background` (thread-local) + `SPARE = 10`:
   `server.py` `warm_up`'s replay builds wait while fewer than 10 of the window's 30 slots are free, leaving them to
   clicks; `_gps_replay` passes the flag to its `locations` pool threads. OpenF1 timeout `(5, 30)`, not 120 s.
2. `server.py` `_is_live`: asks `scheduled_session` first and opens the live feed (a wait of up to 5 s) only when a
   session is on the schedule; an unknown schedule falls back to the feed as before.
3. `driver` bounded to 1-99 (`Annotated[..., Query/PathParam(ge=1, le=99)]`) on `/api/telemetry`,
   `/api/f1tv/telemetry/{driver}`, `/api/f1tv/radio`: 422 before any OpenF1 request or cache file.
4. `src/jolpica.py` `_page`: a page that answers 429 or 5xx is asked once more after `RETRY_WAIT` (2 s).
5. `src/tracks.py` `_kept`: a url that failed isn't asked again for `DOWN_FOR` (5 min); it goes to the saved copy or
   fails fast instead of another 30 s timeout.
6. `replay.py` `_sweep_recent`: unfinished-session builds (several MB each) expire on read as well as write, at most
   `RECENT_MAX = 3`.
7. `src/live.py`: `_changed()` bumps `_version` on every state change; `snapshot` deep-copies once per change and
   hands every poller the same copy (`_shared`), read-only by convention (all callers only read).
Tests (`tests/test_server.py`, end of file and the S-M2 / S-M8 / S-L10 blocks): no sleeping with the lock held,
background waits in a busy window, `_is_live` skips the feed off-schedule, driver 422s, Jolpica retry (429, 503,
400, two 429s), MultiViewer failure memo, recent sweep, shared live copy.

Measured after: warm `/api/replay/2025/24` 0.96 s on the first request after start (was 0.034 s warm in phase 0:
this one read the 5 MB file cold from disk), `/static/util.js` 3 ms during warm-up's builds. Cold build not re-timed.

Not done or not verified, and why:
- No 503 "busy" answer: a GPS build needs ~30 requests, so at 30/min a long wait is normal mid-build and a 503
  would break builds. Holding no lock while sleeping fixes the stall this was for.
- Plan item 4's qualifying page-boundary bug was already fixed (`season.js` `qualiRounds`, `test_season.mjs:77`).
- Item 6: `REPLAY_LOCKS`/`ELEVATION_LOCKS`/`PITLANE_LOCKS`, `radio._texts/_errors/_rows`, `f1tv._cache`,
  `server.season` were left unbounded: one small entry per real session, clip, search or year.
- `live.py` `_put` still re-parses every sample's timestamp per message (the plan didn't ask; live is untestable now).
- Live path checked against stubs only (no live phase this season).

Watch out:
- `live.snapshot()["topics"]` is shared between callers: never mutate it. Tests that write `live._state` directly
  must call `live._changed()` before `snapshot()`.
- `replay.background.on` is per thread; a new thread pool under a background build must copy it (`locations` does).

Next: phase 2, start with item 1 (bind `127.0.0.1` by default, `src/desktop.py:87`, `src/server.py:747`).
