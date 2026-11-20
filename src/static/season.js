// Season analysis, pure (no DOM): teammate head-to-heads, cumulative points, who can still win, qualifying supertimes.
// Rows are Jolpica's flattened season tables; those carry no round, so callers number them first: `numbered` (drivers.js)
// for results and sprints, `qualiRounds` below for qualifying.
import {signed} from './util.js';

const driver = r => r['Driver.driverId'];
const team = r => r['Constructor.constructorId'];
const sum = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);

export function secs(t) {  // '1:23.456' or '59.8' -> seconds, null without a time
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t ?? '');
  return m ? +(m[1] ?? 0) * 60 + +m[2] : null;
}

export function median(a) {
  const s = [...a].sort((x, y) => x - y), i = s.length >> 1;
  return !s.length ? null : s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

// Why not `numbered` here: where a race straddles two of Jolpica's 100-row pages its qualifying rows arrive out of
// position order (2024 gave 26 "rounds" of 24 by position drops), so a drop doesn't mean a new race. A driver can't
// qualify twice in one race and there's only one pole, so either repeating does.
export function qualiRounds(rows) {
  let round = 1, seen = new Set();
  return rows.map(r => {
    if (seen.has(driver(r)) || (seen.has('P1') && +r.position === 1)) { round++; seen = new Set(); }
    seen.add(driver(r));
    if (+r.position === 1) seen.add('P1');
    return {...r, round};
  });
}

// Each round's teammate pairs. Exactly two cars and two drivers: a third row means either a shared drive (one car, the
// 1950s) or customers of the same chassis (Cooper in the 1960s), and nothing in the rows tells those from a works team.
function pairs(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.round}/${team(r)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].filter(g => g.length === 2 && driver(g[0]) !== driver(g[1]) && g[0].number !== g[1].number);
}

// Teammate records per driver, by round so a mid-season swap makes two records rather than one muddled one:
// Map driverId -> [{mate, rounds, q: {wins, losses, n, gap}, r: {wins, losses, n}}], longest partnership first.
// q.gap: this driver's median % gap, negative = quicker; a median because one wet or wrecked lap would swing a mean.
export function teammates(results, quali) {
  const all = new Map();
  const rec = (a, b, round) => {
    const mates = all.get(a) ?? all.set(a, new Map()).get(a);
    const x = mates.get(b) ?? mates.set(b, {mate: b, seen: new Set(), gaps: [], q: {wins: 0, losses: 0}, r: {wins: 0, losses: 0, n: 0}}).get(b);
    x.seen.add(round);
    return x;
  };
  const score = (mine, theirs, s) => { if (mine < theirs) s.wins++; else if (mine > theirs) s.losses++; };
  for (const [a, b] of pairs(results)) {
    for (const [me, other] of [[a, b], [b, a]]) {
      const x = rec(driver(me), driver(other), me.round);
      // a numeric positionText is classified; position alone ranks retirements too, which says nothing about pace
      if (!/^\d+$/.test(me.positionText) || !/^\d+$/.test(other.positionText)) continue;
      x.r.n++;
      score(+me.position, +other.position, x.r);
    }
  }
  for (const [a, b] of pairs(quali)) {
    // the last session both reached: earlier ones were banker laps, not the two cars' best against each other
    const session = ['Q3', 'Q2', 'Q1'].find(s => secs(a[s]) && secs(b[s]));
    for (const [me, other] of [[a, b], [b, a]]) {
      const x = rec(driver(me), driver(other), me.round);
      if (!session) continue;
      const mine = secs(me[session]), theirs = secs(other[session]);
      x.gaps.push(100 * (mine / theirs - 1));
      score(mine, theirs, x.q);
    }
  }
  return new Map([...all].map(([id, mates]) => [id, [...mates.values()]
    .map(({mate, seen, gaps, q, r}) => ({mate, rounds: seen.size, q: {...q, n: gaps.length, gap: median(gaps)}, r}))
    .sort((a, b) => b.rounds - a.rounds)]));
}

