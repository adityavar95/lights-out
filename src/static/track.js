// Circuit geometry for the simulation: the outline resampled every DS metres with tangents, curvature, the racing
// line and DRS zones, plus position lookups. Pure. Units: metres on the map plane (x right, y down), so a right-hand
// turn has positive curvature and its inside lies on the +normal (right) side.
import {drsZones, clamp} from './telemetry.js';

const DS = 5;  // sample spacing, m

// Racing line as a lateral offset (metres, + = right of the direction of travel) per point of a closed outline in
// metres. Cars stay wide before a corner, clip the apex and run wide on exit: a difference of Gaussians of the signed
// curvature k = dtheta/ds gives that shape. The narrow one (sigma 25 m) pulls the line inside round the apex, subtracting
// the wide one (90 m) pushes it outside on the approach and exit. A right-hander (k > 0) has its inside at +offset.
export function racingLine(pts, half) {
  const n = pts.length, s = [0], k = [];
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let i = 1; i < n; i++) s.push(s[i - 1] + dist(pts[i], pts[i - 1]));
  const lap = s[n - 1] + dist(pts[0], pts[n - 1]);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    k.push(Math.atan2(Math.sin(d), Math.cos(d)) / ((dist(a, b) + dist(b, c)) / 2 || 1));
  }
  const blur = sigma => s.map(si => {
    let sum = 0, total = 0;
    for (let j = 0; j < n; j++) {
      const d = Math.min(Math.abs(si - s[j]), lap - Math.abs(si - s[j])), g = Math.exp(-d * d / (2 * sigma * sigma));
      sum += g * k[j];
      total += g;
    }
    return sum / total;
  });
  const near = blur(25), far = blur(90);
  return near.map((kn, i) => clamp((kn - far[i]) * 120, -1, 1) * Math.max(half - 1.2, 0));
}

// Centripetal Catmull-Rom spline through a closed polyline. Between points p1 and p2 (neighbours p0, p3) the curve is
// built with knots spaced by sqrt(chord length) (alpha = 0.5, Barry-Goldman's pyramid): unlike uniform Catmull-Rom it
// never overshoots or forms cusps where points are unevenly spaced, e.g. across a 40-50 m gap in the GPS-derived
// outline, so a gap doesn't turn into a fake hairpin. Returns `per` points per segment as [x, y, u], u = the
// fractional index into the original points (to carry per-point data like heights along).
export function splinePoints(P, per = 8) {
  const n = P.length, out = [];
  const lerp = (a, b, ta, tb, t) => (tb - ta < 1e-9 ? a : [a[0] + (b[0] - a[0]) * (t - ta) / (tb - ta), a[1] + (b[1] - a[1]) * (t - ta) / (tb - ta)]);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const k = (a, b) => Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
    const t0 = 0, t1 = t0 + k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3);
    for (let q = 0; q < per; q++) {
      const t = t1 + (t2 - t1) * q / per;
      const A1 = lerp(p0, p1, t0, t1, t), A2 = lerp(p1, p2, t1, t2, t), A3 = lerp(p2, p3, t2, t3, t);
      const B1 = lerp(A1, A2, t0, t2, t), B2 = lerp(A2, A3, t1, t3, t);
      out.push([...lerp(B1, B2, t1, t2, t), i + q / per]);
    }
  }
  return out;
}

