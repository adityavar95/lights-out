// Race Highlights, pure: the moments of a GPS race worth seeing, as a playlist of race-time clips that fits a budget of
// real seconds at 1x. The start, the flag, red flags and lead changes come first, then safety cars, then passes for
// the top five. replay.js plays it.
import {leadChanges, neutralBands} from './moments.js';

const NEUTRAL_NAME = {sc: 'Safety car', vsc: 'Virtual safety car', red: 'Red flag'};
const RANK = {start: 0, finish: 0, red: 1, restart: 1, lead: 2, sc: 3, vsc: 3, pass: 4};
const SHORTEST = 3;  // s: what's left of a clip trimmed by the one before can be too short to read its caption

// [{t, id, other, p}]: a car took P`p` (2 to 5) from `other` on the road. The position feed also moves cars through the
// pits, under a safety car, when a car ahead retires and for a moment when it flickers, so those are left out.
export function passes(data, from, bands = []) {
  const pos = {}, rows = data.positions ?? [], pits = data.pits ?? [], out = [];
  const pitted = (id, t) => pits.some(([at, who]) => who === id && at > t - 45 && at < t + 15);
  for (let i = 0; i < rows.length;) {
    const t = rows[i][0], before = {...pos}, moved = [];
    for (; i < rows.length && rows[i][0] === t; i++) { pos[rows[i][1]] = rows[i][2]; moved.push(rows[i]); }
    if (t < from + 45 || bands.some(b => t > b.t - 5 && t < b.end + 20)) continue;  // the start is its own clip
    for (const [, id, p] of moved) {
      if (!(before[id] > p) || p < 2 || p > 5) continue;
      const other = Object.keys(before).find(k => before[k] === p);
      const undone = rows.some(([at, who, q]) => who === id && at > t && at < t + 20 && q > p);
      if (!other || undone || pitted(id, t) || pitted(other, t)) continue;
      if (pos[other] === undefined || pos[other] <= p) continue;  // the other car didn't drop: a shuffle elsewhere
      out.push({t, id, other, p});
    }
  }
  return out;
}

// whose race ended just before a safety car, the likely reason for it, nearest first. A car's last lap has no duration
// when it never finished it, so its start stands in.
function stoppedBefore(laps, t, total) {
  const last = new Map();
  for (const [at, id, lap, dur] of laps) last.set(id, {lap, end: at + (dur ?? 0)});
  return [...last].filter(([, {lap, end}]) => lap < total - 2 && end > t - 180 && end < t + 20)
    .sort((a, b) => b[1].end - a[1].end).map(([id]) => id);
}

// a red flag's restart: where most cars next start a lap once the session is back on (a few cross the line earlier, leaving
// the pit lane for the formation lap), and the first car to do it from there
function restarts(data, bands) {
  return bands.filter(b => b.kind === 'red' && b.end < data.duration).flatMap(b => {
    const next = new Map();
    for (const [at, id] of data.laps ?? []) if (at > b.end && !next.has(id)) next.set(id, at);
    const times = [...next.values()].sort((x, y) => x - y), mid = times[times.length >> 1];
    if (!times.length) return [];
    const go = [...next].filter(([, at]) => at > mid - 30).sort((x, y) => x[1] - y[1])[0];
    return [{t: go[1], id: go[0]}];
  });
}

// the moment the winner took the flag: the first end of the last lap, else the chequered flag's message
function flagAt(data) {
  const ends = (data.laps ?? []).filter(l => l[2] === data.total_laps && l[3]).map(l => ({t: l[0] + l[3], id: l[1]}));
  if (ends.length) return ends.reduce((a, b) => (b.t < a.t ? b : a));
  const flag = (data.race_control ?? []).find(r => r[2] === 'CHEQUERED');
  return flag ? {t: flag[0], id: null} : {t: data.duration, id: null};
}

