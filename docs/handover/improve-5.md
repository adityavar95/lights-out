# Handover after improvement phase 5 (20 Nov 2026)
Branch / commits: `improve-phase-5`, from `improve-phase-4`.

Done:
1. `src/archive.py` (new): builds the "gps" replay payload from F1's archive. It reads the season `Index.json`, picks the session (`find`: the meeting folder dated within a day of the Jolpica race date), then fetches these 8 files in parallel: Position.z, TimingData and DriverList (needed), and SessionStatus, TimingAppData, PitLaneTimeCollection, WeatherData and RaceControlMessages (optional, empty if absent). `build()` is pure and works out:
   - t0 (the archive clock's UTC start) from Position's timestamps;
   - laps from `NumberOfLaps` / `LastLapTime` / `Sectors`. Lap 1 starts at the first SessionStatus "Started", which is lights out: VER starts moving there in 2021 Bahrain;
   - positions, gaps (`"1 L"` → `"+1 LAP"`), stints, pits, weather and race control, in OpenF1's row shapes.
   The token is sent only as `Authorization: Bearer`.
2. `src/replay.py` `replay(..., token)`: with a token, for 2018 and later, it asks the archive first (`archive_replay`). On any failure (401/403/404, network, no data) it logs one line and falls back to OpenF1, then to lap times, as before. Builds are cached as `.cache/replay/archive-<year>-<date>-<session>.json`, and `_built` checks that file first, so `saved_replay` serves it without asking OpenF1. Sessions that ended less than 2 h ago go to `_recent`, the same rule OpenF1 builds follow. Pre-2023 teams come from Jolpica results, because 2021's DriverList has none in its first line.
3. `src/server.py` `race_replay` passes `f1auth.valid(X-F1-Token)` through. `src/static/util.js` `get()` sends `tvHeaders()` on `/api/replay/`.
4. Tests (`tests/test_server.py`, "archive replay ok" and "replay route token ok"):
   - the parser, run on `tests/fixtures/archive/`: real 2021 Bahrain archive files trimmed to cars 33/44/11 and the first ~6 minutes from the start, 196 KB;
   - `find`, `local_utc` and `_gap`;
   - a 403 raises `Missing`, without the token in its message;
   - a 401 falls back to lap times (2021) and to OpenF1 (2024);
   - with no token, the archive isn't asked;
   - a finished build is served from disk without an OpenF1 call;
   - the route forwards a valid token and drops an expired one.
   `scripts/test_all.py` is green.

Measured: the full 2021 Bahrain race (real files from FastF1's public mirror, same format) builds in 1.7 s. The payload is 3.4 MB raw JSON (OpenF1 builds are ~5 MB), with 20 cars, 56 laps and no gaps in VER's frames. Stints match the real race (VER pitted on laps 17 and 39). Headed agent-browser at 2040x1000, using that build placed in the cache: 2021 Bahrain plays as "Race · GPS replay", with the timing tower, tyres, gaps and weather, and no window errors (`improve-5-2021-bahrain.png`). The cache file was deleted afterwards. Request count with a token: 1 index + 8 files, against OpenF1's ~30.

Not done or not verified, and why:
- **Not run against the real archive with a token.** None was available this session. The parser was checked on the mirror's 2021 files, which use the same format. First real check: connect F1 TV in the app, then open a 2024 race and a 2019 race. The server log shows "Archive replay ... unavailable" if it fell back.
- 2023+ team colours come from DriverList's `TeamColour`. That's assumed (FastF1 reads it) but wasn't seen, because the mirror has only 2021-22.
- The frontend still labels pre-2023 races "Lap replay" (`replay.js` `replayKind`), and sessions other than the race aren't offered before 2023. The archive could serve them, but that's UI work.
- `/api/telemetry` (OpenF1 car_data) and `/api/sessionlaps` still need OpenF1, so a pre-2023 GPS replay has no telemetry panel data. CarData.z is not used yet.
- Lap 1 sector 1 is often empty, as it is in OpenF1.

Watch out:
- The fallback catches every exception, so a parser bug shows up only as a log line, followed by an OpenF1 or lap replay.
- A replay built with a token is cached on disk and served to anyone on the LAN after that, without a token.
- Delete `.cache/replay/archive-*.json*` as well when the payload format changes.

Next: phase 6, start with item 1 (drop livef1).
