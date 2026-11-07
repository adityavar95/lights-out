// Run: node tests/test_sim.mjs  — checks the race simulation's physics on a synthetic circuit.
import assert from 'node:assert/strict';
import {createRace, gridOrder, thermalGrip, wearGrip, COMPOUNDS} from '../src/static/sim.js';
import {surfaceGrip, isWetTyre} from '../src/static/tyres.js';
import {trackWetness} from '../src/static/weather.js';
import {pitTrace} from '../src/static/strategy.js';
import {annotate} from '../src/static/circuits.js';

// a "stadium": two 1.2 km straights joined by 120 m radius hairpins, in metres (mpu 1)
const pts = [];
for (let x = 0; x < 1200; x += 10) pts.push([x, 0]);
for (let a = 0; a < Math.PI; a += 0.05) pts.push([1200 + 120 * Math.sin(a), 120 - 120 * Math.cos(a)]);
for (let x = 1200; x > 0; x -= 10) pts.push([x, 240]);
for (let a = 0; a < Math.PI; a += 0.05) pts.push([-120 * Math.sin(a), 120 + 120 * Math.cos(a)]);
const race = (drivers, opts = {}) => createRace({year: 2025, mapPts: pts, mpu: 1, width: 14, drivers, laps: 6, ...opts});

// grip curves: full grip in the 90-110 C window, the cliff below 35 % health
assert.equal(thermalGrip(100), 1);
assert.ok(thermalGrip(70) < 0.8 && thermalGrip(130) < 0.7, 'cold and overheated tyres lose grip');
assert.ok(wearGrip(60) > 0.95 && wearGrip(36) > 0.92, 'gentle fade to 35 %');
assert.ok(wearGrip(20) < 0.8 && wearGrip(0) < 0.6, 'then the cliff');
assert.ok(COMPOUNDS.SOFT.grip > COMPOUNDS.MEDIUM.grip && COMPOUNDS.HARD.wear < COMPOUNDS.MEDIUM.wear);

// one car, a few laps: top speed sensible, downforce lets it corner harder at speed than standing still allows (~1.45 g)
const solo = race(['A']), a = solo.cars[0];
let vmax = 0, gLat = 0;
while (a.lapsDone < 4) {
  solo.advance(1 / 60);
  if (a.lapsDone >= 2) { vmax = Math.max(vmax, a.v); gLat = Math.max(gLat, Math.abs(a.gLat)); }
}
assert.ok(vmax * 3.6 > 280 && vmax * 3.6 < 345, `top speed ${vmax * 3.6}`);
assert.ok(gLat > 2.5, `aero grip in the 120 m hairpins: ${gLat} g`);
assert.equal(solo.laps.A.length, 4, 'every lap timed');
assert.ok(solo.laps.A[2].slice(3).every(s => s > 0), 'sector times');
// the start: lights out after the five lights and a 0.2-3 s hold, the car moving only after its reaction time
assert.ok(solo.lightsOut >= 5.2 && solo.lightsOut <= 8, `lights out at ${solo.lightsOut}`);
const start = race(['A']);
while (start.t < start.lightsOut + start.cars[0].react - 0.05) { start.advance(1 / 60); assert.equal(start.cars[0].v, 0, 'no jump start'); }
// live delta to the best lap: zero-ish on a lap as fast as the best, the best lap is the fastest timed
assert.equal(a.best, Math.min(...solo.laps.A.map(l => l[2])));
assert.ok(Math.abs(a.lapDelta) < 1, `delta ${a.lapDelta}`);

// DRS: forced open from lap 3 on, the flap is worth well over 10 km/h at the end of the straight
const drs = race(['A']), b = drs.cars[0];
b.drs.forced = true;
let vmaxDrs = 0, opened = false;
while (b.lapsDone < 4) {
  drs.advance(1 / 60);
  if (b.lapsDone >= 2) vmaxDrs = Math.max(vmaxDrs, b.v);
  opened ||= b.drs.open;
}
assert.ok(opened, 'DRS opened in the zone');
assert.ok((vmaxDrs - vmax) * 3.6 > 10, `DRS gain ${(vmaxDrs - vmax) * 3.6} km/h`);

