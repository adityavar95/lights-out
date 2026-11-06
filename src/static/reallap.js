// Real laps for the telemetry trace: OpenF1 car data (speed, pedals, rpm, gear, DRS on the GPS replay's time grid) turned
// into the same 500-bucket lap trace.js records from the simulation. Pure (no DOM), tested in tests/test_trace.mjs.
//
// No channel gives distance, so it is integrated: d(t) = integral of v dt over the official lap window. Speed is sampled
// every 0.5 s and a wheel-speed trace overreads or underreads slightly, so d(T) misses the true lap by ~1 %, differently
// each lap; scaling every lap to one length makes both start and end on the line, which is what lets them overlay.
// The time at each bucket comes back from the same interpolation trace.js's record uses, and the lap's total stays the
// official one by construction. What can still be wrong is the time partway round: sectorCheck measures that.
import {N, CHANNELS, createRecorder, record} from './trace.js';

// the replay's and the trace's telemetry request: one URL, so util.js get's cache serves both
export const teleUrl = (S, d) => `/api/telemetry/${S.year}/${S.round}?session=${encodeURIComponent(S.data.session)}&driver=${d.num}`
  + `&start=${encodeURIComponent(S.data.start)}&duration=${S.data.duration}`;

export const isReal = S => !S?.sim && !S?.live && S?.data?.mode === 'gps' && !!S.data.laps?.length;

const lapTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;

// Race control's deleted lap times per driver, as {times: Set of lap times (s, 3 dp), laps: Set of lap numbers}. The
// message's own "LAP n" is one ahead of OpenF1's lap_number (checked on 2026 US GP qualifying: four of four), so a
// message with a TIME is matched by that time. A bare "LAP DELETED" has no time.
// shortcut: a bare one marks both n - 1 and n, since it only costs a lap its place as the default; upgrade if F1 ever
// says which lap it means.
function deletions(control = []) {
  const out = {};
  for (const [, , , msg] of control) {
    const car = /^CAR (\d+)/.exec(msg ?? '')?.[1], time = /TIME (\d+):(\d+\.\d+)/.exec(msg ?? '');
    if (!car) continue;
    const secs = time && (+time[1] * 60 + +time[2]).toFixed(3), d = out[car] ??= {times: new Set(), laps: new Set()};
    if (/REINSTATED/.test(msg)) { if (secs) d.times.delete(secs); continue; }
    if (!/DELETED/.test(msg)) continue;
    if (secs) d.times.add(secs);
    else for (const m of msg.matchAll(/LAP (\d+)/g)) if (+m[1]) d.laps.add(+m[1]).add(+m[1] - 1);
  }
  return out;
}

// A driver's timed laps from the replay payload: {lapNo, start, dur, sectors, compound, tag}, in lap order. tag says why
// a lap isn't representative: pit laps, lap 1 (a standing start, or out of the garage), deleted times. Those stay
// pickable but are never the default. Pit laps go by the pit's time, not its lap_number: that number is the in-lap in a
// race but the out-lap in qualifying and practice (measured on 8 sessions, 390 stops). By time it's one rule: the stop
// falls in the out-lap, and the lap before it is the in-lap. 0.2 s: the payload's times are rounded to 0.1 s.
export function lapTable(data, id) {
  const all = (data.laps ?? []).filter(l => l[1] === id), outLaps = new Set();
  for (const p of data.pits ?? []) {
    if (p[1] !== id) continue;
    const w = all.reduce((m, l) => (l[0] <= p[0] + 0.2 && (!m || l[0] > m[0]) ? l : m), null);
    if (w) outLaps.add(w[2]);
  }
  const gone = deletions(data.race_control)[id];
  return all.filter(l => l[3]).map(([start, , lapNo, dur, s1, s2, s3]) => ({
    lapNo, start, dur, sectors: [s1, s2, s3],
    compound: (data.stints ?? []).find(s => s[0] === id && s[1] <= lapNo && lapNo <= s[2])?.[3] ?? null,
    tag: lapNo === 1 ? 'first lap' : outLaps.has(lapNo) ? 'out-lap' : outLaps.has(lapNo + 1) ? 'in-lap'
      : gone?.times.has(dur.toFixed(3)) || gone?.laps.has(lapNo) ? 'deleted' : null,
  })).sort((a, b) => a.lapNo - b.lapNo);
}

