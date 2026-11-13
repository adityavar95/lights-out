# UI/UX Audit: Lights Out

Audited Nov 13, 2026 against the running app (`src/server.py`, http://127.0.0.1:8086) at 1440×900 and 390×844, dark theme, 2026 Brazilian GP loaded. Screens covered: intro, Races (all seven tabs), Play setup, Stream, globe, race calendar, command palette, phone layout.

The short version: the 3D replay is good enough to sell the product, but the frame around it doesn't hold up. The header breaks at a common laptop width, half the app speaks in a terminal monospace while the other half speaks Inter, and the screens a first-time visitor clicks second and third (Drivers, Results podium, Play) show empty boxes and stray labels.

---

## 1. Critical

### [x] C1. The "NEXT session" pill covers the Stream button
- **Location:** Header, `.nextbtn` next to `.viewswitch` (`style.css:104`, `:134`), every view, from 1301 px up to about 1500 px wide.
- **Pass:** Designer + First-Time User
- **The Problem:** At 1440 px the countdown pill ("NEXT Practice 1 · USA · Fri 06:00 AM in 6d 14h") sits on top of the three-way switch, so it reads "Races | Play | S". Clicking where "Stream" should be opens the countdown instead, which happens to also go to Stream. An automated click on `[data-view=stream]` was rejected because `#nextbtn` covered it. One of three primary destinations is partly hidden and looks broken at the most common laptop resolution.
- **The Fix:** Add `flex: none` to `.modeswitch` so it can't shrink below its content. Change the `.nextbtn` hide rule at `style.css:111` from `max-width: 1300px` to `max-width: 1560px`, or better, move the countdown out of the header into the hero banner's right side (where the podium sits after a race), and keep it in the header only when `≥1600px`. Check 1280, 1366, 1440 and 1536 widths.
- **Status:** Done. `.modeswitch` gets `flex: none`; the countdown hides below 1560 px (`style.css`), and the paired Stream spacer rule was removed. Checked at 1280/1366/1440/1536/1600: no overlap.

### [x] C2. Stream view drops the right side of the header
- **Location:** Header in Stream view (`body[data-section=stream]`).
- **Pass:** Designer + First-Time User
- **The Problem:** In Stream the race picker disappears, the header items move, and at 1440 px "Assets ready" and the theme/globe buttons run off the right edge (only the search icon is visible). Switching views moves controls under the cursor, and theme and globe can't be reached from Stream at all.
- **The Fix:** Give every view the same header slots: keep `.racepick` in the DOM in Stream and set `visibility: hidden` instead of `display: none`, so widths don't change. Put the right-hand cluster (`#dlbtn`, `#globebtn`, `#palbtn`, `#themebtn`) in a wrapper with `margin-left: auto; flex: none; display: flex; gap: 8px`, so it can never overflow. Fixing C1 removes most of the width pressure.
- **Status:** Done. Right-hand buttons wrapped in `.topright` (`index.html`, `flex: none`); `.racepick` uses `visibility: hidden` in Stream, so the header doesn't reflow. Theme and globe stay hidden in Stream on purpose (Stream is forced dark, `style.css`), not by overflow. `margin-left: auto` skipped: the race picker's own auto margin already pushes the cluster right.

### [x] C3. Phone: the replay controls wrap to three rows and the camera menu is clipped
- **Location:** Race replay control bar at 390 px wide.
- **Pass:** Designer + First-Time User
- **The Problem:** The bar wraps into "Race · ▶ · 1× · Highlights" / "Why" / scrubber, and the camera button ("TV Chase") and "⋯" are cut off at the bottom of the screen. With a 140 px header, a banner and tabs on top, the 3D stage gets about 420 px of an 844 px screen. The start lights sit on top of the cars. On a phone, which is how most people will open a shared link, the main feature is cramped and part of its controls can't be seen.
- **The Fix:** Under `@media (max-width: 640px)`: hide the session select, Highlights and Why from the bar and put them in the `⋯` menu (`util.js dropUp`). Keep one row: ▶, speed, scrubber, camera icon, ⋯. Make the scrubber the full width of a second row if it must wrap. Shrink the header to one 48 px row: logo, race picker, and a single menu button holding season, theme, globe and assets. Hide `.hero` on replay on phones (the race picker already names the race).
- **Status:** Done (phone, ≤640 px). Session, Highlights and Why move into the ⋯ menu (`replay.js` phoneGroup); bar is one row with the scrubber on its own full-width row; hero hidden on the replay tab (`body[data-tab]`, set in `app.js activate`), which also hides the hero's spoiler toggle and F1 TV button there. Header: logo, season, race and a ⋯ menu (assets, globe, search, theme) on one row; the view switch keeps a second row (96 px total, was 134). Further mobile work is on hold: desktop only for now.

### [x] C4. Drivers tab: a grid of empty photo boxes
- **Location:** Races → Drivers, `drivers.js` card grid.
- **Pass:** Designer + First-Time User
- **The Problem:** Every card starts with a roughly 170 px empty dark box where a headshot should be, for all 25 drivers. On first view the tab looks broken, and the page is about 60% empty space. It's also the generic AI "card grid" pattern: same-size cards, a P-badge in the corner, and stats with no ranking.
- **The Fix:** Show the photo area only when the headshot has loaded (`img.onload` adds `.has-photo`; without it the area is `display: none`). Without photos, use a compact row layout: position, team-colour bar, name, team, points, wins and podiums in a single line, like Standings, and use the space for one useful comparison such as the teammate head-to-head that's already computed ("vs Russell Q 11-9"). Load headshots lazily with a fixed `aspect-ratio` so cards don't jump.
- **Status:** Done. Photo area shown only once the photo has loaded (`drivers.js photo()` adds `has-photo` to box and card); a card without one pads for its P badge. The compact row layout without photos was not built.

### [x] C5. Results podium: P1 headshot cut in half, P3 headshot blank
- **Location:** Races → Results, podium block.
- **Pass:** Designer + First-Time User
- **The Problem:** The winner's photo is clipped to a half circle by its container, and P3 (Hadjar) shows an empty circle. The block that's supposed to celebrate the winner is the most visibly broken thing on the page.
- **The Fix:** Remove the `overflow: hidden` / fixed height on the podium column that clips the P1 avatar, or reserve `padding-top` for the avatar's full height plus its raised step. When there's no headshot, show the driver code in team colour inside the circle (`background: color-mix(in oklab, var(--team) 25%, transparent)`) instead of an empty disc.
- **Status:** Done. Could not reproduce the clipped P1 or the blank P3 with photos loaded (they were the moment before Wikipedia answered). Fallback added: the circle shows the driver code in team colour on a 25% team tint (`drivers.js faces()`).

### [x] C6. Play: turn-number labels show through the setup card
- **Location:** Play → setup card (`playsetup.js`) over the 3D circuit.
- **Pass:** Designer + First-Time User
- **The Problem:** The circuit's 3D turn labels ("15", "7", "6", "9") are drawn on top of the card: "15" over the title, "6" and "9" under "Change circuit / Change car". It looks broken, and the numbers read like they belong to the form.
- **The Fix:** Give the setup card a higher z-index than the label layer (CSS2D renderer element), or hide the turn labels while the setup card is open (`labels.visible = false` in `showSetup`, restored on Start race).
- **Status:** Done. Labels hidden while a card overlay (setup, pause, results) is up: `replay.js setOverlay` toggles `.nolabels` on the map.

---

## 2. High Impact

### [x] H1. Two typefaces fighting: a terminal monospace for UI text
- **Location:** Replay HUD, Play setup card, Strategy lab "What-if finishing order", replay control bar, Stream metadata, Drivers card footers.
- **Pass:** Designer
- **The Problem:** `var(--mono)` is used well beyond numbers: on button labels ("Highlights", "Why", "Start race", "Change circuit"), form values ("5 laps", "Medium"), section titles ("TIMING", "G-FORCE") and whole sentences. The Play setup card is entirely monospace, so it looks like a debug panel, while the header, tabs and tables use a geometric sans. Two visual languages side by side, with no rule for which goes where.
- **The Fix:** Rule: mono only for tabular numbers (times, gaps, laps, speeds, countdowns). Everything else uses `var(--face)`. Grep `font-family: var(--mono)` in `style.css`, `circuitdeck.css` and `analytics.css` and limit it to numeric classes; for mixed text, use `font-variant-numeric: tabular-nums` on the sans instead.
- **Status:** Done. Mono kept for numeric classes only; labels, headings, sentences and the HUD/glass roots moved to `var(--face)` with `tabular-nums` kept (24 rules in `style.css`, 2 in `circuitdeck.css`, 1 in `analytics.css`).

### [x] H2. 14 different border radii and 30+ font sizes
- **Location:** `style.css`, `circuitdeck.css`, `analytics.css`.
- **Pass:** Designer
- **The Problem:** Measured: radii of 0, 2, 3, 4, 6, 8, 10, 12, 16, 24, 50%, 999px plus three tokens (31 uses of a hard-coded `4px` beside 53 uses of `--dp-radius-panel`). Font sizes: 12, 13, 13.5, 14, 15, 16, 17, 18, 20, 22, 24, 28, 30, 34, 38, 40 px plus nine different `clamp()`s. The panels, chips and pills on one screen (replay: timing panel, weather chips, control-bar pills, driver card) all have slightly different corners. That's why the app feels assembled instead of designed.
- **The Fix:** Three radii: `--r-sm: 6px` (chips, inputs), `--r-md: 12px` (panels, cards), `--r-pill: 999px`, plus `50%` for avatars. A six-step type scale: 12 / 13 / 15 / 18 / 24 / 40, plus one display `clamp()` for heroes. Replace the hard-coded values with tokens, and add a test in `tests/` that fails on any raw `border-radius: Npx` outside the token block.
- **Status:** Done. `--r-sm` 6 / `--r-md` 12 / `--r-pill` 999 tokens; every raw px radius mapped (≤8 → sm, 10–24 → md); old radius tokens alias them. Px font sizes snapped to 12/13/15/18/24/40 (`--text-7: 40px` added). The nine fluid `clamp()` sizes on Stream were left as they are. New `tests/test_tokens.mjs` fails on a raw px radius.

### [x] H3. Replay HUD: car number "1" next to a car running P3
- **Location:** Race replay, 3D car label ("1 NOR") vs. Timing panel (NOR P3) vs. driver card ("P3").
- **Pass:** First-Time User
- **The Problem:** The label above the followed car reads "1 NOR" in an orange box that looks like a position, while the timing tower says P3. A newcomer reads it as "Norris is leading" and can't match it to the tower.
- **The Fix:** Show the race position in the 3D label (`P3 NOR`) and the car number only in the driver card, or put the number in the team colour without a box and add a `P3` tag. The tower and the label must agree.
- **Status:** Done. 3D tags show the race position from the same board as the tower (`scene3d.js setTagPositions`, called per frame in `replay.js render`). Verified: tag `P3 NOR` = tower P3.

### [x] H4. Unlabelled "Why", "Highlights" and "MODEL" controls
- **Location:** Replay control bar; G-force panel header.
- **Pass:** First-Time User
- **The Problem:** "Why" on its own says nothing (why what?). "Highlights" doesn't say whether it filters, jumps or plays a reel. "MODEL" in the G-force panel header, and the green "I" circles repeated 22 times in the tower, are jargon with no legend. The interval column shows "~" for every row.
- **The Fix:** Rename "Why" to what it opens (e.g. "Why positions changed"), or give it an icon plus `title` and `aria-label`. "Highlights" becomes "Jump to moments ▾". Change the G-force "MODEL" header to "Estimated" with a tooltip. Add a one-line legend under the TIMING header ("I = intermediate tyre"). Hide the interval column until it has data instead of showing "~".
- **Status:** Done, partly differently. Why → "Why positions changed" (+ aria-label). Highlights → "Play highlights", not "Jump to moments ▾": the button plays a reel, it isn't a menu. G-force header → ESTIMATED with a tooltip. A tyre key under TIMING. The "~" column is the ⌁ compare-telemetry button (it has a tooltip), not an interval column, so nothing was hidden.

### [x] H5. The asset-loading panel stays on the intro's first frame
- **Location:** Intro (first visit), top centre: "Sky: Overcast / Satellite ground / Car model … ready".
- **Pass:** Designer + First-Time User
- **The Problem:** A loader with progress bars that already read "ready" stays over the hero shot, under the weather bar. It's leftover technical state, and it pulls the eye away from the headline.
- **The Fix:** In `loadstage.js`, fade the panel out 400 ms after every row reports ready, and never show it at all if everything was ready before it was first drawn (`if (allReady) return`).
- **Status:** Done. `loadstage.js`: the panel waits 300 ms before showing, never shows if everything finished first, and hides 400 ms after all rows are ready (1.6 s for announcements and offline notes).

### [x] H6. "Assets ready" is a permanent status label pretending to be a button
- **Location:** Header, `#dlbtn` (`downloads.js`).
- **Pass:** Designer
- **The Problem:** A disabled pill that says "Assets ready" sits in the main header on every screen. When everything is fine it's noise, and it takes width that pushes the header into C1 and C2.
- **The Fix:** (Keep the button visible, per an earlier decision.) Collapse it to a 30 px icon button like its neighbours (a download glyph with a green check when complete), with "Assets ready" in `title` and `aria-label`. Show text only while a download is running ("Downloading 42%").
- **Status:** Done. Idle/ready states are a 30 px download icon with a green dot when complete; label in `title`/`aria-label`. Text only while downloading, on error and for "Reload for 4K" (`downloads.js`).

### [x] H7. Play: dead controls under the modal, and two ways to do one thing
- **Location:** Play setup screen.
- **Pass:** First-Time User
- **The Problem:** Before a race exists, the bottom bar shows ▶, 1×, a scrubber and a camera menu. Pressing ▶ does nothing useful. The "CIRCUITS / CARS" pills at the top do the same as "Change circuit / Change car" in the card. The season and race pickers in the header stay active and change things behind the card. A first-timer doesn't know which control matters.
- **The Fix:** Hide `.controls` while `showSetup` is open. Remove the top CIRCUITS/CARS pills in the setup state (keep them during a race). Make the card the only input: header season and race changes while the setup card is open should update the card's circuit field instead of reloading the scene behind it.
- **Status:** Done. `.mapwrap.setup` hides the deck and the CIRCUITS/CARS pills while the card is up (`replay.js showSetup`/`startPlay`/`showRace`). Header season/race changes already re-render the card (verified 2026 → 2025).

### [x] H8. Strategy lab opens on a result that says nothing
- **Location:** Races → Strategy lab.
- **Pass:** First-Time User
- **The Problem:** Default state: "P2 → P2, ±0.0 s over the race vs the real strategy". The headline number is a zero. The chart legend promises a dashed "real race" line that is hidden under the what-if line, and the shaded columns are explained in a grey footnote at the bottom.
- **The Fix:** On first open, run "Find best strategy" for the selected driver automatically and show that result ("P2 → P1 with 2 stops, −6.4 s"), with "Real strategy" as the reset. Draw the real race in `--muted` at 2 px under a 2.5 px what-if line so both can be seen. Put "Shaded = safety car laps" in the legend row, not the footnote.
- **Status:** Done. The tab opens by running Find best strategy and loading the top plan (verified: "P2 → P1 ▲1, −24.6 s"); real line 2 px muted under a 2.5 px what-if; a "safety car laps" key in the legend row (`strategylab.js`).

### [x] H9. Lap chart: 22 overlapping lines and no starting focus
- **Location:** Races → Lap chart.
- **Pass:** Designer + First-Time User
- **The Problem:** All 22 drivers are drawn at full opacity with dashed teammates, so it reads as noise. The hint ("Hover a line…") is 12 px grey text above 20 chips.
- **The Fix:** Draw every line at 25% opacity by default and highlight the race's podium three (or the driver followed in the replay) at 100% with labels. Hover or a chip click brings that driver to 100%. Keep that selection when switching tabs (store it with the replay's followed driver).
- **Status:** Done. The podium three start followed, the rest at 25%; the followed set is kept per race across tab switches (`charts.js` PINS). Not linked to the replay's followed driver.