// a full race finishes, with gaps and DRS use between closely matched cars
const full = race(['A', 'B', 'C', 'D']);
let drsUsed = false, towed = false;
while (!full.done && full.t < 2000) {
  full.advance(1 / 30);
  drsUsed ||= full.cars.some(c => c.drs.open);
  towed ||= full.cars.some(c => c.wake > 0.5);
}
assert.ok(full.done, 'race finished');
assert.ok(drsUsed && towed, 'followers got a tow and DRS');
const board = full.board();
assert.equal(board[0].car.id, full.winner);
assert.ok(board.slice(1).every(r => r.gap > 0), 'gaps behind the winner');

// a gap is timed at the car's own spot, not its 20 m stretch: the leader reached 2000 m at t = 100 and 2020 m at t = 101, so
// at t = 110 a car at 2005 m is 9.75 s back and one at 2015 m 9.25 s, where both used to read 10.000
{
  const close = race(['A', 'B', 'C']);
  close.leaderPass[100] = 100; close.leaderPass[101] = 101; close.t = 110;
  [close.cars[0].s, close.cars[1].s, close.cars[2].s] = [2100, 2015, 2005];
  const [, near, far] = close.board();
  assert.ok(Math.abs(near.gap - 9.25) < 1e-9 && Math.abs(far.gap - 9.75) < 1e-9, `gaps ${near.gap} ${far.gap}`);
}

// wet compounds and the crossover: inters beat slicks on a damp track, wets beat inters in standing water, and
// slicks are fastest when dry
assert.ok(surfaceGrip('INTERMEDIATE', 0.3).grip * COMPOUNDS.INTERMEDIATE.grip > surfaceGrip('MEDIUM', 0.3).grip);
assert.ok(surfaceGrip('WET', 0.85).grip * COMPOUNDS.WET.grip > surfaceGrip('INTERMEDIATE', 0.85).grip * COMPOUNDS.INTERMEDIATE.grip);
assert.ok(surfaceGrip('MEDIUM', 0).grip > surfaceGrip('INTERMEDIATE', 0).grip * COMPOUNDS.INTERMEDIATE.grip);
assert.ok(surfaceGrip('INTERMEDIATE', 0).wear > 3, 'inters tear themselves up on a dry track');

// weather: a monsoon floods the track, the racing line stays drier than off-line once it stops, DRS goes off when wet
const wet = race(['A', 'B'], {laps: 40});
while (wet.t < 200) wet.advance(1 / 30);
wet.setWeather('HEAVY_RAIN');
while (wet.t < 420) wet.advance(1 / 30);
assert.ok(trackWetness(wet.W) > 0.6, `flooded: ${trackWetness(wet.W)}`);
assert.equal(wet.control.drs, false, 'DRS disabled on a wet track');
assert.ok(wet.control.messages.some(m => m[3] === 'TRACK SURFACE SLIPPERY'));
wet.setWeather('CLEAR');
while (wet.t < 700) wet.advance(1 / 30);
assert.equal(wet.W.state, 'DRYING');
assert.ok(wet.W.wetLine < wet.W.wetOff, 'the racing line dries first');
assert.ok(wet.cars.every(c => c.pit.stops >= 1 && isWetTyre(c.pit.box?.compound ?? c.tyre.compound) || c.pit.stops >= 1),
          'the AI pitted for wet-weather tyres');

// pit stop: called from the pit wall, the car stops, gets the new set, and loses about the predicted time
const timeTo = (boxLap, lapsTo) => {
  const r = race(['A'], {laps: 8}), car = r.cars[0];
  let predicted = null;
  while (car.lapsDone < lapsTo) {
    r.advance(1 / 60);
    if (boxLap !== null && car.lapsDone === boxLap && !car.pit.box && !car.pit.stops) { r.box('A', 'MEDIUM'); predicted = r.predict('A').loss; }
  }
  return {t: r.t - r.lightsOut - car.react, car, predicted};  // from this car's own start: the lights' hold is random
};
const noStop = timeTo(null, 5), stop = timeTo(3, 5);  // like-for-like set, so the difference is the stop itself
assert.equal(stop.car.tyre.compound, 'MEDIUM');
assert.ok(stop.car.tyre.health[0] > 90, 'a fresh set');
assert.equal(stop.car.pit.stops, 1);
const lost = stop.t - noStop.t;
assert.ok(lost > 15 && lost < 28, `pit stop cost ${lost} s`);
console.log("pit loss measured", lost.toFixed(2), "predicted", stop.predicted.toFixed(2));
assert.ok(Math.abs(lost - stop.predicted) < 2.5, `predicted ${stop.predicted} vs ${lost}`);

