// Strategy Lab model: a real race replayed from Jolpica lap times (1996+) with one driver's pit stops moved. Pure.
// Each lap time = the field's median lap (fuel, track evolution) + the driver's tyre term a + b·age, fitted per stint;
// moving a stop swaps the tyre terms and pit losses of the laps it touches and leaves every other lap as it really was,
// so the actual plan reproduces the actual race exactly. Other cars keep their real race. Under SC/VSC the field closes
// up, so the time the driver gained or lost shrinks lap by lap like the real gaps did (why a stop there is cheap).
// shortcut: no tyre cliff, compounds or fuel loads (refuelling era) and other cars don't react; it ranks plans, it
// doesn't predict a race to the tenth.
import {clamp} from './telemetry.js';

const secs = s => String(s).split(':').reduce((a, p) => a * 60 + +p, 0);
const median = a => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};
export const SC_LOSS = 0.5;   // a stop under SC/VSC costs about half: the field laps slowly meanwhile
const NEUTRAL = 1.1;          // a lap whose field median is 10 % over the race's typical lap is neutralised
const GAP = 0.3;              // s behind a car the driver can't pass
const DEG = 0.05;             // s/lap when a stint has too few clean laps to fit
export const PASS = {easy: 0.3, normal: 0.7, hard: 1.5};  // pace edge (s/lap) needed to pass on track

// least-squares residual = a + b·age, after dropping laps 2 s off the median (traffic, mistakes, damage);
// fallback: the driver's median residual, for a stint too short to fit
function fitLine(pts, fallback) {
  const m = median(pts.map(p => p[1]));
  pts = pts.filter(p => Math.abs(p[1] - m) < 2);
  if (pts.length < 4) return {a: fallback, b: DEG, n: pts.length};
  const n = pts.length, ma = pts.reduce((s, p) => s + p[0], 0) / n, mr = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - ma) ** 2, 0), sxy = pts.reduce((s, p) => s + (p[0] - ma) * (p[1] - mr), 0);
  const b = clamp(sxx ? sxy / sxx : DEG, 0, 0.3);
  return {a: mr - b * ma, b, n};
}

// the stint a lap is in under a plan, and the tyres' age on it (0 on the out-lap)
function stintAt(stops, L) {
  let k = 0;
  while (k < stops.length && stops[k] < L) k++;
  return [k, L - (k ? stops[k - 1] : 0) - 1];
}
const pitting = (stops, L) => stops.includes(L) || stops.includes(L - 1);  // in-lap or out-lap

// laps, pits: Jolpica rows ({number, driverId, position, time}, {driverId, lap})
export function raceModel(laps, pits) {
  const times = {};
  for (const l of laps) (times[l.driverId] ??= [])[+l.number - 1] = secs(l.time);
  const ids = Object.keys(times);
  for (const id of ids) {  // a missing lap ends the usable record
    const hole = Array.from(times[id], t => t > 0).indexOf(false);
    if (hole >= 0) times[id].length = hole;
  }
  const stops = Object.fromEntries(ids.map(id => [id, []]));
  for (const p of pits) if (stops[p.driverId] && +p.lap < times[p.driverId].length) stops[p.driverId].push(+p.lap);
  for (const id of ids) stops[id] = [...new Set(stops[id])].sort((a, b) => a - b);
  const n = Math.max(...ids.map(id => times[id].length));
  const trend = Array.from({length: n}, (_, i) =>
    median(ids.filter(id => times[id][i] && !pitting(stops[id], i + 1)).map(id => times[id][i])));
  const typical = median(trend.slice(1).filter(Number.isFinite));
  for (let i = 0; i < n; i++) if (!Number.isFinite(trend[i])) trend[i] = trend[i - 1] ?? typical;  // everyone pitted
  const neutral = trend.map(t => t > typical * NEUTRAL);
  const fits = {}, losses = [];
  for (const id of ids) {
    const t = times[id], b = [0, ...stops[id], t.length];
    const stints = b.slice(0, -1).map((start, k) => {
      const pts = [];
      for (let L = start + 1; L <= b[k + 1]; L++)
        if (L > 1 && !neutral[L - 1] && !pitting(stops[id], L)) pts.push([L - start - 1, t[L - 1] - trend[L - 1]]);
      return pts;
    });
    const all = median(stints.flat().map(p => p[1]));
    fits[id] = stints.map(pts => fitLine(pts, Number.isFinite(all) ? all : 0));
    for (const s of stops[id]) if (s > 1 && s < t.length && !neutral[s - 1] && !neutral[s])
      losses.push(t[s - 1] + t[s] - trend[s - 1] - trend[s] - tyre(fits[id], stops[id], s) - tyre(fits[id], stops[id], s + 1));
  }
  const cum = Object.fromEntries(ids.map(id => [id, times[id].reduce((a, x) => (a.push((a.at(-1) ?? 0) + x), a), [])]));
  // how much the gaps to the leader shrank on each neutralised lap (1 on green laps): median over cars within a lap
  const lead = i => Math.min(...ids.map(id => cum[id][i] ?? Infinity));
  const squeeze = neutral.map((ntrl, i) => {
    if (!ntrl || !i) return 1;
    const r = ids.map(id => [cum[id][i] - lead(i), cum[id][i - 1] - lead(i - 1)])
      .filter(([g, g0]) => g0 > 1 && g0 < typical && Number.isFinite(g)).map(([g, g0]) => g / g0);
    return r.length ? clamp(median(r), 0, 1) : 1;
  });
  return {ids, times, stops, trend, neutral, squeeze, fits, cum, n,
          pitLoss: losses.length ? Math.max(5, median(losses)) : 22};
}

