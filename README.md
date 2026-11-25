<div align="center">

# 🏁 Lights Out

### Relive every race in 3D. Follow live timing. Simulate any era. Free for every fan.

**A free, open-source race companion for Formula 1 fans: 3D race replays on real circuits, free live timing, a physics race simulator from 1950 to today, a strategy lab, and a 4K HDR multiview player for your own F1 TV subscription. Built by fans, for fans.**

[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e)](LICENSE)
![Open source](https://img.shields.io/badge/open%20source-%E2%9D%A4-e10600)
![Free](https://img.shields.io/badge/price-free%2C%20forever-22c55e)
![No ads](https://img.shields.io/badge/ads-none-6b7280)
![No account](https://img.shields.io/badge/sign--up-not%20needed-6b7280)
![4K HDR](https://img.shields.io/badge/multiview-4K%20HDR-e10600)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-8b5cf6)](#-contributing)

![Python](https://img.shields.io/badge/python-3.14+-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688)
![three.js](https://img.shields.io/badge/three.js-3D-black)
![No build step](https://img.shields.io/badge/frontend-vanilla%20JS%2C%20no%20build-f7df1e)
![Windows app](https://img.shields.io/badge/desktop-Windows%20exe-0078d4)

[Trailer](#-the-trailer) · [Why Lights Out](#%EF%B8%8F-why-lights-out) · [Tour](#-a-tour-of-lights-out) · [Quick start](#-quick-start) · [Desktop app](#%EF%B8%8F-desktop-app-and-executable) · [Download](#%EF%B8%8F-download-the-windows-app) · [F1 TV](#-f1-tv) · [Controls](#%EF%B8%8F-controls) · [API](#-api) · [Contributing](#-contributing) · [License](#-license)

<br>

### 🎬 The trailer

https://github.com/user-attachments/assets/82218406-cb93-4c18-962b-f75ac5a1c396

<sub><b>▶ 29 seconds, sound on.</b> Five lights, five things it does: replay every race in 3D, timing and strategy, drive any era, every number, 4K HDR multiview. Then lights out. Every shot is the real app. · <a href="docs/media/lights-out-trailer.mp4">Download (mp4)</a> · <a href="docs/media/lights-out-trailer.jpg">poster</a></sub>

<br><br>

<img src="docs/screenshots/replay-hud.jpg" alt="Lights Out replaying the 2026 United States Grand Prix in 3D: timing tower, satellite-mapped circuit, g-force, tyre and telemetry panels" width="100%">

<sub>The 2026 United States Grand Prix, replayed from real GPS on a satellite-mapped Circuit of the Americas.</sub>

</div>

---

## 💚 Free and open, for everyone

Lights Out is a **community project**. It is free to download, free to use and free to change, and it always will be.

<table>
<tr>
<td width="33%" valign="top">

**🆓 Free, with nothing held back**<br>
No paywall, no premium tier, no "pro" features, no trial. Every feature in this README is in the free app, because the free app is the only app.

</td>
<td width="33%" valign="top">

**🔓 Open source (MIT)**<br>
Every line is here to read, learn from, fork and improve. Use it, run it for your friends, build on it: the [MIT license](LICENSE) lets you.

</td>
<td width="33%" valign="top">

**🙅 No ads, no accounts, no tracking**<br>
No sign-up, no ads, no cookies, no analytics service. It runs on your own computer, and the only usage numbers are anonymous daily totals that stay on your machine.

</td>
</tr>
<tr>
<td valign="top">

**🤝 Built by fans, for fans**<br>
Made in spare time out of love for the sport, and shaped by the people who use it. Ideas, bug reports and pull requests are all welcome.

</td>
<td valign="top">

**🌍 Open for all**<br>
Runs on any computer with Python, on your phone or tablet over your home network, or as a one-click Windows app. No GPU farm, no cloud bill, no gatekeeper.

</td>
<td valign="top">

**🏳️ Unofficial and independent**<br>
Lights Out is not associated with Formula 1, F1 TV, the FIA or any team. It uses open community data, and F1 TV only through your own subscription. [More below](#%EF%B8%8F-disclaimer).

</td>
</tr>
</table>

## 🏎️ Why Lights Out

Watching a race tells you what happened. Lights Out lets you **look inside it**: ride onboard with the leader, see exactly where a pass was made, rerun the race with a different pit stop, or put a 1990s V10 on today's circuit and race it yourself.

| | |
|---|---|
| 🌍 **A globe to start from** | Pick your race by spinning a satellite Earth; a click flies you down to the circuit, with imagery that sharpens as you approach |
| 🎬 **Every race since 1996 in 3D** | Real GPS for 2023+ (every car, every session), real lap timing back to 1996, on true-scale circuits with real elevation, banking and satellite ground |
| 🔴 **Live timing, free** | During a race weekend, follow the session as it happens: tower, gaps, tyres, race control and weather, no subscription needed |
| 🕹️ **A race simulator, 1950 to 2026** | A physics race on any circuit with any era's cars, driven by AI or by you on keyboard or gamepad |
| 🧪 **Strategy lab** | Move a driver's pit stops and see where they would have finished; let the lab try every plan |
| 📊 **Every number** | Results, lap charts, standings, driver careers, and every raw data table, filterable and exportable |
| 📺 **4K HDR F1 TV multiview** | With your own subscription: past races from 2025 on in 2160p50 HDR (live sessions in 1080p on Windows), every driver's onboard side by side, live data over the picture and transcribed team radio |
| 🖥️ **Runs anywhere** | Browser, other devices on your network, or a Windows desktop app. No build step, no cloud |

---

## 📸 A tour of Lights Out

The app has three sections, switched in the header: **Races** (real races), **Play** (drive a physics race yourself) and **Stream** (F1 TV).

### 🌍 Globe launch view

The app opens on a live satellite Earth. Every circuit on the season calendar is pinned on it. Drag to spin; click a pin (or choose a race in the header) and the view flies down to that circuit, with satellite imagery that loads in sharper patches as you approach. Close enough and **Play** appears: open it and the globe cross-fades into the 3D circuit once it has loaded.

### 🎬 3D race replay

Pick any race, press ▶ and watch the cars move round a true-scale 3D circuit with a live timing tower, flags, race control and weather.

<p align="center">
<img src="docs/screenshots/replay-satellite.jpg" alt="Circuit of the Americas in 3D with satellite imagery draped on the terrain" width="100%">
</p>

- **Real circuits in 3D** (three.js): real heights and banking from OpenF1 elevation, real track width, kerbs, run-off, Armco or concrete barriers, trees with wind sway, the Monaco tunnel, a pit lane traced from real GPS, and **satellite imagery** fitted to the circuit and draped on the terrain with a mown verge, vegetation-keyed ground detail and a painted racing line that darkens as rubber goes down
- **Cinema-grade lighting:** HDRI skies with the sun aimed at their brightest point, cascaded sun shadows, floodlights at night, drifting cloud shadows on the ground, tyre skid marks, motion blur, bloom, heat haze, sparks and spray; **in the wet**, the verge and satellite ground visibly darken
- **Crowds in the stands:** instanced spectators fill the grandstands, with clusters of broadleaf trees behind them
- **Cars** in team colours with race numbers, built to each era's regulation dimensions; 2026+ cars use each team's own detailed 2026 model up close (nine teams in their real liveries; the rest get a repainted RB22)
- **GPS replay (2023+):** real car positions from OpenF1 for every session (practice, qualifying, sprint and race), with real speed, rpm, gear, throttle, brake and DRS
- **Lap-timing replay (1996+):** cars move at each lap's real pace, exact at every lap line, starting from a two-column grid and passing side by side without overlapping
- **HUD:** radar, g-force circle, tyre temperatures and wear, ERS, DRS zones and a telemetry cluster (modelled from the car's path where no telemetry exists); **Cinematic** hides it all
- **Timing tower** with animated overtakes, gaps and intervals, purple/green/yellow sectors, tyres, pit stops and retirements
- **Procedural engine sound** per era (cylinder count, rev limit, turbo, MGU-K), with Doppler, gear-shift cuts and team radio
- Track status (green, yellow, SC, VSC, red, chequered), the race control feed and weather
- **Time of day:** the sky follows the sun as it stood over the circuit at the start, or pick Midday, Sunrise, Sunset, Overcast or Night (floodlights on); `L` steps through them
- **Street circuits get a city:** blocks of flats, offices and glass towers behind the barriers, with lit windows at night
- **Graphics presets** in ⚙ Settings (Ultra, High, Medium, Low; `G` cycles them): a desktop starts on Ultra with 4K skies and photo textures, a phone or tablet on Low
- **Key moments on the scrubber:** safety cars, red flags, lead changes and passes as named pins (`,` `.` jump between them), plus team-radio pins for the car you follow (2023+, they play with F1 TV connected)
- **Highlights (`H`):** the whole race in about five minutes: the start, the flag, red flags, lead changes, safety cars and the top five's passes, played at 1× in the cinematic view
- **The Why:** the race told from its lap times (1996+): a headline and up to seven beats (lead changes, slow spells, retirements from the front, slow stops, undercuts, and the smallest pit call that would have finished higher). Click a beat to watch that lap
- **Momentum strip** under the scrubber (the followed car's laps against the field, green or red) and a one-line story over the stage: who leads, by how much, and where your car is

**Six cameras:** Chase, T-Cam, Cockpit (with a working mirror and steering-wheel display), TV Chase, Helicopter and Free Orbit. Pick one from the deck's Camera menu, or press `1` to `5`; while you drive, `C` steps through them.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/replay-cockpit.jpg" alt="Cockpit camera with the halo, steering-wheel display and live timing"></td>
<td width="50%"><img src="docs/screenshots/replay-tcam.jpg" alt="T-cam view above the leader's car on the straight"></td>
</tr>
<tr>
<td align="center"><sub>Cockpit: halo, mirrors and a working steering-wheel display</sub></td>
<td align="center"><sub>T-Cam above the leader through the esses</sub></td>
</tr>
</table>

### 🔴 Live sessions (free)

- **● LIVE** in the header (or **Latest session** between sessions) opens the current session in the same 3D view
- Live timing tower (positions, gaps, best laps, tyres, pits, speed trap), track status, race control, weather and the session clock, refreshed every second
- Without F1 TV, cars are placed from the mini-sectors they have completed and glide between them at their lap pace
- [With F1 TV connected](#-f1-tv), cars move on real live GPS and the focused car shows its real telemetry
- Picking a session that's running right now opens it live
- In a live race or sprint, an **AS IT STANDS** column shows the championship as it would be if the race ended now
- Turn on **Session start notices** in the command palette and the browser tells you when a session goes live

### 🕹️ Play: drive a physics race on any circuit, in any era

The **Play** view is a racing game on the real circuit, with a grid from the real results, qualifying or standings. Pick a circuit, a car, a driver, the laps and a difficulty (Easy, Medium, Hard), then **race** the AI, set a **time-trial** lap (your best per circuit and car is remembered), or **spectate** and call the strategy from the pit wall. `Esc` pauses.

<p align="center">
<img src="docs/screenshots/simulation.jpg" alt="Physics simulation at Austin with the driver deck, pit wall, weather and race director panels" width="100%">
</p>

- **Era-accurate cars, 1950 to 2026+:** wings, skirts, flat floors, ground effect and 2026 active aero; bias-ply, slick and grooved tyres; H-pattern, semi-automatic and seamless gearboxes; turbo lag, MGU-H, MGU-K and the 2026 energy rules. Calibrated so a qualifying lap lands within about 4 % of real pole times at Austin, Monaco, Monza and Silverstone, from 1955 to 2026
- **Physics:** friction-circle braking with brake bias, lateral load transfer, drag, downforce (DRS really sheds rear downforce), porpoising, tow and dirty air, five tyre compounds with thermal windows and a wear cliff, ERS modes, DRS and overtake detection, weather and standing water
- **Pit wall:** box this lap, tyre choice with a pit-loss and rejoin predictor, pace modes, rear-wing trim, weather from clear to monsoon, and a race director for VSC and safety car
- **Take control** of any car with a keyboard or gamepad: speed-sensitive steering, traction control, ABS and braking assists, auto or manual gears and clutch, only the aids that era allowed if you want it real
- **AI racecraft:** tow, attack, one-move defence, leaving the space, contact and wing damage
- **Reaction game** (the five-lights button in the header): five red lights, one a second, a random hold, then lights out — press as fast as you can. Rates your time against the driver average (~0.2 s) and remembers your personal best

<table>
<tr>
<td width="50%"><img src="docs/screenshots/circuit-selector.jpg" alt="Circuit selector with a card per circuit: outline, sectors, DRS zones, elevation profile and lap record"></td>
<td width="50%"><img src="docs/screenshots/car-showroom.jpg" alt="Car showroom of constructors' champions by era: the 2026 Red Bull RB22 in 3D with its spec card"></td>
</tr>
<tr>
<td align="center"><sub><b>CIRCUITS:</b> sectors, DRS zones, elevation and lap records; one click starts a race there</sub></td>
<td align="center"><sub><b>CARS:</b> each era's champions with specs, results and a 360° preview; <b>Race this era</b></sub></td>
</tr>
</table>

**Telemetry trace (`T`):** speed, throttle, brake, rpm and gear for any two cars against track distance, with Δt, sector zoom, a saved reference lap that outlives the race (compare eras!), CSV/JSON export, and a race engineer that tells you where the time went.

<p align="center">
<img src="docs/screenshots/telemetry-trace.jpg" alt="Telemetry trace comparing two cars at Austin with delta time, speed, throttle, brake and rpm channels and race-engineer insights" width="100%">
</p>

### 📊 Races

Everything about the race you're looking at, one tab away.

<p align="center">
<img src="docs/screenshots/strategy-lab.jpg" alt="Strategy lab: pit-stop sliders, the what-if position chart and the best plans found" width="100%">
</p>

**🧪 Strategy lab:** drag a driver's pit stops to other laps, add or remove one, and see where they would have finished, lap by lap against the real race. **Find best strategy** tries every 1 to 3 stop plan in parallel. The model replays the real lap times, measures this race's pit loss, squeezes the gaps under safety cars like real life, and reproduces the real result exactly when nothing changes.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/results.jpg" alt="Race results with a podium and the classification table"></td>
<td width="50%"><img src="docs/screenshots/lap-chart.jpg" alt="Lap chart of every driver's position on every lap with pit stops"></td>
</tr>
<tr>
<td align="center"><sub><b>Results:</b> podium, grid gains and losses, fastest lap, qualifying</sub></td>
<td align="center"><sub><b>Lap chart:</b> every position on every lap, pit stops marked; hover to follow a driver</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/standings.jpg" alt="Drivers' and constructors' championship standings"></td>
<td width="50%"><img src="docs/screenshots/drivers.jpg" alt="Drivers tab: a card per driver with portrait, points, wins, podiums, poles and DNFs"></td>
</tr>
<tr>
<td align="center"><sub><b>Standings:</b> drivers and constructors after each round</sub></td>
<td align="center"><sub><b>Drivers:</b> season tallies; a card opens a driver's whole career</sub></td>
</tr>
</table>

- **Results, deeper:** driver ratings out of 10 (from race pace, places gained, the teammate and the finish; the formula is printed above the table), the pit-stop table, an overtake ledger, the stewards' decisions (penalties, investigations, deleted laps, each linked to that moment in the replay), and for 2023+ qualifying evolution, ideal laps and practice long runs
- **Pace and tyres:** race trace, tyre-strategy bars, tyre wear per stint and an undercut ledger
- **Standings, deeper:** points race over the season, the title maths (what settles it at the next weekend) and teammate head-to-heads
- **Drivers:** a career dialog for any driver, a head-to-head with any other driver, and ★ to make one your **favourite**: first in Results, Standings and Drivers, and followed when a replay opens
- **Spoiler-free mode:** a race from the last 30 days hides its podium, results, lap chart, strategy lab and standings until its replay reaches the flag or you press Show
- **Season calendar** with flags; the next race is highlighted, the header counts down to the next session, and a weekend still to run lists every session in your time zone with **Add to calendar** (.ics)
- **Links you can share:** the address holds the race, tab, replay moment, followed driver, a Strategy lab plan, an open career or the showroom car, so a link opens exactly what you saw
- **Command palette:** `Ctrl K` (`⌘ K`) finds any race, tab or view; `?` lists every shortcut; `/` searches the drivers
- **Raw data:** every Jolpica, OpenF1 and live-timing table, filterable, with CSV download

<p align="center">
<img src="docs/screenshots/raw-data.jpg" alt="Raw data explorer showing the lap times table with a filter and CSV download" width="100%">
</p>

### 📺 Stream: 4K HDR multiview for your F1 TV

With your own F1 TV subscription, **Stream** turns into a TV-app browse page for the season and a broadcaster-grade multiview player: the race in **4K HDR**, every driver's onboard, live data over the picture and transcribed team radio, as many streams side by side as your screen and connection can take.

> **📺 4K or 1080p?** Watch **past races from 2025 onwards in 4K HDR**. **Live sessions play in 1080p**: F1 TV sends its live 4K only to Apple devices, encrypted with Apple's FairPlay DRM, which browsers on Windows can't decrypt. So on Windows a live session tops out at 1080p. Once F1 TV re-publishes the session as a replay (it can take a day or more), you can watch it in 4K.

> [!NOTE]
> **About these screenshots:** F1 TV's video can't be shown in a public README, so this section shows a simulated session. The viewer's real code is running with sample channel data, Lights Out's own 3D renders stand in for each video feed, and the radio messages are sample text. Everything around the pictures is the real interface: the layouts, menus, 4K badges, data overlays and radio list.

#### 🎞️ 4K HDR, on by default

<p align="center">
<img src="docs/screenshots/stream-uhd.jpg" alt="Multiview with the International broadcast playing 2160p50 HEVC HDR, its quality menu open and the 4K HDR switch on" width="100%">
</p>

- **2160p50 HDR** (HEVC Main10, about 15.4 Mb/s) on the International broadcast and F1 Live of 2025+ races, with a **4K** badge on every tile that's playing it
- **Highest quality from the first frame:** every tile starts on its top rendition and never steps down; a slow connection buffers instead of blurring. Pick **Auto** in a tile's ⚙ menu to fit it to the tile
- The ⚙ menu lists **every rendition** (resolution, frame rate, bitrate, codec) and says why when a feed is playing in HD (older races have no 4K)
- **Checks your device first:** the 4K switch turns itself off where the browser can't decode HEVC Main10 at 2160p50 (Firefox, or Chrome without GPU HEVC); Microsoft Edge and Chrome on a GPU that decodes HEVC 10-bit play it
- Built to run several at once: three 2160p50 streams plus an onboard ran with 0 to 0.1 % of frames dropped, at about 15 Mb/s of bandwidth per 4K stream
- 4K needs an F1 TV subscription that includes it (F1 TV Premium)
- **4K is for replays of 2025+ races.** Live sessions play in **1080p** on Windows: F1 TV's live 4K is FairPlay-encrypted for Apple devices only

#### 🧩 Any number of streams, laid out for you

Add as many streams as you like, or every driver at once with **All drivers** in the picker (those tiles start on Auto quality so 20+ small tiles stay light). Every tile stays a true 16:9 picture, as big as your window allows, and the layout reflows as you add, remove or resize. Three layouts, and the app remembers your choice:

- **Grid:** every stream the same size
- **Focus:** the stream you hear big, the rest beside it; drag its edge to give it anywhere from 25 % to 85 % of the width
- **Picture in picture:** the stream you hear full screen, the others small over its corner

<table>
<tr>
<td width="50%"><img src="docs/screenshots/stream-grid4.jpg" alt="Grid of four feeds: International broadcast and F1 Live in 4K, driver tracker and data channel"></td>
<td width="50%"><img src="docs/screenshots/stream-grid9.jpg" alt="Grid of nine: the International broadcast and eight driver onboards, each with its live telemetry overlay"></td>
</tr>
<tr>
<td align="center"><sub><b>Grid, 4 streams:</b> the race in 4K, F1 Live in 4K, the driver tracker and the data channel</sub></td>
<td align="center"><sub><b>Grid, 9 streams:</b> the race plus eight onboards, each with its own speed, gear, RPM, throttle and brake</sub></td>
</tr>
</table>

<p align="center">
<img src="docs/screenshots/stream-focus.jpg" alt="Focus layout: the International broadcast big with eight onboard thumbnails in a column beside it" width="100%">
<br><sub><b>Focus:</b> the stream you're listening to big, the rest as thumbnails beside it (or under it in a tall window). Switch with one click, or press a tile's ⤢ to make it the big one</sub>
</p>

**How the grid arranges itself** (on a 16:9 screen; it picks the column count that gives the biggest pictures and centres a short last row):

| Streams | Grid layout | | Streams | Grid layout |
|:-:|:-:|---|:-:|:-:|
| 1 | full screen | | 6 | 3 + 3 |
| 2 | 2 side by side | | 7 | 3 + 3 + 1 |
| 3 | 2 + 1 | | 8 | 3 + 3 + 2 |
| 4 | 2 × 2 | | 9 | 3 × 3 |
| 5 | 3 + 2 | | 12 / 16 | 4 × 3 / 4 × 4 |

In **Focus** the selected stream starts at about 72 % of the width; drag the split to change it.

#### 🏎️ Every driver's onboard, with live data

<p align="center">
<img src="docs/screenshots/stream-onboards.jpg" alt="Two Ferrari onboards side by side: telemetry overlays, the tile's quality and audio menu set to team radio, and the team radio list" width="100%">
</p>

- **All 20+ drivers' onboard cameras**, each a tile of its own, in team colours with number and name
- **Live data on the picture:** speed, gear, RPM, throttle, brake and DRS from the car's telemetry (2023+), drawn see-through over the onboard and updated every half second
- **Synced to the video:** **Jump to the start** puts every tile 10 s before lights out, found in the car data; nudge the data ±1 s or ±10 s if a broadcast runs early or late, and the offset is remembered per video
- Onboards open on the **team radio** audio track; switch to track sound, or any commentary language, per tile

#### 📻 Team radio, transcribed on your computer

- Each onboard's **radio button** shows how many messages there are so far and opens a scrollable list: time, words, and ▶ to hear the original clip
- **No spoilers:** a replay's list only shows what's been said up to the playhead, so it grows as you watch
- **Words, not just clips:** F1 publishes radio as audio only, so Lights Out transcribes every message on your own computer with NVIDIA's [Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) speech model through [onnx-asr](https://github.com/istupakov/onnx-asr), on the CPU (the panel asks before downloading the ~2.5 GB model). Nothing is sent to a cloud service
- **Live too:** during a session, new messages appear about 30 s after they're said

#### 👥 Pick any stream, or a whole team

<table>
<tr>
<td width="50%"><img src="docs/screenshots/stream-picker.jpg" alt="Add a stream: the four feeds and a card per driver in team colours, with ticks on the ones already on screen"></td>
<td width="50%"><img src="docs/screenshots/stream-teams.jpg" alt="Team view: a card per team with its two drivers"></td>
</tr>
<tr>
<td align="center"><sub><b>Add stream:</b> every feed and every driver, ticked when already on screen; a tile's label switches that tile the same way</sub></td>
<td align="center"><sub><b>Teams:</b> one click for the race feed big with a team's two onboards beside it</sub></td>
</tr>
</table>

<p align="center">
<img src="docs/screenshots/stream-team-ferrari.jpg" alt="Ferrari team view: the race in 4K big, Leclerc's and Hamilton's onboards beside it with their radio lists open" width="100%">
<br><sub><b>Team view, Ferrari:</b> the race in 4K, both onboards with their data and team radio</sub>
</p>

#### 🎛️ Every control you'd expect

| Where | What you get |
|-------|--------------|
| **Header** | Grid / Focus / Picture-in-picture layout, **Teams**, **Sync** (line every stream up with the one you hear), **Add stream**, and **More**: play or pause all, jump to the start, the 4K HDR switch, telemetry sync and your account |
| **Each tile** | A team-colour label that switches the stream, 📻 team radio, ⚙ quality / audio / data overlay, ⤢ focus, ✕ remove; the tile you hear has a white ring, and a click moves the sound to another |
| **Control bar** | Seek with the buffered range shown, ±10 s, volume, speed 0.5× to 2×, captions, picture-in-picture, fullscreen of one tile with its overlays |
| **Audio** | Every commentary language F1 TV carries, track sound without commentary, and team radio, each 192 kb/s stereo |
| **Keyboard** | `K` / `Space` play or pause · `←` `→` 10 s · `M` mute · `F` fullscreen tile |
| **Continue watching** | Close a replay and pick it up later where you left off, from Stream's first row |

The viewer is designed to stay out of the way: one line-icon set, no clutter, and each tile's controls only appear while your mouse moves over it. Opening it pauses the 3D replay behind it, so your GPU goes to the video.

#### 🗓️ Browse the season

Stream opens as a TV-app page for the season: a full-bleed billboard with the live session (else the latest race), **This weekend** chips for every session, **Continue watching**, **Coming up** with countdowns to each session, and a row per race weekend holding just its sessions, race first.

Without a subscription, Stream still shows the schedule with countdowns and opens each video on F1 TV's own site. Live streams use Widevine DRM and play in Chrome or Edge.

### 🖥️ A desktop app, too

<table>
<tr>
<td width="40%"><img src="docs/screenshots/desktop-launcher.png" alt="The Lights Out desktop launcher: Open in the app or Open in the browser"></td>
<td valign="middle">

Prefer an app to a browser tab? The desktop launcher opens Lights Out in **its own window** (with F1 TV sign-in built in) or **in your browser**. It's private by default: nothing is kept after you quit.

Windows users can [download the app](#%EF%B8%8F-download-the-windows-app) in three sizes, from Lite for older laptops to Full with every asset included: unzip and run, no Python needed.

</td>
</tr>
</table>

---

## 🚀 Quick start

> [!IMPORTANT]
> Needs **Python 3.14+** and **[uv](https://docs.astral.sh/uv/)**. [Node.js](https://nodejs.org) is only needed to run the frontend tests and `scripts/tile_list.py`.

```bash
git clone https://github.com/adityavar95/lights-out.git F1
cd F1
uv sync
uv run python src/server.py
```

Open **http://127.0.0.1:8086**. The first load fetches the page's libraries, so it needs internet. The **Download assets** button at the top right fetches every 4K sky and texture and the satellite ground (about 600 MB, ~45 min, resumes if interrupted), so nothing has to load later. Without it the 3D view streams lighter versions. The Windows app's [Full edition](#%EF%B8%8F-download-the-windows-app) comes with all of this, so there the button reads **Assets ready**. The server has no login, so it answers only this computer. To open it to other devices on the same network, start it with `LIGHTSOUT_LAN=1`; they then open **http://&lt;this-computer-ip&gt;:8086** (the server prints the address). If Windows Firewall asks, allow access on private networks.

> [!NOTE]
> On start-up the server builds the GPS replays of the season's last 3 races in the background. The first replay of any other GPS session downloads every car's trace from OpenF1 (20–60 s); the lap-timing replay plays meanwhile and the GPS replay takes over when it's ready. Finished sessions are cached in `.cache/replay/`.

> [!TIP]
> Team radio is transcribed on your own computer by NVIDIA's Parakeet speech model (through onnx-asr, on the CPU). The radio panel asks before it downloads the model (~2.5 GB, once).

## 🖥️ Desktop app and executable

Run Lights Out in its own window instead of a browser tab:

```bash
uv run python src/desktop.py
```

A small launcher asks **Open in the app** or **Open in the browser**. The app window uses the system's WebView2 (pywebview), so nothing else needs installing. In the browser, the launcher stays open: close it to stop Lights Out. If `src/server.py` is already running, the launcher uses it; set `LIGHTSOUT_PORT` to run on a port other than 8086.

### ⬇️ Download the Windows app

Each [release](https://github.com/adityavar95/lights-out/releases) comes in three editions. They're the same app: they differ only in how much of the 3D look comes in the download and how heavy the graphics are when it first opens.

| Edition | File | Unzipped | Best for |
|---|---|---|---|
| ⭐ **Standard** (recommended) | `LightsOut-standard-windows-x64.zip` | ~520 MB | Most PCs. Comes with the 4K skies and full-detail 2026 team cars. The 4K road textures and satellite ground are up to you: the **Download assets** button gets them (~550 MB) whenever you want them |
| 💎 **Full** | `LightsOut-full-windows-x64.zip` | ~1.1 GB | Fast PCs and offline use. Everything comes in the download, so nothing else is fetched later and the button reads **Assets ready** from the start |
| 🪶 **Lite** | `LightsOut-lite-windows-x64.zip` | ~200 MB | Older laptops, integrated graphics, slow connections. Opens on light graphics (Low preset, lighter skies and road textures, simpler car models). You can still raise the quality in ⚙ Settings, or use **Download assets** later |

Unzip it anywhere and run `LightsOut\LightsOut.exe`. No Python needed. Windows SmartScreen may warn about an unsigned app: **More info → Run anyway**. Keep the whole folder: the exe needs the `_internal` folder beside it.

Whatever an edition leaves out, the app streams a lighter version of it, so every edition shows every circuit and car. The app keeps its cache, downloaded assets and log (`lightsout.log`) in `%LOCALAPPDATA%\LightsOut`. If it doesn't open, look in that log. To remove Lights Out completely, delete the app folder and that one.

<details>
<summary><b>Build the Windows executable yourself (any edition)</b></summary>

On Windows 10/11, with the Quick start prerequisites:

1. Install the dependencies. `uv sync` also installs the dev group, which has PyInstaller:

   ```bash
   uv sync
   ```

2. Build the edition you want. Each one goes to its own folder, `dist/<edition>/LightsOut/`, and replaces only that edition's last build:

   ```bash
   uv run python scripts/build_exe.py standard   # or no argument: core files, skies, team cars (~520 MB)
   uv run python scripts/build_exe.py full       # every asset (~1.1 GB)
   uv run python scripts/build_exe.py lite       # core files only, opens on light graphics (~200 MB)
   ```

   The build first downloads the assets its edition bundles into `src/static/assets/` (git-ignored), then runs PyInstaller (a few minutes). Standard downloads ~310 MB. Full downloads ~25,000 satellite tiles too, so its first build takes about 45 minutes. Downloads resume: if any fail, the build stops before PyInstaller runs, so run it again. Lite downloads only the core files (~5 MB). PyInstaller's working files go in `build/`, and both `build/` and `dist/` are git-ignored.

3. Try it:

   ```bash
   dist/standard/LightsOut/LightsOut.exe
   ```

4. Zip each edition's folder to share it. Share the folder, not the exe alone:

   ```powershell
   foreach ($e in "standard", "full", "lite") {
     Compress-Archive -Path dist\$e\LightsOut -DestinationPath dist\LightsOut-$e-windows-x64.zip -Force
   }
   ```

> [!NOTE]
> Radio transcription runs on the CPU, and the exe leaves out NVIDIA's 2 GB of CUDA libraries (`--exclude-module nvidia` in `scripts/build_exe.py`). The speech model (~2.5 GB) isn't bundled: the radio panel asks before downloading it.

</details>

<details>
<summary><b>Publish a release (maintainers)</b></summary>

1. Bump `version` in `pyproject.toml` (for example `0.3.0`) and run `uv sync` so `uv.lock` follows.
2. Run every test, as CI does:

   ```bash
   npx -y -p typescript@7.0.2 tsc -p jsconfig.json
   uv run python scripts/test_all.py
   ```

3. If a circuit joined the calendar, refresh the satellite tile list (needs Node): `uv run python scripts/tile_list.py`.
4. Build all three editions and zip them (steps 2 and 4 above).
5. Open each edition once: the app should start, a race should replay, and lite should open on the Low preset.
6. Commit, tag and publish with the [GitHub CLI](https://cli.github.com). Each zip is under GitHub's 2 GB limit per file:

   ```bash
   gh release create v0.3.0 dist/LightsOut-standard-windows-x64.zip dist/LightsOut-full-windows-x64.zip dist/LightsOut-lite-windows-x64.zip \
     --title "Lights Out v0.3.0" \
     --notes "Windows builds. Standard (recommended, ~520 MB): 4K skies and team cars, the rest with Download assets. Full (~1.1 GB): everything included. Lite (~200 MB): light graphics for older PCs."
   ```

When a release changes a bundled asset, tell users who are updating to delete `%LOCALAPPDATA%\LightsOut\assets\.bundled-<edition>` once, so the new copy replaces the old one. Installing a bigger edition over a smaller one needs no step: the extra files are copied on its first start.

</details>

## 📺 F1 TV

Lights Out plays F1 TV with **your own subscription**, the way [MultiViewer](https://multiviewer.app) does: you sign in on F1's own site, your password never reaches the app, and nothing is stored on the server. Lights Out doesn't sell, share or unlock any video: it is a player for what you already pay F1 for.

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
| Anywhere | `?` every shortcut · `Ctrl K` / `⌘ K` command palette · `/` find a driver · `Esc` close a dialog |
| Replay | `Space` play/pause · `←` `→` seek 10 s · `-` `+` slower/faster · `1`–`5` Overview, Chase, Cockpit, T-Cam, Helicopter · `[` `]` previous/next driver · `,` `.` previous/next key moment · `H` highlights · `T` telemetry drawer · `Shift T` telemetry trace · `C` car showroom · `L` time of day · `G` graphics preset · click a driver to follow them |
| Driving | `W`/`↑` throttle · `S`/`↓` brake · `A` `D`/`←` `→` steer · `E`/`Shift` gear up · `Q`/`Ctrl` gear down · `X` clutch · `R`/`Space` DRS · `F` overtake · `P` pit · `C` camera · `Esc` pause · gamepads work too |
| F1 TV viewer | `K`/`Space` play/pause · `←` `→` ±10 s · `M` mute · `F` fullscreen tile |

## 🔌 API

Lights Out's backend is an open JSON API, so you can build your own tools on it. Table endpoints return `{"columns": [...], "data": [[...]], "total": n}`, capped at 5,000 rows. Interactive docs are at **http://127.0.0.1:8086/docs**.

<details>
<summary><b>All endpoints</b></summary>

| Endpoint | Returns |
|----------|---------|
| `GET /api/seasons` | Available seasons |
| `GET /api/season/{year}` | The season's sessions |
| `GET /api/calendar/{year}.ics` | Every session of the season for a calendar app |
| `GET /api/jolpica/{year}/{kind}` | Season data: `races`, `drivers`, `constructors`, `circuits`, `driverstandings`, `constructorstandings` |
| `GET /api/jolpica/{year}/{kind}?round={n}` | Round data: `results`, `qualifying`, `sprint`, `laps`, `pitstops`, standings |
| `GET /api/driver/{driverId}` | A driver's career: every result and season standing |
| `GET /api/track/{year}/{round}` | Circuit outline with corners, width and pit loss |
| `GET /api/geo/{year}/{round}` | The circuit's real outline in metres (for satellite imagery) |
| `GET /api/elevation/{year}/{round}` | Track heights along a lap (2023+) |
| `GET /api/pitlane/{year}/{round}` | The pit lane's path from GPS |
| `GET /api/circuit/{circuitId}` | The latest past race at a circuit |
| `GET /api/replay/{year}/{round}?session=Race` | Replay data (`mode: "gps"` or `"laps"`; `&laps=1` forces lap timing) |
| `GET /api/sessionlaps/{year}/{round}?session=` | A session's laps, stints and race control without the positions |
| `GET /api/overtakes/{year}/{round}` · `/api/stationary/…` · `/api/stints/…` | The Results tab's overtake ledger, pit-stop league table and stints (OpenF1) |
| `GET /api/events/{year}/{round}?session=` | A session's important events, for the viewer's seek bars |
| `GET /api/telemetry/{year}/{round}?driver={n}&session=Race` | One car's speed, rpm, gear, throttle, brake, DRS (2023+) |
| `GET /api/live` | Live (or latest) session state from F1's live timing |
| `GET /api/live/stream` | The same, pushed as server-sent events (`?ticket=` from `POST /api/live/ticket` carries an F1 TV token) |
| `GET /api/live/status` | Whether a session is on right now |
| `GET /api/live/track` | Outline and mini-sectors of the live session's circuit |
| `GET /api/live/table/{topic}` | One live topic (e.g. `TimingData`) as a table |
| `GET /api/f1tv/{year}/{round}` | The weekend's F1 TV videos |
| `GET /api/f1tv/account` | Whether the connected token is a live subscription (never the token) |
| `GET /api/f1tv/channels/{id}` | A video's feeds and driver onboards |
| `GET /api/f1tv/play/{id}?channel=` | A signed stream manifest (needs `X-F1-Token`) |
| `POST /api/f1tv/license` | Widevine licence relay for live streams |
| `GET /api/f1tv/telemetry/{year}/{round}/{driver}?session=` | A whole session's telemetry for the viewer's overlay |
| `GET /api/f1tv/radio/{year}/{round}?session=` | Team radio clips with transcripts |
| `POST /api/f1tv/radio/model` | Starts the speech model's download |
| `GET /api/f1tv/radio/audio?u=` | One radio clip's audio |
| `GET /api/assets` · `POST /api/assets/download` | Whether the 3D assets are downloaded; starts the download |
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
│   ├── paths.py         # where the app writes (.cache, or %LOCALAPPDATA%\LightsOut in the exe) and its edition
│   ├── assets.py        # core libraries and the Download assets job (skies, textures, cars, tiles)
│   ├── archive.py       # GPS replays from F1's timing archive (with an F1 TV token)
│   ├── ledgers.py       # OpenF1 overtakes, pit stops and stints for the Results tab
│   ├── desktop.py       # Desktop launcher: app window or browser, in-app F1 TV sign-in
│   ├── jolpica.py       # Jolpica queries, paging, disk cache for settled races
│   ├── replay.py        # Replays (OpenF1 GPS or Jolpica lap timing), telemetry, elevation, pit lane
│   ├── tracks.py        # Circuit outlines: MultiViewer, OpenF1 lap, GeoJSON fallback
│   ├── live.py          # Free live timing over F1's SignalR Core feed
│   ├── f1tv.py          # F1 TV catalogue, channels, play and licence
│   ├── f1auth.py        # F1 TV token expiry check
│   ├── radio.py         # Team radio clips and Parakeet (onnx-asr) transcription
│   └── static/          # Frontend: vanilla JS modules, no build step
│       ├── index.html, launcher.html, launcher.js, style.css, circuitdeck.css, analytics.css
│       ├── homeclass.js      # home look before first paint (no inline script, for the CSP)
│       ├── app.js            # Races / Play / Stream, calendar, hero, tabs
│       ├── boot.js           # first-paint bootstrap, theme
│       ├── globe.js          # satellite Earth launch view, flight to circuit
│       ├── globemath.js      # Mercator math for the globe
│       ├── replay.js         # Replay engine (GPS, lap timing, live)
│       ├── replaylive.js     # Live-session replay overlay
│       ├── scene3d.js        # three.js WebGPU scene, cameras, shadows, ground
│       ├── circuit3d.js, track3d.js, pit3d.js, trackside.js, city.js  # circuit geometry, street-circuit city
│       ├── cars3d.js, rb22.js, showroom.js                    # car models and showroom
│       ├── post.js, vfx.js, mirror.js, textures3d.js         # post-processing and effects
│       ├── satellite.js, groundwork.js   # satellite imagery fitted in a worker
│       ├── graphics.js, glass.js, palette.js  # quality governor, glass material, colour palette
│       ├── sim.js, vehicle.js, eras.js, simmode.js, player.js, racecraft.js,
│       │   tyres.js, weather.js, racecontrol.js, strategy.js, track.js, circuits.js   # race simulation
│       ├── playsetup.js      # setup card before a sim race (car, driver, circuit)
│       ├── pace.js, quali.js, reallap.js, pitdata.js  # timing helpers for sim
│       ├── hud.js, tower.js, onboard.js, pitwall.js, driverdeck.js, decks.js
│       ├── circuitdeck.js, carsdeck.js, trace.js, tracechart.js, tracemodal.js
│       ├── teledrawer.js     # canvas telemetry overlay on video tiles
│       ├── audio.js, audiodeck.js, commentary.js  # procedural engine sound and commentary
│       ├── stream.js, multiviewer.js, tvcontrols.js, radiopanel.js  # F1 TV and radio
│       ├── whatif.js, strategylab.js, optimiser.js  # Strategy lab
│       ├── story.js, storypanel.js, moments.js, highlights.js  # race stories and moments
│       ├── season.js, seasonview.js    # season page and calendar
│       ├── drivers.js, driver.js, charts.js, explorer.js, live.js, lanes.js
│       ├── focus.js, telemetry.js, scrubmarks.js  # telemetry trace helpers
│       ├── spoilers.js, share.js, settings.js, ledgers.js, favourite.js  # spoiler guard, sharing, prefs, favourite driver
│       ├── motion.js         # scripted motion (anime.js, theatre.js, loaded on first use)
│       ├── reaction.js       # F1 lights-out reaction-time minigame
│       ├── downloads.js      # Download assets button
│       ├── input.js, util.js, dash.js, loadstage.js
│       ├── tile_list.json, asset_hashes.json  # satellite tiles Download assets fetches, three.js hashes
│       └── models/           # rb22.glb, the 2026 team cars (1024 px copies), tyre textures, credits
├── scripts/
│   ├── build_exe.py     # PyInstaller build of LightsOut.exe: full, standard or lite edition
│   ├── fetch_assets.py  # every asset into src/static/assets for a checkout (~600 MB)
│   ├── tile_list.py     # regenerates static/tile_list.json when a circuit joins the calendar
│   └── test_all.py      # every test suite, as CI runs it
├── tests/               # test_server.py and the Node .mjs tests
├── docs/screenshots/    # the screenshots in this README
├── docs/media/          # the trailer (mp4) and its poster
└── pyproject.toml
```

</details>

## 🧪 Tests

Plain asserts, no test framework. Run everything, as CI does on Windows (stops at the first failure), and type-check the `// @ts-check` modules:

```bash
uv run python scripts/test_all.py
npx -y -p typescript@7.0.2 tsc -p jsconfig.json
```

Or one suite at a time:

```bash
uv run python tests/test_server.py   # backend
node tests/test_app.mjs               # app shell (the 3D stage stays lazy-loaded)
node tests/test_vehicle.mjs           # vehicle physics benchmark
node tests/test_motion.mjs            # scripted motion
node tests/test_live.mjs              # live car placement
node tests/test_telemetry.mjs         # HUD telemetry (g-forces, tyres, ERS, DRS)
node tests/test_sim.mjs               # race physics
node tests/test_play.mjs              # sim play loop and setup card
node tests/test_player.mjs            # player driving and AI racecraft
node tests/test_eras.mjs              # era profiles and lap times by era
node tests/test_circuits.mjs          # aero trim, grade, banking
node tests/test_trace.mjs             # telemetry trace and engineer insights
node tests/test_whatif.mjs            # Strategy lab model
node tests/test_multiviewer.mjs       # F1 TV overlay timing
node tests/test_lanes.mjs             # lap-timing replay lanes
node tests/test_drivers.mjs           # Drivers tab tallies
node tests/test_globe.mjs             # globe math (Mercator, tile, flight)
node tests/test_reaction.mjs          # reaction game logic
node tests/test_season.mjs            # season calendar
node tests/test_story.mjs             # race story / moments
node tests/test_moments.mjs           # moments extraction
node tests/test_highlights.mjs        # highlights
node tests/test_pace.mjs              # lap pace model
node tests/test_quali.mjs             # qualifying simulation
node tests/test_pitdata.mjs           # pit-stop data helpers
node tests/test_graphics.mjs          # graphics quality governor
node tests/test_glass.mjs             # glass material
node tests/test_palette.mjs           # colour palette
node tests/test_ledgers.mjs           # ledger helpers
node tests/test_marks.mjs             # scrub marks
node tests/test_dash.mjs              # dashboard helpers
node tests/test_tokens.mjs            # auth token helpers
node tests/test_share.mjs             # share URL helpers
node tests/test_spoilers.mjs          # spoiler guard
node tests/test_util.mjs              # general utilities
```

## 🤝 Contributing

Lights Out gets better every time a fan adds something they wish it had. You don't need to be an expert, and every kind of help counts:

- **🐛 Report a bug:** open an [issue](https://github.com/adityavar95/lights-out/issues) with the race, session and what you saw (a screenshot helps)
- **💡 Suggest a feature:** a circuit preset, a new chart, a camera angle, a better strategy model
- **🏁 Add circuit detail:** banking, kerbs, barriers and DRS zones live in `src/static/circuits.js` `PRESETS`, and every circuit added makes the replays and the simulator better
- **🏎️ Tune an era:** the cars of every season since 1950 are in `src/static/eras.js`; if you know how a 1970s Cosworth or a 2004 V10 should feel, help calibrate it
- **🌐 Spread the word:** star the repo, share a screenshot of your favourite race, tell a friend who loves the sport

**Pull requests:**

1. Fork the repo and create a branch
2. Keep to the house style: vanilla JS modules with no build step, small pure functions where physics or maths is involved
3. Add or update a test in `tests/` for new logic (plain asserts, see [Tests](#-tests)) and run them
4. Open a PR describing what changed and why, with a screenshot for anything visual

Be kind and constructive: this is a hobby project made by and for people who love racing.

## 🗂️ Data sources

Lights Out stands on the shoulders of open, community-run projects.

| Source | Used for |
|--------|----------|
| [Jolpica F1](https://github.com/jolpica/jolpica-f1) | Results, qualifying, sprints, lap times, pit stops, standings, calendar, careers |
| [OpenF1](https://openf1.org) | Car GPS, telemetry, elevation, intervals, laps, tyres, pits, race control, weather, team radio (2023+) |
| F1 live timing (SignalR Core) | Live sessions: timing, tyres, track status, race control, weather, team radio |
| [F1 TV](https://f1tv.formula1.com) | Video, with your own subscription |
| F1 timing archive | GPS replays from F1's own archive, with your F1 TV token |
| [MultiViewer](https://multiviewer.app) API | Circuit outlines, corners, mini-sectors, pit loss |
| [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) | GeoJSON outlines for circuits MultiViewer doesn't cover |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite ground under each circuit |
| [Poly Haven](https://polyhaven.com) | HDRI skies and ground textures |
| [Wikipedia](https://www.wikipedia.org) | Driver portraits and biographies |
| [flagcdn](https://flagcdn.com) | Country flags |

Please respect each source's own terms and rate limits; Lights Out caches what it can so it asks them as little as possible.

## ⚠️ Limitations

- **Live GPS and live video need F1 TV.** Without a token, live cars are placed per mini-sector (about 20 per lap) and cars in the pits leave the track.
- **OpenF1 is locked while any session is live.** Cached GPS replays still open, race replays fall back to lap timing, and the session list comes from Jolpica. GPS replays of a session appear once OpenF1 publishes it, usually shortly after it ends.
- **OpenF1's free tier allows ~30 requests a minute**, and a GPS replay costs ~30, so building several at once queues them.
- **F1 TV blocks an IP after a few hundred catalogue searches**; Stream fetches three weekends at a time to stay under it.
- **4K needs 2025+ races**, the main feeds, and a device that decodes HEVC Main10 2160p (not Firefox, nor Chrome without GPU HEVC).
- **Live sessions play in 1080p on Windows.** F1 TV only sends live 4K to Apple devices, as FairPlay-encrypted HLS, which Windows browsers and the desktop app can't decrypt. For 4K, watch the replay once F1 TV re-publishes it (it can take a day or more).
- Lap-timing replays (before 2023) are exact only at the start/finish line. Races before 1996 have no lap data and no replay, though you can still simulate them.
- Track maps use each circuit's modern layout, so historic races on since-changed layouts show today's track. GeoJSON outlines have no known start line or direction.
- Tables over 5,000 rows are truncated in the data explorer.

## 🔒 Privacy

Lights Out runs on your computer and keeps what's yours on it.

- Your F1 TV token stays in the browser tab (sessionStorage) or the desktop app's private window, and is sent only with this app's own requests. The server keeps no token or password.
- Usage counts are anonymous per-day totals of a fixed list of events in `.cache/counts.json` on your own machine: no id, cookie, IP or URL. Nothing is sent under Do Not Track or Global Privacy Control.
- No ads, no third-party analytics, no account.

## 📜 License

Lights Out is open source under the [MIT License](LICENSE): free to use, copy, modify and share, for anyone.

The 2026 car models (the RB22 and the nine team cars) are by Tyler_Dave, licensed [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) (see [`src/static/models/CREDITS.md`](src/static/models/CREDITS.md)). The tyre textures are from "Ferrari F1-75" by Sketcher, licensed [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/): non-commercial use only, so a commercial fork must replace `src/static/models/pirelli_tread*`. Data, imagery and video come from the [sources above](#%EF%B8%8F-data-sources) under their own terms. Driver portraits in the screenshots are loaded from Wikipedia and belong to their photographers.

## 🏳️ Disclaimer

Lights Out is an unofficial, independent fan project. It is not associated in any way with the Formula 1 companies, F1 TV, the FIA, or any team or driver. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trademarks of Formula One Licensing B.V. Team names and liveries are used only to identify real teams. F1 TV content requires your own subscription.

## 🙏 Acknowledgements

Huge thanks to the people behind Jolpica, OpenF1, MultiViewer, f1-circuits, Poly Haven, Tyler_Dave's car models, shaka-player, three.js, anime.js, theatre.js, onnx-asr and NVIDIA's Parakeet. Their open work is what makes a free project like this possible.

Trailer: made with huashu-motion, with an original score and sound effects synthesized for it. Multiview shots use simulated F1 TV feeds.

<div align="center">

<br>

**Made with ❤️ by fans, for fans. If Lights Out made a race more fun, give it a ⭐ and share it with someone who loves the sport.**

<sub>It's lights out and away we go. 🏁</sub>

</div>
