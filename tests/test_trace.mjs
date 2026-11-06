// Run: node tests/test_trace.mjs  — checks the distance-resampled lap telemetry (trace.js) behind the telemetry trace.
import assert from 'node:assert/strict';
import {N, CHANNELS, createRecorder, record, delta, insights, apexes, lapRows} from '../src/static/trace.js';
import {createRace} from '../src/static/sim.js';
import {drawTrace, drawCursor, layout, dtTicks} from '../src/static/tracechart.js';
import {realLap, lapTable, fastestClean, sectorCheck, dominance, dominanceText, lapPath} from '../src/static/reallap.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const vals = new Float64Array(CHANNELS.length - 1), meta = {code: 'AAA', year: 2025};

// constant speed v from s0, sampled every h seconds (deliberately not a bucket multiple); gear = floor(s / 100) % 8
function drive(rec, id, v, s0, until, h) {
  for (let t = 0; s0 + v * t < until; t += h) {
    const s = s0 + v * t;
    vals.fill(0);
    vals[0] = v * 3.6;
    vals[4] = Math.floor(s / 100) % 8;
    record(rec, id, s, t, vals, meta);
  }
}

// 1000 m lap at 50 m/s from the grid (s < 0): every bucket boundary gets its exact crossing time (s / 50), the lap is 20 s
let rec = createRecorder(1000);
drive(rec, 'A', 50, -30, 2500, 0.013);
let c = rec.cars.A;
assert.equal(c.previous.lapNo, 1, 'two complete laps, the second is previous');
close(c.previous.time, 20, 1e-6, 'lap time');
close(c.fastest.time, 20, 1e-6, 'fastest');
for (const b of [0, 1, 137, N - 1]) close(c.previous.t[b], b * 2 / N * 20 / 2, 1e-4, `elapsed time at bucket ${b}`);
assert.ok(c.previous.gear.every(g => Number.isInteger(g)), 'gear is stepped, not interpolated');
assert.equal(c.cur.lapNo, 2);
assert.ok(Number.isNaN(c.cur.t[N - 1]) && !Number.isNaN(c.cur.t[N / 2 - 1]), 'the live lap fills as far as the car has got');

// coarse samples (0.5 s = 25 m, several buckets each) still give every bucket its interpolated time
rec = createRecorder(1000);
drive(rec, 'B', 40, -10, 2100, 0.5);
c = rec.cars.B;
assert.ok(c.previous.t.every(x => !Number.isNaN(x)), 'no gaps');
close(c.previous.time, 25, 1e-6, 'lap time from coarse samples');
close(c.previous.t[250], 12.5, 1e-4, 'half-lap time');

// recording that starts mid-lap: that lap is partial, so never previous / fastest
rec = createRecorder(1000);
drive(rec, 'C', 50, 400, 1500, 0.01);
assert.equal(rec.cars.C.previous, null, 'a partial lap is not a lap');

// Δt: B at 40 m/s vs A at 50 m/s gains 0.5 s per 100 m on A... loses it, i.e. Δt grows to 5 s at the line
rec = createRecorder(1000);
drive(rec, 'A', 50, -1, 2000, 0.01);
drive(rec, 'B', 40, -1, 2000, 0.01);
const A = rec.cars.A.previous, B = rec.cars.B.previous, dt = delta(A, B);
close(dt[0], 0, 1e-4, 'level at the line');
close(dt[N / 2], 2.5, 1e-3, 'half way');
assert.ok(dt.every((x, i) => i === 0 || x >= dt[i - 1]), 'A gains everywhere');
const rows = lapRows(A, 1000, () => [1, 2, 3]);
assert.equal(rows.length, N);
assert.deepEqual(Object.keys(rows[0]), ['distanceMeters', 'splineProgress', 'elapsedTime', 'speedKmh', 'throttlePct', 'brakePct', 'rpm',
  'gear', 'drsActive', 'ersMode', 'lateralG', 'longitudinalG', 'tireCompound', 'worldPos']);

