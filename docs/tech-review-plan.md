# Technology review and plan (13 Nov 2026)

Fourth review in two weeks, so it doesn't repeat `AUDIT_AND_MASTER_PLAN.md`, `implementation.md`, `fan-roadmap.md` or
`graphics-60fps-plan.md`. It answers one question: is each technology the right one, and where would a different one
give a better result? Measured on the running app (RTX 4080 Laptop, Chromium, `#2026/1/results`, cold cache).

## 1. Verdict per technology

| Layer | Now | Verdict | Why |
|---|---|---|---|
| 3D renderer | three.js 0.187 WebGPU + TSL | **Keep** | The most capable renderer the web has. Babylon.js or PlayCanvas would mean rewriting ~6,000 lines for the same picture; Unity/Unreal would lose the single page that is also the exe |
| Page code | Vanilla ES modules, no framework, no build | **Keep** | The page is mostly canvas and 3D. React or Svelte would rewrite 17,000 lines with nothing a user sees. Loads in 2.1 s cold, 0.4 s warm locally |
| Bundler | None | **Keep, add lazy loading** | A bundler buys nothing on localhost. The cost is what loads, not how (step 2) |
| Textures | 4k JPEG, 6 to 22 MB a file | **Change to KTX2** | The one clear technology gap (step 1) |
| Anti-aliasing | MSAA + SMAA | **Try TRAA** | Already item 22 of the 60 fps plan: steadier fences, likely cheaper |
| Server | FastAPI + uvicorn, sync routes | **Keep** | It is a local cache in front of rate-limited upstreams. The upstream limits set the speed, not the framework |
| Live data | Page polls `/api/live` every 1 s; each poll deep-copies the whole feed (`live.py:220`) | **Change to a push stream** | Step 4. Only worth doing before a live weekend |
| Python deps | pandas, numpy, livef1 | **Trim, low priority** | pandas serves three `table()` calls; livef1 serves the Jolpica client and two season lookups, which `basef1` already covers. Dropping both shortens start-up and the exe |
| Video | shaka-player 4.12.6 | **Keep** | Tuned and measured already |
| Desktop | pywebview (WebView2) + PyInstaller | **Keep, one caveat** | WebView2 has no supported Widevine, so live F1 TV in the app is unproven. Electron (castlabs build) is the only fix; not worth it unless live-in-app matters |
| Speech | Parakeet ONNX on CPU | **Keep** | The owner's pick, measured |
| Styles | Plain CSS with `--dp-*` tokens | **Keep** | The gaps are design, not technology (step 5) |

## Progress (13 Nov 2026, uncommitted)

- **Built, seen in a headed browser, suites green:** the banner's stray `false` (`app.js` `selectRace`) and the podium's
  portraits (`drivers.js` `faces`, `charts.js` `renderResults`).
- **Step 6, built:** the server no longer imports pandas or livef1 at start-up (`server.py` `table` flattens rows itself;
  `jolpica.py` uses basef1 directly; livef1 loads on the first old-season session table). Server import 1.49 s to
  0.82 s; output identical to pandas on 56 saved Jolpica tables; suites green. livef1 stays a dependency: it still
  serves pre-2023 session tables in Raw data, so the exe is no smaller.
- **Step 5, built:** the lap chart gives every grid slot a row (the back of the grid shared the bottom row when cars
  ahead of them did not start). Standings, Drivers and Strategy lab were looked at and left alone.
- **Step 3.4 was already there:** the stands have a per-seat crowd shader (`trackside.js`). Reflections, fog and
  exposure are not started: each needs its frame cost read in a foreground window.
- **Step 4 waits:** there is no recorded live feed in `.cache/live` to build against.
- **Found wrong in this plan while starting:** tab switches already use View Transitions (`app.js` `activate`). Step 2
  is worth less than it says: `setupReplay` builds the 3D scene at start-up and Race replay is the default tab, so loading
  on demand only helps a link straight to another tab or to Stream, and it means deferring `setupReplay`, which a dozen
  callers assume has run. Left until the phone layout exists.
- **Step 1 waits on a decision:** no KTX2 encoder is installed (`toktx`, `basisu`), three's `KTX2Loader` and its Basis
  transcoder are not in `static/assets`, and Poly Haven publishes no KTX2, so someone who clones the repo and presses
  Download assets would still get JPEGs unless the converter ships too. Measured since (`nvidia-smi`, whole GPU, headed
  Chromium on `#2026/1/replay`, two runs each): the page takes 2,145 MiB with the 4k sets and 1,467 MiB with every
  photo texture blocked, so they cost about 680 MiB of a 12 GB card. KTX2 would give back roughly 500 MiB. Not worth a
  new toolchain on this machine; revisit if the app must run well on a 6 to 8 GB GPU.