export const fmtGap = g => `${signed(g, 2, '')} %`;

// the driver card's line: the longest partnership, the others counted (the career dialog lists them)
export function h2hLine(records, nameOf) {
  const [x, ...more] = (records ?? []).filter(m => m.q.n || m.r.n);
  if (!x) return '';
  return [`vs ${nameOf(x.mate)}`, x.q.n && `Q ${x.q.wins}–${x.q.losses} (${fmtGap(x.q.gap)})`, x.r.n && `R ${x.r.wins}–${x.r.losses}`,
    more.length && `+${more.length}`].filter(Boolean).join(' · ');
}

// The most one driver can score, from the sporting regulations as summarised at
// en.wikipedia.org/wiki/List_of_Formula_One_World_Championship_points_scoring_systems, checked against the highest
// points in Jolpica's own results for 1950, 1961, 1991, 2010, 2014, 2019, 2021-2026: 8 + fastest lap to 1959, 8 in 1960,
// 9 to 1990, 10 to 2009, 25 from 2010, 25 + fastest lap 2019-2024, the point scrapped from 2025. A driver can take it all,
// so the fastest-lap point counts although it needs a top-ten finish. The 2014 finale paid double.
export function raceMax(year, round, rounds) {
  if (year === 2014 && round === rounds) return 50;
  if (year <= 1959) return 9;
  if (year === 1960) return 8;
  if (year <= 1990) return 9;
  if (year <= 2009) return 10;
  return year >= 2019 && year <= 2024 ? 26 : 25;
}
export const sprintMax = year => (year < 2021 ? 0 : year === 2021 ? 3 : 8);  // same source

// Points by finishing position since 2010 (a sprint's since 2022): the live table below is always this season's
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

// The championship if the session ended now. before: Map code -> points going in; board: [{code, pos, out}], the order
// on track. Returns Map code -> {points, rank, was}. A car that is out scores nothing (a classified retirement can, rarely).
export function asItStands(before, board, table = POINTS) {
  const now = new Map(before);
  for (const b of board) now.set(b.code, (now.get(b.code) ?? 0) + (b.out ? 0 : table[b.pos - 1] ?? 0));
  const rank = m => new Map([...m].sort((a, b) => b[1] - a[1]).map(([c], i) => [c, i + 1]));
  const was = rank(before), is = rank(now);
  return new Map([...now].map(([c, points]) => [c, {points, rank: is.get(c), was: was.get(c) ?? null}]));
}

// A sprint's rows number 1, 2, 3... by sprint; the calendar says which weekends those were
const sprintWeekends = calendar => calendar.filter(c => c['Sprint.date']).map(c => +c.round);

// Points after each round per driver, from numbered race and sprint rows: Map driverId -> [0, after round 1, ...].
// last: the latest round with anything scored (its sprint may have run before its race).
export function cumulative(results, sprint, calendar) {
  const weekends = sprintWeekends(calendar), gained = new Map();
  const add = (r, round) => {
    const m = gained.get(driver(r)) ?? gained.set(driver(r), new Map()).get(driver(r));
    sum(m, round, +r.points || 0);
  };
  for (const r of results) add(r, r.round);
  for (const r of sprint) add(r, weekends[r.round - 1] ?? r.round);
  const last = Math.max(0, ...[...gained.values()].flatMap(m => [...m.keys()]));
  const series = new Map([...gained].map(([id, m]) => {
    let t = 0;
    return [id, Array.from({length: last + 1}, (_, i) => (t += m.get(i) ?? 0))];
  }));
  return {last, series};
}

// What's still on offer: every race beyond racesRun, every sprint beyond sprintsRun
export function maxRemaining(year, calendar, racesRun, sprintsRun) {
  const rounds = calendar.length, races = calendar.filter(c => +c.round > racesRun), sprints = sprintWeekends(calendar).slice(sprintsRun);
  return {races: races.length, sprints: sprints.length,
    points: races.reduce((t, c) => t + raceMax(year, +c.round, rounds), 0) + sprints.length * sprintMax(year)};
}