// the fastest clean lap; a driver with none falls back to their fastest timed lap
export function fastestClean(rows) {
  const best = list => list.reduce((m, r) => (!m || r.dur < m.dur ? r : m), null);
  return best(rows.filter(r => !r.tag)) ?? best(rows);
}

export const lapLabel = (r, fastest) => `L${r.lapNo} · ${lapTime(r.dur)}${r === fastest ? ' · best' : ''}${r.tag ? ` · ${r.tag}` : ''}`;

const num = v => (v === null || v === undefined ? NaN : v);
// OpenF1's DRS codes: 10, 12, 14 are open, 8 eligible, 0 / 1 shut. 2026 cars send nothing: NaN, not "shut".
const drsOpen = v => (v === null || v === undefined ? NaN : v >= 10 ? 1 : 0);
// pedals: OpenF1 sends the odd 104 where it means full
const pct = v => (v === null || v === undefined ? NaN : Math.min(100, v));

// tele: /api/telemetry's {step, speed, ...} arrays, indexed from the replay's start; row: a lapTable row; meta: the lap's
// labels. len: the track's length in metres, used if within 5 % of what the speed integrates to (a stand-in outline may
// be nothing like it; the lap's own distance is then the scale). Returns a trace.js lap with `distance` (integrated, unscaled), or null when speed has a gap inside the
// window: a gap's distance is unknowable, and any filling in would put every later corner in the wrong place.
export function realLap(tele, row, meta = {}, len = 0) {
  const {step, speed} = tele, {start, dur} = row, end = start + dur;
  const kmh = t => { const x = t / step, i = Math.floor(x), a = speed[i], b = speed[i + 1];
    return a === null || a === undefined || b === null || b === undefined ? NaN : a + (b - a) * (x - i); };
  // the window's two ends, then every grid sample between them
  const times = [start];
  for (let i = Math.floor(start / step) + 1; i * step < end; i++) times.push(i * step);
  times.push(end);
  const v = times.map(t => kmh(t) / 3.6);
  if (v.some(Number.isNaN)) return null;
  // trapezoids: between 0.5 s samples a car's speed is closer to a straight line than to a held step
  const d = [0];
  for (let i = 1; i < times.length; i++) d.push(d[i - 1] + (v[i - 1] + v[i]) / 2 * (times[i] - times[i - 1]));
  const distance = d.at(-1), L = Math.abs(len / distance - 1) < 0.05 ? len : distance, k = L / distance, db = L / N;
  if (!(distance > 0)) return null;

  const rec = createRecorder(L), vals = new Float64Array(CHANNELS.length - 1).fill(NaN);
  const feed = (s, t, j) => {
    // order: trace.js's IN. ers, gLat, gLong, d stay NaN: this feed doesn't have them, and NaN means "omit" downstream
    const i = Math.min(speed.length - 1, Math.floor(times[j] / step));
    vals[0] = v[j] * 3.6; vals[1] = pct(tele.throttle?.[i]); vals[2] = pct(tele.brake?.[i]); vals[3] = num(tele.rpm?.[i]);
    vals[4] = num(tele.n_gear?.[i]); vals[5] = drsOpen(tele.drs?.[i]);
    record(rec, 'lap', s, t, vals, meta);
  };
  // record closes a lap when it sees a sample past the line, and counts it only if driven from the line, so it gets one
  // sample a bucket before the start and one a bucket after the end
  feed(-db, start - db / (k * v[0] || 1), 0);
  times.forEach((t, j) => feed(d[j] * k, t, j));
  feed(L + db, end + db / (k * v.at(-1) || 1), times.length - 1);
  const lap = rec.cars.lap.previous;
  return lap && Object.assign(lap, {lapNo: row.lapNo - 1, time: row.dur, sectors: row.sectors, compound: row.compound, len: L, distance, abs: start});
}

