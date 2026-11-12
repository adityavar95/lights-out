// Race replay: the 3D stage with the broadcast HUD round it (timing tower, telemetry, radar, control deck).
import {teleUrl} from './reallap.js';
import {compared, openCompare} from './tracemodal.js';
import {highlightReel, shotsFor} from './highlights.js';
import {setupStory} from './storypanel.js';
import {nextMoment} from './moments.js';
import {markLayer, gpsMarks, lapMarks, NO_MARKS} from './scrubmarks.js';
import {get, el, rows, failed, teamColor, fmtClock, fmtLap, lastBefore, trackStatus, led, covered, dropUp, count} from './util.js';
import {init3d, setTrack, setCars, updateCars, setView, setParts, setTyre, setGround, setPitLane, setStartLights, setDaylight, nextSky, nextTier, announce, hasCockpitWheel, setGhost, timed} from './scene3d.js';
import {setupOnboard, setCameraUi, setWheelAngle, nextCamera} from './onboard.js';
import {liveInfo, liveStatus, liveClock} from './live.js';
import {setupLive} from './replaylive.js';
import {setupDrawer, toggleDrawer, updateDrawer} from './teledrawer.js';
import {toggleCars} from './carsdeck.js';
import {setupHud, setRadar, renderRadar, renderFocus, renderFeed, STATUS} from './hud.js';
import {SIM, simSession, simState, realPitLane, entries} from './simmode.js';
import {setupCard, resultsCard, pauseCard, saveBest, ghostAt, PACE} from './playsetup.js';
import {drive, KEYHELP} from './driverdeck.js';
import {enableInput} from './input.js';
import {setupDecks, updateDecks} from './decks.js';
import {buildTower, timing, renderTower, stableOrder, COLUMNS} from './tower.js';
import {drsZones} from './telemetry.js';
import {fetchCircuit, annotate, f1Coords} from './circuits.js';
import {focusFrame} from './focus.js';
import {pitTrace} from './strategy.js';
import {lanes, GRID, apart, headings} from './lanes.js';
import {commentaryUi, syncCommentary} from './commentary.js';
import {sessionStart} from './multiviewer.js';
import {until} from './stream.js';

const SPEEDS = [0.5, 1, 2, 5, 10, 20, 50, 100];

let ui, S;  // ui: DOM handles; S: state of the race currently shown
let played = false;  // Play has started a race in this tab


export function setupReplay(root, copyView) {
  ui = {
    session: el('select', {class: 'neu sessionsel', 'aria-label': 'Session to replay'}),
    play: el('button', {class: 'neu play', 'aria-label': 'Play replay', onclick: togglePlay}, '▶'),
    speeds: el('select', {class: 'neu speedsel', 'aria-label': 'Replay speed', title: 'Replay speed (- / + keys)', onchange: e => setSpeed(+e.target.value)},
      SPEEDS.map(s => new Option(`${s}×`, s, s === 1, s === 1))),
    speed: 1,
    scrub: el('input', {type: 'range', min: 0, max: 1, step: 1, value: 0, 'aria-label': 'Replay position', class: 'scrub'}),
    clock: el('span', {class: 'clock'}, '0:00:00'),
    lap: el('div', {class: 'lapcount'}, ''),
    flag: el('div', {class: 'flagpill'}, ''),
    startLights: el('div', {class: 'startlights', hidden: true, role: 'img', 'aria-label': 'Start lights'}, ...Array.from({length: 5}, () => el('i'))),
    mode: el('div', {class: 'mode'}, ''),
    weather: el('div', {class: 'weather'}),
    map: el('div', {class: 'trackmap', role: 'img', 'aria-label': '3D track map: drag to rotate, scroll to zoom'}),
    overlay: el('div', {class: 'overlay'}),
    rc: el('ol', {class: 'rcfeed', 'aria-label': 'Race control messages'}),
    tower: el('ol', {class: 'tower', role: 'group', 'aria-label': 'Timing tower'}),
    column: 0,
    show: {halo: true, body: true, wheel: true},
  };
  ui.colBtn = el('button', {class: 'neu colbtn', onclick: () => { nextColumn(); render(true); }});
  ui.view = el('button', {class: 'neu', 'aria-pressed': false, title: 'Collapse the telemetry panels', onclick: e => {
    setCinematic(e.currentTarget.getAttribute('aria-pressed') !== 'true');
  }}, led(), 'Cinematic');
  showColumn();
  ui.session.onchange = () => {
    if (!ahead()) { ui.play.disabled = false; return loadData(false); }
    const {year, round, track, proj, race} = S;  // nothing to show yet: the stage goes back to the bare circuit
    reset({year, round, track, proj, race});
    if (ui.has3d) setCars([], select, year);
    idleHint();
  };
  ui.scrub.oninput = () => { stopReel(); S.t = +ui.scrub.value; render(true); };
  document.addEventListener('keydown', e => {
    if (!S || e.ctrlKey || e.metaKey || e.altKey || !root.offsetParent || covered()) return;
    // a focused button keeps its own Space / Enter (a click) and a tab its arrows; every other shortcut still works after clicking ▶
    if (['INPUT', 'SELECT'].includes(e.target.tagName) || (e.target.tagName === 'BUTTON' && ['Space', 'Enter', 'NumpadEnter'].includes(e.code)) || e.target.closest('[role=tab]')) return;
    // the stage's own keys work on the bare circuit; the rest need a session playing
    if (e.code === 'KeyC' && ui.has3d) toggleCars();  // while driving, input.js takes C first for the next camera (driverdeck.js)
    if (e.code === 'KeyL' && ui.has3d) announce(`Sky: ${nextSky()}`);
    if (e.code === 'KeyG' && ui.has3d) announce(`Graphics: ${nextTier()}`);
    if (e.code === 'KeyH') toggleHighlights();  // before the replay's loaded too: it loads it
    if (!S.data) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    const step = {Minus: -1, NumpadSubtract: -1, Equal: 1, NumpadAdd: 1}[e.code];  // - / + : slower / faster
    if (e.code === 'Escape' && S.reel) stopReel();
    if (e.code === 'Escape' && S.setup && S.sim?.player) togglePause();
    if (e.code === 'KeyT' && !e.shiftKey) { if (toggleDrawer() && !S.selected) setMode('chase'); render(true); }  // the drawer is one car's;  // render: so it isn't empty on a paused replay
    const cam = {Digit1: 'overview', Digit2: 'follow', Digit3: 'onboard', Digit4: 'tcam', Digit5: 'heli'}[e.code];
    if (cam && ui.has3d) setMode(cam);
    if ((e.code === 'Comma' || e.code === 'Period') && !S.sim) jumpMoment(e.code === 'Period' ? 1 : -1);
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') cycleDriver(e.code === 'BracketRight' ? 1 : -1);
    if (step && !S.sim?.player) setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, SPEEDS.indexOf(ui.speed) + step))]);
    if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && !S.sim) {  // a simulation can't be rewound
      stopReel();
      S.t = Math.min(S.data.duration, Math.max(0, S.t + (e.code === 'ArrowRight' ? 10 : -10) * Math.max(1, S.speed / 5)));
      render(true);
    }
  });
  const viewport = el('div', {class: 'viewport'}, ui.map, ui.overlay);  // the 3D view; HUD panels float round it
  ui.stage = el('div', {class: 'mapwrap'}, viewport);
  root.append(el('div', {class: 'replay'}, ui.stage, ui.rc));
  let cams = null;
  try {
    init3d(ui.map);
    ui.has3d = true;
    cams = setupOnboard(viewport, {mode: setMode, parts: p => {
      Object.assign(ui.show, p);
      setParts(p);
      setCameraUi(S.cam, ui.show.wheel);
      render(true);
    }});
  } catch (e) {
    ui.map.append(el('p', {class: 'empty'}, '3D view needs WebGL, which is turned off in this browser.'));
  }
  setupDrawer(ui.stage);
  const hud = setupHud(ui.stage, {onClose: () => S?.selected && select(S.selected),
    onErsMode: m => S?.sim?.setErsMode(S.selected, m), onDrsTest: () => S?.sim?.toggleDrsTest(S.selected)});
  hud.top.append(ui.flag, ui.lap, ui.mode, ui.weather);
  ui.reelBtn = el('button', {class: 'neu reelbtn', title: 'Race highlights: the key moments in about 5 minutes (H)', onclick: toggleHighlights}, 'Highlights');
  ui.story = setupStory(ui.stage, () => S, openLap);
  ui.story.btn.classList.add('storybtn');
  ui.reelText = el('b');
  ui.reelCount = el('small');
  ui.reelBar = el('div', {class: 'reelbar glass', hidden: true, role: 'status'}, ui.reelCount, ui.reelText,
    el('button', {class: 'neu', title: 'Next clip (.)', onclick: () => S.reel && reelGo(S.reel.i + 1)}, 'Skip'),
    el('button', {class: 'neu', title: 'Back to the full replay (Esc)', onclick: () => stopReel()}, 'Exit'));
  ui.stage.append(ui.startLights, ui.reelBar);
  hud.left.append(el('div', {class: 'towerhead'}, el('span', {}, 'TIMING'), ui.colBtn), el('div', {class: 'towerscroll'}, ui.tower));
  // the deck itself: session, play, speed, position, camera. Cinematic and the telemetry trace sit in the ⋯ menu; sound and graphics in Settings, top right
  const moreBtn = el('button', {class: 'neu', popovertarget: 'moremenu', 'aria-haspopup': 'true', 'aria-expanded': false,
    title: 'More: cinematic view, commentary, telemetry trace', 'aria-label': 'More controls'}, '⋯');
  hud.more = el('div', {class: 'deckmenu', id: 'moremenu', popover: 'auto', 'aria-label': 'More controls'}, el('div', {class: 'deckgroup'}, ui.view, commentaryUi(),
    el('button', {class: 'neu', title: 'Copy a link to this moment of the replay', onclick: () => { hud.more.hidePopover(); copyView(); }}, 'Copy link')));
  hud.more.addEventListener('click', e => e.target.closest('[aria-controls=tracedeck]') && hud.more.hidePopover());  // the trace panel takes over
  dropUp(moreBtn, hud.more);
  hud.deck.append(
    el('div', {class: 'deckgroup'}, ui.session, ui.play, ui.speeds, ui.reelBtn, ui.story.btn),
    el('div', {class: 'deckgroup grow'}, (ui.marks = markLayer(ui.scrub, pickMark)).wrap, ui.clock),
    cams ?? '', el('div', {class: 'deckgroup'}, moreBtn, hud.more));  // no WebGL: no cameras
  setupDecks(ui.stage, hud, () => S, {togglePlay});  // pit wall, driver deck (under the tower), audio mixer, telemetry trace
}

