// Pit-stop league table, overtake classes, and the shared CSV helper
import assert from 'node:assert/strict';
import {stopSeconds, pitLeague, stationaryRows, neutralAt, lapAt, classify, overtakeLedger, PIT_WINDOW} from '../src/static/ledgers.js';
import {toCsv} from '../src/static/util.js';

// durations
assert.equal(stopSeconds('23.958'), 23.958);
assert.equal(stopSeconds('1:02.500'), 62.5);
assert.equal(stopSeconds('1:00:02.5'), 3602.5);
for (const bad of [null, undefined, '', 'n/a', '1:2:3:4', '12s']) assert.equal(stopSeconds(bad), null);

// league table
const res = [['verstappen', 'VER', 'red_bull', 'Red Bull'], ['tsunoda', 'TSU', 'red_bull', 'Red Bull'], ['norris', 'NOR', 'mclaren', 'McLaren']]
  .map(([id, code, t, n]) => ({'Driver.driverId': id, 'Driver.code': code, 'Constructor.constructorId': t, 'Constructor.name': n}));
const stop = (driverId, lap, duration) => ({driverId, lap: String(lap), duration});
const {teams, excluded} = pitLeague([stop('verstappen', 20, '23.0'), stop('tsunoda', 21, '25.0'), stop('tsunoda', 40, '30.0'),
  stop('norris', 19, '22.0'), stop('norris', 30, '22.5'), stop('norris', 45, null), stop('norris', 46, ''), stop('verstappen', 44, '16:02.123'), stop('norris', 47, '60.001')], res);
assert.deepEqual(excluded, {none: 2, long: 2});
assert.deepEqual(teams.map(t => t.id), ['mclaren', 'red_bull']);  // by median
assert.deepEqual(teams[1], {id: 'red_bull', name: 'Red Bull', stops: 3, median: 25, best: 23, driver: 'VER', lap: 20});
assert.equal(teams[0].median, 22.25);  // even count
assert.equal(pitLeague([stop('norris', 5, '60.000')], res).excluded.long, 0);  // exactly 60 s counts
assert.deepEqual(pitLeague([], res), {teams: [], excluded: {none: 0, long: 0}});
assert.equal(pitLeague([stop('ghost', 5, '24.0')], res).teams[0].driver, 'ghost');  // not in the results: still shown

// stationary: cars leaving for the grid aren't stops, and don't inflate the partial count
const st = stationaryRows([['10', 1, null, null], ['77', 1, null, null], ['1', 20, 2.4, 22.1], ['3', 21, null, 23], ['4', 22, 2.1, null]]);
assert.equal(st.total, 3);
assert.deepEqual(st.rows.map(r => r.num), ['4', '1']);

