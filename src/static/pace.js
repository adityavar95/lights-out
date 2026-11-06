// Race analysis on a raceModel (whatif.js), pure: the race trace, per-stint tyre wear and the undercut ledger.
// All of it reads the real lap times (M.times, M.cum). M.cum ends at a driver's first missing lap, so a hole or a
// retirement ends a line, a stint and a ledger window without any special case here.

const median = a => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};

const S_PER_KG = 0.03, FUEL_KG = 110;  // lap time per kg of fuel; the load today's cars start on (estimates, both)
const OFF = 2;                         // s from the stint median: traffic, a mistake, damage, not the tyres
const MIN_LAPS = 5;                    // fewer clean laps than this and the slope is mostly noise
const APART = 5, MAX_GAP = 4, MAX_SWING = 15;  // ledger: laps between the stops, s before them, largest believable gain

// Race trace: y_d(L) = cum_ref(L) − cum_d(L) in seconds, by lap number, so positive is ahead of the reference. Each
// array holds laps 1..k and stops where the driver's or the reference's record does.
export function raceTrace(M, ref) {
  const r = M.cum[ref] ?? [];
  return Object.fromEntries(M.ids.map(id => [id, M.cum[id].slice(0, r.length).map((c, i) => r[i] - c)]));
}

// A lap gets faster by this much each lap just from burning fuel, which hides that much tyre loss in a raw slope. The
// burn per lap doesn't depend on the stint, so the correction is one constant for the whole race.
export const fuelPerLap = raceLaps => S_PER_KG * FUEL_KG / raceLaps;

// ordinary least squares y = a + b·x over [x, y] points, with the slope's standard error: sqrt(s² / Sxx) where
// s² = SSE / (n − 2), two degrees of freedom gone on a and b. Needs 3+ points at different x.
export function ols(pts) {
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const b = sxy / sxx, a = my - b * mx, sse = pts.reduce((s, p) => s + (p[1] - a - b * p[0]) ** 2, 0);
  return {a, b, se: Math.sqrt(sse / (n - 2) / sxx)};
}

// One entry per stint. Absolute lap times, not whatif.js's fits[].b, which is relative to the field median and clamped
// at 0: it would call a car on tyres no worse than the field's "no wear". slope is null below MIN_LAPS clean laps.
export function stintPace(M, id) {
  const t = M.times[id], stops = M.stops[id], ends = [0, ...stops, t.length], fuel = fuelPerLap(M.n);
  return ends.slice(0, -1).map((start, k) => {
    const pts = [];
    for (let L = start + 1; L <= ends[k + 1]; L++)
      if (L > 1 && !M.neutral[L - 1] && !stops.includes(L) && !stops.includes(L - 1)) pts.push([L - start - 1, t[L - 1]]);
    const mid = median(pts.map(p => p[1])), clean = pts.filter(p => Math.abs(p[1] - mid) < OFF);
    const fit = clean.length >= MIN_LAPS ? ols(clean) : null;
    return {from: start + 1, to: ends[k + 1], times: clean.map(p => p[1]), n: clean.length,
            slope: fit && fit.b, se: fit && fit.se, corrected: fit && fit.b + fuel};
  });
}

// Everyone with MIN_LAPS clean laps, fastest median clean lap first
export function paceRanking(M) {
  return M.ids.map(id => {
    const stints = stintPace(M, id), times = stints.flatMap(s => s.times);
    return {id, stints, n: times.length, median: median(times)};
  }).filter(r => r.n >= MIN_LAPS).sort((x, y) => x.median - y.median);
}

// Undercut attempts: A, behind B by under MAX_GAP s, stops on lap a; B stops on lap b, a < b ≤ a + APART.
// g0 = cumA(a−1) − cumB(a−1), g1 = cumA(b+1) − cumB(b+1), both positive while A is behind; gain = g0 − g1; a sign flip
// means A came out ahead. A car already ahead that stops first has nothing to undercut, so it isn't an attempt.
// Left out: neutral laps in the window (the field bunches up whatever the tyres do), missing laps, another stop by
// either car in the window (its loss would read as the undercut's), and swings over MAX_SWING s (a slow stop, damage).
export function undercuts(M) {
  const out = [], at = (id, L) => M.cum[id][L - 1];
  for (const A of M.ids) for (const a of M.stops[A]) for (const B of M.ids) {
    if (A === B) continue;
    for (const b of M.stops[B]) {
      if (b <= a || b > a + APART) continue;
      const g0 = at(A, a - 1) - at(B, a - 1), g1 = at(A, b + 1) - at(B, b + 1);  // NaN: no such lap, and it fails below
      if (!(g0 > 0 && g0 < MAX_GAP) || !Number.isFinite(g1) || Math.abs(g0 - g1) > MAX_SWING) continue;
      if (M.neutral.slice(a - 2, b + 1).some(Boolean)) continue;
      const inWindow = s => s >= a - 1 && s <= b + 1;
      if (M.stops[A].some(s => s !== a && inWindow(s)) || M.stops[B].some(s => s !== b && inWindow(s))) continue;
      out.push({a: A, b: B, lapA: a, lapB: b, before: g0, after: g1, gain: g0 - g1, worked: g1 < 0});
    }
  }
  return out.sort((x, y) => x.lapA - y.lapA || x.lapB - y.lapB);
}
