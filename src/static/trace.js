// Lap telemetry traces, MoTeC / FastF1 style: every car's channels resampled onto a fixed DISTANCE grid, so two laps
// line up corner for corner however fast each one was. Pure (no DOM), tested in tests/test_trace.mjs.
//
// Why distance, not time: plotted against elapsed time a quicker car reaches every corner earlier and its braking
// trace slides left of the slower car's, so the same corner sits at different x. Plotted against lap distance s the
// braking zones overlay exactly and the difference becomes "brakes 16 m later". The lap [0, len) is cut into N buckets
// of len / N metres (14 m at Spa); bucket b is sampled at the boundary s_b = b len / N.

export const N = 500;
// Channels stored per bucket (typed arrays, NaN = not driven yet). t: seconds since this lap's start line crossing;
// d: lateral offset from the centre line, m (with s it gives the world position, see worldPos in tracemodal.js).
// ers: index into ERS. drs: 1 open. gear / drs / ers are steps, not interpolated.
export const CHANNELS = ['t', 'kmh', 'throttle', 'brake', 'rpm', 'gear', 'drs', 'ers', 'gLat', 'gLong', 'd'];
export const ERS = ['HOLD', 'HARVEST', 'DEPLOY', 'OVERTAKE'];
const STEP = new Set(['gear', 'drs', 'ers']);
const IN = CHANNELS.slice(1);  // what the caller fills in `values`, in this order (t comes from the race clock)

const newLap = (lapNo, from, meta) => ({lapNo, from, time: null, ...meta,
  ...Object.fromEntries(CHANNELS.map(k => [k, new Float32Array(N).fill(NaN)]))});

// len: lap length in metres. Per car: cur (being driven), previous and fastest complete laps.
export function createRecorder(len) {
  return {len, cars: {}};
}

// Called after every physics substep for every car. s: total distance since the start line (grows lap after lap,
// negative on the grid, so the first crossing of the line fills bucket 0 and lap 1 counts); t: race clock; values: a caller-owned Float64Array in IN order (reused, never kept);
// meta: lap labels {code, teamId, color, year, compound}, read only when a lap starts.
//
// Resampling: between two substeps the car moved from s0 to s1 in t0..t1. Every bucket boundary s_b crossed in that
// interval gets each channel by linear interpolation in distance: f = (s_b - s0) / (s1 - s0), v_b = v0 + f (v1 - v0).
// Time interpolated the same way is the crossing time of s_b to well under a millisecond (a substep is <= 10 ms), so
// laps compare to the hundredth however the render frames fall, at any replay speed.
export function record(rec, id, s, t, values, meta) {
  const c = rec.cars[id] ??= {cur: null, previous: null, fastest: null, last: null, lastK: -1, lastS: 0, lastT: 0};
  const db = rec.len / N, k = Math.floor(s / db);  // k: global bucket index = lap x N + bucket
  if (c.last && k > c.lastK) {
    for (let g = c.lastK + 1; g <= k; g++) {
      const lap = Math.floor(g / N), b = g - lap * N, f = (g * db - c.lastS) / ((s - c.lastS) || 1), tb = c.lastT + f * (t - c.lastT);
      if (!c.cur || c.cur.lapNo !== lap) startLap(c, lap, b, tb, meta);
      const L = c.cur;
      L.t[b] = tb - L.t0;
      IN.forEach((ch, j) => { L[ch][b] = STEP.has(ch) ? (f < 0.5 ? c.last[j] : values[j]) : c.last[j] + f * (values[j] - c.last[j]); });
    }
  }
  c.last ??= new Float64Array(IN.length);
  c.last.set(values);
  c.lastK = Math.max(c.lastK, k);  // -1 on the grid; a spin that runs backwards doesn't refill buckets already crossed
  c.lastS = s;
  c.lastT = t;
}

// The car crossed the start of lap `lap` at bucket b (0 unless recording began mid-lap) at race time tb: close the
// lap it was on (its time is tb minus its start) and keep it as previous / fastest when it was driven from the line.
function startLap(c, lap, b, tb, meta) {
  const L = c.cur;
  if (L && L.from === 0 && lap === L.lapNo + 1) {
    L.time = tb - L.t0;
    c.previous = L;
    if (!c.fastest || L.time < c.fastest.time) c.fastest = L;
  }
  c.cur = Object.assign(newLap(lap, b, meta), {t0: tb});
}

