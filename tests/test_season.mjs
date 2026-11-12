// Season analysis: teammate head-to-heads, cumulative points, who can still win, supertimes
import assert from 'node:assert/strict';
import {secs, median, qualiRounds, teammates, h2hLine, fmtGap, raceMax, sprintMax, cumulative, maxRemaining, alive, reconcile, supertimes} from '../src/static/season.js';
import {numbered} from '../src/static/drivers.js';

const row = (round, id, tid, number, position, extra = {}) => ({round, 'Driver.driverId': id, 'Constructor.constructorId': tid, 'Constructor.name': tid, number,
  position: String(position), positionText: String(position), ...extra});
const get = (m, a, b) => m.get(a).find(x => x.mate === b);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

assert.equal(secs('1:23.456'), 83.456);
assert.equal(secs('59.8'), 59.8);
assert.equal(secs(''), null);
assert.equal(secs(null), null);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([1, 2, 3, 10]), 2.5);

// a mid-season swap pairs per round: Lawson drives rounds 1-2 beside Verstappen, Tsunoda rounds 3-4
const swap = [
  row(1, 'max', 'rb', 1, 1), row(1, 'law', 'rb', 30, 5),
  row(2, 'max', 'rb', 1, 2), row(2, 'law', 'rb', 30, 7),
  row(3, 'max', 'rb', 1, 3), row(3, 'tsu', 'rb', 22, 4),
  row(4, 'tsu', 'rb', 22, 1), row(4, 'max', 'rb', 1, 2),
  row(3, 'law', 'vcarb', 30, 9), row(3, 'had', 'vcarb', 6, 8),
];
const t = teammates(swap, []);
assert.deepEqual(t.get('max').map(x => x.mate), ['law', 'tsu']);
assert.deepEqual(get(t, 'max', 'law').r, {wins: 2, losses: 0, n: 2});
assert.deepEqual(get(t, 'max', 'tsu').r, {wins: 1, losses: 1, n: 2});
assert.deepEqual(t.get('law').map(x => x.mate).sort(), ['had', 'max']);
assert.equal(t.get('max').find(x => x.mate === 'had'), undefined);

// the last session both reached decides, whoever went further
const q = (round, id, number, position, Q1, Q2, Q3) => row(round, id, 'x', number, position, {Q1, Q2, Q3});
const quali = teammates([], [
  q(1, 'a', 1, 1, '1:30.000', '1:29.000', '1:28.000'), q(1, 'b', 2, 2, '1:30.500', '1:29.500', '1:29.000'),  // Q3: a by 1 s of 89
  q(2, 'a', 1, 5, '1:30.000', '1:29.900', '1:29.000'), q(2, 'b', 2, 12, '1:29.000', '1:30.000'),              // Q2 not Q1 (where b was quicker) or Q3
  q(3, 'b', 2, 15, '1:31.000'), q(3, 'a', 1, 17, '1:31.500'),                                                 // Q1 only: b
]);
const ab = get(quali, 'a', 'b').q;
assert.equal(ab.wins, 2);
assert.equal(ab.losses, 1);
assert.equal(ab.n, 3);
close(ab.gap, 100 * (89.9 / 90 - 1));  // the median of the three, signed for a: quicker is negative
assert.ok(ab.gap < 0 && get(quali, 'b', 'a').q.gap > 0);
assert.equal(get(teammates([], [q(1, 'a', 1, 1), q(1, 'b', 2, 2)]), 'a', 'b').q.n, 0);  // neither set a time

// the race comparison skips a DNF: only rounds where both were classified
const dnf = teammates([
  row(1, 'a', 'x', 1, 1), row(1, 'b', 'x', 2, 2),
  row(2, 'a', 'x', 1, 18, {positionText: 'R'}), row(2, 'b', 'x', 2, 3),
  row(3, 'b', 'x', 2, 19, {positionText: 'D'}), row(3, 'a', 'x', 1, 4),
], []);
assert.deepEqual(get(dnf, 'a', 'b').r, {wins: 1, losses: 0, n: 1});
assert.equal(get(dnf, 'a', 'b').rounds, 3);

// a shared drive (one car, two drivers) isn't a teammate comparison, nor is a driver in two cars or a third entry
const shared = teammates([
  row(1, 'fangio', 'mer', 2, 1), row(1, 'kling', 'mer', 2, 1),
  row(2, 'fangio', 'mer', 2, 1), row(2, 'fangio', 'mer', 4, 4),
  row(3, 'fangio', 'mer', 2, 1), row(3, 'kling', 'mer', 4, 2), row(3, 'taruffi', 'mer', 6, 3),
], []);
assert.equal(shared.size, 0);

