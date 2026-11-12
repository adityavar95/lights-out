// Run: node tests/test_pace.mjs  — race trace, tyre-wear fits and undercut ledger (pace.js) on synthetic races.
import assert from 'node:assert/strict';
import {raceModel} from '../src/static/whatif.js';
import {raceTrace, fuelPerLap, ols, stintPace, paceRanking, undercuts, compoundOf, stintBars} from '../src/static/pace.js';

{  // a fitted stint's compound: OpenF1's stint on at its middle lap, whichever side of the stop each source puts the pit lap
  const rows = [['1', 1, 18, 'MEDIUM', 0], ['1', 19, null, 'HARD', 3], ['44', 1, 57, null, 0]];
  assert.equal(compoundOf(rows, 1, {from: 1, to: 19}), 'MEDIUM');
  assert.equal(compoundOf(rows, '1', {from: 20, to: 57}), 'HARD');   // an open-ended last stint
  assert.equal(compoundOf(rows, 44, {from: 1, to: 57}), null);       // OpenF1 gave no compound
  assert.equal(compoundOf(rows, 16, {from: 1, to: 57}), null);
  assert.equal(compoundOf(null, 1, {from: 1, to: 19}), null);
}

const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

// cars: {id: L => lap time, or null for a lap with no record}; stops: {id: [laps]}
function race(cars, stops = {}, N = 20) {
  const laps = [], pits = [];
  for (const [id, time] of Object.entries(cars)) {
    for (let L = 1; L <= N; L++) {
      const t = time(L);
      if (t !== null) laps.push({number: String(L), driverId: id, position: '1', time: fmt(t)});
    }
    for (const s of stops[id] ?? []) pits.push({driverId: id, lap: String(s)});
  }
  return raceModel(laps, pits);
}

// race trace
{
  const M = race({W: () => 90, D: L => (L === 3 ? 95 : 90.5), X: () => 91});
  const gaps = raceTrace(M, 'W');
  close(gaps.D.at(-1), M.cum.W.at(-1) - M.cum.D.at(-1), 1e-9, 'final gap is the difference of cumulative times');
  close(gaps.D.at(-1), -(19 * 0.5 + 5), 1e-6, 'and behind reads negative');
  assert.ok(gaps.W.every(g => g === 0), 'the reference is the zero line');
  close(raceTrace(M, 'D').W.at(-1), 14.5, 1e-6, 'a chosen reference flips the sign');
}
{
  const M = race({A: L => (L === 8 ? 130 : 90), B: L => (L === 8 ? 130 : 90), C: L => (L === 8 ? 130 : 90)});
  assert.equal(M.neutral[7], true, 'a slow lap for the whole field is flagged neutral');
  assert.equal(M.neutral.filter(Boolean).length, 1, 'and only that one');
}
{
  const M = race({A: () => 90, B: L => (L === 9 ? null : 90), C: () => 90});
  const gaps = raceTrace(M, 'A');
  assert.equal(gaps.B.length, 8, 'a lap hole stops the line');
  assert.equal(gaps.C.length, 20);
  assert.equal(raceTrace(M, 'B').A.length, 8, 'and a reference with a hole stops every line');
}

// tyre wear
{
  // base + deg·age, and a sub-2 s in- and out-lap on laps 10 and 11 the median filter would keep: only the
  // exclusions take them out. Lap 5 is neutral for everyone.
  const deg = 0.08, slow = L => L === 5 ? 130 : null;
  const car = L => slow(L) ?? (L <= 10 ? 90 + deg * (L - 1) : 90 + deg * (L - 11)) + (L === 1 ? 1.5 : 0) + (L === 10 || L === 11 ? 1.5 : 0);
  const M = race({A: car, B: L => slow(L) ?? 90, C: L => slow(L) ?? 90.2}, {A: [10]});
  const [s1, s2] = stintPace(M, 'A');
  assert.deepEqual([s1.from, s1.to, s2.from, s2.to], [1, 10, 11, 20]);
  assert.equal(s1.n, 7, 'lap 1, the in-lap and the neutral lap are out of stint 1');
  assert.equal(s2.n, 9, 'the out-lap is out of stint 2');
  close(s1.slope, deg, 1e-3, 'stint 1 recovers the slope');
  close(s2.slope, deg, 1e-3, 'stint 2 recovers the slope');
  close(s1.corrected - s1.slope, 0.03 * 110 / 20, 1e-9, 'fuel adds 0.03 s/kg × 110 kg / laps');
  close(s2.corrected - s2.slope, fuelPerLap(20), 1e-9, 'the same constant on every stint');
}
{
  // a lap 2 s off the stint median is traffic, not tyres
  const M = race({A: L => (L === 7 ? 95 : 90 + 0.1 * (L - 1)), B: () => 90, C: () => 90});
  const [s] = stintPace(M, 'A');
  assert.equal(s.n, 18, 'lap 1 and the far-off lap are gone');
  close(s.slope, 0.1, 1e-3, 'and the slope is untouched by it');
}
{
  // stops on laps 4 and 10 leave stint 2 with 4 clean laps (6-9): too few
  const M = race({A: () => 90, B: () => 90, C: () => 90}, {A: [4, 10]});
  const [s1, s2] = stintPace(M, 'A');
  assert.equal(s1.slope, null, 'stint 1 has 2 clean laps: no slope');
  assert.equal(s1.corrected, null);
  assert.equal(s2.n, 4);
  assert.equal(s2.slope, null, 'stint 2 has 4: no slope');
}
{
  // by hand: x 0..4, y 0 2 1 3 2 gives b = 5/10, residuals −.6 .9 −.6 .9 −.6, SSE 2.7, se = sqrt(2.7/3/10) = 0.3
  const f = ols([[0, 0], [1, 2], [2, 1], [3, 3], [4, 2]]);
  close(f.b, 0.5, 1e-9, 'slope');
  close(f.se, 0.3, 1e-9, 'standard error');
}
{
  const M = race({S: () => 91, F: () => 90, R: L => (L > 3 ? null : 90)});
  const rank = paceRanking(M);
  assert.deepEqual(rank.map(r => r.id), ['F', 'S'], 'fastest median first; 2 clean laps are not ranked');
  assert.equal(rank[0].median, 90);
}

