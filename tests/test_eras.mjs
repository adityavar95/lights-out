// Run: node tests/test_eras.mjs  — era regulation profiles (eras.js) and what they make the solver (vehicle.js) do.
import assert from 'node:assert/strict';
import {profile} from '../src/static/eras.js';
import {carSpec, gearUp, aero, kLimit, control, vehicleStep} from '../src/static/vehicle.js';
import {createRace} from '../src/static/sim.js';

// the table: frozen, and each era's hardware where it belongs
assert.ok(Object.isFrozen(profile(2026)) && Object.isFrozen(profile(2026).aero), 'profiles are immutable');
assert.equal(profile(1955).tyre.kind, 'bias-ply');
assert.equal(profile(2000).tyre.kind, 'grooved');
assert.ok([1977, 1982].every(y => profile(y).aero.skirts) && !profile(1983).aero.skirts && !profile(1976).aero.skirts);
assert.ok(profile(1985).power.turbo && !profile(1990).power.turbo && profile(2018).power.mguh && !profile(2026).power.mguh);
assert.ok(profile(2026).aero.active && !profile(2025).aero.active && profile(2025).aero.drs && !profile(2026).aero.drs);
assert.deepEqual([1990, 1992, 1995, 2004, 2010].map(y => profile(y).aids.tc), [false, true, false, true, false], 'TC legal 1991-93, 2001-07');
assert.deepEqual([1960, 1992, 2010].map(y => profile(y).gearbox.type), ['H', 'SEMI', 'SEAMLESS']);

// turbo lag: a 1985 turbo floored at mid revs takes a moment to come on boost; with an MGU-H (2015) it's instant
const spool = year => {
  const c = carSpec(year);
  gearUp(c, c.CdA);
  const car = {spec: c, v: 30, s: 0, d: 0, psi: 0, vy: 0, r: 0, gear: 2, shiftT: 0, spin: 0, damage: 0, aLong: 0, boost: 0, bov: 0,
               ers: {soc: 0.5, harvested: 0, deployed: 0}};
  const ctl = {...control(), throttle: 1, kappa: 0, lane: {d: 0, rate: 2.5}};
  const T = {half: 7, wall: 10};
  const steps = [];
  for (let i = 0; i < 60; i++) {  // half a second
    vehicleStepFor(car, ctl, T);
    car.v = 30;  // held: the boost alone
    steps.push(car.boost);
  }
  return steps;
};
function vehicleStepFor(car, ctl, T) {
  const c = car.spec, N = c.mass * 9.81;
  vehicleStep({t: 0}, car, ctl, 1 / 120, {T, k: 0, mu: c.mu, N, down: 0, drag: 0, slope: 0, sinBank: 0, off: false});
}
const lag = spool(1985), instant = spool(2015);
assert.ok(lag[11] < 0.6 && lag[59] > lag[11], `1985 turbo spools up: ${lag[11].toFixed(2)} at 0.1 s, ${lag[59].toFixed(2)} at 0.5 s`);
assert.equal(instant[0], 1, 'MGU-H: no lag');

// 2026: the MGU-K fades past 290 km/h (the override holds it longer), and straight mode sheds drag and downforce
const c26 = carSpec(2026);
assert.equal(kLimit(c26, 250 / 3.6, false), 350e3);
assert.ok(kLimit(c26, 330 / 3.6, false) < 250e3 && kLimit(c26, 330 / 3.6, true) === 350e3, 'super clipping taper vs override');
const flaps = mode => {
  const car = {v: 80, z: 0, zv: 0, aeroX: mode === 'X_MODE_STRAIGHT' ? 1 : 0, seal: 1};
  return aero(car, c26, {...control(), aeroMode: mode, throttle: 1, brake: 0}, 1 / 120, {mult: 1, drag: 1, vertical: 0, kerb: 0, bump: 0, drsCut: 0});
};
const z = flaps('Z_MODE_CORNER'), x = flaps('X_MODE_STRAIGHT');
assert.ok(x.CdA < 0.6 * z.CdA && x.ClA < 0.7 * z.ClA, `X mode: drag ${x.CdA.toFixed(2)} vs ${z.CdA.toFixed(2)}`);

// skirts: a kerb strike breaks the seal and half the ground-effect downforce goes at once
const c80 = carSpec(1980), car80 = {v: 60, z: 0.01, zv: 0, aeroX: 0, seal: 1};
const env = kerb => ({mult: 1, drag: 1, vertical: 0, kerb, bump: 0, drsCut: 0});
const sealed = aero(car80, c80, control(), 1 / 120, env(0)).ClA, broken = aero(car80, c80, control(), 1 / 120, env(0.012)).ClA;
assert.ok(broken < 0.6 * sealed, `skirt seal lost: ${broken.toFixed(2)} vs ${sealed.toFixed(2)}`);

// lap times fall era by era on the same circuit (the test stadium: two 1.2 km straights, 120 m hairpins)
const pts = [];
for (let px = 0; px < 1200; px += 10) pts.push([px, 0]);
for (let a = 0; a < Math.PI; a += 0.05) pts.push([1200 + 120 * Math.sin(a), 120 - 120 * Math.cos(a)]);
for (let px = 1200; px > 0; px -= 10) pts.push([px, 240]);
for (let a = 0; a < Math.PI; a += 0.05) pts.push([-120 * Math.sin(a), 120 + 120 * Math.cos(a)]);
const lap = year => {
  const R = createRace({year, mapPts: pts, mpu: 1, width: 14, drivers: ['A'], laps: 3}), car = R.cars[0];
  while (car.lapsDone < 3 && R.t < 600) R.advance(1 / 30);
  assert.ok(!R.cars.some(c => c.damage > 0), `${year}: no crash`);
  return R.laps.A[2][2];
};
const times = [1955, 1975, 2004].map(lap);
assert.ok(times[0] > times[1] && times[1] > times[2], `quicker by era: ${times.map(t => t.toFixed(1)).join(' > ')}`);
console.log('eras ok:', times.map(t => t.toFixed(1)).join(' s, '), 's');
