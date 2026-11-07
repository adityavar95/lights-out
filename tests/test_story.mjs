// Run: node tests/test_story.mjs  — the Why (story.js) on synthetic races.
import assert from 'node:assert/strict';
import {raceModel} from '../src/static/whatif.js';
import {raceStory, leadChanges, betterCall, stopExcess, flagLaps} from '../src/static/story.js';

const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const N = 40, LOSS = 20;

// lap = 90 + base + deg·age, a stop's LOSS split over in and out laps; sc laps 130 s; red laps 2000 s; out: last lap run
function race(cars, {sc = [], red = []} = {}) {
  const laps = [], pits = [];
  for (const {id, base = 0, deg = 0.05, stops = [], out = N, extra = {}} of cars) {
    for (let L = 1; L <= out; L++) {
      const k = stops.filter(s => s < L).length, age = L - (k ? stops[k - 1] : 0) - 1;
      let t = red.includes(L) ? 2000 : sc.includes(L) ? 130 : 90 + base + deg * age;
      if (stops.includes(L)) t += LOSS / 2;
      if (stops.includes(L - 1) && !sc.includes(L - 1)) t += LOSS / 2;
      laps.push({number: String(L), driverId: id, position: '1', time: fmt(t + (extra[L] ?? 0))});
    }
    for (const s of stops) pits.push({driverId: id, lap: String(s)});
  }
  return raceModel(laps, pits);
}
const results = (...ids) => ids.map((id, i) => ({'Driver.driverId': id, 'Driver.familyName': id.toUpperCase(), grid: String(i + 1), status: 'Finished'}));
const filler = [{id: 'x', base: 3, stops: [20]}, {id: 'y', base: 4, stops: [20]}, {id: 'z', base: 5, stops: [20]}];

// an interim leader who only keeps the lead warm through the stops isn't a lead change
let M = race([{id: 'a', stops: [20]}, {id: 'b', base: 0.1, stops: [22]}, ...filler]);
assert.deepEqual(leadChanges(M, 'a'), [], 'pit cycle: a leads before and after');

// losing the lead through the stops
M = race([{id: 'a', stops: [20, 30]}, {id: 'b', base: 0.1, stops: [20]}, ...filler]);
let c = leadChanges(M, 'a');
assert.equal(c.at(-1).to, 'b');
assert.equal(c.at(-1).how, 'stops');

// a pass on track
M = race([{id: 'a', base: 1, stops: [20]}, {id: 'b', stops: [20], extra: {1: 2}}, ...filler]);
c = leadChanges(M, 'a');
assert.equal(c.length, 1);
assert.equal(c[0].to, 'b');
assert.equal(c[0].how, 'track');

// the leader's retirement
M = race([{id: 'a', out: 25, stops: [20]}, {id: 'b', base: 0.5, stops: [20]}, ...filler]);
c = leadChanges(M, 'a');
assert.equal(c.at(-1).how, 'retired');
let story = raceStory(M, results('b', 'x', 'y', 'z', 'a'));
assert.ok(story.beats.some(b => b.kind === 'retired' && b.id === 'a' && b.lap === 25), 'retirement told');

// a stop just before a safety car: the better call is under it
const sc = [21, 22, 23];
M = race([{id: 'r', stops: [21]}, {id: 'a', base: 0.05, stops: [20]}, ...filler], {sc});
const better = betterCall(M, 'a');
assert.ok(better, 'a stop under the safety car beats the one before it');
assert.ok(M.neutral[better.lap - 1], 'moved under the safety car');
assert.ok(better.finish < better.was);

// a car that can't finish higher gets no verdict
M = race([{id: 'a', stops: [20]}, {id: 'b', base: 3, stops: [20]}, ...filler]);
assert.equal(betterCall(M, 'a'), null, 'the winner has nothing to gain');

// tyres changed in a red flag: no verdict, and no gain of the whole stoppage (Monaco 2024 read 2,457 s)
M = race([{id: 'a', stops: [1]}, {id: 'b', base: 0.02, stops: [1]}, {id: 'c', base: 0.04, stops: [1]}, ...filler.map(f => ({...f, stops: [1]}))], {red: [1]});
assert.equal(betterCall(M, 'b'), null);
story = raceStory(M, results('a', 'b', 'c', 'x', 'y', 'z'));
assert.ok(story.beats.every(b => b.kind !== 'cost' && b.kind !== 'gain'), 'no pit-call verdicts');
assert.ok(story.beats.some(b => b.kind === 'neutral' && b.lap === 1 && b.text.startsWith('A red flag')), 'the red flag is told');

// a slow stop is told as one, and isn't the moved stop's gain
M = race([{id: 'a', stops: [20]}, {id: 'b', base: 0.05, stops: [20], extra: {20: 8}}, ...filler]);
assert.ok(stopExcess(M, 'b', 20) > 6, 'slow stop measured');
assert.equal(betterCall(M, 'b'), null, 'a slow stop is not a better lap to stop on');
story = raceStory(M, results('a', 'b', 'x', 'y', 'z'));
assert.ok(story.beats.some(b => b.kind === 'slow' && b.id === 'b'));

// no pit records (before 2011): the story says so and makes no pit calls
M = race([{id: 'a'}, {id: 'b', base: 0.2}, ...filler.map(({id, base}) => ({id, base}))], {sc});
story = raceStory(M, results('a', 'b', 'x', 'y', 'z'));
assert.ok(story.notes[0].startsWith('No pit stop records'));
assert.ok(story.beats.every(b => !['cost', 'gain', 'slow', 'undercut'].includes(b.kind)));

// a full story: within budget, in lap order, the headline right
M = race([{id: 'r', stops: [21]}, {id: 'a', base: 0.05, stops: [20]}, ...filler], {sc});
story = raceStory(M, results('r', 'a', 'x', 'y', 'z'));
assert.ok(story.beats.length <= 7);
assert.deepEqual(story.beats.map(b => b.lap), story.beats.map(b => b.lap).toSorted((x, y) => x - y));
assert.match(story.headline, /^R won by [\d.]+ s, leading \d+ of 40 laps\.$/);

// what race control called names a slow spell; without it the text says lap times can't tell
const rc = [[1000, 'SafetyCar', null, 'SAFETY CAR DEPLOYED'], [1300, 'SafetyCar', null, 'SAFETY CAR IN THIS LAP'], [1400, 'Flag', 'GREEN', 'TRACK CLEAR']];
const lapRows = Array.from({length: 40}, (_, i) => [i * 90, 'a', i + 1]);
const called = flagLaps(rc, 3600, lapRows);
assert.equal(called[0].kind, 'sc');
assert.equal(called[0].from, 12);
assert.ok(called[0].to > called[0].from);
M = race([{id: 'r', stops: [22]}, {id: 'a', base: 0.05, stops: [10]}, ...filler.map(f => ({...f, stops: [30]}))], {sc});  // the field not stopping on one lap: a lap with no car to time reads as green
const told = flags => raceStory(M, results('r', 'a', 'x', 'y', 'z'), {flags}).beats.find(b => b.kind === 'neutral').text;
assert.match(told(null), /safety car, VSC or rain/);
assert.match(told([{kind: 'sc', from: 21, to: 23}]), /^The safety car on laps 21–23/);
assert.match(told([{kind: 'vsc', from: 22, to: 22}]), /^The VSC on laps 21–23/);
assert.match(told([{kind: 'red', from: 21, to: 23}]), /^A red flag on laps 21–23/);
assert.match(told([{kind: 'sc', from: 5, to: 6}]), /with no safety car called/);

console.log('ok - story');