// What settles the title at the next race weekend: the leader is champion once the lead is more than everything left
// after it. Returns null when nothing is left or nobody else is alive, else {round, leader, rivals: [{id, by, possible}]}:
// the leader must outscore each rival by `by` points that weekend (0 or less: that rival is already out of reach after
// it whatever happens); possible is false when the weekend doesn't offer that many.
export function clinch(totals, year, calendar, racesRun, sprintsRun) {
  const next = calendar.find(c => +c.round === racesRun + 1), now = maxRemaining(year, calendar, racesRun, sprintsRun);
  if (!next || !totals.size) return null;
  const sprintToCome = sprintWeekends(calendar).indexOf(+next.round) >= sprintsRun;
  const offer = raceMax(year, +next.round, calendar.length) + (sprintToCome ? sprintMax(year) : 0), after = now.points - offer;
  const [[leader, top], ...rest] = [...totals].sort((a, b) => b[1] - a[1]);
  const rivals = rest.filter(([, p]) => top - p <= now.points).map(([id, p]) => {
    const by = Math.floor(after - (top - p)) + 1;
    return {id, by, possible: by <= offer};
  });
  return rivals.length ? {round: +next.round, leader, rivals} : null;
}

// alive: leader − driver ≤ points remaining. A tie at the very end stays alive: countback isn't points.
export function alive(totals, remaining) {
  const leader = Math.max(0, ...totals.values());
  return new Map([...totals].map(([id, p]) => [id, {gap: leader - p, alive: leader - p <= remaining}]));
}

// Scored against official: before 1991 only a driver's best results counted (and the rule varied by year, split seasons
// included), so adding up results overshoots the standings. This finds it in the numbers, and which drivers it hit;
// dropped says it's that rule, and not a late penalty or standings that lag the latest race.
export function reconcile(year, series, standings) {
  const diffs = standings.map(s => ({id: driver(s), scored: series.get(driver(s))?.at(-1) ?? 0, counted: +s.points}))
    .filter(d => Math.abs(d.scored - d.counted) > .01).sort((a, b) => Math.abs(b.scored - b.counted) - Math.abs(a.scored - a.counted));
  return {diffs, dropped: year <= 1990 && diffs.length > 0};
}

// Supertime: a team's best lap of the whole of qualifying against the round's fastest, 100·(best/fastest − 1), which
// compares across circuits where seconds can't. wet: the fastest lap is over 10 % off the median driver's best. That
// spread only opens when conditions change under the field (Zandvoort 2023), which is when the number stops measuring
// the car; a session wet throughout keeps a normal spread (Spa 2021) and a fair comparison, so it isn't flagged.
export function supertimes(quali) {
  const byRound = new Map(), teams = new Map();
  for (const r of quali) {
    const best = Math.min(...['Q1', 'Q2', 'Q3'].map(s => secs(r[s]) ?? Infinity));
    if (best < Infinity) byRound.set(r.round, [...(byRound.get(r.round) ?? []), {id: team(r), name: r['Constructor.name'], best}]);
  }
  const rounds = [...byRound].map(([round, rows]) => {
    const fastest = Math.min(...rows.map(x => x.best)), mid = median(rows.map(x => x.best)), bests = new Map();
    for (const x of rows) bests.set(x.id, Math.min(x.best, bests.get(x.id) ?? Infinity));
    for (const [id, b] of bests) {
      const t = teams.get(id) ?? teams.set(id, {name: rows.find(x => x.id === id).name, points: []}).get(id);
      t.points.push([round, 100 * (b / fastest - 1)]);
    }
    return {round, fastest, median: mid, wet: 1 - fastest / mid > .1};
  });
  return {rounds, teams};
}
