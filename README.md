<div align="center">

# 🏎️ Lights Out

**Every Formula 1 race since 1950, replayed in 3D. Live timing for free. F1 TV multiview, a race simulator and a strategy lab, all in one app.**

![Python](https://img.shields.io/badge/python-3.14+-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688)
![three.js](https://img.shields.io/badge/three.js-3D-black)
![livef1](https://img.shields.io/badge/livef1-1.2.11-e10600)
![No build step](https://img.shields.io/badge/frontend-vanilla%20JS%2C%20no%20build-f7df1e)
![Windows app](https://img.shields.io/badge/desktop-Windows%20exe-0078d4)

[Features](#-features) · [Quick start](#-quick-start) · [Desktop app](#%EF%B8%8F-desktop-app-and-executable) · [F1 TV](#-f1-tv) · [Controls](#%EF%B8%8F-controls) · [API](#-api) · [Project structure](#-project-structure) · [Tests](#-tests) · [Limitations](#%EF%B8%8F-limitations)

</div>

---

Pick any race, see the circuit, press ▶ and watch the cars move round a true-scale 3D track with a live timing tower, flags and race control. During a race weekend **● LIVE** follows the session as it happens. With an F1 TV subscription, the **Stream** page plays every feed and onboard side by side, with live data over the picture and transcribed team radio. Lights Out runs in your browser, on other devices on your network, or as a Windows desktop app.

## ✨ Features

The app has two sections, **Analytics** and **Stream**, switched in the header.

<details open>
<summary><b>🎬 Race replay</b></summary>

- **3D circuit** (three.js): real heights and banking from OpenF1 elevation, real track width, kerbs, run-off, Armco or concrete barriers, trees, the Monaco tunnel, a pit lane traced from real GPS, and satellite imagery draped on the terrain
- **Lighting and post-processing:** HDRI sky with the sun aimed at its brightest point, cascaded sun shadows, a rubbered-in racing line that darkens as the session goes on, motion blur, bloom, heat haze, sparks and spray
- **F1 cars** in team liveries with race numbers, built to each era's regulation dimensions; 2026+ cars use a detailed RB22 model up close
- **Cameras:** overview, chase, onboard (with a working mirror and steering wheel), T-cam and helicopter
- **GPS replay (2023+):** real car positions from OpenF1 for every session (practice, qualifying, sprint and race), with real speed, rpm, gear, throttle, brake and DRS
- **Lap-timing replay (1996+):** cars move at each lap's real pace, exact at every lap line, starting from a two-column grid and passing side by side without overlapping
- **HUD:** radar, g-force circle, tyre temperatures and wear, ERS, DRS zones and a telemetry cluster (modelled from the car's path where no telemetry exists); **Cinematic** hides it all
- **Timing tower** with animated overtakes, gaps and intervals, purple/green/yellow sectors, tyres, pit stops and retirements
- **Procedural engine sound** per era (cylinder count, rev limit, turbo, MGU-K), with Doppler, gear-shift cuts and team radio
- Track status (green, yellow, SC, VSC, red, chequered), the race control feed and weather

</details>

<details>
<summary><b>🔴 Live sessions (free)</b></summary>

- **● LIVE** in the header (or **Latest session** between sessions) opens the current session in the same 3D view
- Live timing tower (positions, gaps, best laps, tyres, pits, speed trap), track status, race control, weather and the session clock, refreshed every second
- Without F1 TV, cars are placed from the mini-sectors they have completed and glide between them at their lap pace
- [With F1 TV connected](#-f1-tv), cars move on real live GPS and the focused car shows its real telemetry ("· car GPS" in the status line)
- Picking a session that's running right now opens it live

</details>

<details>
<summary><b>🕹️ Simulation and driving</b></summary>

- **Simulation** session for any race: a physics race on the real circuit with a grid from the real results, qualifying or standings
- Physics: friction-circle braking, drag, downforce on normal load, porpoising and plank strikes, tow and dirty air, five tyre compounds with thermal windows and a wear cliff, ERS modes, DRS detection, weather and standing water
- **Race control:** green, VSC and safety car, with DRS interlocks and messages
- **Pit wall:** wing trim, pit calls, tyre strategy and a pit-loss and rejoin predictor
- **Take control** of any car with a keyboard or gamepad: speed-sensitive steering, traction control, ABS and braking assists, auto or manual gears
- **AI racecraft:** tow, attack, one-move defence, leaving the space, contact and wing damage
- **CIRCUITS:** a card per circuit of the season, with sectors, DRS zones and elevation, that starts a simulation there
- **CARS:** each era's constructors' champion with a spec card and a 360° preview; **Race this era** starts a simulation
- **TELEMETRY TRACE (T):** five channels per lap against distance, Δt to a saved reference lap, race-engineer insights, sector zoom, and CSV/JSON export

</details>

<details>
<summary><b>📊 Analytics</b></summary>

- **Season calendar** with flags; the next race is highlighted and the header counts down to the next session
- **Results:** podium, grid gains and losses, fastest lap, qualifying
- **Lap chart:** positions on every lap with pit stops; hover to follow one driver
- **Standings:** drivers and constructors after each round
- **Strategy lab:** move one driver's pit stops and see where they would have finished, with a position-by-lap chart (real vs what-if) and the best 1–3 stop plans; the model reproduces the real race exactly when nothing changes
- **Drivers:** the season's drivers with portraits and wins, podiums, poles, fastest laps and DNFs; a card opens their whole career
- **Raw data:** every Jolpica, OpenF1 and live-timing table as a filterable table

</details>

<details>
<summary><b>📺 Stream (F1 TV)</b></summary>

- A TV-app browse page for the season: a billboard (the live session, else the latest race), **This weekend** chips, **Continue watching**, **Coming up** with countdowns, and a row per race weekend
- **Multiview viewer:** any number of feeds and driver onboards side by side, in a grid or focus layout, with **Teams** presets (the race feed plus a team's two onboards)
- **4K HDR** on the main feeds of 2025+ races, where your device can decode HEVC Main10
- **Live data** (speed, gear, throttle, brake) over each onboard, synced to the picture with **Lights out**
- **Team radio** on onboards: every message as a list with playback, transcribed on your computer by [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- Per-tile quality and audio track (commentary languages, track sound, team radio), sync, play/pause all, picture-in-picture

</details>

## 🚀 Quick start

> [!IMPORTANT]
> Needs **Python 3.14+** and **[uv](https://docs.astral.sh/uv/)**. [Node.js](https://nodejs.org) is only needed to run the frontend tests.

```bash
git clone <your-repo-url> F1
cd F1
uv sync
uv run python src/server.py
```

Open **http://127.0.0.1:8086**. Other devices on the same network can open **http://&lt;this-computer-ip&gt;:8086** (the server prints the address). If Windows Firewall asks, allow access on private networks.

> [!NOTE]
> On start-up the server builds the GPS replays of the season's last 3 races in the background. The first replay of any other GPS session downloads every car's trace from OpenF1 (20–60 s); the lap-timing replay plays meanwhile and the GPS replay takes over when it's ready. Finished sessions are cached in `.cache/replay/`.

> [!TIP]
> Radio transcription runs on an NVIDIA GPU when CUDA loads (~0.5 s a clip), else on the CPU (~4.5 s). The whisper model (`small.en`) downloads on first use.

## 🖥️ Desktop app and executable

Run Lights Out in its own window instead of a browser tab:

```bash
uv run python src/desktop.py
```

A small launcher asks **Open in the app** or **Open in the browser**. The app window uses the system's WebView2 (pywebview), so nothing else needs installing. In the browser, the launcher stays open: close it to stop Lights Out. If `src/server.py` is already running, the launcher uses it; set `LIGHTSOUT_PORT` to run on a port other than 8086.

**Build the Windows executable:**

```bash
uv run python scripts/build_exe.py
```

This produces `dist/LightsOut/LightsOut.exe`. Share the whole `dist/LightsOut` folder (about 450 MB; zip it). The exe keeps its cache in `dist/LightsOut/.cache` and its log in `dist/LightsOut/lightsout.log`.

> [!NOTE]
> The exe leaves out NVIDIA's 2 GB of CUDA libraries, so radio transcription runs on the CPU there. Remove `--exclude-module nvidia` in `scripts/build_exe.py` to include them.

## 📺 F1 TV

Lights Out plays F1 TV with your own subscription, the way [MultiViewer](https://multiviewer.app) does: you sign in on F1's own site, your password never reaches the app, and nothing is stored on the server.

| Where | How to connect |
|-------|----------------|
| **Desktop app** | **Connect F1 TV → Sign in to F1 TV**: F1's sign-in opens in a window of its own and closes once you're signed in |
| **Browser** | **Connect F1 TV**, drag the bookmarklet to your bookmarks bar, sign in at formula1.com, then click the bookmarklet there: it brings you back connected |

The connection lasts until you close the tab or the app. Without F1 TV connected, Stream's cards open the video on f1tv.formula1.com.

> [!WARNING]
> Use email and password: Google sign-in doesn't work inside the desktop app's window. Replays play without DRM; live streams use Widevine, which the desktop app's WebView2 isn't officially supported for.

## ⌨️ Controls

| Where | Keys |
|-------|------|
| Replay | `Space` play/pause · `←` `→` seek 10 s · `C` next camera · `T` telemetry trace · click a driver to follow them |
| Driving | `W`/`↑` throttle · `S`/`↓` brake · `A` `D`/`←` `→` steer · `E`/`Shift` gear up · `Q`/`Ctrl` gear down · `R`/`Space` DRS · `F` ERS · `P` pit · `C` camera · gamepads work too |
| F1 TV viewer | `K`/`Space` play/pause · `←` `→` ±10 s · `M` mute · `F` fullscreen tile |

## 🔌 API

Table endpoints return `{"columns": [...], "data": [[...]], "total": n}`, capped at 5,000 rows. Interactive docs are at **http://127.0.0.1:8086/docs**.

<details>
<summary><b>All endpoints</b></summary>

| Endpoint | Returns |
|----------|---------|
| `GET /api/seasons` | Available seasons |
| `GET /api/season/{year}` | The season's sessions |
| `GET /api/season/{year}/f1schedule` | Schedule from formula1.com |
| `GET /api/jolpica/{year}/{kind}` | Season data: `races`, `drivers`, `constructors`, `circuits`, `driverstandings`, `constructorstandings` |
| `GET /api/jolpica/{year}/{kind}?round={n}` | Round data: `results`, `qualifying`, `sprint`, `laps`, `pitstops`, standings |
| `GET /api/driver/{driverId}` | A driver's career: every result and season standing |
| `GET /api/track/{year}/{round}` | Circuit outline with corners, width and pit loss |
| `GET /api/geo/{year}/{round}` | The circuit's real outline in metres (for satellite imagery) |
| `GET /api/elevation/{year}/{round}` | Track heights along a lap (2023+) |
| `GET /api/pitlane/{year}/{round}` | The pit lane's path from GPS |
| `GET /api/circuit/{circuitId}` | The latest past race at a circuit |
| `GET /api/replay/{year}/{round}?session=Race` | Replay data (`mode: "gps"` or `"laps"`; `&laps=1` forces lap timing) |
| `GET /api/telemetry/{year}/{round}?driver={n}&session=Race` | One car's speed, rpm, gear, throttle, brake, DRS (2023+) |
| `GET /api/live` | Live (or latest) session state from F1's live timing |
| `GET /api/live/track` | Outline and mini-sectors of the live session's circuit |
| `GET /api/live/table/{topic}` | One live topic (e.g. `TimingData`) as a table |
| `GET /api/f1tv/{year}/{round}` | The weekend's F1 TV videos |
| `GET /api/f1tv/account` | Whether the connected token is a live subscription (never the token) |
| `GET /api/f1tv/channels/{id}` | A video's feeds and driver onboards |
| `GET /api/f1tv/play/{id}?channel=` | A signed stream manifest (needs `X-F1-Token`) |
| `POST /api/f1tv/license` | Widevine licence relay for live streams |
| `GET /api/f1tv/telemetry/{year}/{round}/{driver}?session=` | A whole session's telemetry for the viewer's overlay |
| `GET /api/f1tv/radio/{year}/{round}/{driver}?session=` | Team radio clips with transcripts |
| `GET /api/f1tv/radio/audio?u=` | One radio clip's audio |
| `POST /api/count/{event}` · `GET /api/counts` | Anonymous per-day usage totals (see [Privacy](#-privacy)) |

F1 TV endpoints take your subscription token in the `X-F1-Token` header.

</details>

## 📁 Project structure

<details>
<summary><b>Show the tree</b></summary>

```
F1/
├── src/
│   ├── server.py        # FastAPI routes, start-up warm-up, usage counts
│   ├── desktop.py       # Desktop launcher: app window or browser, in-app F1 TV sign-in
│   ├── jolpica.py       # Jolpica queries, paging, disk cache for settled races
│   ├── replay.py        # Replays (OpenF1 GPS or Jolpica lap timing), telemetry, elevation, pit lane
│   ├── tracks.py        # Circuit outlines: MultiViewer, OpenF1 lap, GeoJSON fallback
│   ├── live.py          # Free live timing over F1's SignalR Core feed
│   ├── f1tv.py          # F1 TV catalogue, channels, play and licence
│   ├── f1auth.py        # F1 TV token expiry check
│   ├── radio.py         # Team radio clips and faster-whisper transcription
│   └── static/          # Frontend: vanilla JS modules, no build step
│       ├── index.html, style.css, circuitdeck.css
│       ├── app.js            # Analytics / Stream switch, calendar, hero, tabs
│       ├── replay.js         # Replay engine (GPS, lap timing, live)
│       ├── scene3d.js        # three.js scene, cameras, shadows, ground
│       ├── circuit3d.js, track3d.js, cars3d.js, rb22.js, post.js, vfx.js, mirror.js
│       ├── satellite.js, groundwork.js   # satellite imagery fitted in a worker
│       ├── sim.js, simmode.js, player.js, racecraft.js, tyres.js, weather.js,
│       │   racecontrol.js, strategy.js, track.js, circuits.js   # race simulation
│       ├── hud.js, tower.js, onboard.js, pitwall.js, driverdeck.js, decks.js
│       ├── circuitdeck.js, carsdeck.js, trace.js, tracechart.js, tracemodal.js
│       ├── audio.js, audiodeck.js       # procedural engine sound
│       ├── stream.js, multiviewer.js, tvcontrols.js   # F1 TV
│       ├── whatif.js, strategylab.js, optimiser.js    # Strategy lab
│       ├── drivers.js, charts.js, explorer.js, live.js, lanes.js
│       ├── focus.js, telemetry.js, input.js, util.js
│       └── models/           # rb22.glb and its credits
├── scripts/build_exe.py # PyInstaller build of LightsOut.exe
├── tests/               # test_server.py and the Node .mjs tests
├── docs/                # design notes
└── pyproject.toml
```

</details>

## 🧪 Tests

Plain asserts, no test framework:

```bash
uv run python tests/test_server.py   # backend
node tests/test_live.mjs              # live car placement
node tests/test_telemetry.mjs         # HUD telemetry (g-forces, tyres, ERS, DRS)
node tests/test_sim.mjs               # race physics
node tests/test_player.mjs            # player driving and AI racecraft
node tests/test_circuits.mjs          # aero trim, grade, banking
node tests/test_trace.mjs             # telemetry trace and engineer insights
node tests/test_whatif.mjs            # Strategy lab model
node tests/test_multiviewer.mjs       # F1 TV overlay timing
node tests/test_lanes.mjs             # lap-timing replay lanes
node tests/test_drivers.mjs           # Drivers tab tallies
```

## 🗂️ Data sources

| Source | Used for |
|--------|----------|
| [Jolpica F1](https://github.com/jolpica/jolpica-f1) | Results, qualifying, sprints, lap times, pit stops, standings, calendar, careers |
| [OpenF1](https://openf1.org) | Car GPS, telemetry, elevation, intervals, laps, tyres, pits, race control, weather, team radio (2023+) |
| F1 live timing (SignalR Core) | Live sessions: timing, tyres, track status, race control, weather, team radio |
| [F1 TV](https://f1tv.formula1.com) | Video, with your own subscription |
| [livef1](https://github.com/GoktugOcal/LiveF1) | Seasons, sessions and its bundled Jolpica client |
| [MultiViewer](https://multiviewer.app) API | Circuit outlines, corners, mini-sectors, pit loss |
| [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) | GeoJSON outlines for circuits MultiViewer doesn't cover |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite ground under each circuit |
| [Poly Haven](https://polyhaven.com) | HDRI skies |
| [Wikipedia](https://www.wikipedia.org) | Driver portraits and biographies |
| [flagcdn](https://flagcdn.com) | Country flags |

## ⚠️ Limitations

- **Live GPS and live video need F1 TV.** Without a token, live cars are placed per mini-sector (about 20 per lap) and cars in the pits leave the track.
- **OpenF1 is locked while any session is live.** Cached GPS replays still open, race replays fall back to lap timing, and the session list comes from livef1. GPS replays of a session appear once OpenF1 publishes it, usually shortly after it ends.
- **OpenF1's free tier allows ~30 requests a minute**, and a GPS replay costs ~30, so building several at once queues them.
- **F1 TV blocks an IP after a few hundred catalogue searches**; Stream fetches three weekends at a time to stay under it.
- **4K needs 2025+ races**, the main feeds, and a device that decodes HEVC Main10 2160p (not Firefox, nor Chrome without GPU HEVC).
- Lap-timing replays (before 2023) are exact only at the start/finish line. Races before 1996 have no lap data and no replay.
- Track maps use each circuit's modern layout, so historic races on since-changed layouts show today's track. GeoJSON outlines have no known start line or direction.
- livef1 can't build some seasons (2010 fails inside livef1); the rest of the app still works for those years.
- Tables over 5,000 rows are truncated in the data explorer.

## 🔒 Privacy

- Your F1 TV token stays in the browser tab (sessionStorage) or the desktop app's private window, and is sent only with this app's own requests. The server keeps no token or password.
- Usage counts are anonymous per-day totals of a fixed list of events in `.cache/counts.json`: no id, cookie, IP or URL. Nothing is sent under Do Not Track or Global Privacy Control.

## 🙏 Acknowledgements

Thanks to Jolpica, OpenF1, livef1, MultiViewer, f1-circuits, Poly Haven, shaka-player, three.js and faster-whisper for making this possible. The 2026 car model is "2026 Redbull RB22" by Tyler_Dave, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/): see [`src/static/models/CREDITS.md`](src/static/models/CREDITS.md).

<sub>This project is unofficial and is not associated with Formula 1, F1 TV or the FIA. F1 TV content requires your own subscription.</sub>
