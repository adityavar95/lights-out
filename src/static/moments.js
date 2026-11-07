// Key moments of a GPS race replay, pure: neutralised stretches and lead changes, for the scrubber's marks and the , . keys.
import {trackStatus} from './util.js';

const KIND = {SC: 'sc', 'SC IN': 'sc', VSC: 'vsc', 'VSC ENDING': 'vsc', RED: 'red'};
export const KIND_NAME = {sc: 'Safety car', vsc: 'Virtual safety car', red: 'Red flag', lead: 'Lead change'};
const COLOR = {sc: '#ffc800', vsc: '#ffe680', slow: '#ffc800', red: '#ff2d38', lead: '#fff'};
const SETTLE = 5;  // s a new leader must last: the position feed flickers around pit stops

// rc: [[t, category, flag, message]]. Runs of one kind as {kind, t, end}; a run still open at the end of the data ends there.
export function neutralBands(rc, duration) {
  const out = [];
  let open = null;
  for (const [t] of rc) {
    const kind = KIND[trackStatus(rc, t)] ?? null;
    if (open && open.kind !== kind) { open.end = t; open = null; }
    if (kind && !open) out.push(open = {kind, t, end: duration});
  }
  return out;
}

// positions: [[t, id, position]] by time. Who took P1 and held it, from `from` (lights out) on.
export function leadChanges(positions, from) {
  const flips = [];
  let on = null;
  for (const [t, id, pos] of positions) if (pos === 1 && id !== on) { flips.push({t, id}); on = id; }
  const out = [];
  let leader = null;
  flips.forEach((f, i) => {
    if ((flips[i + 1]?.t ?? Infinity) - f.t < SETTLE || f.id === leader) return;
    if (f.t >= from && leader !== null) out.push({kind: 'lead', t: f.t, id: f.id});
    leader = f.id;
  });
  return out;
}

// The moment after (dir 1) or before (dir -1) t. A jump lands a few seconds before its moment, so going forward looks
// past where it just landed and going back past what it just jumped to, or neither key could ever leave one.
export function nextMoment(moments, t, dir, lead = 4) {
  if (dir > 0) return moments.find(x => x.t > t + lead) ?? null;
  return moments.findLast(x => x.t < t - 1) ?? null;
}

// CSS background for the scrubber's track: a band per neutral stretch, a tick per lead change
export function marksGradient(moments, duration) {
  if (!moments.length || !duration) return 'none';
  const at = t => `${(t / duration * 100).toFixed(2)}%`;
  return moments.map(x => {
    const end = x.kind === 'lead' ? `calc(${at(x.t)} + 2px)` : at(x.end);
    return `linear-gradient(90deg, transparent ${at(x.t)}, ${COLOR[x.kind]} ${at(x.t)}, ${COLOR[x.kind]} ${end}, transparent ${end})`;
  }).join(',');
}
