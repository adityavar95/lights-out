// Run: node tests/test_lanes.mjs  — lap-timing replay lanes: grid columns and passing without driving through the car.
import assert from 'node:assert/strict';
import {lanes, GRID, apart} from '../src/static/lanes.js';
import {CAR_L, CAR_W} from '../src/static/racecraft.js';

const LEN = 5000, HALF = 6.5;

// grid: two columns at the start, closed up to the line after GRID.fade m
const grid = n => Array.from({length: n}, (_, i) => ({id: 'p' + i, s: -(GRID.front + GRID.row * i), v: 90 - i, rank: i, run: 0}));
let l = lanes(grid(4), LEN, HALF);
assert.deepEqual([l.p0, l.p1, l.p2, l.p3], [GRID.col, -GRID.col, GRID.col, -GRID.col]);
l = lanes(grid(4).map((c, i) => ({...c, s: -100 * i, run: GRID.fade})), LEN, HALF);
assert.ok(Object.values(l).every(x => x === 0));

// a pass at 5 m/s closing speed: never overlapping, smooth, and back on the line afterwards
const slow = {id: 'slow', s: 1000, v: 55}, fast = {id: 'fast', s: 900, v: 60};
let prev = 0, rate = 0, sawFull = false, signs = new Set();
for (let t = 0; t < 60; t += 0.02) {
  const cars = [{...slow, s: slow.s + slow.v * t}, {...fast, s: fast.s + fast.v * t}];
  const o = lanes(cars, LEN, HALF), ds = cars[1].s - cars[0].s;
  if (o.fast) signs.add(Math.sign(o.fast));  // one side for the whole pass
  assert.equal(o.slow, 0);  // the car being passed holds its line
  assert.ok(!(Math.abs(ds) < CAR_L && Math.abs(o.fast - o.slow) < CAR_W), `overlap at t=${t}`);
  rate = Math.max(rate, Math.abs(o.fast - prev) / 0.02);
  prev = o.fast;
  sawFull ||= Math.abs(o.fast) > 3;
}
assert.ok(sawFull && prev === 0 && rate < 2 && signs.size === 1, `pass: full ${sawFull}, end ${prev}, rate ${rate}, sides ${signs.size}`);
// a chain A > B > C all level: each pair ends up clear of the others
l = lanes([{id: 'A', s: 0, v: 3}, {id: 'B', s: 0.1, v: 2}, {id: 'C', s: 0.2, v: 1}], LEN, HALF);
for (const [x, y] of [['A', 'B'], ['B', 'C'], ['A', 'C']]) assert.ok(Math.abs(l[x] - l[y]) >= CAR_W, `${x}/${y}: ${l[x]} ${l[y]}`);

// GPS: a pass down a straight (travel +x, left = -y) whose GPS lateral gap is noise round zero. The cars never overlap, the
// passer stays on the side it took, the shifts change smoothly, and nothing moves once they're apart.
const sides = {};
let side = 0, prevB = 0, step = 0;
for (let t = 0; t < 20; t += 0.02) {
  const noise = 0.8 * Math.sin(t * 7.3);  // m, crosses zero many times
  const cars = [{id: 'slow', x: 55 * t, y: 0, dx: 1, dy: 0}, {id: 'fast', x: 60 * t - 50, y: noise, dx: 1, dy: 0}];
  const e = apart(cars, sides), ds = cars[1].x - cars[0].x, dl = -(cars[1].y + e.fast[1]) + (cars[0].y + e.slow[1]);
  if (Math.abs(ds) < CAR_L) {
    assert.ok(Math.abs(dl) >= CAR_W, `overlap at t=${t.toFixed(2)}: ${dl}`);
    side ||= Math.sign(dl);
    assert.equal(Math.sign(dl), side, 'passer changed sides');
  }
  if (Math.abs(ds) > CAR_L + 3) assert.deepEqual([...e.fast, ...e.slow].map(Math.abs), [0, 0, 0, 0]);
  step = Math.max(step, Math.abs(e.fast[1] - prevB));
  prevB = e.fast[1];
}
assert.ok(side !== 0 && step < 0.3, `side ${side}, largest frame-to-frame shift ${step}`);
assert.deepEqual(sides, {});  // forgotten once apart
console.log('ok');