// the card's line and its signed gap
assert.equal(fmtGap(-.123), '−0.12 %');
assert.equal(fmtGap(.5), '+0.50 %');
assert.equal(h2hLine([{mate: 'b', q: {wins: 2, losses: 1, n: 3, gap: -.11}, r: {wins: 1, losses: 0, n: 1}}, {mate: 'c', q: {n: 1, gap: 0, wins: 0, losses: 0}, r: {n: 0}}], x => x.toUpperCase()),
  'vs B · Q 2–1 (−0.11 %) · R 1–0 · +1');
assert.equal(h2hLine([{mate: 'b', q: {n: 0}, r: {wins: 3, losses: 1, n: 4}}], x => x), 'vs b · R 3–1');
assert.equal(h2hLine([{mate: 'b', q: {n: 0}, r: {n: 0}}], x => x), '');
assert.equal(h2hLine(undefined, x => x), '');

// qualifying rows out of position order at a page boundary (2024's shape) are one race; a new one starts where a driver
// repeats, or at a second pole when its sitter wasn't in the last race
const scrambled = ['a:1', 'b:2', 'c:3', 'b:4', 'a:1', 'c:2', 'd:1', 'a:2'].map(s => ({'Driver.driverId': s[0], position: s.slice(2)}));
assert.deepEqual(qualiRounds(scrambled).map(r => r.round), [1, 1, 1, 2, 2, 2, 3, 3]);

// race and sprint points by era
assert.deepEqual([1950, 1959, 1960, 1961, 1990, 1991, 2009, 2010, 2018, 2019, 2024, 2025, 2026].map(y => raceMax(y, 1, 20)),
  [9, 9, 8, 9, 9, 10, 10, 25, 25, 26, 26, 25, 25]);
assert.equal(raceMax(2014, 19, 19), 50);
assert.equal(raceMax(2014, 18, 19), 25);
assert.deepEqual([2020, 2021, 2022, 2026].map(sprintMax), [0, 3, 8, 8]);

// cumulative points equal the final standings on a fixture: rows numbered as they arrive, a sprint on its own weekend
const calendar = [{round: '1'}, {round: '2', 'Sprint.date': '2024-05-04'}, {round: '3'}, {round: '4', 'Sprint.date': '2024-06-01'}, {round: '5'}];
const racePts = (position, id, points) => ({position, 'Driver.driverId': id, points: String(points)});
const results = numbered([
  racePts('1', 'a', 25), racePts('2', 'b', 18),
  racePts('1', 'b', 26), racePts('2', 'a', 18),
  racePts('1', 'a', 25), racePts('2', 'b', 18),
]);
const sprint = numbered([racePts('1', 'a', 8), racePts('2', 'b', 7)]);
const c = cumulative(results, sprint, calendar);
assert.equal(c.last, 3);
assert.deepEqual(c.series.get('a'), [0, 25, 51, 76]);  // round 2 holds the sprint and the race
assert.deepEqual(c.series.get('b'), [0, 18, 51, 69]);
assert.deepEqual(reconcile(2024, c.series, [{'Driver.driverId': 'a', points: '76'}, {'Driver.driverId': 'b', points: '69'}]), {diffs: [], dropped: false});

// a sprint that's run before its race: the round is on the chart, its race still to come
assert.equal(cumulative(numbered([racePts('1', 'a', 25)]), numbered([racePts('1', 'a', 8)]), calendar).last, 2);

// what's left, in the 2024 rules: rounds 4, 5 + round 4's sprint
assert.deepEqual(maxRemaining(2024, calendar, 3, 1), {races: 2, sprints: 1, points: 26 + 26 + 8});
// the sprint has run, its race hasn't
assert.deepEqual(maxRemaining(2024, calendar, 3, 2), {races: 2, sprints: 0, points: 52});
assert.deepEqual(maxRemaining(2024, calendar, 5, 2), {races: 0, sprints: 0, points: 0});
assert.equal(maxRemaining(2014, Array.from({length: 19}, (_, i) => ({round: String(i + 1)})), 18, 0).points, 50);

// alive at the boundary: exactly the points left is alive, one more isn't
const a = alive(new Map([['lead', 100], ['edge', 40], ['out', 39.5]]), 60);
assert.deepEqual(a.get('lead'), {gap: 0, alive: true});
assert.deepEqual(a.get('edge'), {gap: 60, alive: true});
assert.deepEqual(a.get('out'), {gap: 60.5, alive: false});
assert.equal(alive(new Map([['a', 10], ['b', 10], ['c', 9]]), 0).get('b').alive, true);  // level at the flag: countback, not points
assert.equal(alive(new Map([['a', 10], ['b', 10], ['c', 9]]), 0).get('c').alive, false);

