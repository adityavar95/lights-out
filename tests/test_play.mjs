// Play (playsetup.js): lap choices, time-trial bests storage, and the time trial's race (sim.js: one car, no lap limit, light fuel)
import assert from 'node:assert/strict';
import {lapsFor, loadBests, saveBest, loadSetup, saveSetup, PACE, DIFFICULTY} from '../src/static/playsetup.js';
import {createRace} from '../src/static/sim.js';

assert.equal(lapsFor('3', 58), 3);
assert.equal(lapsFor('quarter', 58), 15);
assert.equal(lapsFor('quarter', 2), 1);
assert.equal(lapsFor('full', 58), 58);
assert.equal(lapsFor('junk', 58), 58);
for (const [k] of DIFFICULTY) assert.ok(PACE[k] >= 0.8 && PACE[k] <= 1.1, k);  // inside the driver deck slider's range

const mem = () => { const m = new Map(); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v)}; };
const store = mem();
assert.deepEqual(loadBests(store), {});
assert.equal(saveBest('2025/1', 81.5, store), true);
assert.equal(saveBest('2025/1', 82, store), false);  // slower: kept
assert.equal(saveBest('2025/1', 80.9, store), true);
assert.equal(saveBest('2025/2', Infinity, store), false);
assert.deepEqual(loadBests(store), {'2025/1': 80.9});
assert.equal(loadSetup(store).mode, 'race');  // defaults
saveSetup({mode: 'trial', laps: '3', difficulty: 'hard', driver: 'x'}, store);
assert.equal(loadSetup(store).mode, 'trial');
const broken = {getItem: () => '{', setItem: () => { throw new Error('blocked'); }};
assert.deepEqual(loadBests(broken), {});
assert.equal(loadSetup(broken).mode, 'race');
saveSetup({}, broken);  // doesn't throw

// a time trial: one car, laps Infinity, a light fuel load; the AI drives it round and it sets a best lap, never a flag
const N = 400, pts = Array.from({length: N}, (_, i) => [800 * Math.cos(2 * Math.PI * i / N), 500 * Math.sin(2 * Math.PI * i / N)]);
const full = createRace({year: 2025, mapPts: pts, mpu: 1, width: 14, drivers: ['a'], laps: Infinity});
const tt = createRace({year: 2025, mapPts: pts, mpu: 1, width: 14, drivers: ['a'], laps: Infinity, fuel: 0.1});
for (const R of [full, tt]) for (let t = 0; t < 200; t++) R.advance(1);
const car = tt.car('a');
assert.ok(car.best < Infinity, 'a best lap');
assert.ok(!tt.done && !car.finished, 'no chequered flag');
assert.ok(car.spec.mass < full.car('a').spec.mass - 50, 'lighter than a race fuel load');
assert.equal(tt.board()[0].pos, 1);
console.log('play ok');

// the ghost lap: linear between frames, held at either end
import {ghostAt} from '../src/static/playsetup.js';
const lap = [[0, 0, 1], [1, 50, 2], [2, 120, 0]];
assert.deepEqual(ghostAt(lap, 0.5), [25, 1.5]);
assert.deepEqual(ghostAt(lap, 1.5), [85, 1]);
assert.deepEqual(ghostAt(lap, -1), [0, 1]);
assert.deepEqual(ghostAt(lap, 9), [120, 0]);
assert.equal(ghostAt([], 1), null);
console.log('ghost ok');
