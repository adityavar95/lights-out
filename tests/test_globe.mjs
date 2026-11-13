// The launch globe's maths: where a place sits on the sphere, which tiles cover it, and the flight to a circuit
import assert from 'node:assert/strict';
import {llToVec, vecToLL, tileLL, tilesRound, flight, over} from '../src/static/globemath.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// the sphere: north up, Greenwich facing +z, east to +x, and back again
assert.deepEqual(llToVec(90, 0).map(v => +v.toFixed(9)), [0, 1, 0]);
assert.deepEqual(llToVec(0, 0).map(v => +v.toFixed(9)), [0, 0, 1]);
assert.deepEqual(llToVec(0, 90).map(v => +v.toFixed(9)), [1, 0, 0]);
for (const [lat, lng] of [[43.7347, 7.42056], [-37.8497, 144.968], [34.8431, 136.541], [-23.7036, -46.6997]]) {
  const [la, ln] = vecToLL(llToVec(lat, lng).map(v => v * 3.4));  // from any distance
  near(la, lat); near(ln, lng);
}

// tiles: the world's corners, and a block that holds its circuit in the middle tiles
assert.deepEqual(tileLL(0, 0, 0).map(Math.round), [85, -180]);
assert.deepEqual(tileLL(3, 4, 4).map(v => Math.round(v) + 0), [0, 0]);
for (const z of [6, 9, 12, 15]) {
  const [x, y] = tilesRound(43.7347, 7.42056, z, 4), [top, left] = tileLL(z, x + 1, y + 1), [bottom, right] = tileLL(z, x + 3, y + 3);
  assert.ok(left <= 7.42056 && 7.42056 <= right && bottom <= 43.7347 && 43.7347 <= top, `zoom ${z}`);
}
assert.deepEqual(tilesRound(0, 179.99, 6, 4), [60, 30]);  // stays on the map at its edge

// the flight: starts and ends where asked, takes the short way over the antimeridian, and never climbs
const a = {lat: 20, lng: 170, alt: 2.4}, b = {lat: -37.85, lng: -170, alt: 0.0009};
assert.deepEqual(flight(a, b, 0), a);
const end = flight(a, b, 1);
near(end.lat, b.lat); near(end.alt, b.alt); near((end.lng + 360) % 360, 190);
let last = a;
for (let f = 0.05; f <= 1; f += 0.05) {
  const v = flight(a, b, f);
  assert.ok(v.lng >= 170 && v.lng <= 190 && v.alt <= last.alt);
  last = v;
}
near(flight(a, b, 0.4).lng, 190);  // over the circuit before most of the drop
assert.ok(flight(a, b, 0.4).alt > 1);
// from low over one circuit to another: up to about the hop's length first, and down to the same end
const monza = {lat: 45.6156, lng: 9.28111, alt: 0.0009}, spa = {lat: 50.4372, lng: 5.97139, alt: 0.0009};
near(flight(monza, spa, 0).alt, 0.0009); near(flight(monza, spa, 1).alt, 0.0009);
assert.ok(flight(monza, spa, 0.2).alt > 0.08 && flight(monza, spa, 0.2).alt < 0.1);
near(flight(monza, monza, 0.2).alt, 0.0009);  // nowhere to go: it stays down

// Play's pin: the nearest one, only while it is in the middle of the window
const ats = [monza, spa].map(c => llToVec(c.lat, c.lng));
assert.equal(over(ats, llToVec(45.62, 9.29), 0.004), 0);   // ~0.8 km off Monza, from 25 km up
assert.equal(over(ats, llToVec(50.44, 5.97), 0.0009), 1);
assert.equal(over(ats, llToVec(45.9, 9.28), 0.004), -1);   // 30 km north of it: out of the window
assert.equal(over(ats, llToVec(48, 7.6), 0.3), 0);         // between the two from high up: the nearer
assert.equal(over([], llToVec(0, 0), 0.004), -1);
console.log('globe ok');