### [x] H10. Replay timing tower and driver card are clipped
- **Location:** Race replay, right column driver card (speed / gear); timing panel.
- **Pass:** Designer
- **The Problem:** At 1440×900 the driver card is cut off at the bottom: the "GEAR" label under "3" is half hidden by the control bar. The right column stacks three panels and doesn't fit the stage height.
- **The Fix:** Make the right column `display: flex; flex-direction: column; max-height: calc(100% - var(--controls-h) - 16px)` and let the circuit map shrink (`flex: 1 1 auto; min-height: 120px`) so the driver card always fits. Or collapse G-force + tyres into one tabbed panel.
- **Status:** Done. Right column at ≥1101 px: the circuit map shrinks first (min 120 px), and a container query hides it when the column is under 590 px, so the driver card always clears the deck. At 1440×900 the circuit minimap is therefore hidden.

### [x] H11. Globe: unlabelled dots and a close button in the far corner
- **Location:** Header globe button → globe overlay.
- **Pass:** First-Time User
- **The Problem:** About 20 identical red dots with no names; you have to hover each one to find a circuit. Close is a small × at the bottom-left, far from the globe button (top-right) that opened it. The hint says "choose a race above", pointing back at the header.
- **The Fix:** Label the season's circuits with their country name (12 px, fading out on the far side of the globe), and mark the current race and the next one differently (filled white = shown, outlined = next). Move close to the top-right under the header, and make Esc close it (say so in the hint).
- **Status:** Done. Every pin shows its country; the race on screen is a white dot, the next race an outlined one (`app.js pin`, `globe.js setPins`); close is top-right under the header; the hint says Esc closes.

