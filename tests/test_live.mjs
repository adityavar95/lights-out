// Run: node tests/test_live.mjs  — checks how live cars are placed from mini-sector progress.
import assert from 'node:assert/strict';
import {liveState, liveFeeds, liveInfo, liveGps, hasGps, gpsAt, liveCar} from '../src/static/live.js';

const driver = {id: '1', code: 'NOR'};
const topics = segsDone => ({
  SessionInfo: {Type: 'Race', StartDate: '2026-10-25T15:00:00', GmtOffset: '-05:00:00'},
  LapCount: {CurrentLap: 5, TotalLaps: 56},
  TimingData: {Lines: {'1': {
    Position: '1', NumberOfLaps: 4, LastLapTime: {Value: '1:40.000'},
    Sectors: [{Segments: Array.from({length: 10}, (_, i) => ({Status: i < segsDone ? 2049 : 0}))}],
  }}},
  TimingAppData: {Lines: {'1': {Stints: [{Compound: 'MEDIUM'}]}}},
});

let s = liveState(topics(5), [driver], 0);
assert.equal(s.fracs['1'], 0.5);  // first data: snap to 5 of 10 mini-sectors
assert.equal(s.board[0].tyre, 'MEDIUM');
assert.equal(s.board[0].gapText, 'LAP 5');
s = liveState(topics(5), [driver], 1000);
assert.ok(Math.abs(s.fracs['1'] - 0.51) < 1e-9);  // creeps on at lap pace (1 s = 1/100 lap)...
for (let ms = 2000; ms <= 60000; ms += 1000) s = liveState(topics(5), [driver], ms);
assert.ok(Math.abs(s.fracs['1'] - 0.6) < 1e-9);   // ...but never past the next mini-sector
s = liveState(topics(0), [driver], 61000);
assert.ok(Math.abs(s.fracs['1'] - 0.6) < 1e-9);   // segments reset before the lap count rises: don't jump back

assert.equal(liveInfo(topics(0)).origin, Date.parse('2026-10-25T20:00:00Z'));  // local start + 5 h
const feeds = liveFeeds({RaceControlMessages: {Messages: [{Utc: '2026-10-25T20:01:00', Category: 'Flag', Flag: 'GREEN', Message: 'GREEN LIGHT'}]}},
                        Date.parse('2026-10-25T20:00:00Z'));
assert.deepEqual(feeds.race_control, [[60, 'Flag', 'GREEN', 'GREEN LIGHT']]);
console.log('ok');

// TimingStats speed trap and pit stops (completed stints) reach the tower rows
const withStats = {...topics(5), TimingStats: {Lines: {'1': {BestSpeeds: {ST: {Value: '331', Position: 1}}}}},
                   TimingAppData: {Lines: {'1': {Stints: [{Compound: 'MEDIUM'}, {Compound: 'HARD'}]}}}};
const row = liveState(withStats, [driver], 62000).board[0];
assert.deepEqual([row.trap, row.trapBest, row.stops, row.tyre], ['331', true, 1, 'HARD']);
console.log('live stats ok');

// F1 TV car GPS: drawn GPS_DELAY (1.8 s) behind the newest sample, interpolated between samples
const T0 = Date.parse('2026-10-25T20:00:00Z'), iso = ms => new Date(ms).toISOString();
const pos = (ms, x, status = 'OnTrack') => ({Timestamp: iso(ms), Entries: {'1': {Status: status, X: x, Y: 0, Z: 0}}});
assert.equal(hasGps(0), false);
liveGps({Position: {Position: [pos(T0, 0), pos(T0 + 1000, 100), pos(T0 + 2000, 200)]}}, 5000);  // newest drawn at wall 6800
assert.equal(hasGps(5000), true);
assert.deepEqual(gpsAt('1', 5000), [20, 0]);       // feed time T0 + 200 ms
assert.deepEqual(gpsAt('1', 5000, 500), [70, 0]);
assert.equal(gpsAt('2', 5000), null);                // no samples for that car
liveGps({Position: {Position: [pos(T0 + 2000, 200), pos(T0 + 3000, 300, 'OffTrack')]}}, 6000);  // no drift: clock kept
assert.deepEqual(gpsAt('1', 6000), [120, 0]);
assert.equal(gpsAt('1', 8000), null);                // from the OffTrack sample on: in the garage
assert.equal(hasGps(9000), true);                     // newest sample (T0 + 3 s) is 1.2 s behind the drawn time
assert.equal(hasGps(14000), false);                   // 6.2 s without samples: back to mini-sector placement
const cd = {CarData: {Entries: [{Utc: iso(T0), Cars: {'1': {Channels: {0: 11000, 2: 290, 3: 7, 4: 100, 5: 1, 45: 12}}}}]}};
assert.deepEqual(liveCar(cd, '1', 5000), {rpm: 11000, speed: 290, n_gear: 7, throttle: 100, brake: 100, drs: 12});
assert.equal(liveCar(cd, '2', 5000), null);
console.log('live ok');

// timing tower order: two cars side by side swapping every update don't move the rows; a pass that holds for 3
// updates does; an order that never settles still shows within 1 s; a scrub (force) takes the board's order at once
import {stableOrder} from '../src/static/tower.js';
const B = (...ids) => ids.map((id, i) => ({d: {id}, pos: i + 1}));
const shown = r => r.map(b => `${b.pos}${b.d.id}`).join(' ');
const st = {};
assert.equal(shown(stableOrder(st, B('A', 'B', 'C'), 0)), '1A 2B 3C');
for (let k = 1; k <= 6; k++) assert.equal(shown(stableOrder(st, k % 2 ? B('B', 'A', 'C') : B('A', 'B', 'C'), k * 120)), '1A 2B 3C');
assert.equal(shown(stableOrder(st, B('A', 'C', 'B'), 840)), '1A 2B 3C');   // C passes B: not yet...
assert.equal(shown(stableOrder(st, B('A', 'C', 'B'), 960)), '1A 2B 3C');
assert.equal(shown(stableOrder(st, B('A', 'C', 'B'), 1080)), '1A 2C 3B');  // ...held for 3 updates: shown
// a field that keeps reshuffling (never back to the shown order, never the same twice running): shown within ~1 s
const busy = {}, cycle = [B('B', 'A', 'C'), B('C', 'B', 'A'), B('B', 'C', 'A')];
stableOrder(busy, B('A', 'B', 'C'), 0);
let moved = null;
for (let k = 1; k <= 12 && moved === null; k++) if (!shown(stableOrder(busy, cycle[k % 3], k * 120)).startsWith('1A')) moved = k * 120;
assert.ok(moved !== null && moved <= 1200, `reshuffling field shown after ${moved} ms`);
assert.equal(shown(stableOrder(st, B('C', 'A', 'B'), 1100, true)), '1C 2A 3B');
console.log('tower order ok');