// undercut ledger. Lap 1 puts A 2 s behind B, A stops on 10, B on 12 (20 s each), A's fresh laps 11-13 gain `edge` a lap.
{
  const B = L => 90 + (L === 12 || L === 13 ? 10 : 0);
  const A = edge => L => 90 + (L === 1 ? 2 : 0) + (L === 10 || L === 11 ? 10 : 0) - (L >= 11 && L <= 13 ? edge : 0);
  const C = () => 90.1;  // a third car keeps the field median honest
  const stops = {A: [10], B: [12]};

  const worked = undercuts(race({A: A(1), B, C}, stops));
  assert.equal(worked.length, 1);
  const w = worked[0];
  assert.deepEqual([w.a, w.b, w.lapA, w.lapB], ['A', 'B', 10, 12]);
  close(w.before, 2, 1e-6, 'gap before');
  close(w.after, -1, 1e-6, 'gap after');
  close(w.gain, 3, 1e-6, 'gain');
  assert.equal(w.worked, true, 'sign flip');

  const failed = undercuts(race({A: A(0.2), B, C}, stops));
  assert.equal(failed.length, 1);
  close(failed[0].gain, 0.6, 1e-6, 'gain without the pass');
  assert.equal(failed[0].worked, false, 'no sign flip');

  const sc = L => (L === 11 ? 130 : null);
  const neutral = race({A: L => sc(L) ?? A(1)(L), B: L => sc(L) ?? B(L), C: L => sc(L) ?? C(L)}, stops);
  assert.equal(neutral.neutral[10], true);
  assert.equal(undercuts(neutral).length, 0, 'a neutral lap in the window excludes it');

  const hole = race({A: A(1), B: L => (L === 13 ? null : B(L)), C}, stops);
  assert.equal(undercuts(hole).length, 0, 'a missing lap in the window excludes it');
  const holeA = race({A: L => (L === 12 ? null : A(1)(L)), B, C}, stops);
  assert.equal(undercuts(holeA).length, 0, 'on either car');

  assert.equal(undercuts(race({A: A(6), B, C}, stops)).length, 0, 'an 18 s swing is excluded');

  const far = L => 90 + (L === 1 ? 5 : 0) + (L === 10 || L === 11 ? 10 : 0) - (L >= 11 && L <= 13 ? 1 : 0);
  assert.equal(undercuts(race({A: far, B, C}, stops)).length, 0, '5 s behind is too far back');

  const ahead = L => 90 + (L === 10 || L === 11 ? 10 : 0);
  const Bbehind = L => B(L) + (L === 1 ? 2 : 0);
  assert.equal(undercuts(race({A: ahead, B: Bbehind, C}, stops)).length, 0, 'a car already ahead has nothing to undercut');

  assert.equal(undercuts(race({A: A(1), B, C}, {A: [10], B: [16]})).length, 0, 'stops 6 laps apart are too far apart');
  assert.equal(undercuts(race({A: A(1), B, C}, {A: [10, 13], B: [12]})).length, 0, 'a second stop in the window excludes it');
}

{  // tyre strategy bars: one car's stints in order, widths by laps, an open last stint ending at the car's laps
  const rows = [['44', 19, null, 'HARD', 0], ['44', 1, 18, 'MEDIUM', 0], ['1', 1, 50, 'SOFT', 0], ['44', null, null, 'SOFT', 0]];
  const bars = stintBars(rows, 44, 50);
  assert.deepEqual(bars.map(s => [s.compound, s.from, s.to]), [['MEDIUM', 1, 18], ['HARD', 19, 50]]);
  assert.ok(Math.abs(bars[0].share - 18 / 50) < 1e-9 && Math.abs(bars[0].share + bars[1].share - 1) < 1e-9);
  assert.deepEqual(stintBars(null, 44, 50), []);
}

console.log('pace tests passed');