// the command palette's way to the stage's keys
export const stageCommands = {
  drawer: () => toggleDrawer(),
  sky: () => { if (ui.has3d) announce(`Sky: ${nextSky()}`); },
  tier: () => { if (ui.has3d) announce(`Graphics: ${nextTier()}`); },
  highlights: () => toggleHighlights(),
};

export function setCinematic(on = !ui.stage.classList.contains('cinematic')) {
  // the panels about to hide mustn't keep the focus: it would drop to the page
  if (on && ui.stage.querySelector(':is(.hud-left, .hud-right, .pitwall):focus-within')) ui.play.focus({preventScroll: true});
  ui.view.setAttribute('aria-pressed', on);
  ui.stage.classList.toggle('cinematic', on);
}

// the first visit's opening shot: lights out at real speed, the camera chasing the leader, side panels out of the way
// while the welcome card shows (it may already be gone: the track can take longer than the click)
export async function intro() {
  const token = S.token;
  setSpeed(1);
  setCinematic(document.body.classList.contains('intro'));
  await loadData(false);
  if (token !== S.token || !S.data) return;
  S.t = Math.max(0, lightsOut(S.data) - 6);  // a few seconds on the grid, then lights out
  setMode('chase');
  if (!S.playing) togglePlay();
}

// the speed-trap and as-it-stands columns only exist in live timing; replays skip them
function nextColumn(step = 1) {
  ui.column = (ui.column + step) % COLUMNS.length;
  const has = {trap: S?.live, champ: S?.standings};  // champ: a live race or sprint, once the standings are here
  while (COLUMNS[ui.column][0] in has && !has[COLUMNS[ui.column][0]]) ui.column = (ui.column + 1) % COLUMNS.length;
  showColumn();
}

function showColumn() {
  ui.colBtn.replaceChildren(led(), COLUMNS[ui.column][1]);
  ui.colBtn.setAttribute('aria-label', `Timing column: ${COLUMNS[ui.column][1]}. Click to switch`);
}

function setSpeed(s) {
  ui.speed = s;
  if (S) S.speed = s;
  ui.speeds.value = s;
}

// What a run race can replay, as replay.py decides: every car's GPS position (OpenF1, 2023 on), positions from lap
// times (Jolpica's laps, races from 1996), or nothing but results before that. null: not run yet.
export const REPLAY_KINDS = {gps: ['3D GPS', "Every car's real position on track"], laps: ['Lap replay', 'Positions worked out from lap times'],
  results: ['Results only', 'No lap timing before 1996: results, standings and drivers']};
export const replayKind = (year, date) => date > new Date().toISOString().slice(0, 10) ? null : year >= 2023 ? 'gps' : year >= 1996 ? 'laps' : 'results';

// sim: Simulate mode, a physics race on this circuit (the session list is then just that, and hidden)
export async function showRace(year, round, sessions, sim = false) {
  reset({year, round});
  ui.session.replaceChildren(...(sim ? [SIM] : sessions).map(s => new Option(s, s)));
  ui.session.value = sim ? SIM : sessions.includes('Race') ? 'Race' : sessions.at(-1) ?? '';
  const token = S.token;
  setOverlay('Loading track…');
  try {
    S.track = await fetchCircuit(year, round);  // with heights
  } catch (e) {
    S.track = null;
  }
  if (token !== S.token) return;
  const f1 = f1Coords(S.track);
  drawTrack(S.track?.x, S.track?.y, S.track?.rotation ?? 0, S.track?.corners ?? [], f1, f1 ? 0.1 : 1);
  if (ui.has3d && S.track) setGround(year, round);  // satellite imagery, when it loads
  // the race row: session times (this season's "hasn't run yet") and the circuit's lat/long (the sky's sun, the Simulation's
  // too); app.js has this season's list already, and an older one is a single cached request
  S.race = await get(`/api/jolpica/${year}/races`).then(l => rows(l).find(r => +r.round === +round), () => null);
  if (token !== S.token) return;
  daylight();
  if (sim) return showSetup();  // Play: the setup card, then the race
  idleHint();
}

// the sky's sun: a GPS replay's clock start, else Jolpica's session time (the Simulation's: the race's; before 2005 Jolpica
// has no times, and sessionStart's midnight stand-in would make night of every old race), else midday
function daylight(start = null) {
  if (!ui.has3d) return;
  const s = ui.session.value === SIM ? 'Race' : ui.session.value;
  setDaylight(+S.race?.['Circuit.Location.lat'], +S.race?.['Circuit.Location.long'], start || (S.race?.time ? sessionStart(S.race, s) : null));
}

