// Drivers tab numbers: wins, podiums, poles, fastest laps, retirements and starts from Jolpica result rows
import assert from 'node:assert/strict';
import {tally} from '../src/static/drivers.js';

const flat = [  // the season table's flattened rows
  {position: '1', positionText: '1', grid: '1', points: '25', laps: '57', 'FastestLap.rank': '1'},
  {position: '3', positionText: '3', grid: '4', points: '15', laps: '57', 'FastestLap.rank': '5'},
  {position: '18', positionText: 'R', grid: '2', points: '0', laps: '12'},
  {position: '24', positionText: 'F', grid: '0', points: '0', laps: '0'},  // didn't qualify: not a start
];
assert.deepEqual(tally(flat), {starts: 3, wins: 1, podiums: 2, poles: 1, fastest: 1, dnfs: 1, points: 40, laps: 126, best: 1});
// /api/driver's nested rows count the same
assert.equal(tally([{position: '2', positionText: '2', grid: '1', points: '18', laps: '50', FastestLap: {rank: '1'}}]).fastest, 1);
assert.equal(tally([]).best, null);
console.log('drivers tally ok');
