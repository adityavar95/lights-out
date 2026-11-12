// Play's setup card: before anything moves, pick the circuit, car, driver, mode, laps and difficulty, then Start.
// The last choice is kept in localStorage. replay.js shows the card (showRace) and runs the race (startPlay).
import {el} from './util.js';

export const MODES = [['race', 'Race'], ['spectate', 'Spectate']];
export const LAPS = [['3', '3 laps'], ['5', '5 laps'], ['quarter', '25 % distance'], ['full', 'Full distance']];
export const DIFFICULTY = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
export const PACE = {easy: 0.9, medium: 1, hard: 1.05};  // the AI's pace (driverdeck.js slider range 80-110 %)
const KEY = 'f1play', DEFAULTS = {mode: 'race', laps: '5', difficulty: 'medium', driver: null};

export function loadSetup(store = globalThis.localStorage) {
  try { return {...DEFAULTS, ...JSON.parse(store.getItem(KEY))}; } catch (e) { return {...DEFAULTS}; }  // blocked or bad: the defaults
}
export function saveSetup(setup, store = globalThis.localStorage) {
  try { store.setItem(KEY, JSON.stringify(setup)); } catch (e) { /* storage blocked: the setup just isn't remembered */ }
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
  const sync = () => { driver.row.hidden = mode.s.value === 'spectate'; };
  mode.s.onchange = sync;
  sync();
  const start = el('button', {class: 'tvbtn', onclick: () => {
    const setup = {...saved, mode: mode.s.value, driver: driver.s.value || null, laps: laps.s.value, difficulty: level.s.value};
    saveSetup(setup);
    onStart(setup);
  }}, 'Start race');
  const card = el('div', {class: 'playsetup glass', role: 'dialog', 'aria-label': 'Race setup'},
    el('div', {class: 'eyebrow'}, `PLAY · ${year}`),
    el('h2', {}, race?.raceName ?? 'Race'),
    el('div', {class: 'psdecks'}, Object.assign(deck('circuitdeck'), {textContent: 'Change circuit'}), Object.assign(deck('carsdeck'), {textContent: 'Change car'})),
    mode.row, driver.row, laps.row, level.row, start);
  if (!list.length) { start.disabled = true; start.textContent = 'No entry list for this race'; }
  return card;
}