const ahead = () => sessionStart(S.race, ui.session.value) > Date.now();

// Play: nothing runs until the setup card's Start
async function showSetup() {
  const token = S.token;
  halt();
  ui.session.value = SIM;
  ui.play.disabled = true;  // ▶ would start a race nobody set up
  const list = await entries(S.year, S.round).catch(() => []);
  if (token !== S.token) return;
  setOverlay(setupCard({year: S.year, race: S.race, list, onStart: startPlay}));
}

async function startPlay(setup) {
  const token = S.token, driving = setup.mode !== 'spectate', first = !played;
  halt();
  S.setup = setup;
  if (driving) S.selected = setup.driver;  // loadData keeps it, so no car is picked for us
  setSpeed(1);
  ui.play.disabled = false;
  await loadData(false);
  if (token !== S.token || !S.sim) return;
  S.sim.ai.pace = PACE[setup.difficulty] ?? 1;
  Object.assign(S, {best: Infinity, rec: null, ghost: null});  // the time trial's best this run, the lap being recorded, the ghost's lap
  if (driving && S.byId[S.selected]) drive(S.sim, S.selected, first);
  played = true;
  if (S.selected) setMode('follow');
  if (!S.playing) togglePlay();
}

// stop the race and the driving keys (a menu or the setup card is about to show)
function halt() {
  if (S.playing) togglePlay();
  enableInput(false);
}

const restart = () => { S.paused = false; startPlay(S.setup); };
const changeSetup = () => { S.paused = false; showSetup(); };

function togglePause() {
  if (!S.paused && !S.playing && !ui.overlay.hidden) return;  // the setup card or the results are up (paused otherwise, e.g. by the F1 TV viewer: Esc shows the menu)
  S.paused = !S.paused;
  if (S.paused) {
    halt();
    setOverlay(pauseCard({help: KEYHELP, onResume: togglePause, onRestart: restart, onSetup: changeSetup}));
  } else {
    setOverlay('');
    enableInput(!!S.sim?.player);
    togglePlay();
  }
}

// the chequered flag: the finishing order, and what next
function showResults() {
  enableInput(false);
  setOverlay(resultsCard({rows: S.sim.board(), byId: S.byId, you: S.sim.player, onRestart: restart, onSetup: changeSetup, onNext: nextCircuit}));
}

async function nextCircuit() {
  const list = await get(`/api/jolpica/${S.year}/races`).then(rows, () => []);
  const next = list.find(r => +r.round === +S.round + 1) ?? list[0];
  if (next) dispatchEvent(new CustomEvent('f1:circuit', {detail: {year: S.year, round: +next.round}}));
}

// each frame of a time trial: the chosen car's lap is recorded ([lap time, s from the line, d]); at the line a new best
// lap becomes the ghost, and is stored when you drove it (the AI can drive it too: hand it over and chase its line)
function playTick() {
  const R = S.sim, car = S.setup.mode === 'trial' && R.car(S.setup.driver);
  if (!car || car.s < 0) return;
  if (S.rec?.lap !== car.lapsDone) {
    if (S.rec && car.best < S.best) {
      S.best = car.best;
      S.ghost = S.rec.pts;
      if (car.player && saveBest(`${S.year}/${S.round}`, car.best) && ui.has3d) announce(`New best lap: ${fmtLap(car.best)}`);
    }
    S.rec = {lap: car.lapsDone, pts: []};
  }
  S.rec.pts.push([R.t - car.lapStart, car.s - car.lapsDone * R.T.len, car.d]);
}

// the ghost's map point now and 0.5 s on, at this lap's time
function ghostPos() {
  const car = S.ghost && S.sim.car(S.setup.driver);
  if (!car || car.s < 0) return [null, null];
  const now = ghostAt(S.ghost, S.sim.t - car.lapStart), next = ghostAt(S.ghost, S.sim.t - car.lapStart + 0.5);
  return [S.sim.at(...now), S.sim.at(...next)];
}

// What the stage says before ▶, and whether ▶ can do anything: nothing is asked of OpenF1 for a session that hasn't run.
function idleHint() {
  clearTimeout(ui.hintTimer);
  if (S.live || S.data || S.loading) return;
  const {year, round} = S, none = year < 1996, soon = ahead(), session = ui.session.value;  // none: replayKind 'results', ▶ would only fetch an error
  ui.play.disabled = none || soon;
  if (soon) {
    setOverlay(`${session} hasn't run yet: it starts ${until(sessionStart(S.race, session))}.`, false, S.track && overlayBtn(`Race it yourself with ${year}'s cars`,
      () => dispatchEvent(new CustomEvent('f1:circuit', {detail: {year, round}}))));  // no outline: nothing to simulate on
    ui.hintTimer = setTimeout(idleHint, 60000);  // keeps the countdown true and frees ▶ when the session starts
    return;
  }
  setOverlay(none ? `No replay for races before 1996: lap timing starts then. Results, Standings and Drivers cover ${year}`
      + (S.track ? `, and Play races this circuit with ${year}'s cars.` : '.')  // no outline (e.g. Ain-Diab): nothing to simulate on
    : S.track ? 'Press ▶ to watch the session' : 'No track map for this circuit. Press ▶ to load the session');
}

// Live timing lives in replaylive.js; it reads the view state through these getters and helpers.
const live = setupLive({S: () => S, ui: () => ui, reset, setOverlay, showFailed, drawTrack, pointAt, prepare, render});
export const showLive = live.showLive;
const liveRender = live.liveRender;

function reset(extra) {
  clearTimeout(ui.hintTimer);
  stopReel();
  S = {t: 0, playing: false, speed: ui.speed, selected: null, data: null, track: null, token: {}, cam: 'overview', tele: {}, ...extra};
  for (const c of [ui.session, ui.play, ui.speeds, ui.scrub]) c.hidden = !!S.live;  // live has no playback controls
  ui.reelBtn.hidden = !!S.live || S.year < 2023;  // GPS races only
  whyAvailable();
  ui.story.reset();
  nextColumn(0);  // leaving live timing on its speed-trap column moves on to GAP
  if (ui.has3d) {
    setView('overview');
    setCameraUi('overview', ui.show.wheel);
  }
  ui.play.textContent = '▶';
  ui.tower.replaceChildren();
  ui.rc.replaceChildren();
  renderFocus(null);
  setRadar(null);
  ui.flag.textContent = ui.lap.textContent = ui.mode.textContent = ui.clock.textContent = '';
  ui.weather.replaceChildren();
  ui.marks?.set();
  ui.scrub.max = 1;
  ui.scrub.value = 0;
  syncCommentary(S);
}

export function setSessions(list) {
  const cur = ui.session.value;
  if (cur === SIM) return;  // Simulate mode
  ui.session.replaceChildren(...list.map(s => new Option(s, s)));
  ui.session.value = list.includes(cur) ? cur : list.includes('Race') ? 'Race' : list.at(-1);
  if (S?.loading && ui.session.value !== cur) return loadData(false);  // a link's session this weekend didn't have: its load would be dropped
  if (S) idleHint();
}

// the hint overlay lets clicks through to the 3D view; its button still takes them
const overlayBtn = (text, onclick) => el('button', {class: 'neu', style: 'pointer-events:auto', onclick}, text);

// A load that failed, in plain words (server.py's 502 details carry Python reprs), blurring the map so Retry can be clicked
function showFailed(e, retry) {
  setOverlay(failed(/request failed/.test(e.message) ? "The replay data service didn't answer. Try again in a minute." : e, retry));
  ui.overlay.classList.remove('hint');
}

