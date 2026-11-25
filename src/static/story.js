// The Why, pure: a real race as a short computed account of what decided it, on whatif.js's model. Each beat names a lap
// and a car, so the replay can open it. Verdicts on pit calls are the model's, in hindsight, with the rivals' real races.
import {simulate, tyre, PASS} from './whatif.js';
import {paceRanking, undercuts} from './pace.js';
import {neutralBands as calledBands} from './moments.js';
import {median} from './util.js';

const MIN_STINT = 3, MAX_STINT = 40;  // whatif.js has no tyre cliff, so a longer stint would flatter a plan
const MIN_SAVED = 1;                  // s: a smaller gain is inside what the lap-time fits can tell apart
const MAX_SHIFT = 10;                 // laps: further than this is hindsight, not a call anyone could have made
const FIELD = 10;                     // whose pit calls and undercuts are worth telling
const BEATS = 7;
export const AT_LAP_END = new Set(['cost', 'gain', 'slow', 'undercut', 'retired']);  // these happen as a lap ends, the rest as it starts
const CAPS = {neutral: 3, cost: 2, gain: 2, undercut: 2, slow: 2};  // or one kind fills the story: most of a field stops under one safety car
const SLOW_STOP = 3;                  // s over this race's typical stop
const OFF_TRACK = 30;                 // s: more than this on an in or out lap is an accident or a spin, not the stop
const PACE_TIE = 0.05;                // s/lap: closer is a tie
const PACE_GAP = 1;                   // s/lap: a wider gap between medians means they ran in different conditions
const RED_FLAG = 3;                   // a neutral lap this many typical laps long stopped the race

const pitted = (M, id, L) => M.stops[id].includes(L) || M.stops[id].includes(L - 1);
const typical = M => median(M.trend);
// every car's time, not M.trend: that leaves out cars stopping, and in a red flag nearly all of them do
const redLap = (M, L) => {
  const t = M.ids.map(id => M.times[id][L - 1]).filter(Boolean);
  return t.length > 0 && median(t) > typical(M) * RED_FLAG;
};
// tyres changed in a red flag aren't a pit call, and whatif.js can't move one: it would refund the whole stoppage
const redStop = (M, s) => redLap(M, s) || redLap(M, s + 1);
const order = (M, L) => M.ids.filter(id => M.cum[id][L - 1] !== undefined).sort((a, b) => M.cum[a][L - 1] - M.cum[b][L - 1]);

// who really held the lead: a car that inherits it when the leader stops, then gives it up by stopping itself, only ever
// kept it warm. pole: who it starts from. [{lap, from, to, how: 'track' | 'stops' | 'retired'}]
export function leadChanges(M, pole) {
  const runs = [];
  for (let L = 1; L <= M.n; L++) {
    const [lead] = order(M, L);
    if (lead && lead !== runs.at(-1)?.id) runs.push({id: lead, from: L});
  }
  runs.forEach((r, i) => { r.to = (runs[i + 1]?.from ?? M.n + 1) - 1; });
  const held = runs.filter((r, i) => i === 0 || i === runs.length - 1 || !pitted(M, r.id, r.to + 1));
  const out = [];
  let on = M.times[pole] ? pole : held[0]?.id, since = 1;  // since: the last lap `on` led, so an interim leader can't hide its stop
  for (const r of held) {
    if (r.id === on) { since = r.to; continue; }
    const last = M.times[on]?.length ?? 0;
    out.push({lap: r.from, from: on, to: r.id, how: last < r.from && last < M.n ? 'retired' : M.stops[on]?.some(s => s >= since - 1 && s <= r.from) ? 'stops' : 'track'});
    on = r.id;
    since = r.to;
  }
  return out;
}

// runs of slow laps: safety car, VSC, red flag or rain, which lap times can't tell apart. Lap 1 only if it was stopped: a
// standing start alone can read as slow.
export function neutralBands(M) {
  const out = [];
  M.neutral.forEach((n, i) => {
    if (!redLap(M, i + 1) && (!n || !i)) return;
    if (out.at(-1)?.to === i) out.at(-1).to = i + 1;
    else out.push({from: i + 1, to: i + 1});
  });
  return out;
}

