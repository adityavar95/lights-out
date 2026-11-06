// The Results tab's two ledgers, each fetched when its section is opened: the pit-stop league table and the overtake ledger.
import {el, failed, get, skeleton, teamColor, th, trackStatus, lastBefore, csvButton} from './util.js';

export const PIT_WINDOW = 30;  // s either side of a stop: OpenF1's stop date is near the car leaving the lane
export const MAX_STOP = 60;    // s of pit-lane time: longer is a red flag or a garage repair, not a pit stop
const NEUTRAL = new Set(['SC', 'SC IN', 'VSC', 'VSC ENDING', 'RED']);

// Jolpica's duration: '23.958', or '16:02.123' for a stop that spans a red flag. null when it isn't a time
export function stopSeconds(s) {
  if (!/^(\d+:){0,2}\d+(\.\d+)?$/.test(s ?? '')) return null;
  return String(s).split(':').reduce((sum, p) => sum * 60 + +p, 0);
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// pits: Jolpica rows; results: the race's, for each driver's team. Quickest median first
export function pitLeague(pits, results) {
  const info = Object.fromEntries(results.map(r => [r['Driver.driverId'], r])), teams = new Map(), excluded = {none: 0, long: 0};
  for (const p of pits) {
    const s = stopSeconds(p.duration);
    if (s === null) { excluded.none++; continue; }
    if (s > MAX_STOP) { excluded.long++; continue; }
    const r = info[p.driverId], id = r?.['Constructor.constructorId'] ?? '?';
    const team = teams.get(id) ?? teams.set(id, {id, name: r?.['Constructor.name'] ?? 'Unknown team', stops: []}).get(id);
    team.stops.push({s, driver: r?.['Driver.code'] || p.driverId, lap: +p.lap});
  }
  return {excluded, teams: [...teams.values()].map(t => {
    const best = t.stops.reduce((a, b) => (b.s < a.s ? b : a));
    return {id: t.id, name: t.name, stops: t.stops.length, median: median(t.stops.map(x => x.s)), best: best.s, driver: best.driver, lap: best.lap};
  }).sort((a, b) => a.median - b.median)};
}

// /api/stationary's rows: the ones with stationary time, out of the race's real stops (OpenF1 also lists cars leaving for the
// grid, on lap 1 with no durations)
export function stationaryRows(rows) {
  const stops = rows.filter(([, lap, stop, lane]) => !(lap <= 1 && stop === null && lane === null));
  return {total: stops.length, rows: stops.filter(r => r[2] !== null).map(([num, lap, stop, lane]) => ({num, lap, stop, lane})).sort((a, b) => a.stop - b.stop)};
}

// neutralised at t: SC, VSC or a red flag. rc: [t, category, flag, message], sorted. A stoppage comes as SESSION ABORTED ...
// SESSION STARTED, with a TRACK CLEAR in between that trackStatus reads as green
export function neutralAt(rc, t) {
  if (NEUTRAL.has(trackStatus(rc, t))) return true;
  let stopped = false;
  for (let i = 0, n = lastBefore(rc, t); i <= n; i++) {
    if (rc[i][1] !== 'SessionStatus') continue;
    if (/ABORTED/.test(rc[i][3])) stopped = true;
    else if (/STARTED/.test(rc[i][3])) stopped = false;
  }
  return stopped;
}

const group = (rows, f) => {
  const m = new Map();
  for (const r of rows) (m.get(r[1]) ?? m.set(r[1], []).get(r[1])).push(f(r));
  return m;
};

// the overtaking car's own lap at t: 1 until it has started another
export function lapAt(starts, t) {
  let lap = 1;
  for (const [at, n] of starts ?? []) if (at <= t && n > lap) lap = n;
  return lap;
}

// One row's class, first match wins: lap 1, then within PIT_WINDOW of either car's stop, then neutralised, else on track
export function classify({t, a, b, lap}, pitsBy, rc) {
  if (lap === 1) return 'lap1';
  if ([a, b].some(id => (pitsBy.get(id) ?? []).some(at => Math.abs(at - t) <= PIT_WINDOW))) return 'pit';
  return neutralAt(rc, t) ? 'neutral' : 'track';
}

// /api/overtakes' feeds -> every row classed, totals, and per-driver counts. Neutralised rows count for nobody
export function overtakeLedger({overtakes, laps, pits, race_control: rc}) {
  const lapsBy = group(laps, l => [l[0], l[2]]), pitsBy = group(pits, p => p[0]);
  const rows = overtakes.map(([t, a, b, position]) => {
    const row = {t, a, b, position, lap: lapAt(lapsBy.get(a), t)};
    return {...row, cls: classify(row, pitsBy, rc)};
  });
  const counts = {lap1: 0, pit: 0, neutral: 0, track: 0}, per = new Map();
  for (const r of rows) {
    counts[r.cls]++;
    if (r.cls === 'neutral') continue;
    const d = per.get(r.a) ?? per.set(r.a, {num: r.a, lap1: 0, pit: 0, track: 0}).get(r.a);
    d[r.cls]++;
  }
  return {rows, counts, drivers: [...per.values()].sort((x, y) => y.track - x.track || y.lap1 + y.pit - x.lap1 - x.pit)};
}

// ---------- the sections ----------

const CLASS = {lap1: 'Lap 1', pit: 'Pit-related', neutral: 'Under SC/VSC/red', track: 'On track'};
const secs = (s, d = 3) => s.toFixed(d);
const note = text => el('p', {class: 'muted small'}, text);
const none = text => el('p', {class: 'empty'}, text);
const table = (head, body) => el('div', {class: 'tablewrap'}, el('table', {class: 'data'}, el('thead', {}, el('tr', {}, head.map(th))), el('tbody', {}, body)));
const bar = (title, button) => el('div', {class: 'ledgerbar'}, el('h3', {}, title), button);

// a section that loads when first opened; load(): the elements to show
function section(title, load) {
  const body = el('div');
  const run = () => {
    body.replaceChildren(skeleton());
    load().then(parts => body.replaceChildren(...parts.filter(Boolean)), e => body.replaceChildren(failed(e, run)));
  };
  const box = el('details', {class: 'card ledgerbox', ontoggle: () => { if (box.open && !body.hasChildNodes()) run(); }}, el('summary', {}, title), body);
  return box;
}

async function pitParts(year, round, results, jol) {
  if (year < 2011) return [none(`No pit-stop times for ${year}: Jolpica's records start in 2011.`)];
  const pits = await jol('pitstops', round), {teams, excluded} = pitLeague(pits, results);
  if (!pits.length) return [none('Jolpica has no pit stops for this race yet.')];
  const left = [excluded.none && `${excluded.none} with no time`, excluded.long && `${excluded.long} over ${MAX_STOP} s (a red flag or a repair)`].filter(Boolean);
  const head = ['#', 'Team', 'Stops', 'Median', 'Best', 'Driver', 'Lap'];
  return [note('Pit-lane time: Jolpica times the whole trip through the pit lane, from entry to exit. It is not the time the car stood still.'),
    left.length ? note(`Left out of ${pits.length} stops: ${left.join(' and ')}.`) : null,
    bar('Teams by median pit-lane time', csvButton(`pitstops_${year}_${round}`, head, () => teams.map((t, i) => [i + 1, t.name, t.stops, +secs(t.median), +secs(t.best), t.driver, t.lap]))),
    teams.length ? table(head, teams.map((t, i) => el('tr', {},
      el('td', {class: 'num'}, i + 1),
      el('td', {}, el('span', {class: 'chip', style: `background:${teamColor(t.id, t.name)}`}), el('b', {}, t.name)),
      el('td', {class: 'num'}, t.stops), el('td', {class: 'num'}, secs(t.median)), el('td', {class: 'num'}, secs(t.best)),
      el('td', {}, t.driver), el('td', {class: 'num'}, t.lap)))) : none('None of this race\'s stops has a usable time.'),
    stationaryPart(year, round, results)];
}

// a table of its own request: if OpenF1 is locked or down, the league table above still stands
function stationaryPart(year, round, results) {
  if (year < 2023) return note(`Stationary time: none for ${year}. OpenF1's records start in 2023.`);
  const box = el('div', {class: 'stationary'}), label = driverLabel(results);
  const run = () => {
    box.replaceChildren(skeleton(3));
    get(`/api/stationary/${year}/${round}`).then(data => {
      const {rows, total} = stationaryRows(data), head = ['Driver', 'Lap', 'Stationary', 'Pit lane'];
      box.replaceChildren(bar('Stationary time', rows.length ? csvButton(`stationary_${year}_${round}`, head, () => rows.map(r => [label(r.num).code, r.lap, r.stop, r.lane])) : ''),
        note(`Partial: OpenF1 has stop_duration, the time the car stood still, for ${rows.length} of this race's ${total} stops. Its coverage is patchy from 2025 and almost nothing before, so this can't rank teams.`),
        ...(rows.length ? [table(head, rows.map(r => el('tr', {}, el('td', {}, driverCell(label(r.num))), el('td', {class: 'num'}, r.lap),
          el('td', {class: 'num'}, secs(r.stop, 1)), el('td', {class: 'num'}, r.lane === null ? '' : secs(r.lane, 1)))))] : []));
    }, e => box.replaceChildren(failed(e, run)));
  };
  run();
  return box;
}

function driverLabel(results) {
  const by = Object.fromEntries(results.map(r => [String(r.number), r]));
  return num => {
    const r = by[num];
    return {code: r ? r['Driver.code'] || r['Driver.familyName'].slice(0, 3).toUpperCase() : `#${num}`, color: r ? teamColor(r['Constructor.constructorId'], r['Constructor.name']) : 'var(--muted)'};
  };
}
const driverCell = ({code, color}) => [el('span', {class: 'chip', style: `background:${color}`}), el('b', {}, code)];

async function overtakeParts(year, round, results) {
  if (year < 2023) return [none(`No overtake records for ${year}: OpenF1's start in 2023.`)];
  const {rows, counts, drivers} = overtakeLedger(await get(`/api/overtakes/${year}/${round}`)), label = driverLabel(results);
  const onTrack = rows.filter(r => r.cls === 'track');
  const allHead = ['Lap', 'Class', 'Overtaking', 'Overtaken', 'For position'], perHead = ['Driver', 'On track', 'Lap 1', 'Pit-related'];
  return [note('As reported by OpenF1; no official count exists. OpenF1 says this feed includes position changes from pit stops and penalties, and may be incomplete.'),
    note(`${rows.length} rows: ${counts.lap1} on lap 1, ${counts.pit} within ${PIT_WINDOW} s of either car's stop, ${counts.track} on track. ${counts.neutral} under a safety car, VSC or red flag aren't counted below.`),
    bar('Per driver', csvButton(`overtakes_${year}_${round}`, allHead, () => rows.map(r => [r.lap, CLASS[r.cls], label(r.a).code, label(r.b).code, r.position]))),
    table(perHead, drivers.map(d => el('tr', {}, el('td', {}, driverCell(label(d.num))), el('td', {class: 'num'}, d.track), el('td', {class: 'num'}, d.lap1), el('td', {class: 'num'}, d.pit)))),
    el('h3', {}, 'On-track overtakes'),
    onTrack.length ? table(['Lap', 'Overtaking', 'Overtaken', 'For position'], onTrack.map(r => el('tr', {}, el('td', {class: 'num'}, r.lap),
      el('td', {}, driverCell(label(r.a))), el('td', {}, driverCell(label(r.b))), el('td', {class: 'num'}, r.position ?? '')))) : none('None reported in this race.')];
}

// results: the race's, empty before it has run: then there's nothing to add. jol: app.js's Jolpica fetch
export function resultLedgers(year, round, results, jol) {
  if (!results.length) return [];
  return [section('Pit-stop league table', () => pitParts(year, round, results, jol)), section('Overtake ledger', () => overtakeParts(year, round, results))];
}
