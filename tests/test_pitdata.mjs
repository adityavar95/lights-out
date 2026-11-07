// Pit-wall telemetry maths: tyre bands, traction ellipse, shift lights, strip buffer, nearest outline point.
import assert from 'node:assert';
import {tyreBand, ggLoad, litLeds, strip, sampleAt, nearestPoint} from '../src/static/pitdata.js';

assert.equal(tyreBand(60), 'rgb(56 132 255)');
assert.equal(tyreBand(100), 'rgb(47 208 111)');
assert.equal(tyreBand(130), 'rgb(255 64 72)');
assert.notEqual(tyreBand(82), tyreBand(75));  // coming up to temperature shows before it arrives

assert.ok(Math.abs(ggLoad(5, -1.65) - 1) < 1e-9);    // on the ellipse at full lateral
assert.ok(Math.abs(ggLoad(0, -5.5) - 1) < 1e-9);     // full braking
assert.ok(Math.abs(ggLoad(0, 2.2) - 1) < 1e-9);      // full traction
assert.ok(ggLoad(0, 3) > 1);

assert.equal(litLeds(0), 0);
assert.equal(litLeds(7500), 8);
assert.equal(litLeds(20000), 15);
assert.equal(litLeds(null), 0);

const s = strip(10);
for (let t = 0; t <= 20; t += 0.5) s.push(t, {t});
assert.ok(s.t[0] >= 10);                 // old samples leave
assert.equal(sampleAt(s, 15.1).t, 15);
assert.equal(s.push(20.001, {}), false);  // under 30 Hz of race time
s.push(5, {t: 5});                       // a scrub back starts afresh
assert.equal(s.t.length, 1);
s.clear();
assert.equal(sampleAt(s, 1), null);

const ring = Array.from({length: 100}, (_, i) => [Math.cos(i / 100 * 2 * Math.PI), Math.sin(i / 100 * 2 * Math.PI)]);
assert.equal(nearestPoint(ring, [1, 0]), 0);
assert.equal(nearestPoint(ring, ring[42]), 42);
assert.equal(nearestPoint(ring, ring[3], 99), 3);  // a local search wraps round the loop
console.log('pitdata ok');