// the real simulation, hooked like tracemodal.js: recorded lap times match the sim's own timing to a substep
// a stadium with 30 m radius hairpins (real braking zones), the line half way down a straight so no apex sits on it
const pts = [];
for (let x = 600; x < 1200; x += 10) pts.push([x, 0]);
for (let a = 0; a < Math.PI; a += 0.1) pts.push([1200 + 30 * Math.sin(a), 30 - 30 * Math.cos(a)]);
for (let x = 1200; x > 0; x -= 10) pts.push([x, 60]);
for (let a = 0; a < Math.PI; a += 0.1) pts.push([-30 * Math.sin(a), 30 + 30 * Math.cos(a)]);
for (let x = 0; x < 600; x += 10) pts.push([x, 0]);
const R = createRace({year: 2025, mapPts: pts, mpu: 1, width: 14, drivers: ['X', 'Y'], laps: 6});
rec = createRecorder(R.T.len);
R.onStep = () => {
  for (const car of R.cars) {
    vals.set([car.v * 3.6, car.throttle * 100, car.brake * 100, car.rpm, car.gear, car.drs.open ? 1 : 0, 0, car.gLat, car.gLong, car.d]);
    record(rec, car.id, car.s, R.t, vals, {code: car.id, year: 2025});
  }
};
while (R.cars[0].lapsDone < 4) R.advance(1 / 30);
for (const id of ['X', 'Y']) {
  const p = rec.cars[id].previous, sim = R.laps[id].find(l => l[1] === p.lapNo + 1);
  close(p.time, sim[2], 0.02, `${id} lap ${p.lapNo + 1} time`);
}
const X = rec.cars.X.fastest, Y = rec.cars.Y.fastest;
assert.ok(apexes(X).length >= 2, 'two hairpins, two apexes');
const notes = insights(X, Y, {len: R.T.len, a: 'X', b: 'Y', corner: i => `bucket ${i}`});
assert.ok(notes.length >= 3, `callouts: ${notes.map(n => n.kind)}`);
assert.ok(notes.every(n => typeof n.text === 'string' && n.text.length > 20 && n.at >= 0 && n.at < N));
close(delta(X, Y)[N - 1], (Y.t[N - 1] - X.t[N - 1]), 1e-6, 'Δt at the end of the lap');

// the plot renders both laps on a stub 2D context without throwing, zoomed into sector 2 too
const calls = {};
const ctx = new Proxy({}, {get: (o, k) => (k in o ? o[k] : k === 'measureText' ? () => ({width: 30})
  : k === 'createLinearGradient' ? () => ({addColorStop() {}}) : (...a) => { calls[k] = (calls[k] ?? 0) + 1; }), set: (o, k, v) => { o[k] = v; return true; }});
for (const [x0, x1] of [[0, 1], [1 / 3, 2 / 3]]) {
  const view = {A: X, B: Y, colA: '#3671C6', colB: '#38f0ff', nameA: 'X', nameB: 'Y', len: R.T.len, x0, x1, rpmMax: 15000,
                corners: [{i: 107, label: 'T1 Test'}], dt: delta(X, Y)};
  drawTrace(ctx, 900, 600, view);
  drawCursor(ctx, 900, 600, view, 250);
  assert.ok(view.vTop >= 370, 'speed axis ceiling');
}
assert.ok(calls.lineTo > 4 * N, 'traces drawn');
const lay = layout(900, 600, 0, 1);
close(lay.frac(lay.X(250)), 0.5, 1e-9, 'x <-> lap fraction round trip');
// Δt axis: at most 5 labels whatever the scale, spaced to the plot's height, always on zero and inside the scale
for (const m of [0.0575, 0.3, 0.7, 2.5, 30, 250, 1000]) for (const h of [30, 60, 110, 400]) {
  const t = dtTicks(m, h);
  assert.ok(t.length >= 3 && t.length <= (h < 100 ? 3 : 5), `${t.length} labels at ±${m} s, ${h} px`);
  assert.ok(t.includes(0) && t.every(x => Math.abs(x) <= m), `ticks ${t} at ±${m} s`);
}
// ---------- real laps (reallap.js) ----------

// Synthetic car data on the replay's 0.5 s grid: a 1000 m lap whose true speed is v(s) m/s, driven from t = start with a
// flying start. Returns the telemetry and the exact time at each lap fraction, by fine integration of ds / v(s).
function fakeLap(v, start, {extra = {}, step = 0.5} = {}) {
  const ds = 0.01, times = [0];
  for (let s = 0; s < 1000; s += ds) times.push(times.at(-1) + ds / v(s));
  const dur = times.at(-1), sAt = t => { let lo = 0, hi = times.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; } return lo * ds; };
  const n = Math.ceil((start + dur + 2) / step), speed = [];
  for (let i = 0; i < n; i++) { const t = i * step - start; speed.push(v(t < 0 ? 0 : t > dur ? 0 : sAt(t)) * 3.6); }
  const at = f => times[Math.round(f * 1000 / ds)];
  return {tele: {step, speed, ...extra}, dur, at};
}
const wavy = (a, b) => s => a + b * Math.sin(s / 1000 * 2 * Math.PI * 3);

