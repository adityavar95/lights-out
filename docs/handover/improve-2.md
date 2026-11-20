# Handover after improvement phase 2 (20 Nov 2026)
Branch / commits: `improve-phase-2`, from `improve-phase-1`.

Done:
1. LAN safety:
   - `src/server.py:745` `LAN`/`HOST`: the server binds `127.0.0.1`; `LIGHTSOUT_LAN=1` binds `0.0.0.0` and prints the
     LAN address. `src/desktop.py:87` uses the same `HOST`. CLAUDE.md's run line and README's "Other devices" text say so.
   - `src/server.py:635` (`revalidate_static` middleware): every POST needs an `Origin` whose host is the request's
     Host, else 403. A missing Origin is refused too (it used to pass): browsers send one on every POST, `sendBeacon`
     included, so only a bare client (curl on another device) is turned away. The four per-route checks are gone.
2. `src/server.py:642`: `/static/assets/` answers 200 with `public, max-age=31536000, immutable`; the rest of
   `/static` and `/` keep `no-cache`; a missing asset (404) isn't cached.
3. Replays:
   - `src/replay.py:246` `saved_replay` returns the `.json.gz` beside the built file (level 6, written once, again when
     the `.json` is newer). `race_replay` (`server.py:334`) sends it with `Content-Encoding: gzip` (GZipMiddleware
     leaves it alone), or decompressed to a client that doesn't accept gzip.
   - `src/replay.py:259` `replay_head(path)`: the file without `frames`, `lru_cache(8)` keyed on path + mtime.
     `/api/sessionlaps` (`saved_head`), `_replay_grid` and `ledgers.overtakes` (`ledgers.py:61`) read it.
4. `src/static/index.html:23`: the inline home-class script is `src/static/homeclass.js`, loaded blocking in the same
   place. The import map is the page's only inline script left (allowed by hash). CSP is still report-only.
Tests (`tests/test_server.py`): missing-Origin POSTs 403, `.json.gz` written and refreshed, `saved_head`/`replay_head`,
gzip and identity replay responses, immutable vs no-cache headers, default `HOST`.

Measured after (server on 127.0.0.1:8086, agent-browser headed 2040x1000):
| Measure | Phase 0 | Now |
|---|---|---|
| `/api/replay/2025/24?session=Race` warm | 0.034 s, 1.76 MB | 0.007-0.019 s, 1.15 MB (first request after start 2.95 s: writes the .gz during warm-up's builds) |
| Home reload | FCP 116 ms, load 626 ms, 250 requests, 55 KB | FCP 108 ms, load 531 ms, 250 requests (all 41 `/static/assets/` from the browser cache, no round trip), 44 KB |
No page errors and no CSP report in the console after the reload.

Not done or not verified, and why:
- CSP stays report-only (plan: a later decision, T4.6). `launcher.html` and other pages weren't checked for inline script.
- LAN mode (`LIGHTSOUT_LAN=1`) not run from a second device; the exe not rebuilt.
- agent-browser's `wait` (and any eval longer than a few seconds) killed its daemon here ("EOF while parsing"); short
  separate calls worked.

Watch out:
- Deleting `.cache/replay/*.json` after a format change should take the `.json.gz` too (`*.json*`, CLAUDE.md says so);
  a leftover `.gz` without its `.json` is ignored.
- `replay_head` results are shared: never mutate them.
- Any new POST route is guarded by the middleware; a test that posts must send `Origin: http://127.0.0.1:8086`.

Next: phase 3, start with its item 1.