// Resample the outline (map units, mpu metres each) every DS metres along its Catmull-Rom spline and precompute what
// the physics reads per sample: unit tangent; curvature twice: `k` for speed limits, the heading change over +-5 m (the
// outline has few points in tight corners, so a hairpin may be one sharp sample: averaging would open it up), with
// glitches removed: a sample over 3x sharper than both samples 10 m either side is an outline error (a 3 m "corner" on
// a straight) and takes the sharper neighbour's value; and `ks` over +-20 m for telling straights from corners; racing
// line; DRS zones with their detection points; elevation and banking.
// ann: circuits.js annotate() output (per outline point heights, banking, kerbs; tunnel and DRS zones as outline
// indices), resampled here onto the DS grid; without it the track is flat with automatic DRS zones.
export function buildTrack(mapPts, mpu, width = 13, ann = null) {
  const N = mapPts.length, D = splinePoints(mapPts.map(p => [p[0] * mpu, p[1] * mpu])), seg = [], sAt = [];
  let len = 0;
  for (let i = 0; i < D.length; i++) {
    const a = D[i], b = D[(i + 1) % D.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (i % 8 === 0) sAt.push(len);  // lap distance of each original outline point
    seg.push([len, l]);
    len += l;
  }
  const n = Math.floor(len / DS), x = [], y = [], h = [], bank = [], kerb = [];
  const per = (arr, u) => {  // a per-outline-point value at fractional index u
    if (!arr) return 0;
    const i = Math.floor(u) % N, f = u - Math.floor(u);
    return arr[i] + (arr[(i + 1) % N] - arr[i]) * f;
  };
  for (let i = 0, j = 0; i < n; i++) {
    const s = i * len / n;
    while (seg[j][0] + seg[j][1] < s) j++;
    const a = D[j], b = D[(j + 1) % D.length], f = (s - seg[j][0]) / (seg[j][1] || 1);
    const u = a[2] + ((b[2] < a[2] ? b[2] + N : b[2]) - a[2]) * f;
    x.push(a[0] + (b[0] - a[0]) * f);
    y.push(a[1] + (b[1] - a[1]) * f);
    h.push(per(ann?.h, u));
    bank.push(per(ann?.bank, u));
    kerb.push(ann?.kerb[Math.round(u) % N] ?? '');
  }
  const ds = len / n, tx = [], ty = [];
  // signed heading change between the chords either side of sample i, per metre: each chord's heading is the tangent at
  // its midpoint, and the two midpoints are W samples apart (dividing by 2 W ds halved every curvature until Oct 2026)
  const turn = (i, W) => {
    const a = (i - W + n) % n, c = (i + W) % n;
    const d = Math.atan2(y[c] - y[i], x[c] - x[i]) - Math.atan2(y[i] - y[a], x[i] - x[a]);
    return Math.atan2(Math.sin(d), Math.cos(d)) / (W * ds);
  };
  for (let i = 0; i < n; i++) {
    const nx = x[(i + 1) % n] - x[(i - 1 + n) % n], ny = y[(i + 1) % n] - y[(i - 1 + n) % n], l = Math.hypot(nx, ny) || 1;
    tx.push(nx / l);
    ty.push(ny / l);
  }
  const k1 = x.map((_, i) => turn(i, 1)), ks = x.map((_, i) => turn(i, 4));
  const kd = k1.map((v, i) => {
    const near = Math.max(Math.abs(k1[(i - 2 + n) % n]), Math.abs(k1[(i + 2) % n]));
    return Math.abs(v) > 3 * near ? Math.sign(v) * near : v;
  });
  // then averaged over +-10 m: the outline's 5 m wiggles (radii jumping 50 <-> 3,000 m through Austin's esses) are no
  // corner a 5.5 m car follows, and any real corner longer than ~25 m keeps its full curvature
  const k = kd.map((_, i) => (kd[(i - 2 + n) % n] + kd[(i - 1 + n) % n] + kd[i] + kd[(i + 1) % n] + kd[(i + 2) % n]) / 5);
  // Elevation along the lap, from the heights h(s):
  //   grade  = dh/ds over +-10 m (the road's pitch is atan(grade); gravity along it is g sin(pitch))
  //   kv     = d2h/ds2 over +-15 m, the vertical curvature: > 0 in a compression (a dip, like the bottom of Eau Rouge,
  //            where the car is pushed into the road with v^2 kv on top of g), < 0 over a crest (Raidillon's top,
  //            where the same term lifts weight off the tyres). Clamped to radii over 50 m, below which it's GPS noise.
  const grade = h.map((_, i) => (h[(i + 2) % n] - h[(i - 2 + n) % n]) / (4 * ds));
  const kv = h.map((_, i) => Math.max(-0.02, Math.min(0.02, (h[(i + 3) % n] - 2 * h[i] + h[(i - 3 + n) % n]) / (3 * ds) ** 2)));
  const pts = x.map((v, i) => [v, y[i]]), half = width / 2, sOf = i => sAt[i];
  const zones = ann?.zones?.length
    ? ann.zones.map(z => ({start: sOf(z.start), end: sOf(z.end) + (z.end < z.start ? len : 0), detect: sOf(z.detect)}))
    : drsZones(pts).map(([a, b]) => ({start: a * ds, end: (b < a ? b + n : b) * ds, detect: ((a * ds - 150) % len + len) % len}));
  const tunnel = ann?.tunnel ? [sOf(ann.tunnel[0]), sOf(ann.tunnel[1])] : null;
  // the racing line and the curvature of its own path: kappa = k / (1 - k d) + d'', with d'' over +-15 m (the line
  // opens a corner out, swings across before it), which the AI corners on and plans its speed by (sim.js)
  const line = racingLine(pts, half), W = 3;
  const dd = line.map((_, i) => (line[(i + W) % n] - 2 * line[i] + line[(i - W + n) % n]) / (W * ds) ** 2);
  const kLine = k.map((v, i) => v / Math.max(0.3, 1 - v * line[i]) + dd[i]);
  return {n, ds, len, x, y, tx, ty, k, ks, line, dd, kLine, half, zones, mpu, h, grade, kv, bank, kerb, tunnel,
          sinBank: bank.map(Math.sin), wall: ann?.wall ?? 10};  // sinBank: for the physics' hot loops
}

// sample index of track distance s (any lap), and the value of a per-sample array there
export const idx = (T, s) => Math.floor(((s % T.len) + T.len) % T.len / T.ds) % T.n;
export const at = (T, arr, s) => arr[idx(T, s)];

// map position of track distance s with lateral offset d (normal n = (-ty, tx) points to the right in y-down coords).
// The normal is interpolated between samples too: held per 5 m sample, it turns by ~0.3 rad at once in a tight
// chicane, jumping a car 7 m off the centre line ~2 m sideways each time it crossed one.
export function trackPos(T, s, d) {
  const u = ((s % T.len) + T.len) % T.len / T.ds, i = Math.floor(u) % T.n, j = (i + 1) % T.n, f = u - Math.floor(u);
  const tx = T.tx[i] + (T.tx[j] - T.tx[i]) * f, ty = T.ty[i] + (T.ty[j] - T.ty[i]) * f, l = Math.hypot(tx, ty) || 1;
  const x = T.x[i] + (T.x[j] - T.x[i]) * f - ty / l * d, y = T.y[i] + (T.y[j] - T.y[i]) * f + tx / l * d;
  return [x / T.mpu, y / T.mpu];
}