### [x] H12. Race calendar: wrong flag/name pairs and truncated names
- **Location:** Header race picker (`#calendar`), seen at 390 px.
- **Pass:** First-Time User
- **The Problem:** Round 16 shows the Malaysian flag with "Malaysia" and the subtitle "Bahrain Grand Prix in Mala…". Subtitles are cut off with "…" on phones, so the date — the one piece of information you need — is the part that gets lost.
- **The Fix:** Check the 2026 round 16 data in `jolpica.py` (the country and race name disagree). In the calendar, put the date on the right side next to the "3D GPS" tag and let the race name truncate instead (`.calendar .sub { display: flex } .date { flex: none }`).
- **Status:** Done. The data is right: Jolpica itself names 2026 round 16 "Bahrain Grand Prix in Malaysia" at Sepang, so `jolpica.py` was not changed. The date moved next to the tag, where it can't be cut; the race name truncates instead (`app.js` calendar).

### [x] H13. Race-control log under the stage is unstyled
- **Location:** Race replay, list below the stage ("0:01:30 RACE START", "CLEAR IN TRACK SECTOR 12").
- **Pass:** Designer
- **The Problem:** Plain lines with all-caps FIA messages in bold, no panel, no grouping, unrelated to the timeline above. "CLEAR CLEAR IN TRACK SECTOR 12" repeats the category as a word. It looks like debug output.
- **The Fix:** Put it in a `.card` panel titled "Race control". Use flag-colour category chips (green/yellow/red/blue) instead of repeated words, write messages in sentence case, and make each row clickable to seek the replay (`replay.seek(t)`).
- **Status:** Done. A "Race control" card; flag chips in sentence case; messages in sentence case without the repeated flag word (`util.js rcText`, tested in `tests/test_util.mjs`); a click on a row seeks the replay there.

