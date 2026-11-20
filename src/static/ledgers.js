// The Results tab's sections, each fetched when it is opened: the pit-stop league table, the overtake ledger, and from a
// session's own laps (quali.js) qualifying's evolution and practice's long runs.
import {el, failed, get, skeleton, teamColor, th, trackStatus, lastBefore, csvButton, fmtLap, fmtClock, signed as sign} from './util.js';
import {qualiEvolution, longRuns, idealLaps, MIN_RUN, SPREAD, LIMIT} from './quali.js';

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

// What the stewards did, from race control's messages [t, category, flag, text]. Wordings as OpenF1 has them (2023+):
// "CAR 4 (NOR) TIME 1:31.2 DELETED - TRACK LIMITS AT TURN 4 ...", "BLACK AND WHITE FLAG FOR CAR 4 (NOR) - ...",
// "... INCIDENT INVOLVING CARS 4 (NOR) AND 81 (PIA) NOTED - CAUSING A COLLISION", "... UNDER INVESTIGATION ...",
// "... REVIEWED NO FURTHER INVESTIGATION ...", "5 SECOND TIME PENALTY FOR CAR 4 (NOR) - ...".
// Returns {rows: [{t, kind, codes, text}], tally: Map code -> {penalty, noted, deleted, warning}}; a decision made after
// the session isn't in this feed.
const STEWARD_KINDS = [['deleted', /DELETED/], ['warning', /BLACK AND WHITE FLAG/], ['cleared', /NO FURTHER (ACTION|INVESTIGATION)/],
  ['served', /PENALTY SERVED/], ['penalty', /PENALTY/], ['noted', /UNDER INVESTIGATION|WILL BE INVESTIGATED|NOTED/]];
