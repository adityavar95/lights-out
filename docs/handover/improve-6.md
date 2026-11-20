# Handover after improvement phase 6 (20 Nov 2026)
Branch / commits: `improve-phase-6`, from `improve-phase-5`.

Done:
1. **livef1 and pandas dropped** (`pyproject.toml`, `uv.lock`). `uv sync` also removed 37 packages that came with them, among them ipython, scipy, timezonefinder, lxml and pytest.
   - `src/jolpica.py` `session_rows`: `/api/season/{year}` rows for seasons before 2023, and for when OpenF1 is locked, built from the Jolpica race list. The rows have the same shape as OpenF1's (`Round`, `Session Name`, `StartDate`, `EndDate`). Jolpica has session times from 2022 and race times from 2005; races before 2005 get a single dated Race row. It shares `_session_times` with `calendar_ics`.
   - `src/server.py`: `season`, `frame_table` and `/api/season/{year}/f1schedule` are gone (that route was the livef1 f1.com scrape, which 404'd), along with its entry in the data explorer (`src/static/explorer.js:4`). 2010, the season livef1 crashed on, now answers.
   - Tests in `tests/test_server.py`: the rows (timed and pre-2005), and `/api/season/1800` is a 404 with no Jolpica call.
2. **Exe trimmed to core assets + skies** (the user chose this):
   - `scripts/build_exe.py` fetches only core + HDRIs. It no longer runs the 45-minute `fetch_assets.py`. After PyInstaller it deletes `_internal/static/assets/{textures,tiles}`.
   - `src/paths.py` (new) `DATA`: `.cache` in a checkout. When frozen, it's `%LOCALAPPDATA%\LightsOut`. `jolpica.py`, `live.py` and `replay.py` (so radio, f1tv, tracks and the rest too) write there. So does `desktop.py`'s `lightsout.log`, which used to go beside the exe.
   - `src/assets.py`: when frozen, `ASSETS` is `DATA/assets`. The bundled assets are copied there once (`.bundled` marker), and `server.py` mounts `/static/assets` on that folder. So a Program Files install works, and the Download assets button adds textures and tiles to the same folder.
3. **Clean rebuild**: `dist/` and `build/` were deleted first. That also removed the stale `dist/LightsOut-windows-x64.zip`.

Measured after:
| Measure | Baseline | Now |
|---|---|---|
| exe folder `dist/LightsOut` | 1.1 GB (`_internal/static` 643 MB) | 291 MB (`_internal/static` 90 MB; largest left: `av.libs` 65 MB, `onnxruntime` 38 MB, `numpy.libs` 21 MB) |
| `scripts/test_all.py` | all pass | all pass |

Smoke run: `LIGHTSOUT_PORT=8099 dist/LightsOut/LightsOut.exe` (8086 was taken by a running dev server). These all answered 200: the launcher, `/`, fonts, three.js, a bundled 4k HDRI, `/api/season/2010` (Jolpica rows) and `/api/season/2025`. `/api/assets` reported 24,674 files missing, which is the textures and tiles. `%LOCALAPPDATA%\LightsOut` held the assets and caches, and nothing was written beside the exe.

Not done or not verified, and why:
- No headed agent-browser check. The only UI change is one entry removed from the explorer's list. The exe's window wasn't looked at either: the smoke run went over HTTP.
- Not tested: an install under Program Files, a first run offline (the bundled assets cover it), and pressing Download assets in the exe.
- An exe built before this phase kept `.cache` beside itself. The new exe doesn't read that folder, so caches start empty.

Watch out:
- Frozen, the first start copies ~85 MB of assets to `%LOCALAPPDATA%` (`shortcut:` in `assets.py`). If an exe update changes a bundled asset, the copy isn't refreshed, because `.bundled` already exists. Delete `%LOCALAPPDATA%\LightsOut\assets\.bundled` to recopy, or key the marker by version when releases exist.
- `paths.FROZEN` is `sys.frozen`. Tests and the dev server never take the frozen branches.

Next: phase 7, start with item 1 (dependency refresh).
