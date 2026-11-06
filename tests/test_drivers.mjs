// Drivers tab numbers: wins, podiums, poles, fastest laps, retirements and starts from Jolpica result rows
import assert from 'node:assert/strict';
import {tally, numbered, decided} from '../src/static/drivers.js';

const flat = [  // the season table's flattened rows
  {round: '1', position: '1', positionText: '1', grid: '1', points: '25', laps: '57', 'FastestLap.rank': '1'},
  {round: '2', position: '3', positionText: '3', grid: '4', points: '15', laps: '57', 'FastestLap.rank': '5'},
  {round: '3', position: '18', positionText: 'R', grid: '2', points: '0', laps: '12'},
  {round: '4', position: '24', positionText: 'F', grid: '0', points: '0', laps: '0'},  // didn't qualify: not a start
];
assert.deepEqual(tally(flat), {starts: 3, wins: 1, podiums: 2, poles: 1, fastest: 1, dnfs: 1, points: 40, laps: 126, best: 1});
// /api/driver's nested rows count the same
assert.equal(tally([{position: '2', positionText: '2', grid: '1', points: '18', laps: '50', FastestLap: {rank: '1'}}]).fastest, 1);
assert.equal(tally([]).best, null);
// a shared drive: two rows in one race are one start, and a DNF only if neither car was classified
const shared = (round, ...texts) => texts.map((positionText, i) => ({season: '1955', round, position: String(i + 1), positionText, grid: '0', points: '0', laps: '1'}));
assert.equal(tally(shared('1', '4', 'R')).starts, 1);
assert.equal(tally(shared('1', '4', 'R')).dnfs, 0);  // the other car was classified
assert.equal(tally(shared('1', 'R', 'R')).dnfs, 1);
assert.equal(tally(shared('1', 'R', 'D')).dnfs, 1);
assert.equal(tally(shared('1', 'W', 'F')).starts, 0);
assert.equal(tally([...shared('1', '4', 'R'), ...shared('2', 'R')]).starts, 2);
// same round number, another season: another race
assert.equal(tally([...shared('1', '4'), {...shared('1', '4')[0], season: '1956'}]).starts, 2);
// the season table has no round: a position that drops starts the next race
assert.deepEqual(numbered(['1', '2', '3', '1', '2', '2'].map(position => ({position}))).map(r => r.round), [1, 1, 1, 2, 2, 2]);
const fangio = [{position: '1'}, {position: '4'}, {position: '1'}].map(r => ({...r, positionText: r.position, driver: 'fangio'}));
assert.equal(tally(numbered(fangio)).starts, 2);
// a title is only decided once the last race date has passed
assert.equal(decided([{date: '2026-12-06'}], '2026-11-05'), false);
assert.equal(decided([{date: '2026-12-06'}], '2026-12-06'), false);
assert.equal(decided([{date: '2026-12-06'}], '2026-12-07'), true);
assert.equal(decided([], '2026-12-07'), false);
console.log('drivers tally ok');