function setOverlay(text, spinner = false, action = null) {  // text: words, or an element of its own
  const body = typeof text === 'string' ? el('p', {}, text) : text;
  ui.overlay.replaceChildren(...(text ? [spinner && el('div', {class: 'spinner'}), body, action].filter(Boolean) : []));
  ui.overlay.hidden = !text;
  ui.overlay.classList.toggle('hint', !spinner);  // hints leave the map visible; loading blurs it
}

async function loadData(autoplay) {
  clearTimeout(ui.hintTimer);
  const load = S.loading = {};  // this load: a newer one, or another race, drops it; ▶ meanwhile only asks it to play (togglePlay)
  S.playing = false;
  ui.play.textContent = '▶';
  S.data = null;
  syncCommentary(S);
  const token = S.token, session = ui.session.value;
  const standIn = session === 'Race' && S.year >= 2023;  // see below
  setOverlay(`Loading ${session} replay…${standIn || session === SIM ? '' : " The first load of a session fetches every car's GPS trace and can take up to a minute."}`, true);
  try {
    const sim = session === SIM && await simSession(S.year, S.round, S.proj, S.track, {laps: S.setup?.laps, solo: S.setup?.mode === 'trial' && S.setup.driver});
    const url = `/api/replay/${S.year}/${S.round}?session=${encodeURIComponent(session)}`, gps = !sim && get(url);
    // A GPS replay the server hasn't built yet takes ~40 s. A race's lap-timing replay (Jolpica: ~10 s uncached, then on disk) plays
    // meanwhile and the GPS one takes over when it lands (swapToGps); without Jolpica laps yet, it just waits for GPS.
    // (a GPS request that fails fast, OpenF1 unreachable, is no answer either: the lap replay still plays)
    let data = sim ? sim.data : await Promise.race([gps.catch(() => null), new Promise(r => setTimeout(r, 1500))]), early = null;
    if (!data && standIn) early = data = await get(`${url}&laps=1`).catch(() => null);
    data ??= await gps;
    if (load !== S.loading || session !== ui.session.value) return;
    S.sim = sim?.race ?? null;
    S.t = 0;
    ui.scrub.hidden = !!S.sim;
    prepare(data);
    if (data.mode === 'gps' && data.intervals?.length) S.t = Math.max(0, lightsOut(data) - 6);  // a race opens on the grid, not a ~90 s formation lap
    if (S.selected && !S.byId[S.selected]) S.selected = null;  // not in this session
    setOverlay('');
    if (S.sim && !S.selected && S.cam === 'overview' && S.drivers?.[0]) { S.selected = S.drivers[0].id; setMode('follow'); }  // in the overview the grid is a speck at the frame's edge
    useLink(!!early);
    if (autoplay || load.play) togglePlay();
    render(true);
    if (S.cam !== 'overview') setMode(S.cam);  // prepare dropped the telemetry: the followed car's, for this session
    if (early) {
      const note = ' · GPS replay loading…';
      ui.mode.textContent += note;
      gps.then(g => swapToGps(g, token, early), () => { if (S.data === early) ui.mode.textContent = ui.mode.textContent.replace(note, ''); });
    }
  } catch (e) {
    // replay.py's 401 message: the session is running now, so show it from F1's free live feed instead
    if (load !== S.loading) return;
    if (/is live now/.test(e.message)) return showLive();  // server.py LIVE_NOW
    showFailed(e, () => loadData(autoplay));
  } finally {
    if (S.loading === load) S.loading = null;
  }
}

// lap timing counts from lights out; a GPS replay starts a minute or two before it, lights out being lap 1's start
// (laps feed: [start, driver, lap, ...]). 0 when there's no such feed (lap-timing replays)
const lightsOut = d => { const go = (d.laps ?? []).filter(e => e[2] === 1).map(e => e[0]); return go.length ? Math.min(...go) : 0; };

// A GPS race's start: the gantry shows from 10 s before lights out, its five reds come on one a second and all go out at
// lap 1's start. shortcut: the hold after the fifth light is a fixed 1 s (really a random 0.2-3 s), as the data has only
// the moment they went out. null outside the sequence, or for a session that isn't a race.
function startLights(t) {
  const out = S.lightsOut;
  return out && t >= out - 10 && t < out ? `LIGHTS ${Math.max(0, Math.min(5, Math.floor(t - (out - 6))))}` : null;
}

// the GPS replay has landed while its lap-timing stand-in plays: same moment of the race, same camera, same playing state
function swapToGps(g, token, standIn) {
  if (token !== S.token || S.data !== standIn) return;  // another race, session or a fresh load since
  const t = S.t + lightsOut(g);
  prepare(g);
  S.t = Math.min(t, g.duration);
  if (S.selected && !S.byId[S.selected]) S.selected = null;  // Jolpica driver ids there, car numbers here
  render(true);
  if (S.cam !== 'overview') setMode(S.cam);  // follows the leader again if the followed car was dropped
  useLink(false);
}

// What a shared link says of the replay (share.js). A GPS race's lap-timing stand-in counts from lights out and the GPS clock
// from LEAD before it (replay.py), so a link always holds the GPS clock.
const LEAD = 90;
const isStandIn = () => S.data?.mode === 'laps' && S.year >= 2023;
export function moment() {
  if (!S || S.live || S.sim) return {};
  const session = ui.session.value === 'Race' ? undefined : ui.session.value;
  if (!S.data) return {session};
  return {session, t: S.t + (isStandIn() ? LEAD : 0), focus: S.byId[S.selected]?.code, cmp: compared()};
}

// A link's moment, on the race just shown: picks its session and loads it if need be; useLink does the rest once data is here
export function openMoment({t, focus, session, cmp}) {
  if (!S || S.live || (t === undefined && !focus && !session && !cmp)) return;
  S.link = {t, focus, cmp};
  const pick = session && S.year >= 2023 && session !== ui.session.value;  // before 2023 there's only the race
  if (pick) {
    if (![...ui.session.options].some(o => o.value === session)) ui.session.add(new Option(session, session));  // setSessions may not have run yet
    ui.session.value = session;
  }
  if (ahead()) { S.link = null; return idleHint(); }
  if (!pick && S.data) { useLink(isStandIn()); return render(true); }
  if (pick || !S.loading) loadData(false);  // no autoplay: the reader lands on the moment, paused
}

function useLink(standIn) {
  const L = S.link;
  if (!L) return;
  if (L.t !== undefined) S.t = Math.min(S.data.duration, Math.max(0, L.t - (standIn ? LEAD : 0)));
  const d = L.focus && S.drivers.find(x => x.code === L.focus);
  if (d && S.selected !== d.id) select(d.id);
  S.link = standIn && (L.focus || L.cmp) ? {focus: L.focus, cmp: L.cmp} : null;  // car ids change when the GPS replay lands: asked again then
  if (L.cmp && !standIn) openCompare(L.cmp);
}

// the race replay has played to its end (app.js: spoiler-free mode lifts there)
export const ended = () => !!S?.data && !S.live && !S.sim && ui.session.value === 'Race' && S.t >= S.data.duration - 1;

// start the loaded race (app.js: the notice for a race new since the last visit)
export const play = () => S && !S.playing && togglePlay();

// [ and ]: the next driver up or down the order on screen, the camera and telemetry go with them
function cycleDriver(step) {
  const order = (S.board ?? []).map(b => b.d.id);
  if (!order.length) return;
  const i = order.indexOf(S.selected), next = i < 0 ? order[0] : order[(i + step + order.length) % order.length];  // nobody followed: the leader
  if (next !== S.selected) select(next);
}

