// Run: node tests/test_lanes.mjs  — lap-timing replay lanes: grid columns and passing without driving through the car.
import assert from 'node:assert/strict';
import {lanes, GRID, apart, headings, retime} from '../src/static/lanes.js';
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

// standing still: jitter under the distance never turns a car; it keeps the direction it arrived in, gaps included
const yaws = headings([0, 0, 40, 80, 80, 81, null, 80, 80, 120], [5, 5, 5, 5, 6, 4, null, 5, 6, 6], 30);
near(yaws[0], 0); near(yaws[3], 0); near(yaws[5], 0); near(yaws[8], 0);  // set off along +x, arrived along +x, parked
const up = headings([0, 0, 0, 0], [0, 40, 40, 41], 30);
near(up[0], Math.PI / 2); near(up[3], Math.PI / 2);  // before its first move it faces the way it sets off
assert.ok(headings([0, 1, 0], [0, 0, 1], 30).every(Number.isNaN));  // never moved: no heading
// retime: a see-sawing pace along a bent path comes out steady and still on that path; a gap stays a gap
const sx = [], sy = [];
for (let i = 0, d = 0; i < 40; i++, d += i % 2 ? 30 : 10) { sx.push(d < 300 ? d : 300); sy.push(d < 300 ? 0 : d - 300); }
sx.splice(20, 1, null); sy.splice(20, 1, null);
const [rx, ry] = retime(sx, sy);
assert.equal(rx[20], null);
for (let i = 3; i < 17; i++) { const v = Math.hypot(rx[i + 1] - rx[i], ry[i + 1] - ry[i]); assert.ok(Math.abs(v - 20) < 3, `step ${i}: ${v}`); }  // 10/30 see-saw -> ~20
const offPath = (px, py) => Math.min(...sx.slice(0, -1).map((ax, j) => {  // distance to the raw samples' polyline
  if (ax === null || sx[j + 1] === null) return Infinity;
  const ay = sy[j], bx = sx[j + 1] - ax, by = sy[j + 1] - ay, u = Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / (bx * bx + by * by || 1)));
  return Math.hypot(px - ax - u * bx, py - ay - u * by);
}));
for (let i = 0; i < 40; i++) if (rx[i] !== null) assert.ok(offPath(rx[i], ry[i]) < 1e-6, `${i} off the path`);
near(rx[0], sx[0]); near(rx[19], sx[19]); near(ry[39], sy[39]);  // run ends stay put
const flat = [0, 20, 40, 60, 80];
retime(flat, flat.map(() => 0))[0].forEach((v, i) => near(v, flat[i]));  // a steady pace is unchanged
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`); }
console.log('ok');
