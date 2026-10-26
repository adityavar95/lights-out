// Run: node tests/test_telemetry.mjs  — checks the derived telemetry the HUD shows when the feeds don't carry it.
import assert from 'node:assert/strict';
import {kinematics, gearbox, pedals, ersStep, tyreState, tyreStep, drsZones, engine, G} from '../src/static/telemetry.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

// 50 m/s round a 100 m radius, clockwise on screen (y down) = a right-hander: v^2 / R = 25 m/s^2 to the right
const R = 100, w = 50 / R, at = t => [R * Math.cos(w * t), R * Math.sin(w * t)];
let k = kinematics(at(-0.5), at(0), at(0.5), 0.5);
close(k.speed, 50, 1.5, 'corner speed');
close(k.gLat, 25 / G, 0.15, 'right-hander pulls right');
close(k.gLong, 0, 0.05, 'steady speed');
k = kinematics(at(0.5), at(0), at(-0.5), 0.5);  // same circle backwards: anticlockwise, a left-hander
assert.ok(k.gLat < -2, 'left-hander pulls left');

// braking at 4 g in a straight line
const brake = t => [80 * t - 0.5 * 4 * G * t * t, 0];
k = kinematics(brake(-0.25), brake(0), brake(0.25), 0.25);
close(k.gLong, -4, 0.01, 'braking g');
assert.equal(pedals(k.gLong, 250).brake > 90, true, 'hard braking reads as brake');
assert.equal(pedals(0.1, 300).throttle, 100, 'flat out at top speed');

assert.deepEqual(gearbox(0), {gear: 0, rpm: 4000});
assert.equal(gearbox(300).gear, 7);
assert.equal(gearbox(400).gear, 8);

// ERS: 1 s of full deployment at 120 kW drains 120 kJ of a 4 MJ store
const ers = ersStep({soc: 0.5}, 100, 0, 250, 1, 2024);
close(ers.soc, 0.5 - 0.03, 1e-9, 'deployment');
assert.equal(ers.mode, 'DEPLOY');

// tyres settle in the 85-100 C range on a long straight, and a long right-hander heats the left side more
let ty = tyreState(40);
for (let i = 0; i < 2000; i++) tyreStep(ty, {speed: 80, gLong: 0, gLat: 0}, 0.1);
assert.ok(ty.t.every(t => t > 85 && t < 100), `straight equilibrium ${ty.t}`);
for (let i = 0; i < 40; i++) tyreStep(ty, {speed: 60, gLong: 0, gLat: 4}, 0.1);
assert.ok(ty.t[0] > ty.t[1] + 5, `left front hotter in a right-hander ${ty.t}`);

// a stadium: two 1 km straights joined by half circles gives exactly two DRS zones
const pts = [];
for (let x = 0; x < 1000; x += 10) pts.push([x, 0]);
for (let a = 0; a < Math.PI; a += 0.05) pts.push([1000 + 100 * Math.sin(a), 100 - 100 * Math.cos(a)]);
for (let x = 1000; x > 0; x -= 10) pts.push([x, 200]);
for (let a = 0; a < Math.PI; a += 0.05) pts.push([-100 * Math.sin(a), 100 + 100 * Math.cos(a)]);
assert.equal(drsZones(pts).length, 2);
// regulation eras: V10 / V8 + KERS (none in 2010) / V6 turbo hybrid; a screaming V10 revs higher at the same speed
assert.deepEqual([2004, 2010, 2012, 2020, 2026].map(y => engine(y).cyl), [10, 8, 8, 6, 6]);
assert.deepEqual([2004, 2010, 2012, 2020, 2026].map(y => engine(y).pK), [0, 0, 60e3, 120e3, 350e3]);
assert.ok(!engine(2010).drs && engine(2011).drs && !engine(2013).turbo && engine(2014).turbo);
assert.ok(gearbox(200, engine(2004).rpmMax).rpm > gearbox(200).rpm && gearbox(200, 15000).rpm === gearbox(200).rpm);
assert.equal(ersStep({soc: 0.5}, 0, 80, 200, 1, 2004).soc, 0.5, 'no recovery before 2009');
console.log('ok');