---

## 3. Nice to Have

### N1. Hero banner duplicates the race picker and the podium on every tab
- **Location:** `.hero` on Races.
- **Pass:** Designer
- **The Problem:** "Brazilian Grand Prix · Round 20 · date · circuit" + P1/P2/P3 + "Hide results" + "F1 TV" takes 56 px above every tab, and the header already names the race. "Hide results" is a spoiler toggle that doesn't say so.
- **The Fix:** Rename "Hide results" to "Hide spoilers" with an eye icon. On Results and Standings, where the podium is already on screen, hide the podium chips in the banner.

### N2. Selected tabs and pills use a white fill, the loudest thing on screen
- **Location:** Tabs, view switch, Results "Race/Qualifying", Lap chart toggle.
- **Pass:** Designer
- **The Problem:** In dark mode the active state is a solid white pill, brighter than the primary action button ("Explore this race", "▶ F1 TV") which uses the same white. Selection and call-to-action look the same.
- **The Fix:** Selected state: `background: var(--glass-strong); color: var(--ink); box-shadow: inset 0 0 0 1px var(--hairline)`. Keep solid `--accent` for one primary action per screen.

### N3. Keyboard shortcuts aren't discoverable
- **Location:** Replay, Ctrl+K palette.
- **Pass:** First-Time User
- **The Problem:** C (camera), T (telemetry), Esc and Ctrl+K exist, but only Ctrl+K is mentioned, and only in a tooltip.
- **The Fix:** Add `?` to open the `KEYHELP` overlay that already exists, and show key hints on the right side of menu rows ("Camera ▾" items show `C`; "Telemetry trace" shows `T`). Add Space = play/pause and ←/→ = seek ±10 s if they're missing.

