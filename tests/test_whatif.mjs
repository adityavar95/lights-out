// Run: node tests/test_whatif.mjs  — checks the Strategy Lab's what-if race model (whatif.js) on synthetic races.
import assert from 'node:assert/strict';
import {raceModel, simulate, optimise, ranked, PASS, SC_LOSS} from '../src/static/whatif.js';

const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const N = 40, LOSS = 20;

// lap time = 90 + base + deg·age, +LOSS split over in/out laps; neutral laps (SC) at 130 s for everyone
function race(cars, sc = []) {
  const laps = [], pits = [];
  for (const {id, base, deg, stops} of cars) {
    for (let L = 1; L <= N; L++) {
      const k = stops.filter(s => s < L).length, age = L - (k ? stops[k - 1] : 0) - 1;
      let t = sc.includes(L) ? 130 : 90 + base + deg * age;
      if (stops.includes(L)) t += sc.includes(L) ? LOSS * SC_LOSS : LOSS / 2;
      if (stops.includes(L - 1) && !sc.includes(L - 1)) t += LOSS / 2;
      laps.push({number: String(L), driverId: id, position: '1', time: fmt(t)});
    }
    for (const s of stops) pits.push({driverId: id, lap: String(s)});
  }
  return raceModel(laps, pits);
}

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

// the actual plan reproduces the actual race to the millisecond, with or without traffic
const field = [{id: 'a', base: 0, deg: 0.2, stops: [10]}, {id: 'b', base: 0.5, deg: 0.1, stops: [20]},
               {id: 'c', base: 1, deg: 0.05, stops: [25]}, {id: 'd', base: 1.5, deg: 0.05, stops: [15]}];
const M = race(field);
for (const id of M.ids) for (const pass of [null, PASS.normal]) {
  const r = simulate(M, id, M.stops[id], {pass});
  close(r.time, M.cum[id].at(-1), 1e-6, `${id} baseline`);
  for (let i = 0; i < N; i++) close(r.cum[i], M.cum[id][i], 1e-6, `${id} lap ${i + 1}`);
}
close(M.pitLoss, LOSS, 0.5, 'pit loss from in/out laps');
assert.ok(M.fits.a[1].b > M.fits.c[0].b + 0.05, 'the high-deg driver fits a steeper tyre slope');

// linear deg on both stints: a single stop is best near half distance, and better than the early real one
const best = optimise(M, 'a', {pass: null, minStops: 1, maxStops: 1})[0];
assert.ok(Math.abs(best.plan[0] - N / 2) <= 2, `one-stop optimum ${best.plan} near lap ${N / 2}`);
assert.ok(best.time < M.cum.a.at(-1), 'optimum beats the real plan');
const two = optimise(M, 'a', {pass: null, minStops: 2, maxStops: 2})[0];
assert.equal(two.plan.length, 2);

// split into parts (as strategylab.js runs it on parallel workers), the merged best plans are the whole search's
for (const of of [2, 3, 8]) {
  const whole = optimise(M, 'a', {pass: PASS.normal}), parts = Array.from({length: of}, (_, k) => optimise(M, 'a', {pass: PASS.normal, part: [k, of]}));
  assert.deepEqual(ranked(parts.flat()).map(p => [p.finish, p.time]), whole.map(p => [p.finish, p.time]), `${of} parts`);
}

// moving a stop changes only the laps it touches: before the earlier of the two stops nothing moves
const moved = simulate(M, 'a', [14], {pass: null});
for (let i = 0; i < 9; i++) close(moved.cum[i], M.cum.a[i], 1e-9, `lap ${i + 1} untouched`);

// traffic: d is behind c and only a hair faster on fresh tyres; with a hard-to-pass track it stays behind
const T = race([{id: 'c', base: 0, deg: 0, stops: [20]}, {id: 'd', base: 0.15, deg: 0.05, stops: [20]}]);
const free = simulate(T, 'd', [5], {pass: null}), stuck = simulate(T, 'd', [5], {pass: PASS.hard});
assert.ok(stuck.time >= free.time - 1e-9, 'being stuck never helps');
assert.ok(stuck.finish >= free.finish, 'traffic can only cost places');

// a stop under the safety car is cheap: the queue closes up behind it, so adding it costs less than a green stop
const S = race([{id: 'x', base: 0, deg: 0.15, stops: [20]}, {id: 'y', base: 0.3, deg: 0.15, stops: [20]},
                {id: 'z', base: 0.6, deg: 0.15, stops: [20]}], [30, 31, 32]);
assert.ok(S.neutral[29] && S.neutral[31] && !S.neutral[28], 'SC laps detected');
const green = simulate(S, 'x', [20, 27], {pass: null}).time - S.cum.x.at(-1);
const underSc = simulate(S, 'x', [20, 30], {pass: null}).time - S.cum.x.at(-1);
assert.ok(underSc < green, `SC stop ${underSc.toFixed(1)} s cheaper than green ${green.toFixed(1)} s`);
console.log(`whatif ok: pit loss ${M.pitLoss.toFixed(1)} s, a best 1-stop lap ${best.plan} (${(best.time - M.cum.a.at(-1)).toFixed(1)} s), SC stop ${underSc.toFixed(1)} s vs green ${green.toFixed(1)} s`);