// integration recovers the lap's length and official time, and the bucket times track the true ones
const true1 = fakeLap(wavy(60, 15), 10);
const row = (lapNo, start, dur, sectors = [null, null, null]) => ({lapNo, start, dur, sectors, compound: 'SOFT', tag: null});
const R1 = realLap(true1.tele, row(5, 10, true1.dur), {code: 'AAA', color: '#111111', year: 2025});
close(R1.distance, 1000, 5, 'integrated lap length');
close(R1.time, true1.dur, 1e-6, 'the lap time is the official one');
assert.equal(R1.lapNo, 4, 'lap numbers as the trace stores them');
assert.equal(R1.from, 0, 'driven from the line');
for (const f of [0.1, 0.5, 0.9]) close(R1.t[f * N], true1.at(f), 0.05, `time at ${f} of the lap`);
assert.ok(R1.t.every(x => !Number.isNaN(x)), 'every bucket has a time');
close(realLap(true1.tele, row(5, 10, true1.dur), {}, 1020).len, 1020, 1e-9, 'scaled to a track length that agrees');
close(realLap(true1.tele, row(5, 10, true1.dur), {}, 3000).len, R1.distance, 1e-9, 'a stand-in outline is ignored');
const gapped = {...true1.tele, speed: true1.tele.speed.map((x, i) => (i === 20 ? null : x))};
assert.equal(realLap(gapped, row(5, 10, true1.dur)), null, 'a speed gap inside the lap is refused, not filled in');

// recovered sector gaps match the official ones. B is quicker only in the middle of the lap.
const vB = s => wavy(60, 15)(s) * (s > 350 && s < 650 ? 1.03 : 1);
const true2 = fakeLap(vB, 7.3);
const split = (T, f1, f2) => [T.at(f1), T.at(f2) - T.at(f1), T.dur - T.at(f2)];
const A1 = realLap(true1.tele, row(5, 10, true1.dur, split(true1, 0.3, 0.7)), {code: 'AAA', color: '#111111', year: 2025}, 1000);
const B1 = realLap(true2.tele, row(9, 7.3, true2.dur, split(true2, 0.3, 0.7)), {code: 'BBB', color: '#222222', year: 2025}, 1000);
const chk = sectorCheck(A1, B1);
close(chk.cuts[0], 0.3, 0.01, 'sector 1 line');
close(chk.cuts[1], 0.7, 0.01, 'sector 2 line');
for (const off of chk.offsets) close(off, 0, 0.03, 'sector gap against official');
assert.deepEqual(sectorCheck(R1, B1).offsets, [null, null], 'no official times on one lap: nothing claimed');
assert.equal(sectorCheck(R1, null).cuts, null, 'no times at all: no lines');

// missing channels: no g, ERS, lateral or (2026) DRS. Nothing throws, nothing is invented
const rich = {throttle: true1.tele.speed.map(() => 104), brake: true1.tele.speed.map(() => 0), rpm: true1.tele.speed.map(() => 11000),
              n_gear: true1.tele.speed.map(() => 6), drs: true1.tele.speed.map(() => null)};
const Rich = realLap({...true1.tele, ...rich}, row(3, 10, true1.dur, split(true1, 0.3, 0.7)), {code: 'AAA', year: 2025});
for (const ch of ['gLat', 'gLong', 'ers', 'd', 'drs']) assert.ok(Rich[ch].every(Number.isNaN), `${ch} stays missing`);
assert.ok(Rich.throttle.every(x => x === 100), 'the odd 104 reads as full');
assert.ok(Rich.gear.every(x => x === 6) && Rich.rpm.every(x => x === 11000));
const realRows = lapRows(Rich, 1000, () => [1, 2]);
for (const key of ['lateralG', 'longitudinalG', 'ersMode', 'drsActive']) assert.ok(!(key in realRows[0]), `${key} left out of the export`);
assert.equal(realRows[0].gear, 6);
assert.deepEqual(realRows[0].worldPos, [1, 2]);
const realNotes = insights(Rich, B1, {len: 1000, a: 'AAA', b: 'BBB', corner: i => `bucket ${i}`, cuts: chk.cuts});
assert.ok(realNotes.length >= 1, 'callouts from what is there');
for (const n of realNotes) assert.ok(!/NaN|lateral|ERS/.test(n.text), `no invented channel: ${n.text}`);
assert.ok(!/Sector/.test(insights(Rich, B1, {len: 1000, a: 'A', b: 'B', corner: () => 'x', cuts: null}).at(-1).text), 'no sector lines, no sector named');
const realView = {A: Rich, B: Rich, colA: '#111111', colB: '#38f0ff', nameA: 'A', nameB: 'B', len: 1000, x0: 0, x1: 1, rpmMax: 15000, corners: [], dt: delta(Rich, Rich), cuts: chk.cuts};
drawTrace(ctx, 900, 600, realView);
drawCursor(ctx, 900, 600, realView, 100);
drawTrace(ctx, 900, 600, {...realView, cuts: null});

