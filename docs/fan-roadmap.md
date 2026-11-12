# Lights Out: audit and fan roadmap

Written 2026-11-12 on `roadmap-phase-1` at `91fc8ce`. Third audit in a week, so it does not repeat the first two
(`AUDIT_AND_MASTER_PLAN.md`, Nov 5-6, and `implementation.md`, Nov 11-12). It checks what they left open and then looks
at the app as an F1 fan would. Sizes: **S** under a day, **M** one to three days, **L** a week or more.

## Progress (2026-11-12, uncommitted)

- **Built, with asserts and seen in a headed browser:** W1 spoiler-free mode, W3 weekend schedule and calendar file, A1 tyre strategy bars, W4 stewards ledger, A2 ideal lap (no speed trap: the saved replays don't hold trap speeds).
- **Built, with asserts, not seen live:** L1 feed recorder and playback (no session to record yet), L3 as-it-stands tower column, W2's clinch line (the 2026 title is already decided, so the line doesn't show; the what-if table is not built), W5 session start notices (no assert: it is a permission prompt and a `Notification`).
- **Looked at and put back:** A9 units (speeds are printed in 18 modules, several on canvas: not a one-day change), S3 real conditions (the real weather is only in a GPS replay, about 30 OpenF1 requests to build).
- **Not started:** L2, L4, W6, A3-A8, S1-S2, S4-S7, P1, P2, and everything in section 2.

## 1. Where the project stands

- **Health:** all 27 suites pass (`scripts/test_all.py`, run today). No open GitHub issues.
- **Engineering debt is mostly paid.** The two earlier audits fixed about 120 findings. What they left is listed in
  section 2; none of it blocks daily use.
- **Domain rules checked today and found right:** points per era (8/9/10/25, fastest-lap point 2019-2024 only, the 2014
  double finale, sprint points by year), title maths, the two-compound rule with sprints exempt, DRS interlocks (2 laps
  to 2023, 1 from 2024, "OVERTAKE" from 2026), blue flags, VSC delta, wet crossover points, one-move defence.
- **The gap is on the fan side, not the code side.** The app is strong on things nobody else has (3D replay, Strategy
  lab, era simulation, multiview). It is thin on the things a fan opens an F1 app for every weekend: what's on and when,
  who needs what for the title, what the stewards did, and not having the result spoiled.

## 2. Still owed from the earlier audits

| Item | What | Size |
|---|---|---|
| Merge | `roadmap-phase-1` holds four phases of fixes and the Simulate-feel work, not yet on `master` | S |
| Live paths | Live merge, live Widevine, the licence proxy and live GPS have only run against stubs (T3.6). Battle forecast and pit rejoin (T3.4) wait on the same | see 3 |
| Browser checks | T1.10, T1.11, T1.12, T2.1 (hidden tabs), T4.9, T4.10 were written but not seen in a browser | S |
| CSP | Sent as report-only; enforcing waits on a headed sweep (T4.6) | S |
| Release checks | Built exe on a machine without Python, Esri offline terms, "Lights Out" trademark search (T4.8). The owner's to run | - |
| Docs | `CLAUDE.md` names `CONTEXT.md` and `docs/adr/`, which don't exist (T4.5). `AUDIT_AND_MASTER_PLAN.md` and `implementation.md` sit in the repo root against the project's own rule: move to `docs/` | S |
| File size | Eight files over the 500-line rule and growing: `replay.js` 937, `scene3d.js` 923, `multiviewer.js` 785, `server.py` 716, `cars3d.js` 708, `circuit3d.js` 701, `app.js` 593, `style.css` 1513. No user gain; split only at clean seams when a file is next touched | - |
| Tests | `app.js`, `replay.js` and every 3D module are imported by no test. New pure logic keeps going into new tested modules, which is the right fix | - |

## 3. The deadline that orders everything: three live weekends left

Las Vegas (race Nov 22), Qatar (Nov 29, sprint) and Abu Dhabi (Dec 6). After that there is no live session until
March 2027, and every live feature stays unverified for four months.

| ID | Do before Las Vegas | Why | Size |
|---|---|---|---|
| L1 | **Record the live feed.** `live.py` appends each SignalR message to a JSONL file when a flag is set; the same module can play a file back at real speed in place of the socket | Turns three weekends into a permanent test fixture. Every live feature below can then be built and tested in the off-season | S-M |
| L2 | Run the T3.6 checklist during a session and write down what broke | The release blocker from `implementation.md` | S |
| L3 | **Standings as it stands.** Live tower positions into points into provisional championship order, beside the tower | The TV graphic every fan watches in a title run-in. `season.js` already has the points tables | S |
| L4 | Battle forecast and pit rejoin on live data (the deferred F10) | The pit wall's rejoin predictor exists for the Simulation; live needs the same sums on live gaps | M |

## 4. New features, ranked by fan value for the effort

Every row uses data the app already fetches unless "new source" says otherwise.

### 4.1 Race-weekend companion (small, used every weekend)

