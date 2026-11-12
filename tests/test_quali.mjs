// Qualifying evolution (parts from race control, bests per part, deleted laps, the fastest lap falling) and practice long runs
import assert from 'node:assert/strict';
import {segments, deleted, qualiEvolution, longRuns} from '../src/static/quali.js';

const green = t => [t, 'Flag', 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'], flag = t => [t, 'Flag', 'CHEQUERED', 'CHEQUERED FLAG'];
const rc = [green(0), [400, 'Flag', 'RED', 'RED FLAG'], green(800), flag(1500), green(2000), flag(2900), green(3300), flag(4000),
  [1200, 'Other', null, 'CAR 2 (BBB) TIME 1:19.000 DELETED - TRACK LIMITS AT TURN 1 LAP 4 15:20:00'],
  [1300, 'Other', null, 'CAR 1 (AAA) TIME 1:20.000 DELETED - TRACK LIMITS AT TURN 1 LAP 3 15:21:00'],
  [1400, 'Other', null, 'CAR 1 (AAA) TIME 1:20.000 WILL BE REINSTATED'],
  [1450, 'Other', null, 'CAR 3 (CCC) LAP DELETED - TRACK LIMITS AT TURN 4 LAP 5 15:24:00 (PIT)']];

// a red flag's restart doesn't start a new part
assert.deepEqual(segments(rc), [[0, 1500], [2000, 2900], [3300, 4000]]);
assert.deepEqual([...deleted(rc)], ['2 1:19.000']);  // given back, or with no time: not deleted

const lap = (t, num, n, time) => [t, num, n, time, null, null, null];
const q = qualiEvolution({race_control: rc, laps: [
  lap(10, '1', 1, null),  // out-lap: no time
  lap(100, '1', 2, 81), lap(900, '1', 3, 80),
  lap(100, '2', 2, 82), lap(950, '2', 4, 79),  // its 1:19.000 was deleted
  lap(1490, '3', 5, 80.5),  // started before the flag, finished after: stands for Q1
  lap(1580, '2', 6, 120),  // a knocked-out car's in-lap, between the parts: no Q2 time
  lap(2100, '1', 7, 79.5), lap(2100, '3', 7, 79.2),
  lap(3400, '3', 9, 78.9), lap(3500, '1', 9, 79.9),
  lap(200, '4', 2, 86),  // over 107 % of Q1's best: a slow lap, not a time
]});
assert.equal(q.split, true);
assert.deepEqual(q.rows.map(r => r.num), ['3', '1', '2']);  // by the last part reached, then the time in it
assert.deepEqual(q.rows.find(r => r.num === '1').times, [80, 79.5, 79.9]);
assert.deepEqual(q.rows.find(r => r.num === '2').times, [82, null, null]);
assert.deepEqual(q.rows.find(r => r.num === '3').times, [80.5, 79.2, 78.9]);
assert.deepEqual(q.bests, [80, 79.2, 78.9]);
assert.ok(!q.rows.some(r => r.num === '4'));
// the fastest lap falling, in the order the laps ended
assert.deepEqual(q.falls.map(f => [f.num, f.time, f.part]), [['1', 81, 0], ['1', 80, 0], ['3', 79.2, 1], ['3', 78.9, 2]]);
assert.equal(q.falls[0].gain, null);
assert.equal(q.falls[1].gain, 1);

// race control without three parts: one table, not mislabelled ones
const one = qualiEvolution({race_control: [green(0), flag(3600)], laps: [lap(100, '1', 2, 81), lap(900, '1', 3, 80)]});
assert.equal(one.split, false);
assert.deepEqual(one.rows, [{num: '1', times: [80]}]);
assert.deepEqual(qualiEvolution({race_control: [], laps: []}), {split: false, rows: [], falls: [], bests: [Infinity]});

// long runs
const times = (num, from, list) => list.map((x, i) => lap(from * 90 + i * 90, num, from + i, x));
const runs = longRuns({
  stints: [['1', 1, 9, 'SOFT', 0], ['1', 10, 22, 'MEDIUM', 3], ['2', 1, 12, 'HARD', 0]],
  laps: [
    ...times('1', 1, [null, 78, 105, 78.2, 99, 77.9, 97, 78.1, 120]),  // push, cool, push: not a run
    ...times('1', 10, [null, 83, 83.2, 83.4, 83.6, 83.8, 84, 110]),    // six steady laps between an out-lap and an in-lap
    ...times('1', 18, [84, 84, 84, 84]),                               // four: too short
    ...times('2', 1, [null, 85, 85, 85, 85, 85, 95, 85, 85, 85, 85, 85]),  // traffic on lap 7 splits it in two
    ...times('3', 1, [null, 90, 90, 90, 90, 90]),                      // no stint rows: still a run, tyre unknown
  ],
});
assert.deepEqual(runs.map(r => [r.num, r.from, r.to, r.laps, r.compound]),
  [['1', 11, 16, 6, 'MEDIUM'], ['2', 2, 6, 5, 'HARD'], ['2', 8, 12, 5, 'HARD'], ['3', 2, 6, 5, null]]);
assert.ok(Math.abs(runs[0].mean - 83.5) < 1e-9);
assert.ok(Math.abs(runs[0].slope - 0.2) < 1e-9);  // s a lap
assert.equal(runs[0].age, 3);
assert.equal(runs[1].slope, 0);
// a run can't straddle a tyre change, even at the same pace
assert.deepEqual(longRuns({stints: [['1', 1, 4, 'SOFT', 0], ['1', 5, 8, 'HARD', 0]], laps: times('1', 1, [80, 80, 80, 80, 80, 80, 80, 80])}), []);

console.log('test_quali: ok');

{  // ideal lap: best sectors added up, against the best real lap; a driver missing a sector is left out
  const {idealLaps} = await import('../src/static/quali.js');
  const {rows, bests} = idealLaps({laps: [[0, '1', 1, 90.5, 30, 30.5, 30], [100, '1', 2, 90.2, 30.2, 30, 30], [0, '4', 1, 90.1, 30.1, 30, 30],
    [0, '9', 1, null, 31, null, null], [50, '4', 2, null, 29.9, null, null]]});
  assert.deepEqual(rows.map(r => r.num), ['4', '1']);
  assert.ok(Math.abs(rows[0].ideal - 89.9) < 1e-9 && Math.abs(rows[0].lost - 0.2) < 1e-9);
  assert.ok(Math.abs(rows[1].ideal - 90) < 1e-9 && Math.abs(rows[1].lost - 0.2) < 1e-9);
  assert.deepEqual(bests, [29.9, 30, 30]);
}
