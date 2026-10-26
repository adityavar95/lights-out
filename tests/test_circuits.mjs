// Run: node tests/test_circuits.mjs  — circuit physics: auto aero trim, elevation (grade, compressions) and banking.
import assert from 'node:assert/strict';
import {createRace} from '../src/static/sim.js';
import {buildTrack} from '../src/static/track.js';
import {autoAero} from '../src/static/circuits.js';
import {fitGeo} from '../src/static/satellite.js';

// the "stadium" of test_player: two 1.2 km straights joined by 120 m radius right-hand hairpins (clockwise), metres
const stadium = (straight = 1200, r = 120) => {
  const pts = [];
  for (let x = 0; x < straight; x += 10) pts.push([x, 0]);
  for (let a = 0; a < Math.PI; a += 0.05) pts.push([straight + r * Math.sin(a), r - r * Math.cos(a)]);
  for (let x = straight; x > 0; x -= 10) pts.push([x, 2 * r]);
  for (let a = 0; a < Math.PI; a += 0.05) pts.push([-r * Math.sin(a), r + r * Math.cos(a)]);
  return pts;
};
const pts = stadium(), n = pts.length;
const flat = () => ({h: new Array(n).fill(0), bank: new Array(n).fill(0), kerb: new Array(n).fill(''), tunnel: null, zones: null, wall: 10});
const race = ann => createRace({year: 2025, mapPts: pts, mpu: 1, width: 14, drivers: ['A'], laps: 4, ann});

// aero: a layout with long straights trims for low drag, a tight one maxes the wing
const fast = autoAero(stadium(1300, 150), 1), slow = autoAero(stadium(150, 40), 1);
assert.ok(fast.cl < 0.9 && fast.cd < fast.cl + 0.1, `long straights: low wing ${JSON.stringify(fast)}`);
assert.equal(slow.cl, 1.25, 'short straights: maximum wing');
assert.ok(slow.drs > fast.drs, 'a bigger rear wing gains more from DRS');

// elevation: the first straight climbs 30 m, the second falls back. The grade is + uphill, and the car is slower at
// the top of the climb than at the bottom of the descent
const hill = flat();
pts.forEach(([x, y], i) => { hill.h[i] = y === 0 ? 30 * x / 1200 : y === 240 ? 30 * x / 1200 : x > 0 ? 30 : 0; });
const T = buildTrack(pts, 1, 14, hill);
assert.ok(T.grade[Math.round(600 / T.ds)] > 0.02, `climbing grade ${T.grade[Math.round(600 / T.ds)]}`);
const R = race(hill), car = R.cars[0], v = {};
while (!R.done && R.t < 400) {
  R.advance(1 / 60);
  if (car.lapsDone !== 2) continue;
  const s = ((car.s % T.len) + T.len) % T.len;
  if (Math.abs(s - 1100) < 5) v.top = car.v;
  if (Math.abs(s - (1200 + 377 + 1100)) < 5) v.bottom = car.v;
}
assert.ok(v.top && v.bottom && v.bottom > v.top + 1,  // 2.5 % both ways: ~6 km/h at 300 km/h, where drag dominates
          `downhill faster than uphill: ${JSON.stringify(v)}`);

// banking: 15 degrees of positive camber on both hairpins lets the car carry more speed round them (30 m hairpins:
// the 120 m ones are flat out)
const tight = stadium(1200, 30), m = tight.length;
const level = () => ({h: new Array(m).fill(0), bank: new Array(m).fill(0), kerb: new Array(m).fill(''), tunnel: null, zones: null, wall: 10});
const banked = level();
tight.forEach(([x], i) => { if (x < 0 || x > 1200) banked.bank[i] = 15 * Math.PI / 180; });
const minSpeed = ann => {
  const R = createRace({year: 2025, mapPts: tight, mpu: 1, width: 14, drivers: ['A'], laps: 4, ann}), c = R.cars[0];
  let low = Infinity;
  while (!R.done && R.t < 400) { R.advance(1 / 60); if (c.lapsDone === 2) low = Math.min(low, c.v); }
  return low;
};
const vFlat = minSpeed(level()), vBank = minSpeed(banked);
assert.ok(vBank > vFlat * 1.04, `banked hairpin faster: ${vFlat.toFixed(1)} -> ${vBank.toFixed(1)} m/s`);
// georeferencing: an asymmetric outline in F1 decimetres (y down) against its real shape in metres (y north), rotated
// 30 degrees, shifted, starting elsewhere, running the other way and sampled differently: fitted to well under a metre
{
  const bump = (x, y) => (y === 0 && x > 600 && x < 900 ? -60 * Math.sin((x - 600) / 300 * Math.PI) : 0);  // breaks the symmetry
  const map = stadium().map(([x, y]) => [x * 10, (y + bump(x, y)) * 10]);
  const c = Math.cos(0.52), s = Math.sin(0.52), real = ([x, y]) => [0.1 * (x * c + y * s) + 300, 0.1 * (x * s - y * c) - 120];
  const geo = map.filter((_, i) => i % 3 === 0).map(real).reverse();
  const fit = fitGeo(map, [...geo.slice(40), ...geo.slice(0, 40)]);
  assert.ok(fit.rms < 2, `fit rms ${fit.rms}`);
  for (const p of [map[0], map[100], map[200]]) {
    const [a, b] = fit.map(p), [x, y] = real(p);
    assert.ok(Math.hypot(a - x, b - y) < 3, `point off by ${Math.hypot(a - x, b - y)} m`);
  }
}
console.log('ok');