// team boxes: each car stops at its own team's, 12 m apart; the lane's entry road leaves from the track edge and its
// centre runs 6.5 m beyond the edge, where the car stands
{
  const r = race(['A', 'B', 'C'], {laps: 8}), boxes = r.setBoxes([['A', 'B'], ['C']]);
  assert.deepEqual(r.cars.map(c => c.boxAt), [-6, -6, 6]);
  assert.equal(boxes.length, 2);
  const lane = r.pitLane(), at = q => Math.abs(q[1] - 240) < 30 ? q[1] - 240 : q[1];  // across the straight it's on
  assert.ok(Math.abs(at(lane[0])) < 7, `entry road starts at the edge (${at(lane[0])})`);
  const C = r.cars[2], stopAt = {};
  while (C.lapsDone < 4 && Object.keys(stopAt).length < 2) {
    r.advance(1 / 60);
    for (const c of r.cars) {
      if (c.lapsDone === 1 && !c.pit.box && !c.pit.stops && c.pit.state === 'RACING' && (c.id === 'A' || c.id === 'C')) r.box(c.id, 'HARD');
      if (c.pit.state === 'STOPPED' && !(c.id in stopAt)) stopAt[c.id] = {x: c.s - c.pit.start, d: c.d};
    }
  }
  assert.ok(Math.abs(stopAt.C.x - stopAt.A.x - 12) < 1, `C stops 12 m past A (${stopAt.C.x - stopAt.A.x})`);
  assert.ok(Math.abs(stopAt.A.d - (-(7 + 6.5))) < 0.3, `in the lane at the box (${stopAt.A.d})`);
}

// a real pit lane from GPS (map points): along the first straight from x 150 to 1050, 9 m left of the centre line at
// its ends and 20 m in the middle. The car commits 60 m before it leaves the track, follows it, stops halfway along
// it, and is back on the racing line after it
{
  const lane = [];
  for (let x = 150; x <= 1050; x += 6) lane.push([x, -9 - 11 * Math.min(1, (x - 150) / 120, (1050 - x) / 120)]);
  const r = race(['A'], {laps: 4, pitLane: lane}), car = r.cars[0];
  assert.ok(Math.abs(r.pit.AT - 90) < 8, `commit point ${r.pit.AT}`);
  assert.ok(r.pitLane().every(([x, y]) => x > 140 && x < 1060 && y < -8 && y > -21), 'the drawn lane is the GPS one');
  let stop = null, back = null;
  while (car.lapsDone < 3) {
    r.advance(1 / 60);
    if (car.lapsDone === 1 && !car.pit.box && !car.pit.stops && car.pit.state === 'RACING') r.box('A', 'HARD');
    if (car.pit.state === 'STOPPED' && !stop) stop = {s: ((car.s % r.T.len) + r.T.len) % r.T.len, d: car.d};
    if (car.pit.stops && car.pit.state === 'RACING' && !back) back = car.d;
  }
  assert.ok(stop && Math.abs(stop.s - 600) < 15 && Math.abs(stop.d + 20) < 1, `stopped mid-lane at ${JSON.stringify(stop)}`);
  assert.ok(Math.abs(back) < 7, `back on the track (${back})`);
}

// VSC: everyone lapping about 35 % slower
const vsc = race(['A'], {laps: 8}), v1 = vsc.cars[0];
while (v1.lapsDone < 3) vsc.advance(1 / 60);
vsc.deploy('VSC');
while (v1.lapsDone < 5) vsc.advance(1 / 60);
const [green, slow] = [vsc.laps.A[2][2], vsc.laps.A[4][2]];
assert.ok(slow / green > 1.35 && slow / green < 1.75, `VSC lap ${slow} vs ${green}`);
assert.equal(vsc.control.drs, false, 'no DRS under the VSC');

