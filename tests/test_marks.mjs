// Run: node tests/test_marks.mjs  — the scrubbers' important events (scrubmarks.js): GPS, lap-timing and F1 TV sources.
import assert from 'node:assert/strict';
import {gpsMarks, storyMarks, sessionMarks} from '../src/static/scrubmarks.js';

const rc = [[1000, 'SafetyCar', null, 'SAFETY CAR DEPLOYED'], [1200, 'Flag', 'GREEN', 'TRACK CLEAR'], [3000, 'Flag', 'CHEQUERED', 'CHEQUERED FLAG']];
const positions = [[0, '1', 1], [0, '2', 2], [2000, '2', 1], [2000, '1', 2]];
const laps = [[100, '1', 1, 90], [100, '2', 1, 91], [2950, '2', 30, 90]];
const drivers = [{id: '1', code: 'AAA'}, {id: '2', code: 'BBB'}];

// a GPS race: the reel's events at their own moments, landing a little before them, in time order
let m = gpsMarks({duration: 3100, total_laps: 30, race_control: rc, positions, laps, drivers, intervals: [[0, '1', 0]], pits: []}, 100);
const kinds = m.pins.map(p => p.kind);
for (const k of ['start', 'sc', 'lead', 'finish']) assert.ok(kinds.includes(k), `race has ${k}: ${kinds}`);
assert.deepEqual(m.pins.map(p => p.t), m.pins.map(p => p.t).toSorted((a, b) => a - b));
assert.equal(m.pins.find(p => p.kind === 'start').t, 100, 'lights out');
assert.equal(m.pins.find(p => p.kind === 'lead').t, 2000);
assert.equal(m.pins.find(p => p.kind === 'lead').id, '2');
assert.match(m.pins.find(p => p.kind === 'lead').label, /BBB takes the lead/);
assert.ok(m.pins.every(p => p.seek <= p.t), 'lands before the event');
assert.deepEqual(m.bands.map(b => [b.kind, b.t, b.end]), [['sc', 1000, 1200]]);

// practice and qualifying: only their flags
m = gpsMarks({duration: 3600, race_control: [[500, 'Flag', 'RED', 'RED FLAG'], [800, 'Flag', 'GREEN', 'TRACK CLEAR']], intervals: []});
assert.deepEqual(m.pins, [{t: 500, kind: 'red', label: 'Red flag'}]);

// a lap-timing replay: facts from the Why, never the model's verdicts; a stop lands late in its lap
const cum = {a: [90, 180, 270, 360, 450], b: [91, 182, 273, 364, 455]};
m = storyMarks([
  {lap: 1, id: 'a', kind: 'lead', text: 'A took the lead.'},
  {lap: 2, id: 'a', kind: 'neutral', text: 'The field slowed.', band: {to: 3, kind: 'slow'}},
  {lap: 2, id: 'b', kind: 'cost', text: 'A verdict.'},
  {lap: 3, id: 'b', kind: 'slow', text: 'A slow stop.'},
], cum);
assert.equal(m.pins.length, 3, 'no verdicts on the scrubber');
assert.deepEqual(m.pins.map(p => p.t), [0, 90, 270], 'lap 1 at the start, lap 2 from its start, the stop at the end of lap 3');
assert.equal(m.pins[2].seek, 250);
assert.deepEqual(m.bands, [{t: 90, kind: 'slow', end: 270}]);
assert.match(m.pins[1].label, /^Lap 2 · /);
// a lap the replay doesn't have is left out, not placed at infinity
assert.equal(storyMarks([{lap: 99, id: 'a', kind: 'lead', text: 'x'}], cum).pins.length, 0);

// F1 TV: a race has its start, flags, lead changes and flag; practice only its flags
const session = {duration: 4000, race_control: rc, positions, drivers};
m = sessionMarks({...session, first_lap: 100});
assert.deepEqual(m.pins.map(p => [p.kind, p.t]), [['start', 100], ['sc', 1000], ['lead', 2000], ['finish', 3000]]);
assert.equal(m.pins[2].label, 'BBB takes the lead');
assert.deepEqual(sessionMarks(session).pins.map(p => p.kind), ['sc', 'finish']);

// every part of qualifying ends on a chequered flag
const quali = [[1000, 'Flag', 'CHEQUERED', 'CHEQUERED FLAG'], [2000, 'Flag', 'CHEQUERED', 'CHEQUERED FLAG']];
assert.equal(gpsMarks({duration: 3000, race_control: quali, intervals: []}).pins.length, 2);
assert.equal(sessionMarks({duration: 3000, race_control: quali, positions: [], drivers: []}).pins.length, 2);
assert.equal(sessionMarks({duration: 3000, race_control: quali, positions: [], drivers: [], first_lap: 10}).pins.filter(p => p.kind === 'finish').length, 1, 'a race has one flag');

console.log('ok - marks');