// What race control really called, in lead laps. A GPS replay's feeds: rc [[t, category, flag, message]], laps [[start, id, lap, ...]]
export function flagLaps(rc, duration, laps) {
  const lapAt = t => laps.reduce((top, e) => (e[0] <= t && e[2] > top ? e[2] : top), 0);
  return calledBands(rc, duration).map(b => ({kind: b.kind, from: lapAt(b.t), to: lapAt(b.end)})).filter(f => f.from > 0);
}

// how much longer this stop took than the race's typical one, tyres aside
export const stopExcess = (M, id, s) => {
  const t = M.times[id], stops = M.stops[id];
  return t[s - 1] + t[s] - M.trend[s - 1] - M.trend[s] - tyre(M.fits[id], stops, s) - tyre(M.fits[id], stops, s + 1) - M.pitLoss;
};

// The smallest change to one pit call that would have finished this car higher: one stop moved, or one added under a
// neutralised lap. The real plan's finish is the road order, before penalties. null: no such change.
export function betterCall(M, id, pass = PASS.normal) {
  const stops = M.stops[id], n = M.times[id].length, real = simulate(M, id, stops, {pass});
  const fits = plan => [0, ...plan, n].every((s, i, a) => !i || (s - a[i - 1] >= (i === a.length - 1 ? 1 : MIN_STINT) && s - a[i - 1] <= MAX_STINT));
  const tries = [];
  if (stops.some(s => redStop(M, s))) return null;
  stops.forEach((from, k) => {
    for (let lap = Math.max(1, from - MAX_SHIFT); lap < Math.min(n, from + MAX_SHIFT + 1); lap++) {
      const plan = stops.toSpliced(k, 1, lap);
      if (lap !== from && !redStop(M, lap) && fits(plan.toSorted((a, b) => a - b))) tries.push({from, lap, plan, shift: Math.abs(lap - from)});
    }
  });
  for (let lap = 2; lap < n; lap++) {
    const plan = [...stops, lap].sort((a, b) => a - b);
    if (M.neutral[lap - 1] && !redStop(M, lap) && !stops.includes(lap) && fits(plan)) tries.push({from: null, lap, plan, shift: 0});
  }
  let best = null;
  for (const c of tries) {
    const r = simulate(M, id, c.plan, {pass}), saved = real.time - r.time;
    // a moved stop is timed at the typical stop, so a slow real one would read as the new lap's gain
    const slow = c.from === null ? 0 : Math.max(0, stopExcess(M, id, c.from));
    if (r.finish >= real.finish || saved - slow < MIN_SAVED) continue;
    if (!best || r.finish < best.finish || (r.finish === best.finish && c.shift < best.shift))
      best = {...c, finish: r.finish, was: real.finish, saved};
  }
  return best;
}

// A stop under a neutralised lap that beat stopping on the green laps either side of it. null: it didn't.
export function goodCall(M, id, pass = PASS.normal) {
  const stops = M.stops[id], real = simulate(M, id, stops, {pass});
  let best = null;
  stops.forEach((from, k) => {
    if (!M.neutral[from - 1] || redStop(M, from)) return;
    let a = from, b = from;
    while (M.neutral[a - 1]) a--;
    while (M.neutral[b - 1]) b++;
    const alts = [a, b].filter(l => l >= MIN_STINT && l < M.times[id].length && !stops.includes(l))
      .map(l => simulate(M, id, stops.toSpliced(k, 1, l), {pass}).finish);
    if (!alts.length) return;
    const gained = Math.min(...alts) - real.finish;
    if (gained > 0 && (!best || gained > best.gained)) best = {lap: from, gained, finish: real.finish};
  });
  return best;
}

