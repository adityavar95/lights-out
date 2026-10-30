# UX audit: first visit and conversion

The app has no sign-up or paywall, so "conversion" here means: **a first-time visitor watches a race replay and comes
back**. Everything below is ranked by how much it moves that, judged from the running app (Oct 29, 2026, desktop and
375 px phone). The app has no analytics, so none of this is measured; see 11.

## Done

**1. The product was hidden behind its own chrome.** A new visitor got two red switches, a season picker, a race picker,
a "Latest session" button, a race banner card and eight tabs before the 3D replay. The replay itself then waited behind
"Press ▶ to watch the session".
*Changed:* the first visit (no link, never seen before, or `#intro`) opens on the latest race, full window, from a few
seconds before lights out at real speed, with the camera chasing the leader. One card says what the app is, with
one main button (*Explore this race*) and two alternatives (*Simulate a race*, *Watch on F1 TV*). Esc, the button or
any header control drops into the normal page with the replay still playing. With reduced motion turned on, the card
shows without the autoplay. (`app.js` `startIntro`, `replay.js` `intro`)

**2. The header asked six questions at once.** Two segmented controls side by side (Analytics/Stream and
Watch/Simulate) read as one confusing control, both in red.
*Changed:* one three-way switch (Analytics, Simulate, Stream). The season picker lost its "Season" label (the four-digit
year says it), and the Live button only shows while a session is actually live; between sessions its "Latest session"
opened the race the page already shows.

**3. Pre-1996 races failed only after you pressed ▶.** Pick 1958 and the replay tab looked ready; ▶ then said "No
lap-by-lap timing for this race".
*Changed:* each run race in the race picker is tagged with what ▶ gives (*3D GPS* from 2023, *Lap replay* from 1996,
*Results only* before; `replay.js` `replayKind`, hidden in Simulate, which races any of them). A results-only race opens
on Results, and the next race with a replay goes back to the replay unless you picked a tab yourself. Its stage says
why there's no replay, ▶ is disabled, and it offers Simulate only when the circuit has a track map (1958 Monaco
yes, Ain-Diab no).

**4. The replay control bar had 18 controls.** Session, ▶, speed, scrub bar, five cameras, three cockpit toggles,
Cinematic, Sound and Telemetry trace, all in one strip.
*Changed:* the bar keeps session, ▶, speed and the scrub bar, plus two menus that open above it. *Camera ▾* names the
current camera and lists the five, with the halo / car / wheel toggles under them in Cockpit view; C steps through
the cameras (it already did while driving). *⋯* holds Cinematic, Sound with its level sliders, and Telemetry trace
(T still opens it). 6 controls in a replay, 4 in Simulate. (`util.js` `dropUp`, `onboard.js` `nextCamera`)

**5. Eight tabs of equal weight.** The two things nobody else has (Strategy lab, the 3D replay) sat beside plain tables.
*Changed:* the tabs run Race replay, Strategy lab, Drivers, Results, Lap chart, Standings. Qualifying is now a toggle in
Results (Race / Sprint / Qualifying, one table at a time, the last one picked kept from race to race; a weekend with
qualifying but no race yet opens on it), and old `#…/qualifying` links land there. Data explorer is a quiet *Raw data*
tab at the far right. Seven tabs, and the first three are the ones only this app has.

**6. The first load of an uncached GPS replay said "can take up to a minute".** Honest, but it lost people.
*Changed:* the server builds the GPS replays of the season's last 3 races at start-up (newest first, one at a time for
OpenF1's ~30 requests a minute), so those load in ~0.1 s. Any other 2023+ race whose GPS replay hasn't answered in
1.5 s plays its lap-timing replay meanwhile (labelled "GPS replay loading…") and switches to GPS at the same moment of
the race, still playing, when it lands. Measured on the uncached 2024 Australian GP: lap timing at 13 s (its Jolpica laps
weren't cached either), GPS at 29 s; before, nothing played for those 29 s. Practice and qualifying have no lap-timing
replay, so they still wait.

**7. F1 TV failed at the last step.** Stream let you browse everything, then a card opened the player and only there
said "Not connected", because playback here needs your F1 TV account.
*Changed:* until the tab is connected, a bar at the top of Stream says videos open on F1 TV and offers *Connect F1 TV*
(the same steps as the player's, now one shared panel, `multiviewer.js` `connectPanel`). Each card wears "↗ F1 TV" and
opens the video's own page on f1tv.formula1.com, which plays for anyone signed in there; the billboard's button reads
"▶ Play on F1 TV ↗". Connected, the bar and badges go and videos play here as before. An expired sign-in says so in the bar.

**8. The race banner repeated the header.** A 160 px flag and a 40 px race name, with the flag and country already in
the race picker above it.
*Changed:* one line: the race name, then round, date and circuit, then the podium (or the countdown) and the F1 TV
button. 138 px became 54 px at 1280 px wide, so the stage starts 84 px higher; on a phone it wraps to three short rows.

**9. No reason to come back.** Nothing changed for a returning visitor.
*Changed:* a return visit after a race the last visit hadn't seen gets a notice at the bottom ("NEW · United States Grand
Prix replay · ▶ Watch"); Watch opens that race's replay and plays it, from Stream too. The first visit only remembers
the latest race (the intro covers it), and the notice shows once. The header counts down to the season's next session
("NEXT Practice 1 · Mexico in 1h 36m", every 30 s) and opens Stream's Coming up row; on phones it's left out, since
the header's two rows have no room for it (Stream has the schedule).

**10. "F1 Data Browser" sounded like a developer tool,** and led with Formula 1's trademark.
*Changed:* the app is **Lights Out** (the moment every race starts, and the moment the intro opens on), with an "LO" mark
in the old logo's red badge: page title, header, the API's title and the README. Formula 1 stays only where it's a fact:
the footer's "not associated with Formula 1" and the data itself. Not checked: whether "Lights Out" is taken as a
trademark or domain for a similar product; do that before it goes public.

**11. Nothing was measured.** None of the above could be judged after the fact.
*Changed:* the page sends our own server one event name when something worth knowing happens; the server keeps per-day
totals and nothing else (no id, cookie, IP or page address; no third party; nothing sent under Do Not Track or Global
Privacy Control). Events: `visit`, `return_7d` (another day than the last visit, within a week), `intro_shown`,
`intro_explore` / `intro_simulate` / `intro_stream`, `watched_60s` (a replay or simulation played for a minute of real
time), `new_race_watch`, `stream_open`, `video_here` / `video_f1tv`. Read them at `/api/counts`, e.g. intro_explore ÷
intro_shown is the intro's click-through and return_7d ÷ visit the return rate. They live in `.cache/counts.json`, so
clearing the cache resets them.

**12. Phones: tabs scrolled sideways without a hint.** At 375 px only three of the seven tabs showed, and nothing said
there were more.
*Changed:* whichever edge of the tab bar has more tabs past it fades out, following the scroll (a CSS scroll-driven
animation, like the header's lift): at the start only the right edge, at the end only the left. A bar that fits (desktop)
has no fade. Firefox has no scroll-driven animations yet, so there it stays as before.

All twelve items are done. What's left is outside the code: checking "Lights Out" for trademarks before going public,
and reading `/api/counts` after real use to see which of these changes moved anything.