// dropped scores (1988): results add up to more than counted, so it says so instead of a wrong total
const scored = new Map([['prost', [0, 105]], ['senna', [0, 94]], ['berger', [0, 41]]]);
const st = [['senna', 90], ['prost', 87], ['berger', 41]].map(([id, points]) => ({'Driver.driverId': id, points: String(points)}));
const r88 = reconcile(1988, scored, st);
assert.equal(r88.dropped, true);
assert.deepEqual(r88.diffs.map(d => [d.id, d.scored, d.counted]), [['prost', 105, 87], ['senna', 94, 90]]);
// the same gap after 1990 can't be that rule (a lagging table, a penalty): reported, not called dropped
assert.equal(reconcile(2024, scored, st).dropped, false);
assert.equal(reconcile(2024, scored, st).diffs.length, 2);
assert.equal(reconcile(1988, new Map([['a', [0, 10]]]), [{'Driver.driverId': 'a', points: '10'}]).dropped, false);

// supertimes: the team's best lap of any session against the round's fastest
const s = (round, id, tid, Q1, Q2, Q3) => row(round, id, tid, id, 1, {Q1, Q2, Q3});
const sup = supertimes([
  s(1, 'a', 'x', '1:30.000', '1:29.000', '1:20.000'), s(1, 'b', 'x', '1:30.000', '1:29.000', '1:21.000'),
  s(1, 'c', 'y', '1:22.000'), s(1, 'd', 'y', '1:23.000'), s(1, 'e', 'z'),  // e: no time, no row
]);
assert.deepEqual(sup.teams.get('x').points, [[1, 0]]);
close(sup.teams.get('y').points[0][1], 100 * (82 / 80 - 1));
assert.equal(sup.teams.has('z'), false);
assert.equal(sup.rounds[0].wet, false);

// a wet round: the fastest is over 10 % off the median driver's best; exactly 10 % isn't over
const wet = supertimes([s(2, 'a', 'x', '1:30.000'), s(2, 'b', 'x', '1:41.000'), s(2, 'c', 'y', '1:42.000')]);
assert.equal(wet.rounds[0].round, 2);
assert.equal(wet.rounds[0].median, 101);
assert.equal(wet.rounds[0].wet, true);
assert.equal(supertimes([s(3, 'a', 'x', '1:30.000'), s(3, 'b', 'y', '1:40.000'), s(3, 'c', 'y', '1:40.000')]).rounds[0].wet, false);

console.log('season ok');

// as it stands: the live order's points on top of the standings; a car that is out scores nothing
{
  const {asItStands, SPRINT_POINTS} = await import('../src/static/season.js');
  const now = asItStands(new Map([['ANT', 390], ['NOR', 380], ['VER', 100]]), [{code: 'NOR', pos: 1}, {code: 'ANT', pos: 4}, {code: 'VER', pos: 2, out: true}, {code: 'BEA', pos: 3}]);
  assert.deepEqual(now.get('NOR'), {points: 405, rank: 1, was: 2});
  assert.deepEqual(now.get('ANT'), {points: 402, rank: 2, was: 1});
  assert.equal(now.get('VER').points, 100);
  assert.deepEqual(now.get('BEA'), {points: 15, rank: 4, was: null});
  assert.equal(asItStands(new Map(), [{code: 'A', pos: 1}], SPRINT_POINTS).get('A').points, 8);
}

// clinching at the next weekend (2024 rules; round 4 has a sprint: 34 on offer, 26 left after it)
{
  const {clinch} = await import('../src/static/season.js');
  assert.deepEqual(clinch(new Map([['a', 100], ['b', 90], ['c', 30]]), 2024, calendar, 3, 1),
    {round: 4, leader: 'a', rivals: [{id: 'b', by: 17, possible: true}]});  // c is 70 behind with 60 left: already out
  assert.equal(clinch(new Map([['a', 100], ['b', 50]]), 2024, calendar, 3, 1).rivals[0].by, -23);  // out after it whatever happens
  assert.equal(clinch(new Map([['a', 100], ['b', 100]]), 2024, calendar, 3, 1).rivals[0].possible, true);  // by 27 of 34
  assert.equal(clinch(new Map([['a', 100], ['b', 100]]), 2024, calendar, 3, 2).rivals[0].possible, false);  // by 27 of 26
  assert.equal(clinch(new Map([['a', 100], ['b', 90]]), 2024, calendar, 5, 2), null);  // season over
  assert.equal(clinch(new Map([['a', 100], ['b', 10]]), 2024, calendar, 3, 1), null);  // nobody else alive
}