// results: Jolpica rows, classified order. {headline, beats: [{lap, id, kind, text}], notes}
// flags: flagLaps' answer where known; null words a slow spell as lap times alone can
export function raceStory(M, results, {pass = PASS.normal, flags = null, limit = BEATS} = {}) {
  const ids = results.map(r => r['Driver.driverId']).filter(id => M.times[id]);
  const row = Object.fromEntries(results.map(r => [r['Driver.driverId'], r]));
  const name = id => row[id]?.['Driver.familyName'] ?? id;
  const list = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0]);
  const field = ids.slice(0, FIELD), rank = id => (ids.indexOf(id) + 1) || 99;
  const CAP = {...CAPS}, beats = [], add = (score, lap, id, kind, text, extra) => beats.push({score, lap, id, kind, text, ...extra});

  const pole = results.find(r => r.grid === '1')?.['Driver.driverId'] ?? ids[0];
  const hasStops = M.ids.some(id => M.stops[id].length);  // Jolpica has none before 2011
  const changes = leadChanges(M, pole);
  for (const c of changes) {
    const text = c.how === 'retired' ? `${name(c.to)} inherited the lead when ${name(c.from)} stopped running.`
      : c.how === 'stops' ? `${name(c.to)} came out of the pit stops ahead of ${name(c.from)} and took the lead.`
      : c.lap === 1 ? `${name(c.to)} took the lead from ${name(c.from)} at the start.`
      : !hasStops ? `${name(c.to)} took the lead from ${name(c.from)}.`
      : `${name(c.to)} took the lead from ${name(c.from)} on track.`;
    add(100, c.lap, c.to, 'lead', text);
  }

  for (const b of neutralBands(M)) {
    const before = order(M, Math.max(1, b.from - 1)), after = order(M, b.to), [p1, p2] = before;
    const gap = l => M.cum[p2][l - 1] - M.cum[p1][l - 1], called = flags?.filter(f => f.from <= b.to && f.to >= b.from).map(f => f.kind);
    const red = called?.includes('red') || M.trend.slice(b.from - 1, b.to).some((_, i) => redLap(M, b.from + i));
    const stopped = ids.filter(id => rank(id) <= FIELD && M.stops[id].some(s => s >= b.from && s <= b.to)).map(name);
    const who = stopped.length > 6 ? 'Most of the top ten' : list(stopped);
    const laps = b.to > b.from ? `laps ${b.from}–${b.to}` : `lap ${b.from}`;
    const what = red ? `A red flag on ${laps}` : called?.includes('sc') ? `The safety car on ${laps}` : called?.includes('vsc') ? `The VSC on ${laps}`
      : `The field slowed on ${laps} ${called ? 'with no safety car called' : '(safety car, VSC or rain)'}, which`;
    const under = called && !called.length ? 'stopped then' : 'stopped under it';
    const shrank = b.from > 1 && p1 && p2 && M.cum[p2][b.to - 1] !== undefined && gap(b.from - 1) - gap(b.to) >= MIN_SAVED && after[0] === p1
      ? ` cut ${name(p1)}'s lead over ${name(p2)} from ${gap(b.from - 1).toFixed(1)} s to ${gap(b.to).toFixed(1)} s.` : red ? ' stopped the race.' : ' bunched the race up.';
    if (!stopped.length && !red && !shrank.startsWith(' cut')) continue;  // a slow lap that changed nothing
    add(75, b.from, p1, 'neutral',
      `${what}${shrank}${stopped.length ? ` ${who} ${red ? 'changed tyres' : under}.` : ''}`,
      {band: {to: b.to, kind: red ? 'red' : called?.includes('sc') ? 'sc' : called?.includes('vsc') ? 'vsc' : 'slow'}});
  }

  for (const r of results) {  // gone before finishing a lap, so no lap times to go on
    const id = r['Driver.driverId'];
    if (!M.times[id]?.length && +r.grid >= 1 && +r.grid <= 5) add(85 - +r.grid * 5, 1, id, 'retired', `${name(id)} went out on lap 1 from P${r.grid} on the grid${r.status ? ` (${r.status})` : ''}.`);
  }
  for (const id of ids) {  // running near the front, then gone
    const last = M.times[id].length;
    if (last >= M.n - 2) continue;
    const pos = order(M, last).indexOf(id) + 1;
    if (pos && pos <= 3) add(85 - pos * 5, last, id, 'retired', `${name(id)} went out from P${pos}${row[id]?.status ? ` (${row[id].status})` : ''}.`);
  }

  for (const id of hasStops ? field : []) {
    for (const s of M.stops[id]) {
      const over = M.neutral[s - 1] || M.neutral[s] || redStop(M, s) ? 0 : stopExcess(M, id, s);
      if (over >= SLOW_STOP && over <= OFF_TRACK) add(50 - 3 * rank(id), s, id, 'slow', `${name(id)}'s stop on lap ${s} took about ${over.toFixed(0)} s longer than this race's typical stop.`);
    }
    const c = betterCall(M, id, pass);
    if (c) {
      const gain = `P${c.was} to P${c.finish}`, verb = c.from === null ? `An extra stop while the field was slowed on lap ${c.lap}` : `Stopping on lap ${c.lap} instead of ${c.from}`;
      add(55 + 8 * (c.was - c.finish) - 3 * c.was, c.from ?? c.lap, id, 'cost',
        `${verb} would have taken ${name(id)} from ${gain}, ${c.saved.toFixed(1)} s better over the race.`);
    }
    const g = goodCall(M, id, pass);
    if (g) add(55 + 8 * g.gained - 3 * g.finish, g.lap, id, 'gain',
      `${name(id)}'s stop on lap ${g.lap}, with the field slowed, was worth ${g.gained} place${g.gained > 1 ? 's' : ''} over stopping just before or after.`);
  }

  const undercutters = new Set();
  for (const u of undercuts(M)) {
    if (!u.worked || rank(u.a) > FIELD || !row[u.b] || undercutters.has(u.a)) continue;
    undercutters.add(u.a);
    add(45 - 3 * Math.min(rank(u.a), rank(u.b)), u.lapA, u.a, 'undercut',
      `${name(u.a)} undercut ${name(u.b)}: in on lap ${u.lapA}, ${name(u.b)} on ${u.lapB}, from ${u.before.toFixed(1)} s behind to ${(-u.after).toFixed(1)} s ahead.`);
  }

  const winner = ids[0], led = Array.from({length: M.n}, (_, i) => order(M, i + 1)[0]).filter(id => id === winner).length;
  const margin = ids[1] && M.times[ids[1]].length === M.times[winner].length ? M.cum[ids[1]].at(-1) - M.cum[winner].at(-1) : null;
  const headline = `${name(winner)} won${margin > 0 ? ` by ${margin.toFixed(1)} s` : ''}, leading ${led} of ${M.n} laps.`;

  const notes = hasStops ? [] : ['No pit stop records for this race, so pit calls and undercuts are left out.'];
  const pace = paceRanking(M).filter(r => r.n >= M.n / 2 && rank(r.id) < 99);
  if (pace[0] && pace[1] && pace[0].id !== winner && pace[1].median - pace[0].median < PACE_GAP && pace[1].median - pace[0].median >= PACE_TIE)
    notes.push(`${name(pace[0].id)} had the best median clean lap, ${(pace[1].median - pace[0].median).toFixed(2)} s a lap over ${name(pace[1].id)}, and finished P${rank(pace[0].id)}.`);
  const road = simulate(M, winner, M.stops[winner], {pass}).order[0].id;
  if (road !== winner) notes.push(`${name(road)} was first on the road; the result came after penalties or a disqualification.`);

  return {headline, notes,
    beats: beats.sort((a, b) => b.score - a.score).filter(b => !CAP[b.kind] || CAP[b.kind]-- > 0).slice(0, limit).sort((a, b) => a.lap - b.lap).map(({score, ...b}) => b)};
}