// Δt(s) = t_B(s) - t_A(s): the time gap at every metre of the lap. > 0 where B is behind (A has gained that much
// since the line), and its slope shows where it was gained: rising through a corner = A quicker there.
export function delta(A, B) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = B.t[i] - A.t[i];  // NaN where either lap hasn't got there yet
  return out;
}

const ROW_CHANNELS = [['speedKmh', 'kmh'], ['throttlePct', 'throttle'], ['brakePct', 'brake'], ['rpm', 'rpm'], ['gear', 'gear'], ['drsActive', 'drs'],
                      ['ersMode', 'ers'], ['lateralG', 'gLat'], ['longitudinalG', 'gLong']];

// the lap as rows of named values (CSV / JSON export); pos(i) -> [x, y, z] world position of bucket i
export function lapRows(L, len, pos) {
  const rows = [];
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(L.t[i])) continue;
    const row = {distanceMeters: +(i * len / N).toFixed(1), splineProgress: +(i / N).toFixed(4), elapsedTime: +L.t[i].toFixed(4),
                 speedKmh: +L.kmh[i].toFixed(1), throttlePct: Math.round(L.throttle[i]), brakePct: Math.round(L.brake[i]),
                 rpm: Math.round(L.rpm[i]), gear: L.gear[i], drsActive: L.drs[i] === 1, ersMode: ERS[L.ers[i]] ?? null,
                 lateralG: +L.gLat[i].toFixed(2), longitudinalG: +L.gLong[i].toFixed(2), tireCompound: L.compound ?? null,
                 worldPos: pos(i).map(v => +v.toFixed(2))};
    // a channel this lap's source doesn't have is left out, never written as 0 or false (real laps have no g or ERS)
    for (const [key, ch] of ROW_CHANNELS) if (Number.isNaN(L[ch][i])) delete row[key];
    rows.push(row);
  }
  return rows;
}

// ---------- race engineer insights ----------