// lapTable: which laps may be the default
const payload = {
  laps: [[0, '3', 1, 120, null, 30, 30], [120, '3', 2, 90, 30, 30, 30], [210, '3', 3, 89, 29, 30, 30], [299, '3', 4, 88, 28, 30, 30],
         [387, '3', 5, 87.5, 28, 30, 29.5], [474.5, '3', 6, 130, null, 50, 50], [604, '3', 7, 87.9, 28, 30, 29.9], [692, '3', 8, null, null, null, null], [700, '4', 2, 80, 20, 30, 30]],
  pits: [[310, '3', 3, 25]],  // a race's convention (lap_number is the in-lap); by time, the stop is 11 s into lap 4
  race_control: [[1, 'Other', null, 'CAR 3 (VER) TIME 1:27.500 DELETED - TRACK LIMITS AT TURN 9 LAP 6 12:00:00'],
                 [2, 'Other', null, 'CAR 4 (NOR) TIME 1:20.000 DELETED - TRACK LIMITS AT TURN 9 LAP 3 12:00:00'],
                 [3, 'Other', null, 'CAR 4 (NOR) TIME 1:20.000 WILL BE REINSTATED']],
  stints: [['3', 1, 3, 'MEDIUM', 0], ['3', 4, 8, 'SOFT', 0]],
};
const t3 = lapTable(payload, '3');
assert.deepEqual(t3.map(r => r.lapNo), [1, 2, 3, 4, 5, 6, 7], 'untimed laps are not offered');
assert.deepEqual(t3.map(r => r.tag), ['first lap', null, 'in-lap', 'out-lap', 'deleted', null, null]);
assert.equal(t3[4].compound, 'SOFT');
assert.equal(fastestClean(t3).lapNo, 7, 'skips the quicker out-lap and the deleted lap');
assert.equal(fastestClean(lapTable(payload, '4')).lapNo, 2, 'a reinstated time counts');
assert.equal(fastestClean(lapTable({...payload, laps: [[0, '3', 1, 120, null, 30, 30]]}, '3')).lapNo, 1, 'no clean lap: the fastest timed one');
assert.equal(fastestClean([]), null);

// dominance: known winners by construction, a tie under the threshold, and the sectors add up to the lap's gap
const known = (perSector, total) => { const L = {t: new Float32Array(N), time: total}; for (let i = 0; i < N; i++) L.t[i] = perSector(i); return L; };
const secs = 25, base = i => i / N * 100;  // A: 4 s per mini-sector
const LA = known(base, 100);
// B: 0.1 s slower in sector 0, 0.1 s quicker in sector 1, 0.01 s slower in sector 2, level after that
const bump = i => { const k = i * secs / N; return k <= 1 ? 0.1 * k : k <= 2 ? 0.1 - 0.1 * (k - 1) : k <= 3 ? 0.01 * (k - 2) : 0.01; };
const LB = known(i => base(i) + bump(i), 100.01);
const dm = dominance(LA, LB);
assert.equal(dm.sectors.length, 25);
assert.equal(dm.sectors[0].winner, 'A');
assert.equal(dm.sectors[1].winner, 'B');
assert.equal(dm.sectors[2].winner, null, '0.01 s is a tie');
assert.equal(dm.wins.A, 1);
assert.equal(dm.wins.B, 1);
assert.equal(dm.wins.tie, 23);
close(dm.sectors.reduce((s, x) => s + x.gain, 0), 0.01, 1e-3, 'the sectors sum to the lap gap');
assert.equal(dm.sectors[24].to, N, 'the last one runs to the line');
assert.equal(dominanceText(dm, 'VER', 'NOR'), 'VER fastest in 1 of 25 mini-sectors, NOR in 1, 23 tied');
const partial = known(i => (i > 100 ? NaN : base(i)), null);
const dp = dominance(partial, LB);
assert.ok(dp.sectors.slice(5).every(x => x.winner === null) && dp.wins.tie + dp.wins.A + dp.wins.B <= 5, 'unknown is not a tie');

// lapPath: positions at each bucket's time, with null over a gap in the frames
const path = lapPath({t: Float32Array.from({length: N}, (_, i) => i * 0.1), abs: 10}, {x: Array.from({length: 400}, (_, i) => (i === 40 ? null : i)), y: new Array(400).fill(5)}, 0.5, (x, y) => [x * 2, y]);
close(path[0][0], 40, 1e-6, 'x at the lap start, through rot');
assert.equal(path[0][1], 5);
assert.ok(path.some(p => p === null), 'a gap in the frames is a gap in the path');

console.log('trace ok:', notes.map(n => n.text).join(' | '));
