// node tests/test_highlights.mjs
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {passes, highlightReel, shotsFor} from '../src/static/highlights.js';

const drivers = ['A', 'B', 'C', 'D'].map(id => ({id, code: `${id}AA`}));
const grid = [[-10, 'A', 1], [-10, 'B', 2], [-10, 'C', 3], [-10, 'D', 4]];
const swap = (t, up, down, p) => [[t, up, p], [t, down, p + 1]];

// a real pass, then the ways the feed fakes one
assert.deepEqual(passes({positions: [...grid, ...swap(500, 'C', 'B', 2)]}, 0), [{t: 500, id: 'C', other: 'B', p: 2}]);
assert.deepEqual(passes({positions: [...grid, ...swap(30, 'C', 'B', 2)]}, 0), [], 'part of the start clip');
assert.deepEqual(passes({positions: [...grid, ...swap(500, 'C', 'B', 2)], pits: [[490, 'B', 9, 2.5]]}, 0), [], 'B was in the pits');
assert.deepEqual(passes({positions: [...grid, ...swap(500, 'C', 'B', 2)]}, 0, [{t: 450, end: 600}]), [], 'under a safety car');
assert.deepEqual(passes({positions: [...grid, ...swap(500, 'C', 'B', 2), ...swap(510, 'B', 'C', 2)]}, 0).map(x => x.t), [510], 'the flicker is gone, the move back stays');
assert.deepEqual(passes({positions: [...grid, ...swap(500, 'B', 'A', 1)]}, 0), [], 'the lead is a lead change');

const laps = Array.from({length: 50}, (_, i) => [i * 90, 'A', i + 1, 90]);
const data = {
  duration: 5000, total_laps: 50, drivers, laps: [...laps, [800, 'D', 9, 90]],
  race_control: [[100, 'Flag', 'GREEN', 'GREEN LIGHT'], [900, 'SafetyCar', null, 'SAFETY CAR DEPLOYED'], [1100, 'Flag', 'GREEN', 'TRACK CLEAR']],
  positions: [...grid, ...swap(2000, 'B', 'A', 1), ...swap(3000, 'C', 'A', 2)],
};
const reel = highlightReel(data, 0);
assert.deepEqual(reel.map(c => c.kind), ['start', 'sc', 'lead', 'pass', 'finish']);
assert.equal(reel[0].id, 'A', 'the start watches pole');
assert.equal(reel[1].text, 'Safety car · DAA is out');
assert.equal(reel[1].id, 'D');
assert.equal(reel[2].text, 'BAA takes the lead');
assert.equal(reel[3].text, 'CAA passes AAA for P2');
assert.equal(reel[4].t1, 4506, 'the flag falls at the end of lap 50');
assert.equal(reel[2].lap, 23);
for (let i = 1; i < reel.length; i++) assert.ok(reel[i].t0 >= reel[i - 1].t1, 'clips never overlap');

// a red flag: the clip for it, then the restart on the next lap anyone starts; two cars out are both named
const red = highlightReel({duration: 5000, total_laps: 50, drivers, positions: grid,
  laps: [[800, 'C', 9, null], [810, 'D', 9, null], [1000, 'A', 12, 2000], [3000, 'A', 13, 90], [4000, 'A', 50, 90]],
  race_control: [[900, 'SessionStatus', null, 'SESSION ABORTED'], [2500, 'SessionStatus', null, 'SESSION STARTED']]}, 0);
assert.deepEqual(red.map(c => c.kind), ['start', 'red', 'restart', 'finish']);
assert.equal(red[1].text, 'Red flag · DAA, CAA are out');
assert.equal(red[2].t0, 2992);
assert.equal(red[2].id, 'A');

// a small budget keeps the start and the flag and drops the rest in order
assert.deepEqual(highlightReel(data, 0, 80).map(c => c.kind), ['start', 'finish']);
assert.deepEqual(highlightReel(data, 0, 100).map(c => c.kind), ['start', 'lead', 'finish']);

// a clip that starts inside the one before runs straight on from it
const close = highlightReel({...data, positions: [...grid, ...swap(45, 'B', 'A', 1)]}, 0);
assert.equal(close[1].kind, 'lead');
assert.equal(close[1].t0, close[0].t1);
// what's left of a trimmed clip must be long enough to read
const stub = highlightReel({...data, positions: [...grid, ...swap(41, 'B', 'A', 1)]}, 0);
assert.ok(stub.every(c => c.t1 - c.t0 >= 3));

// the real thing, when it's cached: a usable reel inside the budget
const cached = new URL('../.cache/replay/11404.json', import.meta.url);
if (existsSync(cached)) {
  const race = JSON.parse(readFileSync(cached, 'utf8')), go = Math.min(...race.laps.filter(l => l[2] === 1).map(l => l[0]));
  const real = highlightReel(race, go), total = real.reduce((s, c) => s + c.t1 - c.t0, 0);
  assert.ok(total <= 300 && total > 120, `Mexico reel lasts ${total} s`);
  assert.equal(real[0].kind, 'start');
  assert.equal(real.at(-1).kind, 'finish');
  console.log(`Mexico: ${real.length} clips, ${Math.round(total)} s`);
}
// the director: the helicopter establishes, the T-cam joins a pass, no shot runs long, every clip opens on a shot at 0
const shots = (kind, t0, t1, at) => shotsFor({kind, t0, t1, at});
assert.deepEqual(shots('sc', 100, 128, 120), [{at: 0, cam: 'heli'}], 'a neutralisation stays on the helicopter');
assert.deepEqual(shots('start', 0, 46, 6).map(x => x.cam).slice(0, 2), ['heli', 'chase']);
assert.deepEqual(shots('pass', 100, 116, 110), [{at: 0, cam: 'chase'}, {at: 7, cam: 'tcam'}, {at: 13, cam: 'chase'}], 'chase, T-cam as it passes, chase');
assert.deepEqual(shots('finish', 0, 31, 25).at(-1), {at: 22, cam: 'heli'}, 'the helicopter as the flag falls');
for (const kind of ['start', 'finish', 'red', 'restart', 'lead', 'pass', 'sc']) {
  const s = shots(kind, 50, 100, 70);
  assert.equal(s[0].at, 0, `${kind}: opens at once`);
  s.forEach((x, i) => { assert.ok(!i || x.at > s[i - 1].at && x.cam !== s[i - 1].cam, `${kind}: cuts move on`); assert.ok(x.at < 50, `${kind}: inside the clip`); });
  s.forEach((x, i) => assert.ok(x.cam === 'heli' || (s[i + 1]?.at ?? 50) - x.at <= 8.001, `${kind}: no chase/T-cam shot over 8 s`));
}
assert.deepEqual(shots('lead', 0, 18, 10).map(x => x.cam), ['chase', 'tcam', 'chase'], 'an 18 s lead change swaps cameras');

console.log('highlights ok');
