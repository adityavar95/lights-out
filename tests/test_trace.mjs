// Run: node tests/test_trace.mjs  — checks the distance-resampled lap telemetry (trace.js) behind the telemetry trace.
import assert from 'node:assert/strict';
import {N, CHANNELS, createRecorder, record, delta, insights, apexes, lapRows} from '../src/static/trace.js';
import {createRace} from '../src/static/sim.js';
import {drawTrace, drawCursor, layout} from '../src/static/tracechart.js';

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
console.log('trace ok:', notes.map(n => n.text).join(' | '));