function tyre(fits, stops, L) {
  const [k, age] = stintAt(stops, L), f = fits[Math.min(k, fits.length - 1)];
  return f.a + f.b * age;
}

// The race with driver `id` stopping at the end of each lap in `plan`. pass: pace edge needed to pass on track (null:
// no traffic). Only passes that didn't happen in reality need it, so the actual plan gives the actual race.
export function simulate(M, id, plan, {pass = PASS.normal} = {}) {
  plan = [...new Set(plan)].filter(s => s >= 1 && s < M.times[id].length).sort((a, b) => a - b);
  const t = M.times[id], orig = M.stops[id], f = M.fits[id];
  const removed = orig.filter(s => !plan.includes(s)), added = new Set(plan.filter(s => !orig.includes(s)));
  const laps = [], cum = [];
  let c = 0;
  for (let L = 1; L <= t.length; L++) {
    const i = L - 1, ntrl = M.neutral[i], scStop = s => M.neutral[s - 1];
    // that lap without a stop made on it: a green stop's in/out laps at the model's pace, an SC stop refunded
    let lt = removed.some(s => !scStop(s) && (L === s || L === s + 1)) ? M.trend[i] + tyre(f, orig, L) : t[i];
    if (removed.some(s => scStop(s) && L === s)) lt -= M.pitLoss * SC_LOSS;
    if (L > 1 && !ntrl) lt += tyre(f, plan, L) - tyre(f, orig, L);       // under SC everyone laps at the same pace
    if (added.has(L)) lt += M.pitLoss * (ntrl ? SC_LOSS : 1);
    if (ntrl && L > 1) lt = M.cum[id][i] + (c - M.cum[id][i - 1]) * M.squeeze[i] + lt - t[i] - c;  // the queue closes up
    if (pass !== null && L > 1 && !ntrl && !pitting(plan, L)) {
      let stuck = -Infinity;
      for (const o of M.ids) {
        const co = M.cum[o][i];
        if (o === id || co === undefined || pitting(M.stops[o], L)) continue;
        const passes = cum[i - 1] > M.cum[o][i - 1] && c + lt < co, didInReality = M.cum[id][i] < co;
        if (passes && !didInReality && M.times[o][i] - lt < pass) stuck = Math.max(stuck, co + GAP);
      }
      lt = Math.max(lt, stuck - c);
    }
    c += lt;
    laps.push(lt);
    cum.push(c);
  }
  const time = o => (o === id ? cum : M.cum[o]);
  const order = M.ids.map(o => ({id: o, laps: M.times[o].length, time: time(o).at(-1)}))
    .sort((a, b) => b.laps - a.laps || a.time - b.time);
  const position = cum.map((x, i) => 1 + M.ids.filter(o => o !== id && M.cum[o][i] !== undefined && M.cum[o][i] < x).length);
  return {plan, laps, cum, position, order, finish: order.findIndex(r => r.id === id) + 1, time: c};
}

// The best plans with minStops..maxStops stops (stints of 3+ laps), best finish then time first. 3 stops go in 2-lap
// steps to keep it under a second on a 70-lap race.
export function optimise(M, id, {pass = PASS.normal, minStops = 0, maxStops = 3, top = 5} = {}) {
  const n = M.times[id].length, out = [], MIN = 3;
  const tryPlan = plan => { const r = simulate(M, id, plan, {pass}); out.push({plan: r.plan, finish: r.finish, time: r.time}); };
  if (minStops === 0) tryPlan([]);
  for (let a = MIN; a <= n - MIN; a++) {
    if (minStops <= 1 && maxStops >= 1) tryPlan([a]);
    for (let b = a + MIN; maxStops >= 2 && b <= n - MIN; b++) {
      if (minStops <= 2) tryPlan([a, b]);
      if (maxStops >= 3 && a % 2 === 0 && b % 2 === 0) for (let c = b + MIN; c <= n - MIN; c += 2) tryPlan([a, b, c]);
    }
  }
  return out.sort((x, y) => x.finish - y.finish || x.time - y.time).slice(0, top);
}
