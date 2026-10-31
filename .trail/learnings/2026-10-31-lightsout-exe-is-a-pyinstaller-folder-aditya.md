---
title: LightsOut.exe is a PyInstaller folder build of src/desktop.py; the launcher page navigates itself
author: ADITYA
date: 2026-10-31
branch: master
cost: { minutes: 14, tokens: 43304 }
id: l-d85756d4
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - src/desktop.py
  - scripts/build_exe.py
---

## Decided
- `scripts/build_exe.py` builds onedir, not onefile: onefile unpacks ~450 MB to %TEMP% each launch, and the modules' `Path(__file__).parent.parent / ".cache"` would land there. Onedir puts it at dist/LightsOut/.cache.
- The `nvidia` CUDA wheels (2 GB) are excluded; `radio.py` `_load` already falls back to the CPU. `faster_whisper` and `livef1` need `--collect-all` (faster_whisper is imported lazily, so the analysis misses it).
## Watch out
- A windowed exe has `sys.stdout` None and uvicorn's log formatter calls isatty on it: `desktop.py` sends both streams to lightsout.log beside the exe before importing uvicorn.
- `window.load_url` inside a js_api call raised in the log ("_returnValuesCallbacks... is not a function"), because the page that made the call is gone before pywebview can answer it. `open_app` returns the URL and the launcher page navigates itself.
- When a `server.py` already holds 8086, the exe reuses it, so testing the bundled server needs `LIGHTSOUT_PORT` set to a free port.
