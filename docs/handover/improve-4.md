# Handover after improvement phase 4 (20 Nov 2026)
Branch / commits: `improve-phase-4`, from `improve-phase-3`. Docs only: the spike ran from a scratchpad script, so no app code changed.

**Verdict: go for phase 5.** With the F1 TV token, F1's archive serves Position and CarData for 2018-2026. That's
4 requests per race instead of OpenF1's ~30, at the same ~4 Hz, and it covers the seasons OpenF1 lacks (pre-2023).

Done:
1. Header: FastF1 3.9 (`fastf1.internals.f1account`) "sends the F1TV subscription token as Bearer token to
   livetiming". This is the same token the app already has (`X-F1-Token`, `src/f1auth.py`) and the same header
   `src/live.py:152` sends. No cookie is needed; a plain `User-Agent: Mozilla/5.0` was enough.
2. Measured, with the user's Access+ token passed through an env var at run time (it was not stored or logged). For each season, the first and last race were tried:

| | Result |
|---|---|
| No token | 401 on every season index and file tried |
| Token lifetime | `exp - iat` = 4.0 days, can't be refreshed (FastF1 docs agree) |
| Season `Index.json` 2018-2021, 2023-2026 | 200, 0.1-1 s |
| Season `Index.json` 2022 | **403** with the token (its race files were not probed) |
| 2018 Bahrain race | `Index.json`, Position, CarData 403; only TimingData 200. 2018 Abu Dhabi: all 200 |
| Every other race tried (14) | all four files 200 |
| Size per race | TimingData 2.7-7.4 MB, Position.z 5.6-9.6 MB, CarData.z 6.6-8.6 MB: ~16-25 MB raw, 4 requests |
| Time per race | 2-13 s per file; Position + CarData ~5-12 s together |
| Position rate | median 0.30 s (2018-19), 0.22 s (2020-21), 0.24 s (2023-26) |
| CarData rate | median 0.24 s every year |
| Gaps | mostly at most 1.4 s. Outliers: CarData 71 s (2020 Austria), Position 13.7 s and CarData 11.8 s (2021 Bahrain), CarData 12 s (2023 Bahrain), Position 5.1 s (2024 Abu Dhabi) |

   OpenF1 for comparison: its `location` comes from this same ~3.7-4 Hz feed, it starts in 2023, and a replay costs
   ~30 requests under the ~30 req/min throttle (cold replay ~60 s, phase 0 baseline). The archive is the same
   data rate, needs ~8x fewer requests, has no throttle we've hit, and goes back to 2018.

Not done or not verified, and why:
- Gap and rate figures come from the first 4000 lines of each stream (~15k records, roughly the first third of a race), not the whole file.
- 2022 was not probed past its 403 season index. The race paths may still answer (FastF1's mirror serves 2022
  without a login, but the auto mode classifier refused that download in this session). Phase 5 should try a
  2022 race path directly.
- Sprints, qualifying and practice weren't tried, only races.
- The car counts (23 in 2020, 30 at 2024 Abu Dhabi) are the largest `Entries`, so they include cars that aren't racing. Phase 5 must filter to the session's drivers, which TimingData or DriverList gives.
- Don't know: whether F1 rate-limits the archive. 60 requests in a row, about 3 minutes, were all fine.

Watch out:
- A pasted token in a chat transcript is a live credential for ~4 days; this session's ended up in one. Keep
  tokens to an env var or the page's `X-F1-Token`.
- Treat 403 (an archive gap or a season without entitlement) like 401: fall back to OpenF1.
- The streams are UTF-8 with a BOM. Each `.z.jsonStream` line is `time"base64"`. The payload is raw deflate
  (`zlib.decompress(b, -zlib.MAX_WBITS)`). Timestamps carry 7 fractional digits, which Python's `fromisoformat` won't take: cut them to 6.

Next: phase 5. Start with `src/archive.py`: season Index → session path → Position.z/CarData.z parser, on a small recorded fixture.
