// node tests/test_moments.mjs
import assert from 'node:assert/strict';
import {neutralBands, leadChanges, nextMoment, marksGradient} from '../src/static/moments.js';

const rc = [
  [10, 'Flag', 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'],
  [100, 'SafetyCar', null, 'SAFETY CAR DEPLOYED'],
  [150, 'SafetyCar', null, 'SAFETY CAR IN THIS LAP'],
  [200, 'Flag', 'GREEN', 'TRACK CLEAR'],
  [300, 'SafetyCar', null, 'VIRTUAL SAFETY CAR DEPLOYED'],
  [320, 'SafetyCar', null, 'VIRTUAL SAFETY CAR ENDING'],
  [330, 'Flag', 'GREEN', 'TRACK CLEAR'],
  [400, 'Flag', 'RED', 'RED FLAG'],
];
assert.deepEqual(neutralBands(rc, 500), [
  {kind: 'sc', t: 100, end: 200}, {kind: 'vsc', t: 300, end: 330}, {kind: 'red', t: 400, end: 500}]);
assert.deepEqual(neutralBands([], 500), []);
// wordings seen in real feeds: Mexico 2026 says VSC, and its red flag is no flag at all, with track-clear messages during it
assert.deepEqual(neutralBands([[100, 'SafetyCar', null, 'VSC DEPLOYED'], [120, 'SafetyCar', null, 'VSC ENDING'], [130, 'Flag', 'CLEAR', 'TRACK CLEAR']], 500), [{kind: 'vsc', t: 100, end: 130}]);
assert.deepEqual(neutralBands([[100, 'SessionStatus', null, 'SESSION ABORTED'], [100, 'Other', null, 'RED FLAG - RACE SUSPENDED'], [150, 'Flag', 'CLEAR', 'TRACK CLEAR'],
  [200, 'SessionStatus', null, 'SESSION STARTED']], 500), [{kind: 'red', t: 100, end: 200}]);

const ids = l => l.map(c => [c.t, c.id]);
assert.deepEqual(ids(leadChanges([[-1, 'A', 1], [-1, 'B', 2], [50, 'B', 1]], 0)), [[50, 'B']]);
assert.deepEqual(ids(leadChanges([[-1, 'A', 1], [50, 'B', 1], [52, 'A', 1], [100, 'B', 1]], 0)), [[100, 'B']], 'A never really lost it at 50');
assert.deepEqual(leadChanges([[-50, 'A', 1], [-1, 'B', 1]], 0), [], 'before lights out');
assert.deepEqual(leadChanges([[20, 'A', 1]], 0), [], 'the first reading is not a change');

const data = {duration: 500, race_control: rc, positions: [[-1, 'A', 1], [250, 'B', 1]]};
const m = [...neutralBands(data.race_control, data.duration), ...leadChanges(data.positions, 0)].sort((a, b) => a.t - b.t);
assert.deepEqual(m.map(x => x.kind), ['sc', 'lead', 'vsc', 'red']);
assert.equal(nextMoment(m, 0, 1).t, 100);
assert.equal(nextMoment(m, 97, 1).t, 250, 'a jump landed 3 s before the safety car: the next key moves on');
assert.equal(nextMoment(m, 97, -1), null, 'and back from there leaves it');
assert.equal(nextMoment(m, 110, -1).t, 100);
assert.equal(nextMoment(m, 450, 1), null);
assert.equal(marksGradient([], 500), 'none');
assert.match(marksGradient(m, 500), /#ffc800 20\.00%, #ffc800 40\.00%/);
console.log('moments ok');
