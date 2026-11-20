# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
uv sync                                    # install deps (livef1==1.2.11, fastapi, uvicorn, onnx-asr, av, pywebview; dev: pyinstaller)
.venv/Scripts/python src/server.py         # run app at http://127.0.0.1:8086 (LIGHTSOUT_LAN=1 opens http://<computer-ip>:8086 to the network)
.venv/Scripts/python src/desktop.py        # desktop launcher (pywebview/WebView2); reuses a running server.py; LIGHTSOUT_PORT overrides 8086
.venv/Scripts/python scripts/build_exe.py  # PyInstaller: dist/LightsOut/LightsOut.exe (folder build, ~1.1 GB)
.venv/Scripts/python tests/test_server.py  # plain asserts, no pytest
.venv/Scripts/python scripts/test_all.py        # every suite (JS and tests/test_server.py), first failure stops; CI runs it on Windows
for f in tests/test_*.mjs; do node "$f"; done   # JS tests, one file per module (what each covers: docs/architecture/testing.md)
.venv/Scripts/python scripts/fetch_assets.py    # all assets into src/static/assets (gitignored, 610 MB, ~45 min, resumes); build_exe.py runs it first
.venv/Scripts/python scripts/tile_list.py       # regenerate static/tile_list.json when a circuit joins the calendar (needs node); build_exe.py runs it first
```

## Architecture

F1 web app: FastAPI backend in `src/` plus vanilla-JS ES modules in `src/static/` (served at `/static`, no build step). The same server and page also run as a desktop app (`desktop.py`) and a Windows exe (`scripts/build_exe.py`).

Rules most tasks need:
- Big payloads (replay, telemetry, live) go out through `raw_json`; table endpoints return `{columns, data, total}`.
- After changing the replay payload format, delete `.cache/replay/*.json*` (each built replay has a `.json.gz` beside it).
- OpenF1's free tier is ~30 req/min (`_throttle` in `openf1()`); a GPS replay costs ~30 requests. While a session is live OpenF1 answers 401 (`OpenF1Locked`).
- The F1 TV token (`X-F1-Token`) is never stored or logged by the server.
- 3D is three.js WebGPURenderer + TSL, no WebGL fallback. Every lit material goes through `csmSync`. No `:has()` in styles without measuring.
- Look: `--dp-*` tokens at the top of `style.css`, dark is the default, type floor 12 px. `--accent` is white in dark, so text on it uses `--accent-ink`.
- `agent-browser console` doesn't show uncaught exceptions: add a window `error` listener when testing.
- Where the module notes in the docs below disagree with the 3D-stack or Look notes, those win.

Read before touching the area:
- `docs/architecture/backend.md`: server, jolpica, tracks, replay, f1tv, radio, desktop, live
- `docs/architecture/frontend.md`: every JS module (replay, sim, vehicle, stream, scene3d, ...)
- `docs/architecture/3d-and-look.md`: 3D renderer stack, glass and style system
- `docs/architecture/testing.md`: what each `tests/test_*` file covers

Dead ends (as of Oct 2026): F1's old livetiming endpoints (`/static`, `/signalr`) return 401, so livef1's session/telemetry data is unavailable (the newer `/signalrcore` works, see `live.py`); livef1's f1.com results scrape 404s; `livef1.get_season(2010)` raises inside livef1.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on adityavar95/lights-out, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, each named after its role. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