// , and . : the previous or next safety car, red flag or lead change, from a little before it
function jumpMoment(dir) {
  if (S.reel) return reelGo(Math.max(0, S.reel.i + dir));
  const x = nextMoment(S.moments ?? [], S.t, dir);
  if (!x) return ui.has3d && announce(dir > 0 ? 'No more key moments' : 'No earlier key moment');
  S.t = Math.max(0, x.t - 3);
  render(true);
  if (ui.has3d) announce(x.label);
}

function showMarks(marks) {
  S.moments = marks.pins;  // , and . step through them
  ui.marks.set(marks, S.data.duration);
}

// a pin on the scrubber: that moment, on its car if the camera is following one
function pickMark(m) {
  if (!S?.data) return;
  stopReel();
  S.t = Math.max(0, m.seek ?? m.t);
  if (m.id && S.byId[m.id] && S.cam !== 'overview') S.selected = m.id;
  render(true);
  if (ui.has3d) announce(m.label);
}

// the Why needs a real race's lap times, which start in 1996
function whyAvailable() {
  const off = !!S.live || !!S.sim || S.year < 1996;
  ui.story.btn.hidden = off;
  if (off) ui.story.closePanel();
}

// The Why's beats: a lap of the race from its start, or the last seconds of it for a pit stop, following the car
async function openLap(lap, atEnd, {id, code}) {
  if (!S || S.live || S.sim) return;
  stopReel();
  const token = S.token, say = text => (ui.has3d ? announce(text) : setOverlay(text));
  if (ui.session.value !== 'Race') {
    ui.session.value = 'Race';
    await loadData(false);
  } else if (S.loading) return say('Still loading: try again in a moment');
  else if (!S.data) await loadData(false);
  if (token !== S.token || !S.data) return;
  const start = L => {
    if (S.data.mode === 'gps') return Math.min(...Object.values(S.lapsBy).flatMap(a => a.filter(e => e[1] === L).map(e => e[0])));
    return L <= 1 ? 0 : Math.min(...Object.values(S.data.cum).map(c => c[L - 2] ?? Infinity));
  };
  const end = start(lap + 1), at = atEnd ? (Number.isFinite(end) ? end : S.data.duration) - 20 : start(lap) - 3;
  if (!Number.isFinite(at)) return say('That lap is not in this replay');
  S.t = Math.min(S.data.duration, Math.max(0, at));
  render(true);
  S.selected = S.drivers.find(d => d.id === id || d.code === code)?.id ?? S.selected;
  const cam = S.cam === 'overview' && S.selected ? 'chase' : S.cam;
  if (ui.has3d && cam === S.cam) setView(cam);  // a cut: chase pans between cars otherwise, across the whole circuit
  setMode(cam);
  setSpeed(1);  // a moment to watch: the deck's 10x would be past it in seconds
  if (!S.playing) togglePlay();
}

// Race Highlights (H): plays highlights.js's clips at 1x with the panels away, following each clip's car
async function toggleHighlights() {
  if (S?.reel) return stopReel();
  if (!S || S.live || S.sim) return;
  const say = text => (ui.has3d ? announce(text) : setOverlay(text));
  if (S.loading) return say('Still loading: try again in a moment');
  if (!S.data) await loadData(false);
  if (!S.data) return;
  if (S.data.mode !== 'gps' || !S.data.intervals?.length) return say(S.data.mode === 'laps' ? 'Highlights need the GPS replay, still loading' : 'Highlights are for races with GPS data');
  count('highlights');
  S.reel = {list: highlightReel(S.data, lightsOut(S.data)), i: -1, speed: ui.speed, cinematic: ui.stage.classList.contains('cinematic'), cam: S.cam};
  setSpeed(1);
  setCinematic(true);
  ui.reelBtn.setAttribute('aria-pressed', true);
  ui.reelBar.hidden = false;
  reelGo(0);
  if (!S.playing) togglePlay();
}

function reelGo(i) {
  const r = S.reel, clip = r.list[i];
  if (!clip) {
    stopReel();
    if (S.playing) togglePlay();
    if (ui.has3d) announce('End of the highlights');
    return;
  }
  const cut = Math.abs(S.t - clip.t0) > 0.5;  // a clip that runs straight on from the last keeps the shot
  r.i = i;
  S.t = clip.t0;
  ui.reelCount.textContent = `${i + 1} / ${r.list.length} · ${clip.kind === 'start' ? 'Start' : `Lap ${clip.lap}`}`;
  ui.reelText.textContent = clip.text;
  render(true);  // the board at this moment, for a clip with no car of its own: the leader
  S.selected = (S.byId[clip.id] && clip.id) || S.board?.[0]?.d.id || S.selected;
  r.shots = shotsFor(clip);  // the director's cuts: the replay's own cameras, in the order the clip calls for
  r.shot = -1;
  reelShot(cut);
}

// the camera the clip's director wants now: a new clip cuts to it (view reset: chase pans between cars otherwise, across
// the whole circuit), later shots of the same clip change as the clip's time reaches them
function reelShot(cut = false) {
  const r = S.reel, clip = r.list[r.i], at = S.t - clip.t0;
  let k = r.shots.findLastIndex(x => x.at <= at);
  if (k < 0) k = 0;
  if (k === r.shot) return;
  r.shot = k;
  const cam = r.shots[k].cam;
  if (ui.has3d && cut && cam === S.cam) setView(cam);
  setMode(cam);
}

function stopReel() {
  const r = S?.reel;
  if (!r) return;
  S.reel = null;
  ui.reelBar.hidden = true;
  ui.reelBtn.setAttribute('aria-pressed', false);
  setSpeed(r.speed);
  setCinematic(r.cinematic);
  if (r.cam !== 'overview' && r.cam !== S.cam) setMode(r.cam);  // the viewer's own camera back (overview: the clips left a driver selected, stay on them)
}

function togglePlay() {
  if (!S || S.live || ui.play.disabled) return;
  if (!S.data) {
    if (S.loading) S.loading.play = true;
    else loadData(true);
    return;
  }
  if (S.t >= S.data.duration) S.t = 0;
  S.playing = !S.playing;
  ui.play.textContent = S.playing ? '❚❚' : '▶';
  ui.play.setAttribute('aria-label', S.playing ? 'Pause replay' : 'Play replay');
  ui.play.setAttribute('aria-pressed', S.playing);
  cancelAnimationFrame(S.raf);  // pause + play within one frame would otherwise leave two loops running
  if (S.playing) {
    S.last = performance.now();
    S.raf = requestAnimationFrame(tick);
    try {
      if (!localStorage.getItem('f1played')) { localStorage.setItem('f1played', '1'); count('first_play'); }
    } catch (e) { /* storage blocked: not counted, or it would count every play */ }
  }
  syncCommentary(S);
}

function tick(now) {
  if (!S.playing || !S.data) return;
  if (covered()) return togglePlay();  // the F1 TV viewer opened over it: pause rather than race on unseen
  // the six seconds of start lights run in real time whatever the speed: at 10x they'd be gone in half a second
  const grid = S.lightsOut && S.t >= S.lightsOut - 6 && S.t < S.lightsOut;
  const dt = Math.max(0, (now - S.last) / 1000) * (grid ? Math.min(1, S.speed) : S.speed);  // rAF's stamp can predate togglePlay's S.last
  S.watched = (S.watched ?? 0) + (now - S.last) / 1000;  // real seconds played, once per race or session loaded
  if (S.watched >= 60 && !S.counted) { S.counted = true; count('watched_60s'); }
  let t0 = performance.now();
  if (S.sim) S.sim.advance(Math.min(dt, 2));  // the physics runs in race time; a stalled tab doesn't jump minutes ahead
  if (S.sim) timed('sim', t0);
  S.t = S.sim ? S.sim.t : Math.min(S.data.duration, S.t + dt);
  S.last = now;
  if (S.reel && S.t >= S.reel.list[S.reel.i].t1) reelGo(S.reel.i + 1);
  else if (S.reel) reelShot();
  t0 = performance.now();
  render(false);
  timed('page', t0);
  if (S.setup && S.sim) playTick();
  if (S.sim ? S.sim.done : S.t >= S.data.duration) { togglePlay(); if (S.setup && S.sim) showResults(); }
  else S.raf = requestAnimationFrame(tick);
}