- **TRAA needs care:** `post.js`'s velocity buffer is blended by alpha and the sky's vector is rebuilt from the camera;
  TRAA reads that buffer, so expect ghosting on smoke and sky. Judge it in a foreground window only.

- **Owner's rule (13 Nov):** nothing here is built if the picture gets worse. That drops step 1: KTX2 is lossy
  (worst on normal maps) and only saves memory. TRAA is held to the same rule: it softens fine detail, so it ships only
  if side-by-side screenshots show no loss.

## 2. Plan, in order of gain for the effort

### Step 1. Compressed textures (performance and graphics) — M

Measured: opening any tab, even Results, fetches **130 MB of nine 4k JPEGs plus a 20 MB sky**. In GPU memory a 4k
JPEG is ~85 MB with mipmaps, so nine are ~770 MB; as KTX2 (BC7 on desktop, ASTC on phones) they are ~190 MB, the files
shrink to a third, and nothing is decoded on the main thread.

- `scripts/fetch_assets.py`: convert each Poly Haven set to KTX2 once (needs the `toktx` or `basisu` binary).
- `textures3d.js`: `KTX2Loader` in place of the image loader, JPEG as the fallback when the file is missing.
- Check: GPU memory before and after (`chrome://gpu` or the frame timer), same screenshots, first frame time.

### Step 2. Load only what the tab needs (performance) — S

Measured: 152 requests and 103 script files on first paint, none loaded on demand (no `import()` anywhere), and every
static file is revalidated on each load.

- The 3D stage (`scene3d.js` and what it imports, three.js, textures, sky) loads when Race replay or Play first shows.
- `multiviewer.js`, `stream.js`, `radiopanel.js` load when Stream first shows.
- Files under `/static/assets/` are hash-checked and versioned: send them `immutable`, keep `no-cache` for app code.
- This is what makes the fan roadmap's phone-as-second-screen (P1) usable over Wi-Fi.

### Step 3. Picture (graphics) — M each, in this order

All of these exist as ready nodes in three's TSL addons, so they are wiring, not research:

1. TRAA in place of MSAA + SMAA, judged by the frame timer.
2. Screen-space reflections on a wet track.
3. Height fog and exposure that adapts in tunnels and at night.
4. An instanced crowd in the stands (the stands are empty boxes today).

The largest visual gain is not a technology: only the 2026 car is a real model. A CC-licensed model per era would
change the picture more than any effect. It is asset work; decide if it is wanted.

### Step 4. Live feed as a stream (performance) — M

Server-Sent Events from `live.py` carrying only the changed topics, in place of a 1 s poll and a full deep copy.
Build it against a recorded feed (`LIGHTSOUT_LIVE_PLAY`), so it needs a recording from Las Vegas, Qatar or Abu Dhabi.

### Step 5. Interface (design and experience) — S to M

Seen in the browser today:

- **Bug:** the race banner prints the word `false` at its top right (2026 round 1, Results and Race replay).
- The header takes two rows at 1245 px wide, and header, banner and tabs use 330 px before any content.
- The podium shows three-letter codes with no faces, though `drivers.js` already has the portraits.
- A phone layout for the live tower and a web manifest (fan roadmap P1, P2).
- Then a screen-by-screen pass with the redesign skill: Results, Standings, Drivers, Strategy lab.

### Step 6. Dependencies (start-up, exe size) — S

Drop pandas (three `table()` calls become a list comprehension) and livef1 (`jolpica.py:10`, `server.py:63`, `90`).
Measure the exe and the cold start before and after; skip if under 10 %.

## 3. Not recommended

- A framework, TypeScript, or a bundler: cost across every file, nothing a user sees.
- Rust, Go or async rewrites of the server: the upstream rate limits are the bottleneck.
- Physics in a worker: timed at 0.4 ms a frame (`graphics-60fps-plan.md` §3).
- A WebGL fallback, Electron: recorded decisions or no present need.

## 4. Not checked

Phone layout, the light theme, Stream and Play screens, GPU memory itself (the 770 MB is arithmetic, not a reading),
and whether three.js has a newer release than 0.187.