export const STEWARD_NAMES = {deleted: 'Lap deleted', warning: 'Warning', cleared: 'No action', served: 'Penalty served', penalty: 'Penalty', noted: 'Investigated'};
export function stewards(rc) {
  const rows = [], tally = new Map(), seen = new Set();
  for (const [t, , , text] of rc ?? []) {
    const kind = STEWARD_KINDS.find(([, re]) => re.test(text ?? ''))?.[0];
    if (!kind) continue;
    const codes = [...text.matchAll(/\b\d+ \(([A-Z]{3})\)/g)].map(m => m[1]);
    if (!codes.length) continue;
    rows.push({t, kind, codes, text: text.replace(/^FIA STEWARDS: /, '').replace(/ ?\(?\d\d:\d\d:\d\d\)?( \([A-Z]{3}\))?$/, '')});
    if (kind === 'cleared' || kind === 'served') continue;
    // one incident is noted, then put under investigation: counted once per car and reason
    const reason = text.split(' - ')[1]?.replace(/\s*\(?\d\d:\d\d:\d\d.*$/, '') ?? '';
    for (const c of codes) {
      const key = `${kind}|${c}|${reason}`;
      if (kind === 'noted' && seen.has(key)) continue;
      seen.add(key);
      const row = tally.get(c) ?? tally.set(c, {penalty: 0, noted: 0, deleted: 0, warning: 0}).get(c);
      row[kind]++;
    }
  }
  return {rows, tally};
}

function stewardParts(year, round, d) {
  const {rows, tally} = stewards(d.race_control), label = payloadLabel(d.drivers), by = Object.fromEntries((d.drivers ?? []).map(x => [x.code, x]));
  const cell = code => driverCell({code, color: by[code]?.color ?? 'var(--muted)'});
  if (!rows.length) return [none('Race control shows no penalties, investigations or deleted laps in this race.')];
  const head = ['Driver', 'Penalties', 'Investigated', 'Laps deleted', 'Warnings'], log = ['Time', 'What', 'Driver', 'Message'];
  const order = [...tally].sort((a, b) => b[1].penalty - a[1].penalty || b[1].noted - a[1].noted || b[1].deleted - a[1].deleted);
  return [note('From race control during the race: a penalty or decision given afterwards is not in this feed. A time opens the replay at that moment.'),
    bar('By driver', csvButton(`stewards_${year}_${round}`, log, () => rows.map(r => [fmtClock(r.t), STEWARD_NAMES[r.kind], r.codes.join(' '), r.text]))),
    table(head, order.map(([code, n]) => el('tr', {}, el('td', {}, cell(code)), [n.penalty, n.noted, n.deleted, n.warning].map(v => el('td', {class: 'num'}, v || ''))))),
    el('h3', {}, 'As it happened'),
    table(log, rows.map(r => el('tr', {}, el('td', {class: 'num'}, el('a', {href: `#${year}/${round}/replay?t=${Math.max(0, Math.round(r.t) - 10)}`}, fmtClock(r.t))),
      el('td', {}, STEWARD_NAMES[r.kind]), el('td', {}, r.codes.flatMap(cell)), el('td', {class: 'small'}, r.text))))];
}

// A session's laps (/api/sessionlaps), drawn by draw(data). They come from its GPS replay: when that isn't built yet the box
// asks first, since a build is ~30 requests of OpenF1's 30 a minute.
function sessionBox(year, round, session, draw) {
  const box = el('div'), url = `/api/sessionlaps/${year}/${round}?session=${encodeURIComponent(session)}`;
  const run = build => {
    box.replaceChildren(skeleton());
    get(url + (build ? '&build=1' : '')).then(d => box.replaceChildren(...draw(d).filter(Boolean)), e => box.replaceChildren(...(e.message === 'NOT_BUILT'
      ? [note(`${session}'s laps aren't on this computer yet. Fetching them takes about 30 requests to OpenF1 and up to a minute.`),
        el('button', {class: 'pill', onclick: () => run(true)}, 'Fetch the laps')]
      : [failed(e, () => run(build))])));
  };
  run(false);
  return box;
}

// the replay's own drivers (the session may have run before the race has results)
const payloadLabel = drivers => {
  const by = Object.fromEntries((drivers ?? []).map(d => [String(d.id), d]));
  return num => ({code: by[num]?.code ?? `#${num}`, color: by[num]?.color ?? 'var(--muted)'});
};
const signed = (x, d = 3) => sign(x, d);

function qualiParts(year, round, d) {
  const {split, rows, falls, bests} = qualiEvolution(d), label = payloadLabel(d.drivers), names = split ? ['Q1', 'Q2', 'Q3'] : ['Best'];
  if (!rows.length) return [none('No timed laps in this session.')];
  const head = ['#', 'Driver', ...names], fallHead = [split ? 'Part' : '#', 'Driver', 'Lap', 'Gained'];
  return [note(split ? `Each driver's best lap in each part, from OpenF1's lap times, with the gap to that part's best. Laps the stewards deleted are left out, and so is a lap over ${Math.round(LIMIT * 100)} % of the part's best. Sorted by the last part reached: the grid before penalties.`
    : "Each driver's best lap, from OpenF1's lap times. Race control doesn't show three parts for this session, so it isn't split."),
    bar(split ? 'Best lap by part' : 'Best laps', csvButton(`qualifying_${year}_${round}`, head, () => rows.map((r, i) => [i + 1, label(r.num).code, ...r.times.map(t => fmtLap(t))]))),
    table(head, rows.map((r, i) => el('tr', {}, el('td', {class: 'num'}, i + 1), el('td', {}, driverCell(label(r.num))),
      r.times.map((t, k) => el('td', {class: 'num'}, t === null ? '' : t === bests[k] ? el('b', {}, fmtLap(t)) : [fmtLap(t), el('span', {class: 'muted small'}, ` +${secs(t - bests[k])}`)]))))),
    el('h3', {}, 'The fastest lap, as it fell'),
    table(fallHead, falls.map((f, i) => el('tr', {}, el('td', {class: 'num'}, split ? names[f.part] : i + 1), el('td', {}, driverCell(label(f.num))),
      el('td', {class: 'num'}, fmtLap(f.time)), el('td', {class: 'num'}, f.gain === null ? '' : signed(-f.gain))))),
    ...idealParts(year, round, d, label)];
}

// best sectors and the lap they'd make, for any session with sector times
function idealParts(year, round, d, label) {
  const {rows, bests} = idealLaps(d), head = ['#', 'Driver', 'Sector 1', 'Sector 2', 'Sector 3', 'Ideal lap', 'Best lap', 'Left on track'];
  if (!rows.length) return [];
  return [el('h3', {}, 'Ideal lap'),
    note("Each driver's best three sectors of the session added together, against their best real lap. Bold is the session's best sector."),
    bar('Best sectors', csvButton(`ideal_${year}_${round}_${d.session.replace(/ /g, '')}`, head, () => rows.map((r, i) => [i + 1, label(r.num).code, ...r.sectors, fmtLap(r.ideal), fmtLap(r.best), +r.lost.toFixed(3)]))),
    table(head, rows.map((r, i) => el('tr', {}, el('td', {class: 'num'}, i + 1), el('td', {}, driverCell(label(r.num))),
      r.sectors.map((s, k) => el('td', {class: 'num'}, s === bests[k] ? el('b', {}, s.toFixed(3)) : s.toFixed(3))),
      el('td', {class: 'num'}, fmtLap(r.ideal)), el('td', {class: 'num'}, fmtLap(r.best)), el('td', {class: 'num'}, r.lost ? signed(r.lost) : ''))))];
}

function runParts(year, round, d) {
  const runs = longRuns(d), label = payloadLabel(d.drivers), head = ['Driver', 'Tyre', 'Tyre age', 'Laps', 'Count', 'Mean', 'Trend (s/lap)'];
  if (!runs.length) return [none(`Nobody ran ${MIN_RUN} steady laps in a row in this session.`), ...idealParts(year, round, d, label)];
  return [note(`Runs of ${MIN_RUN} or more laps in a row on one set of tyres, each within ${SPREAD * 100} % of the run's median: a push lap, a cool-down or traffic ends a run. Fastest mean first. Tyre age is the set's laps when its stint began. Trend is how the lap time moved per lap: fuel burning off quickens a car and tyre wear slows it, and this is the two together. Fuel loads aren't known, so the means don't compare cars exactly.`),
    bar('Long runs', csvButton(`longruns_${year}_${round}_${d.session.replace(/ /g, '')}`, head, () => runs.map(r => [label(r.num).code, r.compound ?? '', r.age ?? '', `${r.from}-${r.to}`, r.laps, fmtLap(r.mean), +r.slope.toFixed(3)]))),
    table(head, runs.map(r => el('tr', {}, el('td', {}, driverCell(label(r.num))), el('td', {}, r.compound ?? ''), el('td', {class: 'num'}, r.age ?? ''),
      el('td', {class: 'num'}, `${r.from}–${r.to}`), el('td', {class: 'num'}, r.laps), el('td', {class: 'num'}, fmtLap(r.mean)), el('td', {class: 'num'}, signed(r.slope))))), ...idealParts(year, round, d, label)];
}

// one practice session at a time, Practice 2 first where there is one: teams run their race simulations in it
function practiceParts(year, round, names) {
  const holder = el('div'), show = name => holder.replaceChildren(sessionBox(year, round, name, d => runParts(year, round, d)));
  const first = names.includes('Practice 2') ? 'Practice 2' : names.at(-1);
  show(first);
  return [names.length > 1 && el('label', {class: 'muted small'}, 'Session ', el('select', {onchange: e => show(e.target.value)},
    names.map(n => el('option', {selected: n === first}, n)))), holder];
}

// results: the race's, empty before it has run. sessions: the weekend's sessions that have started (the session list's names).
// jol: app.js's Jolpica fetch
export function resultLedgers(year, round, results, jol, sessions = []) {
  const practice = sessions.filter(s => s.startsWith('Practice'));
  return [
    ...(results.length ? [section('Pit-stop league table', () => pitParts(year, round, results, jol)), section('Overtake ledger', () => overtakeParts(year, round, results))] : []),
    year >= 2023 && results.length && section('Stewards', async () => [sessionBox(year, round, 'Race', d => stewardParts(year, round, d))]),
    year >= 2023 && sessions.includes('Qualifying') && section('Qualifying evolution', async () => [sessionBox(year, round, 'Qualifying', d => qualiParts(year, round, d))]),
    year >= 2023 && practice.length && section('Practice long runs', async () => practiceParts(year, round, practice)),
  ].filter(Boolean);
}