// ---------- track drawing ----------

// mpu: metres per map unit (F1 timing coordinates are decimetres)
function drawTrack(xs, ys, rotation, corners, startKnown, mpu) {
  S.proj = null;
  if (!xs?.length) {
    if (ui.has3d) setTrack([], 1, [], false, 1);
    return;
  }
  const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = (x, y) => [x * c - y * s, -(x * s + y * c)];  // F1 coords are y-up, map coords are y-down
  const pts = xs.map((x, i) => rot(x, ys[i]));
  const X = pts.map(p => p[0]), Y = pts.map(p => p[1]);
  const span = Math.max(Math.max(...X) - Math.min(...X), Math.max(...Y) - Math.min(...Y));
  const cornerPts = corners.map(cn => {
    const off = span * 0.045, ang = (cn.angle ?? 0) * Math.PI / 180;
    return [...rot(cn.x + Math.cos(ang) * off, cn.y + Math.sin(ang) * off), cn.number];
  });
  const ann = annotate({...S.track, h: xs === S.track?.x ? S.track.h : null, rot: ([x, y]) => rot(x, y)}, pts, mpu);  // heights, banking, kerbs, DRS
  if (ui.has3d) setTrack(pts, span, cornerPts, startKnown, mpu, S.track?.width, ann);
  // cumulative distance along the outline, for placing cars by lap fraction
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i - 1], q = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  S.proj = {rot, pts, cum, span, mpu, ann};
}

function pointAt(frac) {
  const {pts, cum} = S.proj, target = (((frac % 1) + 1) % 1) * cum.at(-1);  // before the line (grid slots) wraps to the lap's end
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= target) lo = m; else hi = m; }
  const p = pts[lo], q = pts[(lo + 1) % pts.length], f = (target - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
}

const nearest = p => {  // outline index closest to a map point
  let best = 0, d = Infinity;
  S.proj.pts.forEach((q, i) => { const e = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (e < d) { d = e; best = i; } });
  return best;
};

// ---------- data preparation ----------

function prepare(data) {
  S.data = data;
  daylight(data.start && new Date(data.start));
  S.tele = {};  // all per session: a lap-timing replay has no lapsBy of its own, and tower.js would read the last session's
  S.lapsBy = S.focus = undefined;
  S.drivers = data.drivers.map(d => ({...d, color: d.color || teamColor(d.teamId, d.team)}));
  S.byId = Object.fromEntries(S.drivers.map(d => [d.id, d]));
  S.lightsOut = data.mode === 'gps' && data.intervals?.length ? lightsOut(data) : 0;  // races (and sprints) only
  [...S.drivers].sort((a, b) => (a.grid || 99) - (b.grid || 99)).forEach((d, i) => d.rank = i);  // grid slot; 0 = pit-lane start
  if (data.mode === 'laps') {  // a steady pace per driver (median lap time) says who passes whom, whatever this lap's time was
    for (const d of S.drivers) {
      const c = data.cum[d.id], laps = c.map((x, i) => x - (c[i - 1] ?? 0)).sort((a, b) => a - b);
      d.pace = laps[laps.length >> 1];
    }
  }
  if (data.mode === 'gps') {
    const group = (feed, f) => {
      const m = {};
      for (const e of feed) (m[e[1]] ??= []).push(f(e));
      return m;
    };
    S.pos = group(data.positions, e => [e[0], e[2]]);
    S.lapsBy = group(data.laps, e => [e[0], e[2], e[3], e[4], e[5], e[6]]);  // [start, lap, duration, s1, s2, s3]
    S.gaps = group(data.intervals, e => [e[0], e[2]]);
    S.pitsBy = group(data.pits, e => [e[0], e[2], e[3]]);
    if (!f1Coords(S.track)) drawOutlineFromGps();
  }
  if (!S.proj) {  // no map at all: run the cars round an oval
    drawTrack(Array.from({length: 120}, (_, i) => Math.cos(i / 120 * 2 * Math.PI) * 1000),
              Array.from({length: 120}, (_, i) => Math.sin(i / 120 * 2 * Math.PI) * 600), 0, [], true, 1);
  }
  if (ui.has3d) setCars(S.drivers, select, S.year ?? new Date().getFullYear());
  if (ui.has3d && !S.sim) {  // pit lane: this replay's own from GPS, else the circuit's real one (from a 2023+ race there)
    const lane = data.mode === 'gps' && gpsPitLane(), token = S.token;
    if (lane) setPitLane(lane);
    else realPitLane(S.year, S.round, S.proj, S.track?.width).then(l => l && token === S.token && setPitLane(l));
  }
  if (S.sim) S.lapsBy = S.sim.laps;  // same shape, filled in as the simulated laps complete
  S.rows = buildTower(ui.tower, S.drivers, select);
  S.zones = S.proj.ann.zones?.length ? S.proj.ann.zones.map(z => [z.start, z.end]) : drsZones(S.proj.pts.map(p => [p[0] * S.proj.mpu, p[1] * S.proj.mpu]));
  S.drsName = S.year >= 2026 ? 'OVERTAKE' : 'DRS';  // 2026 rules replaced DRS with the overtake mode energy boost
  setRadar(S.proj.pts, sectorCuts(), S.zones, S.drivers, S.year >= 2026 ? 'OVERTAKE' : 'DRS');
  ui.scrub.max = Math.floor(data.duration);
  showMarks(data.mode === 'gps' ? gpsMarks(data, S.lightsOut) : NO_MARKS);
  if (data.mode === 'laps') lapMarks(S.year, S.round, data.cum).then(m => { if (S?.data === data) showMarks(m); }, () => {});  // a timeline's still usable without them
  ui.reelBtn.hidden = !(data.mode === 'gps' ? data.intervals?.length : data.mode === 'laps' && S.year >= 2023);
  whyAvailable();
  ui.story.refresh();
  ui.mode.textContent = data.mode === 'gps' ? `${data.session} · GPS replay` : data.mode === 'sim' ? 'Physics simulation'
                     : data.mode === 'live' ? ui.mode.textContent
                                            : 'Race · lap-timing replay (approximate positions)';
  S.towerAt = 0;
}

// Where sectors 2 and 3 start: where the car was when the fastest lap with sector times crossed each sector line
// (GPS replays); thirds of the outline when there are no sector times.
function sectorCuts() {
  const n = S.proj.pts.length, thirds = [Math.round(n / 3), Math.round(2 * n / 3)];
  if (S.data.mode !== 'gps') return thirds;
  let best = null;
  for (const [id, laps] of Object.entries(S.lapsBy))
    for (const l of laps) if (l[2] && l[3] && l[4] && (!best || l[2] < best.l[2])) best = {id, l};
  const a = best && gpsPos(best.id, best.l[0] + best.l[3]), b = best && gpsPos(best.id, best.l[0] + best.l[3] + best.l[4]);
  return a && b ? [nearest(a), nearest(b)].sort((x, y) => x - y) : thirds;
}

