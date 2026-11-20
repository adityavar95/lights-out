# Handover after improvement phase 8 (20 Nov 2026)
Branch / commits: `improve-phase-8`, from `improve-phase-7`.

Done:
1. **Deep links** (`share.js` `clean`/`parseHash`/`formatHash`): `#y/r/drivers?career=<driverId>`, `#y/r/strategy?focus=<driverId>&stops=18,40`
   (`stops=` is a no-stop plan), `#y/r/replay|sim?car=<1996-2026>`. app.js keeps the open view's state in `A.extra`; `view()` writes it
   through `formatHash`; `route()` reads only the fields the link's tab uses (`EXTRA`). Modules report changes with a
   `f1:address` event (replaceState, no Back step): `drivers.js` `career` (open/close), `strategylab.js` `change()` (user edits only,
   not the tab's own best-plan pick), `carsdeck.js` `pick`/close and the new `openCar(year)`.
   Reaction game: a five-lights button in the header (`index.html` `#reactbtn`).
2. **Add to calendar**: already there (the hero's link to `/api/calendar/{year}.ics` for a weekend still to finish). Nothing changed.
3. **A5 any-pair head-to-head**: `season.js` `headToHead` (pure, tested), shown in the career dialog's "Head to head" section
   (`drivers.js` `compare`). It picks from the season's drivers and costs one `/api/driver` request. Grid order, not qualifying,
   because Jolpica's qualifying starts in 1994. **A4 radio pins**: `scrubmarks.js` `radioMarks` (tested). `replay.js` fetches
   `/api/f1tv/radio` for 2023+ GPS replays and pins only the **followed car's** clips (every car's would cover the scrubber).
   A pin seeks and plays the clip (`playClip`; it needs the F1 TV token, otherwise it says "Connect F1 TV"). `,`/`.` still step only the highlight pins.
4. **Favourite driver**: `favourite.js` (localStorage `lo-favourite`). Set with ★ in the career dialog. It's first and marked in the
   Results classification, the driver standings and the Drivers grid, and pre-selected in replays (`favCar`, also after the
   stand-in→GPS swap). The favourite team is the team colours' `f1team`: first in constructor standings.

Checked (agent-browser headed 2040x1000, server on :8097, window error listener: none caught): the career link opens Verstappen and the
head-to-head shows VER vs NOR (career 170 races, 2025 24). The strategy link loads NOR with laps 20 and 40, and removing a stop rewrites the address.
The car link opens BGP 001 2009. Closing the dialog drops `career` from the address. NOR is first in the 2025/23 results. The Qatar replay shows 9 NOR radio pins with words.

Not done or not verified, and why:
- Radio clip *audio* not played: no F1 TV token in the test browser.
- With the speech model installed, opening a 2023+ GPS replay now queues that session's clips for transcription
  (same as opening the radio panel). It runs without a token, so the fetches fail fast. Watch the CPU if a token is connected.
- No graphics change, so no fps table.

Watch out:
- `A.extra` is cleared on a tab or race change outside routing. A module that wants something in the address must send `f1:address`.
- A link's replay moment (`pending`) is dropped if the cars deck changes the address meanwhile.

Next: phase 9, start with item 1 (router.js). The `A.extra`/`EXTRA` code moves there too.