// Safety Car: the field bunches up behind the leader; after the restart DRS stays off for a lap (2025)
const sc = race(['A', 'B', 'C', 'D'], {laps: 14});
while (sc.cars[0].lapsDone < 4) sc.advance(1 / 30);
const spread = () => { const s = sc.cars.map(c => c.s); return Math.max(...s) - Math.min(...s); };
const before = spread();
sc.deploy('SC');
while (sc.leader.lapsDone < 7) sc.advance(1 / 30);
assert.ok(spread() < 70 && (before < 70 || spread() < before * 0.6), `bunched (~15 m apart): ${before} -> ${spread()} m`);
sc.deploy('GREEN');
while (sc.control.state !== 'GREEN') sc.advance(1 / 30);
const restart = sc.leader.lapsDone;
while (sc.leader.lapsDone < restart + 1) { assert.equal(sc.control.drs, false, 'no DRS straight after a restart'); sc.advance(1 / 30); }

// the first lap with DRS: lap 3 until 2023, lap 2 from 2024 (the same after a restart)
for (const [year, laps] of [[2023, 2], [2024, 1]]) {
  const r = race(['A', 'B'], {year});
  r.advance(1 / 30);
  while (r.leader.lapsDone < laps) { assert.equal(r.control.drs, false, `${year}: no DRS before ${laps} laps`); r.advance(1 / 30); }
  r.advance(1 / 30);
  assert.ok(r.control.drs, `${year}: DRS on after ${laps} laps`);
}

// the MGU-H keeps a 2024 car deploying on most of its full-throttle running lap after lap (with only the MGU-K's 2 MJ a
// lap it managed ~20 %); 2026, without one, lives on what it harvests, and clips for it instead of emptying the store
{
  const ers = year => {
    const r = race(['A'], {year}), car = r.cars[0];
    let min = 1, clipped = false, flat = 0, on = 0;
    while (car.lapsDone < 5) {
      r.advance(1 / 30);
      clipped ||= car.ers.clipping;
      if (car.lapsDone >= 3) { min = Math.min(min, car.ers.soc); if (car.throttle > 0.95) { flat++; if (car.ers.deploying) on++; } }
    }
    return {min, clipped, share: on / flat};
  };
  const s24 = ers(2024), s26 = ers(2026);
  assert.ok(s24.share > 0.55, `2024 deploys on ${s24.share} of full throttle`);
  assert.ok(s26.min > 0.15 && s26.clipped, `2026 soc ${s26.min}, clipped ${s26.clipped}`);
}

// 2026 overtake: armed at the detection point within a second, it stays armed all of the next lap, shut on the brakes
// and open again after them (35 m hairpins: the stadium's others are flat out)
{
  const tight = [];
  for (let x = 0; x < 800; x += 10) tight.push([x, 0]);
  for (let a = 0; a < Math.PI; a += 0.1) tight.push([800 + 35 * Math.sin(a), 35 - 35 * Math.cos(a)]);
  for (let x = 800; x > 0; x -= 10) tight.push([x, 70]);
  for (let a = 0; a < Math.PI; a += 0.1) tight.push([-35 * Math.sin(a), 35 + 35 * Math.cos(a)]);
  const r = race(['A'], {year: 2026, mapPts: tight}), car = r.cars[0];
  car.drs.forced = true;
  while (car.lapsDone < 2) r.advance(1 / 30);
  let shut = 0, open = 0;
  while (car.lapsDone === 2 && (car.s % r.T.len) < r.T.len - 200) {
    r.advance(1 / 30);
    assert.ok(car.drs.armed, 'armed all lap');
    if (car.brake > 0 && !car.drs.open) shut++;
    if (car.brake === 0 && car.drs.open) open++;
  }
  assert.ok(open > 100 && shut > 10, `open on the power (${open}), shut on the brakes (${shut})`);
}

