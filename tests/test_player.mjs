// Run: node tests/test_player.mjs  — player driving physics (steering, assists, gearbox) and AI racecraft.
import assert from 'node:assert/strict';
import {createRace} from '../src/static/sim.js';
import {steer} from '../src/static/player.js';
import {rpmOf} from '../src/static/vehicle.js';
import {resolveContacts, CAR_W} from '../src/static/racecraft.js';

// a "stadium": two 1.2 km straights joined by 120 m radius hairpins, in metres (mpu 1)
const pts = [];
for (let x = 0; x < 1200; x += 10) pts.push([x, 0]);
for (let a = 0; a < Math.PI; a += 0.05) pts.push([1200 + 120 * Math.sin(a), 120 - 120 * Math.cos(a)]);
for (let x = 1200; x > 0; x -= 10) pts.push([x, 240]);
for (let a = 0; a < Math.PI; a += 0.05) pts.push([-120 * Math.sin(a), 120 + 120 * Math.cos(a)]);
const race = (drivers, laps = 6) => createRace({year: 2025, mapPts: pts, mpu: 1, width: 14, drivers, laps});
const run = (R, secs, each) => { for (const end = R.t + secs; R.t < end;) { R.advance(1 / 60); each?.(); } };
// hand car c over to the player at the start of a straight (the player's tests don't steer), after lap 1
const takeOver = (r, c) => {
  for (const end = r.t + 300; r.t < end && !(c.lapsDone >= 1 && ((c.s % r.T.len) + r.T.len) % r.T.len < 60);) r.advance(1 / 60);
  r.setPlayer(c.id);
};
const until = (r, cond, secs = 20) => { for (const end = r.t + secs; r.t < end && !cond();) r.advance(1 / 60); };

// steering: full lock shrinks with speed (~1.9 deg of road wheel at 320 km/h) and recentres when let go
const car = {v: 89, delta: 0, kPath: 0};
for (let i = 0; i < 120; i++) steer(car, {steer: 1}, 1 / 60);
assert.ok(car.delta > 0.025 && car.delta <= 0.0329, `lock at 320 km/h: ${car.delta}`);
for (let i = 0; i < 120; i++) steer(car, {steer: 0}, 1 / 60);
assert.ok(Math.abs(car.delta) < 0.002, 'self-centring');

// steering assist (a real car's profile): at speed full lock asks for the front tyres' peak slip, past where the front
// axle is going; steering into a rotation the rear can't hold is backed off, counter-steer never is
{
  const spec = race(['A']).cars[0].spec, peak = spec.profile.tyre.slipPeak, hold = (c, s) => { for (let i = 0; i < 120; i++) steer(c, {steer: s}, 1 / 60, spec); };
  const grip = {v: 60, delta: 0, kPath: 0, vy: 0, r: 0};
  hold(grip, 1);
  assert.ok(Math.abs(grip.delta - peak) < 0.002, `full lock = peak slip: ${grip.delta} vs ${peak}`);
  const sliding = {v: 60, delta: 0, kPath: 0, vy: 0, r: 0.5, slipR: 1.2 * peak};  // turning right, rear past its peak
  hold(sliding, 1);
  const free = Math.atan(spec.wb * (1 - spec.fwd) * 0.5 / 60);
  assert.ok(Math.abs(sliding.delta - free) < 0.002, `into the slide: backed off to zero front slip (${sliding.delta} vs ${free})`);
  hold(sliding, -1);
  assert.ok(Math.abs(sliding.delta - (free - peak)) < 0.002, `counter-steer: full window (${sliding.delta})`);
}

// handover mid-race: the car carries on (no reset), and with the throttle pinned on the straight it gains speed and
// the automatic gearbox climbs the gears
const R = race(['A', 'B']), a = R.cars[0];
takeOver(R, a);
Object.assign(R.input, {throttle: 0, brake: 1, steer: 0});
until(R, () => a.v < 40);  // slow down first (the auto box shifts down), then floor it
const s0 = a.s, v0 = a.v, g0 = a.gear;
Object.assign(R.input, {throttle: 1, brake: 0});
run(R, 3);
assert.ok(a.s > s0 && a.v > v0 + 10 && a.gear > g0, `accelerates and upshifts: ${v0} -> ${a.v}, gear ${g0} -> ${a.gear}`);