function drawOutlineFromGps() {
  // use the fastest timed lap's GPS trace as the outline
  let best = null;
  for (const [id, laps] of Object.entries(S.lapsBy))
    for (const [t, , dur] of laps) if (dur && S.data.frames[id] && (!best || dur < best.dur)) best = {id, t, dur};
  if (!best) return;
  const f = S.data.frames[best.id], i0 = Math.ceil(best.t / S.data.step), i1 = Math.floor((best.t + best.dur) / S.data.step);
  const xs = [], ys = [];
  for (let i = i0; i <= i1; i++) if (f.x[i] !== null) { xs.push(f.x[i]); ys.push(f.y[i]); }
  drawTrack(xs, ys, S.track?.rotation ?? 0, [], true, 0.1);
}

// The real pit lane: a car's GPS trace through its first usable pit stop, or, in a session without stops, through
// a car leaving the pits in the first 4 minutes.
function gpsPitLane() {
  const off = ((S.track?.width ?? 13) / 2 + 3) / S.proj.mpu, gap = 2 / S.proj.mpu;
  const tries = S.data.pits.length ? S.data.pits.map(([t, id]) => [id, t - 60, t + 40]) : S.drivers.map(d => [d.id, 0, 240]);
  for (const [id, t0, t1] of tries.slice(0, 10)) {
    const trace = [];
    for (let t = Math.max(0, t0); t <= t1; t += S.data.step) trace.push(gpsPos(id, t));
    const lane = pitTrace(trace, S.proj.pts, off, gap);
    if (lane) return lane;
  }
  return null;
}

// ---------- per-frame state ----------

// a car's map position at time t: GPS frames interpolated (null when it has none), or along the outline by lap time
// Catmull-Rom through the frames either side: straight lines between 0.5 s frames cut up to ~0.8 m inside every corner
function gpsPos(id, t) {
  const f = S.data.frames[id], fi = t / S.data.step, i = Math.floor(fi), k = fi - i;
  if (!f || f.x[i] === null || f.x[i] === undefined) return null;
  const has = n => f.x[n] !== null && f.x[n] !== undefined;
  const j = has(i + 1) ? i + 1 : i, h = has(i - 1) ? i - 1 : i, l = has(i + 2) ? i + 2 : j;
  const k2 = k * k, k3 = k2 * k;
  const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * k + (2 * a - 5 * b + 4 * c - d) * k2 + (3 * b - a - 3 * c + d) * k3);
  return S.proj.rot(cr(f.x[h], f.x[i], f.x[j], f.x[l]), cr(f.y[h], f.y[i], f.y[j], f.y[l]));
}

// GPS cars pushed apart where they overlap (lanes.js apart), across each car's direction over the surrounding half second
function spread(cars, t) {
  if (!(Math.abs(t - S.spreadT) < 5)) S.sides = {};  // after a seek, pass sides start over
  S.spreadT = t;
  const mpu = S.proj.mpu, list = [];
  for (const [id, p] of Object.entries(cars)) {
    const a = gpsPos(id, t - 0.25) ?? p, b = gpsPos(id, t + 0.25) ?? p, n = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (n * mpu > 1) list.push({id, x: p[0] * mpu, y: p[1] * mpu, dx: (b[0] - a[0]) / n, dy: (b[1] - a[1]) / n});  // parked: left alone
  }
  const shift = apart(list, S.sides);
  for (const id in shift) cars[id] = [cars[id][0] + shift[id][0] / mpu, cars[id][1] + shift[id][1] / mpu];
  return cars;
}

function lapPos(id, t) {
  const c = S.data.cum[id];
  let k = 0;
  while (k < c.length && c[k] <= t) k++;
  if (k >= c.length) return null;
  const start = k ? c[k - 1] : 0;
  return pointAt((t - start) / (c[k] - start));
}

// Laps mode: every running car's map position at t, in its lane. Lap 1 starts from the car's grid slot behind the line;
// lanes() fans the grid out into two columns and moves the faster car of a close pair aside to pass.
function lapCars(t) {
  const {cum, mpu} = S.proj, len = cum.at(-1) * mpu, runs = [];
  for (const d of S.drivers) {
    const c = S.data.cum[d.id];
    let k = 0;
    while (k < c.length && c[k] <= t) k++;
    if (k >= c.length) continue;
    const start = k ? c[k - 1] : 0, frac = (t - start) / (c[k] - start), back = k ? 0 : GRID.front + GRID.row * d.rank;
    const run = frac * (len + back);
    runs.push({id: d.id, s: run - back, v: len / d.pace, rank: k ? undefined : d.rank, run: k ? undefined : run});
  }
  const lat = lanes(runs, len, (S.track?.width ?? 13) / 2), cars = {};
  for (const r of runs) {
    const p = pointAt(r.s / len), q = pointAt((r.s + 2) / len), n = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, m = lat[r.id] / mpu / n;
    cars[r.id] = [p[0] + (q[1] - p[1]) * m, p[1] - (q[0] - p[0]) * m];  // the left normal of the direction of travel
  }
  return cars;
}

// car positions only (no timing board), for the heading half a second ahead
function carsAt(t) {
  if (S.data.mode === 'laps') return lapCars(t);
  const cars = {}, pos = gpsPos;
  for (const d of S.drivers) { const p = pos(d.id, t); if (p) cars[d.id] = p; }
  return spread(cars, t);
}

// Under 6 m/s a GPS car's next half second says little about where it points: positions step by 0.1 m, so a parked car
// turned to any angle, and spread's push ends as it slows, which swings the last metres sideways. It keeps the direction
// it arrived in instead; the distance stays the real one (the scene reads speed from it), just enough for a heading.
function holdHeadings(cars, ahead, t) {
  if (S.data.mode !== 'gps') return ahead;
  const {rot, mpu} = S.proj, i = Math.floor(t / S.data.step);
  for (const id in cars) {
    const p = gpsPos(id, t), q = gpsPos(id, Math.min(t + 0.5, S.data.duration));
    if (!p || !q) continue;
    const gone = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (gone * mpu >= 3) continue;
    const f = S.data.frames[id], yaw = (f.yaw ??= headings(f.x, f.y, 3 / mpu))[i];
    if (Number.isNaN(yaw)) continue;  // never moved
    const [dx, dy] = rot(Math.cos(yaw), Math.sin(yaw)), d = Math.max(gone, 0.05 / mpu);
    ahead[id] = [cars[id][0] + dx * d, cars[id][1] + dy * d];
  }
  return ahead;
}

function gpsState(t) {
  const cars = {}, board = [];
  for (const d of S.drivers) {
    const p0 = gpsPos(d.id, t);
    if (p0) cars[d.id] = p0;
    const at = (arr) => { const n = arr ? lastBefore(arr, t) : -1; return n < 0 ? null : arr[n]; };
    const p = at(S.pos[d.id]), lp = at(S.lapsBy[d.id]), g = at(S.gaps[d.id]);
    const lap = lp?.[1] ?? 0;
    const best = Math.min(...(S.lapsBy[d.id] || []).filter(e => e[2] && e[0] + e[2] <= t).map(e => e[2]));
    const stint = S.data.stints.find(s => s[0] === d.id && s[1] <= Math.max(lap, 1) && (s[2] ?? 999) >= lap);
    board.push({d, pos: p?.[1] ?? 99, lap, best: isFinite(best) ? best : null, gap: g ? g[1] : null, tyre: stint?.[3],
                age: stint ? Math.max(lap, 1) - stint[1] + (stint[4] ?? 0) : null,
                // OpenF1's pit date is near the car leaving the lane (replay.py pitlane): the lane time before it, not after
                pit: S.pitsBy[d.id]?.some(s => t > s[0] - (s[2] || 25) && t <= s[0]), out: !cars[d.id]});
  }
  spread(cars, t);
  board.sort((a, b) => a.pos - b.pos);
  const race = S.data.intervals.length > 0;
  for (const b of board) {
    b.gapText = race ? (b.pos === 1 ? `LAP ${b.lap}` : typeof b.gap === 'number' ? `+${b.gap.toFixed(3)}` : (b.gap ?? ''))
                     : fmtLap(b.best);
  }
  return {cars, board, lap: board[0]?.lap};
}