// from: lights out. [{t0, t1, kind, id (the car to watch, or null), text, lap}] in race order, never overlapping.
export function highlightReel(data, from, budget = 300) {
  const name = id => data.drivers?.find(d => d.id === id)?.code ?? id, laps = data.laps ?? [];
  const bands = neutralBands(data.race_control ?? [], data.duration).filter(b => b.t >= from);
  const pole = (data.positions ?? []).filter(r => r[0] <= from && r[2] === 1).at(-1)?.[1] ?? null, flag = flagAt(data);
  const clips = [
    {at: from, t0: from - 6, t1: from + 40, kind: 'start', id: pole, text: 'Lights out'},
    {at: flag.t, t0: flag.t - 25, t1: flag.t + 6, kind: 'finish', id: flag.id, text: flag.id ? `${name(flag.id)} takes the flag` : 'The flag'},
    ...leadChanges(data.positions ?? [], from + 45).map(c => ({at: c.t, t0: c.t - 10, t1: c.t + 8, kind: 'lead', id: c.id, text: `${name(c.id)} takes the lead`})),
    ...bands.map((b, i) => {
      // a flag on top of a safety car still out for the same incident: that clip showed it, so just the moment
      if (b.t - (bands[i - 1]?.end ?? -Infinity) < 60) return {at: b.t, t0: b.t - 6, t1: b.t + 6, kind: b.kind, id: null, text: NEUTRAL_NAME[b.kind]};
      const out = stoppedBefore(laps, b.t, data.total_laps);  // an incident comes before its flag
      return {at: b.t, t0: b.t - 20, t1: b.t + 8, kind: b.kind, id: out[0] ?? null,
              text: NEUTRAL_NAME[b.kind] + (out.length ? ` · ${out.map(name).join(', ')} ${out.length > 1 ? 'are' : 'is'} out` : '')};
    }),
    ...restarts(data, bands).map(r => ({at: r.t, t0: r.t - 8, t1: r.t + 30, kind: 'restart', id: r.id, text: 'The restart'})),
    ...passes(data, from, bands).sort((a, b) => a.p - b.p || b.t - a.t).map(x => ({at: x.t, t0: x.t - 10, t1: x.t + 6, kind: 'pass', id: x.id, p: x.p,
      text: `${name(x.id)} passes ${name(x.other)} for P${x.p}`})),
  ].map(c => ({...c, t0: Math.max(0, c.t0), t1: Math.min(data.duration, c.t1)}));

  let left = budget;
  const chosen = clips.map((c, i) => [c, i]).sort(([a, i], [b, j]) => RANK[a.kind] - RANK[b.kind] || i - j).map(([c]) => c)
    .filter(c => (c.t1 - c.t0 <= left ? (left -= c.t1 - c.t0, true) : false));
  const out = [];
  for (const c of chosen.sort((a, b) => a.t0 - b.t0)) {
    const prev = out.at(-1);
    if (prev && c.t1 <= prev.t1) continue;  // wholly inside the one before
    if (prev && c.t0 < prev.t1) c.t0 = prev.t1;  // runs straight on from it
    if (c.t1 - c.t0 >= SHORTEST) out.push(c);
  }
  return out.map(c => ({...c, lap: laps.reduce((n, l) => (l[0] <= c.t0 + 10 && l[2] > n ? l[2] : n), 0)}));
}

// The camera cuts for a clip, as a broadcast director would cut it: [{at, cam}] with `at` in seconds from the clip's start,
// the replay's cameras only. Establish from the helicopter for the start, restarts and neutralisations; stay on the car for
// a lead change; for a pass, chase, then the T-cam as it pulls alongside, back to chase after; the flag from the car, then
// the helicopter as it falls. No shot runs past MAX_SHOT s: a longer one swaps between chase and T-cam.
const MAX_SHOT = 8;
export function shotsFor(clip) {
  const len = clip.t1 - clip.t0, ev = Math.min(len, Math.max(0, (clip.at ?? clip.t0) - clip.t0));
  const plan = {
    start: [[0, 'heli'], [8, 'chase']], restart: [[0, 'heli'], [6, 'chase']],
    sc: [[0, 'heli']], vsc: [[0, 'heli']], red: [[0, 'heli']],
    pass: [[0, 'chase'], [Math.max(0, ev - 3), 'tcam'], [ev + 3, 'chase']],
    finish: [[0, 'chase'], [Math.max(0, ev - 3), 'heli']],
  }[clip.kind] ?? [[0, 'chase']];
  const cuts = plan.filter(([at], i) => i === 0 || at < len).map(([at, cam], i) => ({at: i === 0 ? 0 : at, cam}));
  const out = [];
  cuts.forEach((c, i) => {
    const end = cuts[i + 1]?.at ?? len;
    for (let at = c.at, k = 0; at < end || k === 0; at += MAX_SHOT, k++) {
      const cam = c.cam === 'heli' ? 'heli' : k % 2 ? (c.cam === 'chase' ? 'tcam' : 'chase') : c.cam;  // long shots swap chase and T-cam
      if (out.at(-1)?.cam !== cam) out.push({at, cam});
    }
  });
  return out;
}