// brakes at the end of the straight: ABS keeps the wheels rolling, without it they lock
const brakeTest = abs => {
  const r = race(['A']), c = r.cars[0];
  takeOver(r, c);
  r.assists.abs = abs;
  r.assists.brakeAssist = 'OFF';
  r.input.throttle = 1;
  until(r, () => c.v >= 70);
  Object.assign(r.input, {throttle: 0, brake: 1});
  let locked = false;
  run(r, 1, () => { locked ||= c.locked; });
  return locked;
};
assert.equal(brakeTest(true), false, 'ABS: no lock-up');
assert.equal(brakeTest(false), true, 'no ABS: the fronts lock');

// traction: flooring it out of the hairpin on worn soft tyres spins the rears without TC; TC FULL holds them
const tractionTest = tc => {
  const r = race(['A']), c = r.cars[0];
  takeOver(r, c);
  r.assists.tc = tc;
  c.tyre.health = [10, 10, 10, 10];  // past the cliff: little grip to put the power down with
  Object.assign(r.input, {throttle: 0, brake: 1});
  until(r, () => c.v <= 15);
  Object.assign(r.input, {throttle: 1, brake: 0});
  let spin = 0, cut = false;
  run(r, 1.5, () => { spin = Math.max(spin, c.spin); cut ||= c.tcCut; });
  return {spin, cut};
};
const noTc = tractionTest('OFF'), fullTc = tractionTest('FULL');
assert.ok(noTc.spin > 0.05, `wheelspin without TC: ${noTc.spin}`);
assert.ok(fullTc.spin === 0 && fullTc.cut, 'TC cuts the engine instead');

// manual gearbox: over-rev protection (a paddle-shift car) refuses a downshift that would pass the limiter
const m = race(['A']), mc = m.cars[0], spec = mc.spec;
assert.ok(rpmOf(spec, 300 / 3.6, 2) > spec.rpmMax && rpmOf(spec, 300 / 3.6, 8) < spec.rpmMax);
takeOver(m, mc);
m.assists.gearbox = 'MANUAL';
m.input.throttle = 1;
for (const end = m.t + 20; mc.v < 75 && m.t < end;) { m.advance(1 / 60); if (mc.rpm > 0.8 * spec.rpmMax) m.input.up = true; }
const gear = mc.gear;
for (let i = 0; i < 4; i++) { m.input.down = true; m.advance(1 / 60); }
assert.ok(mc.gear >= gear - 2 && rpmOf(spec, mc.v, mc.gear) <= spec.rpmMax, `no over-rev: gear ${gear} -> ${mc.gear}`);

// side by side: two AI cars put alongside on the straight keep at least a car width apart
const sbs = race(['A', 'B']);
run(sbs, 30);
const [x, y] = sbs.cars;
y.s = x.s;
y.v = x.v;
y.d = x.d + 0.5;
let minGap = Infinity;
run(sbs, 3, () => { const ds = Math.abs(x.s - y.s); if (ds < 5.5) minGap = Math.min(minGap, Math.abs(x.d - y.d)); });
assert.ok(minGap > CAR_W - 0.1 || minGap === Infinity, `side by side gap ${minGap}`);

// a rear-ender at 10 m/s closing breaks the hitting car's front wing; the car hit is fine
const crash = race(['A', 'B']);
run(crash, 30);
const [front, rear] = crash.cars;
Object.assign(rear, {s: front.s - 3, d: front.d, v: front.v + 10});
resolveContacts(crash);
assert.ok(rear.damage > 0.3 && front.damage === 0, `damage ${rear.damage} / ${front.damage}`);
console.log('ok');