function lapsState(t) {
  const cars = lapCars(t), board = [];
  for (const d of S.drivers) {
    const c = S.data.cum[d.id];
    let k = 0;
    while (k < c.length && c[k] <= t) k++;
    const done = k >= c.length, finished = done && (d.status === 'Finished' || /^\+\d+ Laps?$/.test(d.status) || d.status === 'Lapped');
    const lapStart = k ? c[k - 1] : 0, frac = done ? 0 : (t - lapStart) / (c[k] - lapStart);
    if (finished) cars[d.id] = pointAt(0);
    const pits = S.data.pits[d.id] || [], lastPit = Math.max(0, ...pits.filter(p => p <= k));
    board.push({d, k, p: k + frac, last: k ? c[k - 1] : 0, out: done && !finished, finished, age: k + 1 - lastPit,
                pit: !done && pits.includes(k + 1) && frac > 0.9});
  }
  board.sort((a, b) => (a.out - b.out) || (b.p - a.p) || (a.last - b.last));
  const lead = board[0], cl = S.data.cum[lead.d.id];
  board.forEach((b, i) => {
    b.pos = i + 1;
    if (b.out) b.gapText = 'OUT';
    else if (i === 0) b.gapText = `LAP ${Math.min(b.k + 1, S.data.total_laps)}`;
    else if (!b.k) b.gapText = '';
    else {
      const c = S.data.cum[b.d.id];
      let leaderLaps = 0;  // laps the leader had completed when this driver completed their last lap
      while (leaderLaps < cl.length && cl[leaderLaps] <= c[b.k - 1]) leaderLaps++;
      const down = leaderLaps - b.k;
      b.gapNum = down >= 1 ? null : Math.max(0, c[b.k - 1] - cl[b.k - 1]);  // ordered by progress now, so it can have finished that lap first
      b.gapText = down >= 1 ? `+${down} LAP${down > 1 ? 'S' : ''}` : `+${b.gapNum.toFixed(3)}`;
    }
  });
  return {cars, board, lap: Math.min(lead.k + 1, S.data.total_laps)};
}

// ---------- rendering ----------

function render(force) {
  if (!S.data || !S.proj) return;
  ui.stage.classList.toggle('driving', !!S.sim?.player);  // Play: the replay's speed menu goes while you drive
  if (S.live) S.t = (Date.now() - S.liveInfo.origin) / 1000;
  const t = S.t, st = S.live ? liveRender() : S.sim ? simState(S.sim, S.byId) : S.data.mode === 'gps' ? gpsState(t) : lapsState(t);
  if (ui.has3d) {  // the position half a second later gives each car its heading
    S.ahead = st.ahead ?? holdHeadings(st.cars, carsAt(Math.min(t + 0.5, S.data.duration)), t);
    const progress = S.live ? 1 : S.sim ? st.lap / S.data.total_laps : t / S.data.duration;
    const steer = updateCars(st.cars, S.ahead, S.selected, S.live ? 1 : S.playing ? S.speed : 0, progress, st.fx);
    if (S.sim) setGhost(...(S.ghost ? ghostPos() : [null]), S.year);
    if (S.cam === 'onboard') setWheelAngle(steer, hasCockpitWheel(S.selected));
  }
  S.board = st.board;
  syncCommentary(S);
  renderRadar(st.cars, S.selected);
  if (+ui.scrub.value !== Math.floor(t) || !ui.scrub.style.getPropertyValue('--p')) {
    ui.scrub.value = Math.floor(t);
    ui.scrub.style.setProperty('--p', `${(t / (S.data.duration || 1) * 100).toFixed(2)}%`);
  }
  const left = S.live && S.liveInfo.live ? liveClock(S.live) : null;
  ui.clock.textContent = S.live ? (left !== null ? `${fmtClock(left)} remaining` : '') : S.sim ? fmtClock(t) : `${fmtClock(t)} / ${fmtClock(S.data.duration)}`;
  const race = S.live ? S.data.race : S.sim || S.data.mode === 'laps' || S.data.intervals.length > 0;
  ui.lap.textContent = race ? `LAP ${st.lap || 0}${S.data.total_laps === Infinity ? '' : ` / ${S.data.total_laps}`}` : S.data.session.toUpperCase();  // a time trial has no last lap
  const status = S.live ? liveStatus(S.live) : S.sim ? st.status
    : S.data.mode === 'gps' ? startLights(t) ?? trackStatus(S.data.race_control || [], t) : null;
  const lights = /^LIGHTS (\d)/.exec(status ?? '');  // the start gantry: five red lights, then out
  ui.startLights.hidden = !lights;
  if (lights) ui.startLights.querySelectorAll('i').forEach((l, i) => l.classList.toggle('on', i < +lights[1]));
  if (ui.has3d) setStartLights(lights ? +lights[1] : 0);  // the 3D gantry over the grid too
  if (status && !lights) {
    ui.flag.textContent = status;
    ui.flag.className = `flagpill ${STATUS[status] || ''}`;
  } else {
    ui.flag.textContent = '';
    ui.flag.className = 'flagpill';
  }
  const now = performance.now();
  if (force || now - S.towerAt >= 120) {  // the tower and feed only need ~8 updates a second
    S.towerAt = now;
    S.cols = timing(S, st.board, t);
    renderTower(S.rows, stableOrder(S.order ??= {}, st.board, now, force), S.cols, COLUMNS[ui.column][0], S.selected,
                (id, c) => ui.has3d && setTyre(id, c));
    renderFeed(ui, S.data, t);
    ui.scrub.setAttribute('aria-valuetext', `${fmtClock(t)}, ${ui.lap.textContent}`);
  }
  const f = S.selected ? focusFrame(S, t, st, status, {pos: S.data.mode === 'gps' ? gpsPos : lapPos, nearest}) : null;
  renderFocus(f);  // gauges every frame, so they move smoothly
  updateDrawer(f, t);
  updateDecks(S, st, f);
}

// m: 'overview' | 'chase' | 'follow' | 'onboard' | 'tcam' | 'heli'; all but overview follow the selected driver (the leader
// if none is selected). Picking another driver keeps the camera mode, and the chase camera pans across.
function setMode(m) {
  if (m !== 'overview' && !S.selected) {
    S.selected = S.board?.[0]?.d.id ?? null;
    if (!S.selected) return;  // nothing loaded yet
  }
  if (m === 'overview') S.selected = null;
  const changed = m !== S.cam;
  S.cam = m;
  if (ui.has3d && changed) setView(m);
  if (ui.has3d) setCameraUi(m, ui.show.wheel);
  loadTelemetry(S.selected);
  render(true);
}

// speed / gear / rpm / pedals / DRS for the focused car (GPS replays only), fetched once per driver
function loadTelemetry(id) {
  const d = S.byId?.[id], tele = S.tele;
  if (!d || S.data?.mode !== 'gps' || tele[id]) return;
  tele[id] = 'loading';
  get(teleUrl(S, d))
    .then(t => { tele[id] = t; }, () => { tele[id] = 'none'; });
}

function select(id) {
  S.selected = S.selected === id ? null : id;
  setMode(!S.selected ? 'overview' : S.cam === 'overview' ? (S.sim ? 'follow' : 'chase') : S.cam);  // the sim: a game's chase cam
}