| ID | Feature | How | Size |
|---|---|---|---|
| W1 | **Spoiler-free mode** | One setting. Hides the banner's podium, the "NEW replay" notice text, Results, Standings and the calendar's winner until the replay has been played to the flag or the user reveals it. This is a replay app whose banner prints the podium above the ▶ button | S |
| W2 | **Title permutations** | "What does X need this weekend": for each contender, the finishing positions that clinch or keep the title alive, from `season.js` `alive` and `maxRemaining`. Then a what-if table: set results for the races left and see the standings | M |
| W3 | **Whole-weekend schedule in local time, with a calendar file** | The header counts down to the next session only. Show all sessions of the weekend, and add `/api/calendar.ics` from the Jolpica rows the server already caches | S |
| W4 | **Stewards ledger** | Results section from the race-control feed (2023+): penalties, investigations, deleted laps and track-limit strikes per driver, each row jumping the replay to that moment | S |
| W5 | **Session start notice** | A browser or desktop notification at lights out and when a replay becomes available, off by default | S |
| W6 | Weekend weather forecast on the next-race banner | New source: Open-Meteo (free, no key), one request per weekend, cached | S |

### 4.2 Analysis a fan expects and the app lacks

| ID | Feature | How | Size |
|---|---|---|---|
| A1 | **Tyre strategy bars** | The classic one-bar-per-driver stint chart, coloured by compound. `/api/stints` already feeds the pace table, which shows it only as text cells | S |
| A2 | **Best sectors, ideal lap, speed trap** | Per session from OpenF1 laps (sector times and trap speeds are in `/api/sessionlaps`' source): each driver's theoretical best against their real best | S |
| A3 | **Ghost-lap battle in 3D** | Qualifying's top laps started together on the 3D circuit, as cars or ghosts, with the gap opening corner by corner. `reallap.js` and the GPS replay hold everything needed. The most shareable thing the app could make | M |
| A4 | **Team radio on the replay** | Transcribed radio exists only inside the F1 TV viewer. Put the clips on the GPS replay's scrubber as pins and play them at their moment; add a text search over a race's radio | M |
| A5 | **Any two drivers compared** | Head-to-head exists for teammates only. Open it to any pair: season and career, qualifying and race | M |
| A6 | **Circuit history** | In the circuit deck: past winners, poles converted to wins, how often a safety car came out (2023+ from race control). One Jolpica request per circuit, in the settled cache | S-M |
| A7 | **Clip and picture export** | `canvas.captureStream()` plus `MediaRecorder` for a highlights-reel clip, and a still for the link preview (the recorded `og:image` shortcut) | S-M |
| A8 | Glossary for new fans | Short explanations (undercut, VSC, dirty air) on the terms the Why panel and Strategy lab already use | S |
| A9 | Units | km/h or mph, °C or °F, one setting | S |

### 4.3 Simulate depth

| ID | Feature | How | Size |
|---|---|---|---|
| S1 | **Reliability and incidents** | Era-weighted mechanical retirements (a 1985 turbo fails far more than a 2024 car), and race control that reacts by itself: a stopped car brings a VSC or safety car. Today the race director is manual and nobody ever retires | M |
| S2 | **Time trial against the real pole lap** | The player against a ghost built from the real lap's telemetry (2023+), with the trace modal's Δt live. The saved reference lap is half of this already | M |
| S3 | Real conditions | Start from the real race's weather feed instead of the fixed 26 C air and 38 C track | S |
| S4 | Qualifying before the race | One timed lap per car, or Q1-Q3, to set the grid | M-L |
| S5 | Penalties for the player | Track limits, pit-lane speeding, causing a collision | M |
| S6 | Safety car detail | Lapped cars un-lap themselves; red flag with a standing restart | M |
| S7 | Season mode | A championship over a real calendar | L |

### 4.4 Platform

| ID | Feature | How | Size |
|---|---|---|---|
| P1 | **Phone as a second screen** | The server already listens on the LAN. A phone layout of the live tower alone, for use beside the TV | M |
| P2 | Installable page | A web manifest so the phone view sits on the home screen | S |

## 5. Suggested order

| When | What | Gate |
|---|---|---|
| Now, before Nov 20 | Merge the branch. L1 (feed recorder), L3, the owed browser checks | A recorded Las Vegas session on disk |
| Las Vegas to Abu Dhabi | L2 and L4 on live sessions. W1, W2, W3 while the title is still open | T3.6 checklist filled in |
| December | A1, A2, W4, A9, S3: the small ones | Suites green |
| Off-season | A3, A4, then S1, S2, P1 | Each checked in a headed browser |
| Before the 2027 opener | Replay the recorded feeds through every live feature. CSP enforced. Release checks | - |
| Later, if wanted | A5, A6, A7, S4-S7 | - |

## 6. Not building

- **Fantasy leagues, accounts, comments:** need a hosted service and user data; the app's promise is local and private.
- **Win-probability models and car ratings:** opaque numbers from private data; the what-if's exactness is the point
  (decided Nov 5).
- **Historic track layouts and pre-1996 lap replays:** no free data source has them.
- **Live 4K on Windows:** F1 TV sends it as FairPlay only.
- **A WebGL fallback:** a recorded decision.
