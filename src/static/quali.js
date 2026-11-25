// Qualifying evolution and practice long runs, from the laps of a session's GPS replay (replay.py: laps are
// [start, driver, lap, time, s1, s2, s3] in session seconds, race_control [t, category, flag, message]). Pure.
import {fmtLap, median} from './util.js';

export const MIN_RUN = 5;   // laps that make a long run
export const LIMIT = 1.07;  // a time over this multiple of its part's best isn't one (qualifying's 107 % rule)
export const SPREAD = 0.03;  // each within this of the run's median: a push lap, a cool-down or traffic ends it

// the session's parts, [from, to]: from the pit exit opening to the chequered flag (a red flag's restart stays in its part)
export function segments(rc) {
  const out = [];
  let from = null;
  for (const [t, , flag, message] of [...rc].sort((a, b) => a[0] - b[0])) {
    if (from === null && flag === 'GREEN' && /PIT EXIT OPEN/.test(message ?? '')) from = t;
    else if (from !== null && flag === 'CHEQUERED') { out.push([from, t]); from = null; }
  }
  return out;
}

// the laps the stewards took away, as 'car time' ("CAR 16 (LEC) TIME 1:22.980 DELETED - TRACK LIMITS…"), less those given back
export function deleted(rc) {
  const out = new Set();
  for (const [, , , message] of [...rc].sort((a, b) => a[0] - b[0])) {
    const m = /^CAR (\d+) .*TIME (\d+:\d\d\.\d{3}) (DELETED|WILL BE REINSTATED)/.exec(message ?? '');
    if (m) out[m[3] === 'DELETED' ? 'add' : 'delete'](`${m[1]} ${m[2]}`);
  }
  return out;
}

// The ideal lap: each driver's three best sectors of the session added up, against their best real lap. Rows
// [{num, sectors: [s1, s2, s3], ideal, best, lost}] fastest ideal first, and the session's best in each sector.
// A deleted lap's sectors still count: the feed doesn't say which sector left the track.
export function idealLaps({laps}) {
  const by = new Map();
  for (const [, num, , time, ...secs] of laps) {
    const d = by.get(num) ?? by.set(num, {num, sectors: [Infinity, Infinity, Infinity], best: Infinity}).get(num);
    secs.forEach((s, i) => { if (s > 0 && s < d.sectors[i]) d.sectors[i] = s; });
    if (time > 0 && time < d.best) d.best = time;
  }
  const rows = [...by.values()].filter(d => d.sectors.every(Number.isFinite) && Number.isFinite(d.best))
    .map(d => { const ideal = d.sectors.reduce((a, b) => a + b); return {...d, ideal, lost: Math.max(0, d.best - ideal)}; })
    .sort((a, b) => a.ideal - b.ideal);
  return {rows, bests: [0, 1, 2].map(i => Math.min(...rows.map(r => r.sectors[i])))};
}

// Each driver's best lap in Q1, Q2 and Q3 (a lap counts for the part it started in, so one begun before the flag stands and a
// knocked-out car's in-lap isn't a Q2 time), each part's best, and every time the session's fastest lap fell.
// split: false when race control doesn't show exactly three parts; then it's one table of bests, not mislabelled ones.
export function qualiEvolution({laps, race_control: rc}) {
  const found = segments(rc ?? []), split = found.length === 3, parts = split ? found : [[-Infinity, Infinity]];
  const by = new Map(), falls = [], gone = deleted(rc ?? []);
  let best = Infinity;
  for (const [t, num, , time] of laps.filter(l => l[3] != null && !gone.has(`${l[1]} ${fmtLap(l[3])}`)).sort((a, b) => a[0] + a[3] - b[0] - b[3])) {
    const i = parts.findIndex(([a, b]) => t >= a && t <= b);
    if (i < 0) continue;
    if (!by.has(num)) by.set(num, parts.map(() => null));
    const mine = by.get(num);
    if (mine[i] === null || time < mine[i]) mine[i] = time;
    if (time < best) {
      falls.push({t: t + time, num, time, part: i, gain: best === Infinity ? null : best - time});
      best = time;
    }
  }
  const last = times => times.findLastIndex(x => x !== null);
  const all = [...by].map(([num, times]) => ({num, times}));
  const bests = parts.map((_, i) => Math.min(...all.map(r => r.times[i] ?? Infinity)));
  // shortcut: a slow lap left standing after a driver's real one was deleted is told apart only by LIMIT, which also drops a
  // genuine time that slow (a drying session); read the classification from F1's feed if that's ever seen
  const rows = all.map(r => ({num: r.num, times: r.times.map((t, i) => (t !== null && t > bests[i] * LIMIT ? null : t))})).filter(r => r.times.some(t => t !== null))
    .sort((a, b) => last(b.times) - last(a.times) || a.times[last(a.times)] - b.times[last(b.times)]);  // the grid's order, near enough
  return {split, rows, falls, bests};
}


// the stretches of a run of consecutive laps that hold together: the laps off its median split it, and each piece is asked again
function steady(run) {
  if (run.length < MIN_RUN) return [];
  const med = median(run.map(l => l[3])), out = [[]];
  for (const l of run) Math.abs(l[3] - med) <= med * SPREAD ? out.at(-1).push(l) : out.push([]);
  return out.length === 1 ? [run] : out.flatMap(steady);
}

// Long runs: MIN_RUN or more consecutive timed laps on one set of tyres, each within SPREAD of the run's median.
// slope is s per lap by least squares: fuel burning off and the tyres wearing, together. Fastest mean first.
export function longRuns({laps, stints}) {
  const out = [];
  for (const num of new Set(laps.map(l => l[1]))) {
    const mine = laps.filter(l => l[1] === num && l[3] != null).sort((a, b) => a[2] - b[2]);
    const sets = (stints ?? []).filter(s => s[0] === num);
    for (const [, a, b, compound, age] of sets.length ? sets : [[num, 1, null, null, null]]) {
      const runs = [[]];
      for (const l of mine.filter(l => l[2] >= (a ?? 1) && l[2] <= (b ?? Infinity))) {
        if (runs.at(-1).length && l[2] !== runs.at(-1).at(-1)[2] + 1) runs.push([]);  // a lap with no time between them
        runs.at(-1).push(l);
      }
      for (const run of runs.flatMap(steady)) {
        const n = run.length, times = run.map(l => l[3]), mean = times.reduce((s, x) => s + x, 0) / n, mid = (n - 1) / 2;
        const slope = times.reduce((s, x, i) => s + (i - mid) * (x - mean), 0) / times.reduce((s, _, i) => s + (i - mid) ** 2, 0);
        out.push({num, compound: compound ?? null, age: age ?? null, from: run[0][2], to: run.at(-1)[2], laps: n, mean, slope});
      }
    }
  }
  return out.sort((x, y) => x.mean - y.mean);
}