// where lap L is at each bucket, from the car's GPS frames at the bucket's time: [x, y] map coords or null. The map's
// outline may not start on the line, so this is the only position that certainly belongs to this distance.
export function lapPath(L, frames, step, rot) {
  if (!frames) return new Array(N).fill(null);
  return Array.from(L.t, t => {
    const x = (L.abs + t) / step, i = Math.floor(x), k = x - i, [xa, xb, ya, yb] = [frames.x[i], frames.x[i + 1], frames.y[i], frames.y[i + 1]];
    return [xa, xb, ya, yb].some(c => c === null || c === undefined) ? null : rot(xa + (xb - xa) * k, ya + (yb - ya) * k);
  });
}

// the bucket of a path nearest to (x, y): where a numbered corner falls on this lap
export function nearestBucket(path, x, y) {
  let best = 0, d = Infinity;
  path.forEach((p, i) => { if (!p) return; const e = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (e < d) { d = e; best = i; } });
  return best;
}

// elapsed time at lap fraction f, linear between buckets; the last stretch runs to the line at the lap's official time
function timeAt(L, f) {
  const x = f * N, i = Math.min(N - 1, Math.floor(x)), a = L.t[i], b = i + 1 < N ? L.t[i + 1] : L.time;
  return a + (b - a) * (x - i);
}

// the inverse: lap fraction reached at elapsed time t
function fractionAt(L, t) {
  let lo = 0, hi = N;
  const time = i => (i < N ? L.t[i] : L.time);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (time(m) <= t) lo = m; else hi = m; }
  return (lo + (t - time(lo)) / ((time(hi) - time(lo)) || 1)) / N;
}

// Accuracy against the official splits, for the two laps on screen. A lap's own split can't test it: its split point is
// found from that split, so it would match itself. What can be tested is the comparison the chart makes. Each lap says
// where the sector line is (its fraction at its official split); on the mean of the two, the integrated gap
// t_B(f) - t_A(f) should equal the official gap. offsets[k]: that error in seconds, null without official times.
// cuts: the real sector lines as lap fractions (from either lap, for the chart), null when no times exist.
export function sectorCheck(A, B) {
  const laps = [A, B].filter(Boolean), cuts = [], offsets = [];
  for (const k of [0, 1]) {
    const split = L => (L.sectors?.[0] && (k === 0 || L.sectors[1]) ? L.sectors[0] + (k ? L.sectors[1] : 0) : null);
    const found = laps.filter(L => split(L) !== null), f = found.reduce((s, L) => s + fractionAt(L, split(L)), 0) / found.length;
    cuts.push(found.length ? f : null);
    offsets.push(found.length === 2 && laps.length === 2 ? (timeAt(B, f) - timeAt(A, f)) - (split(B) - split(A)) : null);
  }
  return {cuts: cuts.every(c => c !== null) ? cuts : null, offsets};
}

// Track dominance: the lap cut into `count` equal-distance mini-sectors, each won by whichever lap took less time over
// it. winner: 'A', 'B', or null for a tie (under `tie` seconds) or a mini-sector one lap hasn't got times for; from, to:
// bucket range; gain: B's time minus A's. Times are differences of cumulative t, so sectors sum to the lap's gap.
// tie 0.05 s: measured sector residuals are ~0.1 s (~0.035 s per mini-sector), so a smaller margin is noise, not a winner
export function dominance(A, B, count = 25, tie = 0.05) {
  const edge = (L, k) => (k === count ? L.time ?? NaN : L.t[Math.round(k * N / count)]);
  const sectors = [], wins = {A: 0, B: 0, tie: 0};
  for (let k = 0; k < count; k++) {
    const gain = (edge(B, k + 1) - edge(B, k)) - (edge(A, k + 1) - edge(A, k));
    const winner = Number.isNaN(gain) || Math.abs(gain) < tie ? null : gain > 0 ? 'A' : 'B';
    if (winner) wins[winner]++;
    else if (!Number.isNaN(gain)) wins.tie++;
    sectors.push({from: Math.round(k * N / count), to: Math.round((k + 1) * N / count), winner, gain});
  }
  return {sectors, wins, count};
}

// the same result as a sentence, for the map's text alternative and anyone who can't tell the colours apart
export function dominanceText({wins, count}, a, b) {
  const [lead, other, nLead, nOther] = wins.A >= wins.B ? [a, b, wins.A, wins.B] : [b, a, wins.B, wins.A];
  return `${lead} fastest in ${nLead} of ${count} mini-sectors, ${other} in ${nOther}, ${wins.tie} tied`;
}
