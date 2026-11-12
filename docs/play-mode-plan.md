# Play mode plan: Simulate becomes a browser game

Decided 12 Nov 2026. Races (real data, 3D replay) stays as it is. Simulate becomes **Play**: a single-player browser game.
No multiplayer, accounts or server work.

## The problem

Simulate runs on the replay's stage with the replay's controls (▶, speed menu, Highlights, Story), and it starts as an
all-AI race that plays itself. Driving is a switch inside the collapsed DRIVER panel (`driverdeck.js` `D.master`). It
reads as a second replay, not a game.

## What already exists (reuse, don't rebuild)

- Physics, AI, pit stops, flags, chequered flag, `R.done`: `sim.js` `createRace` (it already takes `laps` and `drivers`).
- Player input, assists, rumble: `input.js`, `player.js`, `driverdeck.js`.
- Best lap, best-lap trace and live delta per car: `sim.js` `timing` (`car.best`, `car.bestTrace`, `car.lapDelta`).
- Circuit and car pickers: `circuitdeck.js`, `carsdeck.js`.
- Entry list for a race: `simmode.js` `entries`.
- Overlay with buttons: `replay.js` `setOverlay` / `overlayBtn`.

The internal key stays `sim` (`A.mode`, `body[data-mode=sim]`, the `#year/round/sim` link, `f1mode` in localStorage).
Only what the user reads changes, so shared links and stored settings keep working.

## Phase 1: its own identity

1. **Rename to Play.** `index.html:28` (label and title), `app.js` (`startIntro` button, `commands` labels and hints),
   `replay.js` `idleHint` ("Race it yourself with 2026's cars"), `circuitdeck.js` `preview` card title,
   `replay.js:676` mode text.
2. **Setup screen before anything runs.** New `playsetup.js`: a card over the bare circuit with
   - Circuit and Car: buttons that open the existing decks.
   - Driver: the entry list.
   - Mode: Race, Time trial, Spectate.
   - Laps: 3, 5, 25 %, full (Race and Spectate only).
   - Difficulty: Easy, Medium, Hard, mapped onto the existing AI pace (0.90, 1.00, 1.05).
   - Start.
   The last setup is kept in localStorage. In Play, `loadData` waits for Start instead of running on open.
   `simSession` gains an options argument (`laps`, `drivers`) that it passes to `createRace`.
3. **You drive by default.** On Start: select the chosen driver, `R.setPlayer(id)`, `enableInput(true)`, chase camera,
   speed forced to 1×, DRIVER panel expanded on the first run so the key help is seen. Spectate skips `setPlayer` and
   keeps the speed menu.
4. **Hide the replay's controls in Play.** Extend `style.css:121` to the ▶ button, speed menu, Highlights and Story
   when a player is driving. Space is DRS while driving (`input.js` takes it first), so the pause menu is Esc only.

Check: open Play, start a 3-lap race at one circuit, drive a lap, confirm no replay control is on screen.

## Phase 2: a complete game loop

5. **Results screen.** When `S.sim.done` (`replay.js` `tick`): the finishing order, your position, your best lap, and
   Restart, Change setup, Next circuit. Restart re-runs `simSession` with the same setup.
6. **Pause menu.** Esc while driving pauses and shows Resume, Restart, Controls (the existing `KEYHELP`),
   Quit to setup.
7. **Time trial.** `createRace` with the player alone and no lap limit. The HUD already shows the delta to your best
   lap. Bests are stored in localStorage per circuit and season, and listed on the setup screen.
8. **Ghost car.** Record the player's position at each track sample on the best lap and draw it as a translucent car.
   This is the only item that needs new 3D work (`scene3d.js`), so it comes last and can be dropped.

Status (12 Nov 2026): items 1-8 done.

Check: finish a race and see results; pause and resume mid-corner; set a time-trial best, reload, see it listed.

## Tests and docs

- `tests/test_sim.mjs`: a race with `laps: 3` ends after 3 laps; a one-car race runs and records a best lap.
- New `tests/test_play.mjs`: setup to `createRace` options, difficulty mapping, bests storage (pure functions in
  `playsetup.js`).
- `docs/architecture/frontend.md` and `testing.md`: add `playsetup.js`; `README` wording Simulate to Play.

## Order

Phase 1 in order (1, 2, 3, 4), then 5, 6, 7, 8. Each numbered item is one commit and leaves the app working.

## Not doing

Multiplayer, leaderboards, accounts, career or championship mode, damage, new handling work (tracked separately in the
sim-feel work), renaming the internal `sim` key.