### N4. Raw data tab is a wall of chips with nothing below
- **Location:** Races → Raw data.
- **Pass:** Designer
- **The Problem:** 15 identical pills and then a black screen. There's no default table and no indication which chip is selected.
- **The Fix:** Open "Results" for the current race by default, give the selected chip the selected style from N2, and show the row count next to each label after its first load.

### N5. Standings: the gap column has no label and the bars repeat the number
- **Location:** Races → Standings.
- **Pass:** Designer
- **The Problem:** "−111, −128…" is unlabelled grey text. The bars show the same thing as the points number next to them.
- **The Fix:** Add a header row (Pos / Driver / Points / Gap to leader). Turn the bar into a split: points scored this race in a brighter tint at the end of the bar, so it shows what changed.

### N6. Intro buttons have different weights
- **Location:** Intro card.
- **Pass:** Designer
- **The Problem:** "Explore this race →" has a doubled focus-ring-style border that looks like a stuck focus state. "Drive a race" and "Watch on F1 TV" are equal-weight secondaries, and F1 TV needs an account the visitor may not have.
- **The Fix:** Primary gets a solid fill with no outer ring (keep the ring for `:focus-visible`). Make "Watch on F1 TV" a text link with ↗ so it's clearly a different kind of action.

### N7. Stream billboard: the hero text runs over a busy satellite image
- **Location:** Stream → billboard.
- **Pass:** Designer
- **The Problem:** The 140 px "Las Vegas Grand Prix" over a bright city image has weak contrast on "Grand Prix". The connect bar right below repeats "Connect to watch" from the hero button.
- **The Fix:** Add a `linear-gradient(to right, rgb(0 0 0 / .75), transparent 60%)` under the text. Remove the "Connect to watch" hero button when the connect bar is visible, or the other way round.

### N8. Layout shift when a tab first loads
- **Location:** Drivers, Results, Strategy lab on first open.
- **Pass:** Designer
- **The Problem:** Panels render empty and then grow when data arrives, so the page jumps.
- **The Fix:** Give each tab panel a skeleton with fixed heights (`min-height` per panel, shimmer rows like `.skeleton`) shown until its fetch resolves.

---

## Summary

The quickest wins with the most effect, in order: C1 (one CSS line), C6, C5, C4, H5, H6. Together they remove most of what makes a first visit feel broken. H1 and H2 are the systemic fixes: until mono and the radii are under control, every new screen will repeat the problem.
