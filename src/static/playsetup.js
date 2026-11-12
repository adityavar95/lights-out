// Play's setup card: before anything moves, pick the circuit, car, driver, mode, laps and difficulty, then Start.
// The last choice is kept in localStorage. replay.js shows the card (showRace) and runs the race (startPlay).
import {el, fmtLap} from './util.js';

export const MODES = [['race', 'Race'], ['trial', 'Time trial'], ['spectate', 'Spectate']];
export const LAPS = [['3', '3 laps'], ['5', '5 laps'], ['quarter', '25 % distance'], ['full', 'Full distance']];
export const DIFFICULTY = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
export const PACE = {easy: 0.9, medium: 1, hard: 1.05};  // the AI's pace (driverdeck.js slider range 80-110 %)
const KEY = 'f1play', BESTS = 'f1bests', DEFAULTS = {mode: 'race', laps: '5', difficulty: 'medium', driver: null};

export function loadSetup(store = globalThis.localStorage) {
  try { return {...DEFAULTS, ...JSON.parse(store.getItem(KEY))}; } catch (e) { return {...DEFAULTS}; }  // blocked or bad: the defaults
}
export function saveSetup(setup, store = globalThis.localStorage) {
  try { store.setItem(KEY, JSON.stringify(setup)); } catch (e) { /* storage blocked: the setup just isn't remembered */ }
}

// time-trial bests, seconds per circuit and season (the season picks the car): {'2025/1': 80.123}
export function loadBests(store = globalThis.localStorage) {
  try { return JSON.parse(store.getItem(BESTS)) ?? {}; } catch (e) { return {}; }
}
// true when time beats the stored best for key (and it is stored)
export function saveBest(key, time, store = globalThis.localStorage) {
  const bests = loadBests(store);
  if (!(time > 0 && time < Infinity) || bests[key] <= time) return false;
  bests[key] = time;
  try { store.setItem(BESTS, JSON.stringify(bests)); } catch (e) { /* storage blocked: the best lasts this race only */ }
  return true;
}

// Ghost lap: pts [[lap time, s from the line, d], ...] recorded each frame; where it was at lap time t (clamped at the ends)
export function ghostAt(pts, t) {
  if (!pts.length) return null;
  let lo = 0, hi = pts.length - 1;
  if (t <= pts[0][0]) return [pts[0][1], pts[0][2]];
  if (t >= pts[hi][0]) return [pts[hi][1], pts[hi][2]];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid; }
  const [t0, s0, d0] = pts[lo], [t1, s1, d1] = pts[hi], f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return [s0 + (s1 - s0) * f, d0 + (d1 - d0) * f];
}

// the race's laps for a choice; full: the real race distance
export const lapsFor = (choice, full) => (choice === 'full' ? full : choice === 'quarter' ? Math.max(1, Math.ceil(full / 4)) : +choice || full);

// list: simmode.js entries (grid order); race: the Jolpica race row; onStart(setup)
export function setupCard({year, race, list, onStart}) {
  const saved = loadSetup();
  const pick = (label, opts, value) => {
    const s = el('select', {class: 'neu', 'aria-label': label}, opts.map(([v, t]) => new Option(t, v)));
    s.value = opts.some(([v]) => v === value) ? value : opts[0][0];
    return {s, row: el('label', {class: 'psrow'}, el('small', {}, label.toUpperCase()), s)};
  };
  const mode = pick('Mode', MODES, saved.mode);
  const driver = pick('Driver', list.map(e => [e.id, `${e.code} · ${e.name}${e.team ? ` · ${e.team}` : ''}`]), saved.driver);
  const laps = pick('Laps', LAPS, saved.laps), level = pick('Difficulty', DIFFICULTY, saved.difficulty);
  const deck = id => el('button', {class: 'neu', onclick: () => document.querySelector(`[aria-controls=${id}]`)?.click()});
  const sync = () => { driver.row.hidden = mode.s.value === 'spectate'; laps.row.hidden = mode.s.value === 'trial'; };
  mode.s.onchange = sync;
  sync();
  const best = loadBests()[`${year}/${race?.round}`];
  const start = el('button', {class: 'tvbtn', onclick: () => {
    const setup = {...saved, mode: mode.s.value, driver: driver.s.value || null, laps: laps.s.value, difficulty: level.s.value};
    saveSetup(setup);
    onStart(setup);
  }}, 'Start race');
  const card = el('div', {class: 'playsetup glass', role: 'dialog', 'aria-label': 'Race setup'},
    el('div', {class: 'eyebrow'}, `PLAY · ${year}`),
    el('h2', {}, race?.raceName ?? 'Race'),
    el('div', {class: 'psdecks'}, Object.assign(deck('circuitdeck'), {textContent: 'Change circuit'}), Object.assign(deck('carsdeck'), {textContent: 'Change car'})),
    mode.row, driver.row, laps.row, level.row, best ? el('small', {class: 'psbest'}, `Time-trial best here: ${fmtLap(best)}`) : '', start);
  if (!list.length) { start.disabled = true; start.textContent = 'No entry list for this race'; }
  return card;
}

const card = (label, ...kids) => el('div', {class: 'playsetup glass', role: 'dialog', 'aria-label': label}, ...kids);
const btn = (text, onclick, cls = 'neu') => el('button', {class: cls, onclick}, text);

// at the flag. rows: sim.js R.board(); byId: the entry list by id; you: the player's id (null when spectating)
export function resultsCard({rows, byId, you, onRestart, onSetup, onNext}) {
  const me = rows.find(r => r.car.id === you);
  const line = r => el('li', {class: r.car.id === you ? 'you' : ''}, el('b', {}, String(r.pos)), el('span', {}, byId[r.car.id]?.code ?? r.car.id),
    el('small', {}, r.pos === 1 ? 'WINNER' : r.lapsDown ? `+${r.lapsDown} lap${r.lapsDown > 1 ? 's' : ''}` : r.gap === null ? '' : `+${r.gap.toFixed(3)}`));
  const top = rows.slice(0, 10);
  if (me && !top.includes(me)) top.push(me);
  return card('Race results', el('div', {class: 'eyebrow'}, 'CHEQUERED FLAG'),
    el('h2', {}, me ? `You finished P${me.pos}` : `${byId[rows[0]?.car.id]?.name ?? 'The leader'} wins`),
    me && me.car.best < Infinity ? el('small', {}, `Your best lap: ${fmtLap(me.car.best)}`) : '',
    el('ol', {class: 'psresults'}, top.map(line)),
    el('div', {class: 'psdecks'}, btn('Restart', onRestart, 'tvbtn'), btn('Change setup', onSetup), btn('Next circuit', onNext)));
}

// Esc while driving. help: the driver deck's key help
export function pauseCard({help, onResume, onRestart, onSetup}) {
  const resume = btn('Resume', onResume, 'tvbtn');
  queueMicrotask(() => resume.focus());
  return card('Paused', el('div', {class: 'eyebrow'}, 'PAUSED'), el('h2', {}, 'Paused'),
    resume, btn('Restart', onRestart), btn('Change setup', onSetup), el('small', {class: 'pshelp'}, help));
}