const fmt = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}s`;
const ok = v => !Number.isNaN(v);

// corner apexes: buckets where speed is the minimum over +-10 buckets and at least 30 km/h under the lap's top speed
export function apexes(L) {
  const top = Math.max(...L.kmh.filter(ok)), out = [];
  for (let i = 10; i < N - 10; i++) {
    const v = L.kmh[i];
    if (!(v < top - 30)) continue;  // also skips NaN
    let min = true;
    for (let m = i - 10; m <= i + 10 && min; m++) if (L.kmh[m] < v || (L.kmh[m] === v && m < i)) min = false;
    if (min) out.push(i);
  }
  return out;
}

// Three or four callouts from two laps, strongest first in each category. opts: {len, a, b (names), corner(i) ->
// label of the corner at or just after bucket i, cuts: the real sector lines as lap fractions (default thirds, the
// simulation's own sectors; null: unknown, so no sector is named)}. A channel a lap doesn't have (NaN) drops that part of
// its callout. Thresholds: braking onset = brake crossing 20 %; apexes as above;
// full throttle = both cars over 95 %.
export function insights(A, B, {len, a, b, corner, cuts: lines}) {
  const db = len / N, dt = delta(A, B), out = [];
  const both = i => ok(A.t[i]) && ok(B.t[i]);
  const gain = (i, j) => (both(i) && both(j) ? dt[j] - dt[i] : 0);  // what A gained from bucket i to j

  // Braking point: pair each of A's braking onsets with B's nearest one within 25 buckets (~350 m at Spa)
  const onsets = L => { const r = []; for (let i = 1; i < N; i++) if (L.brake[i] > 20 && !(L.brake[i - 1] > 20)) r.push(i); return r; };
  const ob = onsets(B);
  let brk = null;
  for (const i of onsets(A)) {
    const j = ob.reduce((best, x) => (Math.abs(x - i) <= 25 && (best === null || Math.abs(x - i) < Math.abs(best - i)) ? x : best), null);
    if (j === null || i === j) continue;
    let apex = i;  // the corner's slowest point after braking: the end of the zone
    for (let m = i; m < Math.min(N, i + 30); m++) if (A.kmh[m] < A.kmh[apex]) apex = m;
    const g = gain(Math.max(0, Math.min(i, j) - 5), apex);
    if (!brk || Math.abs(i - j) > Math.abs(brk.i - brk.j)) brk = {i, j, g};
  }
  if (brk) {
    const later = brk.i > brk.j ? a : b, g = brk.i > brk.j ? brk.g : -brk.g;
    out.push({kind: 'BRAKING', text: `${later} brakes ${Math.round(Math.abs(brk.i - brk.j) * db)} m later into ${corner(brk.i)}, `
      + `${g >= 0 ? 'gaining' : 'yet losing'} ${Math.abs(g).toFixed(3)}s to the apex`, at: brk.i});
  }

  // Apex speed: A's corner minima against B's minimum nearby
  let apx = null;
  for (const i of apexes(A)) {
    if (!both(i)) continue;
    let j = i;
    for (let m = Math.max(0, i - 10); m <= Math.min(N - 1, i + 10); m++) if (B.kmh[m] < B.kmh[j]) j = m;
    const dv = B.kmh[j] - A.kmh[i];
    if (!apx || Math.abs(dv) > Math.abs(apx.dv)) apx = {i, j, dv, dg: Math.abs(B.gLat[j]) - Math.abs(A.gLat[i])};
  }
  if (apx && Math.abs(apx.dv) >= 1) {
    const [who, dg] = apx.dv > 0 ? [b, apx.dg] : [a, -apx.dg];
    out.push({kind: 'APEX', text: `${who} carries +${Math.abs(apx.dv).toFixed(0)} km/h more minimum speed through ${corner(apx.i)}`
      + (ok(dg) ? ` (${dg >= 0 ? '+' : '−'}${Math.abs(dg).toFixed(1)}G lateral)` : ''), at: apx.i});
  }

  // Straight line: speed trap, time on full-throttle sections, DRS / overtake metres
  const vmax = L => Math.max(...L.kmh.filter(ok));
  let flat = 0, drsA = 0, drsB = 0;
  for (let i = 1; i < N; i++) {
    if (both(i) && both(i - 1) && A.throttle[i] > 95 && B.throttle[i] > 95) flat += dt[i] - dt[i - 1];
    drsA += A.drs[i] === 1 || A.ers[i] === 3;
    drsB += B.drs[i] === 1 || B.ers[i] === 3;
  }
  const va = vmax(A), vb = vmax(B);
  if (isFinite(va) && isFinite(vb)) {
    const [fast, dv] = va >= vb ? [a, va - vb] : [b, vb - va];
    const assist = drsA !== drsB ? ` · DRS / overtake open ${Math.round(drsA * db)} m vs ${Math.round(drsB * db)} m` : '';
    out.push({kind: 'STRAIGHTS', text: `${fast} is +${dv.toFixed(0)} km/h faster at the speed trap (${Math.max(va, vb).toFixed(0)} vs ${Math.min(va, vb).toFixed(0)}); `
      + `${flat >= 0 ? a : b} gains ${Math.abs(flat).toFixed(3)}s on full-throttle sections${assist}`, at: A.kmh.indexOf(va)});
  }

  // Overall: the lap gap so far and the sector where most of it came from
  let last = N - 1;
  while (last > 0 && !both(last)) last--;
  if (last > 10) {
    const cuts = [0, Math.round((lines?.[0] ?? 1 / 3) * N), Math.round((lines?.[1] ?? 2 / 3) * N), last].map(x => Math.min(x, last));
    const secs = [0, 1, 2].map(s => gain(cuts[s], cuts[s + 1]));
    const s = secs.reduce((m, v, k) => (Math.abs(v) > Math.abs(secs[m]) ? k : m), 0);
    out.push({kind: 'LAP', text: `Δ ${fmt(dt[last])} at ${Math.round(last * db)} m (${dt[last] >= 0 ? a : b} ahead)`
      + (lines === null ? '' : `; Sector ${s + 1} decides it: ${secs[s] >= 0 ? a : b} gains ${Math.abs(secs[s]).toFixed(3)}s there`), at: cuts[s]});
  }
  return out;
}
