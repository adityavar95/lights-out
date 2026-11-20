# Handover after improvement phase 7 (20 Nov 2026)
Branch / commits: `improve-phase-7`, from `improve-phase-6`.

Done:
1. **Dependency refresh** (`pyproject.toml`, `uv.lock`). Each was bumped on its own, with `scripts/test_all.py` after each:
   - fastapi 0.162.0 -> 0.165.0 (floor raised in `pyproject.toml`), starlette 1.9.0 -> 1.10.0. All suites pass.
   - onnxruntime 1.31.1 -> 1.32.0. Parakeet was checked on a speech clip made with Windows SAPI ("Box box, box this lap. Rain is coming in turn four."). Before and after, the transcript was word for word right, and a warm clip took 0.87 s before and 0.79 s after.
   - Patch releases, done as one step: numpy 2.5.5, websockets 17.4, pydantic 2.14.4 (core 2.50.5), anyio 4.16.0, pyinstaller-hooks-contrib 2026.10, and the small packages pulled in with them (click, filelock, httpx2/httpcore2, annotated-doc, opentelemetry-api, typing-inspection).
   - Already the newest, so no change: three.js r187 (npm `latest` is 0.187.0), uvicorn 0.54.0, pywebview 6.2.1, av, requests, huggingface-hub.
2. **Load time**: measured, and nothing changed. A warm reload is faster than the phase-0 baseline (table below), so the plan's condition ("only if it's still slow") isn't met and nothing was moved to `import()`.

Measured after (agent-browser headed, 2040x1000, server with the new packages on 127.0.0.1:8097):
| Measure | Baseline | Now |
|---|---|---|
| Home reload, warm (3 runs) | first contentful paint 116 ms, load 626 ms, 250 requests, 55 KB | first contentful paint 80-108 ms, load 342-395 ms, 243-251 requests, 51 KB |
| Home, first load with a cold browser cache | not taken | first contentful paint 264 ms, load 559 ms, 18.4 MB |
| `/api/replay/2025/24?session=Race`, built replay on disk | warm 0.034 s | 0.86 s on the first request after the server started (gzip read from disk), then 0.012 s |
| `scripts/test_all.py` | all pass | all pass |

Smoke check: `#races` (Brazil 2026) drew the 3D circuit, and the window `error`/`unhandledrejection` listener (`--init-script`) caught nothing. `/api/season/2010` answered 200.

Not done or not verified, and why:
- **shaka-player stays at 4.12.6.** The newest are 4.16.58 (4.x) and 5.3.6. The F1 TV viewer uses `getVariantTracks`, `getNetworkingEngine`, `getPlayheadTimeAsDate` and the Widevine `drm.servers` config. A bump can only be checked by playing a real F1 TV stream, which needs the user's token and a DRM stream. Bump it in a session where the user signs in to F1 TV: 4.16 first, then 5.x (look at the 5.0 release notes for `getVariantTracks`).
- **No fps table and no three.js screenshots**: three.js wasn't bumped, and no frontend file changed.
- The exe wasn't rebuilt with the new packages.

Watch out:
- The dev server's port (8086) is fixed in `server.py`. To test while the user's own server is running, run `uvicorn.run(server.app, port=8097)` from `src/`.

Next: phase 8, start with item 1 (deep links in `share.js` `TABS`).
