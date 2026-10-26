# 🏎️ F1 Data Browser

![Python](https://img.shields.io/badge/python-3.14+-blue)
![livef1](https://img.shields.io/badge/livef1-1.2.11-e10600)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688)

A Formula 1 web app built on [livef1](https://pypi.org/project/livef1/) 1.2.11. Pick any race from 1950 to today, see the circuit map, press ▶ and watch the race replay with cars moving round the track, a live timing tower, flags and race control messages. During a race weekend the **● LIVE** button follows the session as it happens, for free. Results, qualifying, lap charts and standings are one tab away, and every raw dataset is available in a data explorer.

## Features

**Race replay**
- **3D circuit** (three.js): real-width asphalt, kerbs on every corner, white lines, run-off, barriers, trees, sky, start gantry and chequered line
- **F1 cars** in team colours with their racing number and a floating number + driver-code tag
- **Cameras:** Overview (orbit / zoom), Chase (behind a driver), **Onboard** (driver's eye, with toggles to hide the halo, the car and the steering wheel)
- **Steering wheel** that turns with the corners, with rev lights, speed, gear, throttle/brake, DRS, lap, position, gap, tyre and flag lights — real car telemetry for 2023+ sessions, estimated speed before that
- **GPS replay (2023 onwards):** real car positions from OpenF1 for every session — practice, qualifying, sprint and race
- **Lap-timing replay (1996 onwards):** cars move round the circuit at each lap's real pace, with exact positions and gaps at every lap line
- Timing tower with animated overtakes, gaps to the leader, tyre compound, pit stops and retirements
- Track status (green / yellow / safety car / VSC / red / chequered), race control feed and weather
- Play / pause, 1×–100× speed, scrubbing, keyboard controls (space, ← / →), click a driver to follow them

**Live sessions (free)**
- **● LIVE** in the header (or **Latest session** between sessions) opens the current session in the same 3D view
- Live timing tower (positions, gaps / best laps, tyres, pit), track status, race control, weather and session clock, refreshed every second
- With an F1 TV subscription connected (F1 TV viewer → Connect F1 TV: sign in on formula1.com, then click the bookmarklet there), cars move on real live GPS and the focused car shows its real speed, rpm, gear, throttle and brake ("· car GPS" in the status line). Without it, cars are placed from the mini-sectors they have completed and glide between them at their lap pace
- Picking a session that is running right now opens it live (OpenF1 locks free access to all sessions while one is live)

**Track maps**
- Official-style circuit outlines with corner numbers and the start/finish line, for every circuit raced since 2018
- Older and new circuits (Sepang, Magny-Cours, Madring and more) from a GeoJSON circuit collection

**Race views**
- Season calendar with flags, the next race highlighted
- Results with podium, grid gains/losses and fastest lap
- Qualifying with the fastest Q1/Q2/Q3 times highlighted
- Lap chart of positions on every lap, with pit stops and hover to follow one driver
- Driver and constructor standings after each round
- Data explorer: every dataset (schedule, results, laps, pit stops, standings, drivers, circuits…) as a filterable table

## Quick start

Requires Python 3.14+ and [uv](https://docs.astral.sh/uv/).

```bash
git clone <your-repo-url> F1
cd F1
uv sync
uv run python src/server.py
```

Open **http://127.0.0.1:8086**.

> The first replay of a GPS session downloads every car's trace from OpenF1 and takes 20–60 seconds. Finished sessions are then cached in `.cache/replay/` and load instantly.

## API

Table endpoints return `{"columns": [...], "data": [[...]], "total": n}`, capped at 5,000 rows.

| Endpoint | Returns |
|----------|---------|
| `GET /api/seasons` | List of available seasons |
| `GET /api/season/{year}` | livef1 session table for the season |
| `GET /api/season/{year}/f1schedule` | Schedule scraped from formula1.com |
| `GET /api/jolpica/{year}/{kind}` | Season data: `races`, `drivers`, `constructors`, `circuits`, `driverstandings`, `constructorstandings` |
| `GET /api/jolpica/{year}/{kind}?round={n}` | Round data: `results`, `qualifying`, `sprint`, `laps`, `pitstops`, `driverstandings`, `constructorstandings` |
| `GET /api/track/{year}/{round}` | Circuit outline `{source, x, y, rotation, corners}` |
| `GET /api/replay/{year}/{round}?session=Race` | Replay data (`mode: "gps"` or `"laps"`) |
| `GET /api/telemetry/{year}/{round}?driver={number}&session=Race` | One car's speed, rpm, gear, throttle, brake, DRS (2023+) |
| `GET /api/live` | Live (or most recent) session state from F1's live timing feed |
| `GET /api/live/track` | Outline and mini-sectors of the live session's circuit |
| `GET /api/live/table/{topic}` | One live topic (e.g. `TimingData`) as a table |

FastAPI's interactive docs are at **http://127.0.0.1:8086/docs**.

## Project structure

```
F1/
├── src/
│   ├── server.py      # FastAPI app and routes
│   ├── jolpica.py     # Jolpica queries via livef1's client, flattened to rows
│   ├── replay.py      # Replay data: OpenF1 GPS (2023+) or Jolpica lap timing
│   ├── tracks.py      # Circuit outlines: MultiViewer, GeoJSON fallback
│   ├── live.py        # Free live timing: F1 SignalR Core connection and state
│   └── static/        # Frontend (vanilla JS modules, no build step)
│       ├── index.html, style.css
│       ├── app.js     # Calendar, race header, tabs
│       ├── replay.js  # Replay engine, timing tower, controls
│       ├── scene3d.js # 3D circuit, car models and cameras (three.js from CDN)
│       ├── onboard.js # Camera toolbar and steering wheel display
│       ├── charts.js  # Results, qualifying, lap chart, standings
│       ├── live.js    # Live feed -> timing tower and mini-sector car positions
│       ├── explorer.js
│       └── util.js
├── tests/test_server.py
└── pyproject.toml
```

## Data sources

| Source | Used for |
|--------|----------|
| [livef1](https://github.com/GoktugOcal/LiveF1) | Seasons, session schedule, formula1.com schedule, and its bundled Jolpica client |
| [Jolpica F1](https://github.com/jolpica/jolpica-f1) | Results, qualifying, sprint, lap timings, pit stops, standings, calendar |
| F1 live timing (SignalR Core) | Live sessions: timing, tyres, track status, race control, weather |
| [OpenF1](https://openf1.org) | Car GPS positions, positions, intervals, laps, tyres, pit stops, race control, weather (2023+) |
| [MultiViewer](https://multiviewer.app) API | Circuit outlines and corners (the same source livef1 uses) |
| [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) | GeoJSON outlines for circuits MultiViewer doesn't cover |
| [flagcdn](https://flagcdn.com) | Country flags |

## Limitations

- **Live GPS needs F1 TV.** The live view uses F1's SignalR Core feed (`livetiming.formula1.com/signalrcore`); car positions and telemetry come only with an F1 TV subscription token. Without one, cars are placed per mini-sector (about 20 per lap) and cars in the pits are taken off the track.
- **OpenF1 is locked during live sessions.** While any session runs, OpenF1 refuses free requests for every session, past ones included: GPS replays already cached in `.cache/replay/` still open, race replays fall back to lap timing, and the session list comes from livef1. Full GPS replays of a session appear once OpenF1 publishes it, usually shortly after it ends.
- livef1's own live timing client uses F1's older feed, which now answers `401 Unauthorized`, so it isn't used.
- Lap-timing replays (before 2023) place cars by average lap pace, so positions are exact only at the start/finish line. Races before 1996 have no lap data and no replay.
- Track maps use each circuit's modern layout, so historic races on since-changed layouts (e.g. Bahrain 2010's endurance loop) show today's track. GeoJSON outlines have no known start line or direction.
- livef1 1.2.11 cannot build some seasons (2010 fails inside livef1); the rest of the app still works for those years.
- Tables larger than 5,000 rows are truncated in the data explorer.

## Tests

```bash
uv run python tests/test_server.py
node tests/test_live.mjs
```

## Acknowledgements

Thanks to the livef1, Jolpica, OpenF1, MultiViewer and f1-circuits projects for making this data available.

*This project is unofficial and is not associated with Formula 1 or the FIA.*