// neutralised periods
const rc = [[-90000, 'SessionStatus', null, 'SESSION STARTED'], [-100, 'Flag', 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'], [0, 'SessionStatus', null, 'SESSION STARTED'],
  [100, 'SafetyCar', null, 'VSC DEPLOYED'], [150, 'SafetyCar', null, 'VSC ENDING'], [160, 'Flag', 'CLEAR', 'TRACK CLEAR'],
  [300, 'SafetyCar', null, 'SAFETY CAR DEPLOYED'], [400, 'SafetyCar', null, 'SAFETY CAR IN THIS LAP'], [450, 'Flag', 'CLEAR', 'TRACK CLEAR'],
  [600, 'SafetyCar', null, 'SAFETY CAR DEPLOYED'], [620, 'SessionStatus', null, 'SESSION ABORTED'], [640, 'Flag', 'CLEAR', 'TRACK CLEAR'], [900, 'SessionStatus', null, 'SESSION STARTED']];
for (const [t, want] of [[50, false], [100, true], [155, true], [161, false], [350, true], [420, true], [451, false], [610, true], [700, true], [899, true], [901, false]]) {
  assert.equal(neutralAt(rc, t), want, `t=${t}`);
}

// each car's lap
const starts = [[10, 1], [100, 2], [200, 3]];
assert.equal(lapAt(starts, 5), 1);
assert.equal(lapAt(starts, 99.9), 1);
assert.equal(lapAt(starts, 100), 2);
assert.equal(lapAt(starts, 999), 3);
assert.equal(lapAt(undefined, 999), 1);

// each class, and which wins
const pits = new Map([['1', [1000]], ['2', [2000]]]), row = (t, lap = 5, a = '1', b = '2') => ({t, a, b, lap});
assert.equal(classify(row(5000), pits, []), 'track');
assert.equal(classify(row(5000, 1), pits, []), 'lap1');
assert.equal(classify(row(1000 + PIT_WINDOW), pits, []), 'pit');       // the boundary is in
assert.equal(classify(row(1000 - PIT_WINDOW), pits, []), 'pit');       // before the stop's date too
assert.equal(classify(row(1000 + PIT_WINDOW + 0.1), pits, []), 'track');
assert.equal(classify(row(2010), pits, []), 'pit');                    // the overtaken car's stop counts
assert.equal(classify(row(5000, 5, '3', '4'), pits, []), 'track');     // nobody's stop
assert.equal(classify(row(350), pits, rc), 'neutral');
assert.equal(classify(row(350, 1), pits, rc), 'lap1');                 // lap 1 first
assert.equal(classify(row(1010), pits, [[1000, 'SafetyCar', null, 'SAFETY CAR DEPLOYED']]), 'pit');  // then a stop, even under a safety car

// the ledger: neutral rows count for nobody
const L = overtakeLedger({
  overtakes: [[20, '1', '2', 5], [350, '1', '3', 4], [1005, '3', '1', 4], [5000, '1', '2', 3], [5100, '1', '3', 2], [5200, '2', '1', 2]],
  laps: [[0, '1', 1], [100, '1', 2], [0, '2', 1], [100, '2', 2], [0, '3', 1], [100, '3', 2]],
  pits: [[1000, '1', 10]], race_control: rc,
});
assert.deepEqual(L.counts, {lap1: 1, pit: 1, neutral: 1, track: 3});
assert.deepEqual(L.drivers, [{num: '1', lap1: 1, pit: 0, track: 2}, {num: '2', lap1: 0, pit: 0, track: 1}, {num: '3', lap1: 0, pit: 1, track: 0}]);
assert.deepEqual(L.rows.map(r => r.cls), ['lap1', 'neutral', 'pit', 'track', 'track', 'track']);
assert.equal(L.rows[3].lap, 2);

// CSV: quotes, nulls, and formula injection
assert.equal(toCsv(['a', 'b'], [['x', 'y']]), '"a","b"\n"x","y"');
assert.equal(toCsv(['a'], [['say "hi", ok']]), '"a"\n"say ""hi"", ok"');
assert.equal(toCsv(['a'], [[null], [undefined]]), '"a"\n""\n""');
for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', ' =1', '\t=1', '\r=1']) {
  assert.equal(toCsv(['a'], [[bad]]).split('\n').length >= 2, true);
  assert(toCsv(['a'], [[bad]]).startsWith('"a"\n"\''), JSON.stringify(bad));
}
assert.equal(toCsv(['=x'], []), '"\'=x"');          // headers too
assert.equal(toCsv(['a'], [[-1.5]]), '"a"\n"-1.5"');  // a real number stays one
assert.equal(toCsv(['a'], [['a=1']]), '"a"\n"a=1"');  // only at the start
assert.equal(toCsv(['a'], [[[{name: 'x'}, 'y']]]), '"a"\n"x, y"');  // explorer's arrays, as before

{  // stewards: real OpenF1 wordings; an incident noted and then investigated counts once; cleared ones don't count
  const {stewards} = await import('../src/static/ledgers.js');
  const {rows, tally} = stewards([
    [10, 'Other', null, 'CAR 4 (NOR) TIME 1:31.204 DELETED - TRACK LIMITS AT TURN 4 LAP 12 15:22:10'],
    [20, 'Other', null, 'TURN 1 INCIDENT INVOLVING CARS 4 (NOR) AND 81 (PIA) NOTED - CAUSING A COLLISION (15:30:01)'],
    [25, 'Other', null, 'FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 4 (NOR) AND 81 (PIA) UNDER INVESTIGATION - CAUSING A COLLISION'],
    [40, 'Other', null, 'FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 4 (NOR) - CAUSING A COLLISION'],
    [50, 'Flag', 'BLACK AND WHITE', 'BLACK AND WHITE FLAG FOR CAR 81 (PIA) - TRACK LIMITS'],
    [60, 'Other', null, 'FIA STEWARDS: TURN 3 INCIDENT INVOLVING CAR 1 (VER) REVIEWED NO FURTHER INVESTIGATION - LEAVING THE TRACK'],
    [70, 'Flag', 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'], [80, 'Other', null, 'FIA STEWARDS: PENALTY SERVED - CAR 4 (NOR)'],
  ]);
  assert.deepEqual(rows.map(r => r.kind), ['deleted', 'noted', 'noted', 'penalty', 'warning', 'cleared', 'served']);
  assert.deepEqual(tally.get('NOR'), {penalty: 1, noted: 1, deleted: 1, warning: 0});
  assert.deepEqual(tally.get('PIA'), {penalty: 0, noted: 1, deleted: 0, warning: 1});
  assert.ok(!tally.has('VER'));
  assert.equal(rows[0].text, 'CAR 4 (NOR) TIME 1:31.204 DELETED - TRACK LIMITS AT TURN 4 LAP 12');
  assert.equal(rows[1].text, 'TURN 1 INCIDENT INVOLVING CARS 4 (NOR) AND 81 (PIA) NOTED - CAUSING A COLLISION');
}

console.log('test_ledgers: ok');