// the pit limit and the air come from the circuit (circuits.js annotate): 60 km/h lanes, thin air at altitude
{
  const r = race(['A'], {ann: annotate({circuitId: 'marina_bay'}, pts, 1)}), car = r.cars[0];
  let vLane = 0;
  r.box('A', 'HARD');
  while (!car.pit.stops || car.pit.state === 'LANE') { r.advance(1 / 60); if (car.pit.state === 'LANE') vLane = Math.max(vLane, car.v); }
  assert.ok(vLane * 3.6 > 55 && vLane * 3.6 < 63, `pit lane speed ${vLane * 3.6}`);  // the AI settles onto it from just above
  const top = id => { const q = race(['A'], {ann: annotate({circuitId: id}, pts, 1)}), c = q.cars[0]; let v = 0; while (c.lapsDone < 3) { q.advance(1 / 30); v = Math.max(v, c.v); } return v; };
  assert.ok(top('rodriguez') > top('monza') + 3, 'less drag at altitude: a higher top speed on the same power');
}

// eras: a 2004 V10 car revs past the hybrid limiter, has no energy recovery and no DRS (even forced), and is lighter
const v10 = race(['A'], {year: 2004}), e = v10.cars[0];
e.drs.forced = true;
let rpm = 0;
while (e.lapsDone < 3) {
  v10.advance(1 / 60);
  rpm = Math.max(rpm, e.rpm);
  assert.ok(!e.drs.open && !e.ers.deploying && !e.ers.harvesting, 'no DRS or ERS in 2004');
}
assert.ok(rpm > 15000 && rpm <= 19000, `V10 revs ${rpm}`);
assert.ok(e.spec.minMass < a.spec.minMass && Math.abs(v10.laps.A[1][2] / solo.laps.A[1][2] - 1) < 0.05, `lighter, and close to 2025 on the hybrid's power: ${v10.laps.A[1][2]} vs ${solo.laps.A[1][2]}`);
// replay pit lane from GPS: on the straight, 25 m off it past the box (standing still for 3 s), back on; noise on track ignored
{
  const lane = Array.from({length: 40}, (_, i) => i < 5 ? [200 + i * 20, 2] : i < 15 ? [300 + (i - 5) * 20, -25] : i < 21 ? [500, -25]
    : i < 30 ? [500 + (i - 21) * 20, -25] : [680 + (i - 30) * 20, 3]);
  const got = pitTrace([null, ...lane, null], pts, 10, 2);
  assert.deepEqual(got[0], [280, 2], 'starts at the last point on the track');
  assert.deepEqual(got.at(-1), [680, 3], 'ends where it rejoins');
  assert.equal(got.filter(p => p[0] === 500).length, 1, 'the stop adds one point');
  assert.equal(pitTrace(pts.slice(0, 30).map(([x, y]) => [x, y + 3]), pts, 10, 2), null, 'never left the track');
  assert.equal(pitTrace([[100, 0], [120, -25], null], pts, 10, 2), null, 'GPS dropped out in the lane');
}

// the pit-loss estimate stays a loss after a stop: the run through the lane isn't timed as racing pace
{
  const r = race(['A'], {laps: 8}), car = r.cars[0];
  while (car.lapsDone < 2) r.advance(1 / 60);
  const racing = car.segT;
  assert.ok(racing > 0, 'a green-flag run was timed');
  r.box('A', 'MEDIUM');
  while (car.lapsDone < 4) r.advance(1 / 60);
  assert.equal(car.pit.stops, 1);
  assert.ok(Math.abs(car.segT - racing) < 3, `segment after the stop ${car.segT} s, racing ${racing} s`);
  assert.ok(r.predict('A').loss > 15, `pit loss after the stop ${r.predict('A').loss} s`);
}

// a shared drive (Moss in two cars, Britain 1957): one car per driver, on the better grid slot
assert.deepEqual(gridOrder([{id: 'brooks', grid: 3}, {id: 'moss', grid: 3}, {id: 'moss', grid: 1}, {id: 'fangio', grid: 4}]).map(e => [e.id, e.grid]),
                 [['moss', 1], ['brooks', 3], ['fangio', 4]]);

// a zero time step does nothing: it used to leave every AI car's lateral position NaN for good
{
  const r = race(['A', 'B']);
  r.advance(1 / 60);
  const t = r.t;
  r.advance(0);
  assert.equal(r.t, t);
  r.advance(1 / 60);
  assert.ok(r.cars.every(c => Number.isFinite(c.d)), 'd stays a number');
}
console.log('ok');
