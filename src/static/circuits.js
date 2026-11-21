// Circuits: the real outline (MultiViewer, F1 timing coordinates) plus a real height profile (OpenF1 car positions on
// a fast lap), and for four circuits an authored preset (aero trim, banking, kerbs, barriers, DRS zones, landmarks).
// annotate() turns all of it into per-outline-point arrays that the physics (track.js), the 3D scene (circuit3d.js)
// and the HUD all read, so they agree on where every hill, bank and kerb is. Pure apart from fetchCircuit.
import {get} from './util.js';
import {buildTrack} from './track.js';

// Preset corner numbers follow F1's official numbering (as MultiViewer's corner list does); `turns` names them (the
// telemetry trace's corner labels). Banking: degrees of
// camber at a corner, + tilted towards the corner's inside (helps), - off-camber. DRS zones: from the exit of corner
// `from` to the braking for corner `to`, detection `detect` = [corner, metres before (-) or after (+) it].
// Banking, kerb and detection positions are approximations from circuit maps, not survey data.
export const PRESETS = {
  monaco: {
    name: 'Circuit de Monaco', short: 'Monaco', lengthKm: 3.337, elevation: 42, aero: {cl: 1.25, cd: 1.25, drs: 0.2},
    aeroLabel: 'Ultra-high downforce', record: ['1:12.909', 'L. Hamilton', 2021],
    wall: 0.8, runoff: 'armco',  // steel barriers right at the track edge, no run-off anywhere
    bank: {1: 2, 6: 1, 8: -2, 12: 1.5, 18: 1},
    drs: [{from: 19, to: 1, detect: [19, -60]}],
    tunnel: {from: [8, 60], to: [10, -110]},  // from just past Portier to before the Nouvelle Chicane
    turns: {1: 'Sainte Dévote', 3: 'Massenet', 4: 'Casino', 5: 'Mirabeau', 6: 'Hairpin', 8: 'Portier', 10: 'Nouvelle Chicane',
            12: 'Tabac', 13: 'Piscine', 18: 'Rascasse', 19: 'Anthony Noghès'},
  },
  silverstone: {
    name: 'Silverstone Circuit', short: 'Silverstone', lengthKm: 5.891, elevation: 11.3, aero: {cl: 1.05, cd: 1.02, drs: 0.22},
    aeroLabel: 'Medium-high downforce', record: ['1:27.097', 'M. Verstappen', 2020],
    wall: 12, runoff: 'gravel', bank: {9: 1, 15: 1.5, 18: 1},
    drs: [{from: 5, to: 6, detect: [3, -50]}, {from: 14, to: 15, detect: [13, -50]}],  // Wellington, Hangar Straight
    turns: {1: 'Abbey', 2: 'Farm', 3: 'Village', 4: 'The Loop', 5: 'Aintree', 6: 'Brooklands', 7: 'Luffield', 8: 'Woodcote', 9: 'Copse',
            10: 'Maggotts', 12: 'Becketts', 14: 'Chapel', 15: 'Stowe', 16: 'Vale', 17: 'Club'},
  },
  spa: {
    name: 'Circuit de Spa-Francorchamps', short: 'Spa', lengthKm: 7.004, elevation: 102, aero: {cl: 0.9, cd: 0.9, drs: 0.18},
    aeroLabel: 'Medium-low downforce', record: ['1:46.286', 'V. Bottas', 2018],
    wall: 11, runoff: 'gravel', bank: {3: 2, 10: 3, 11: 3, 17: 1},  // Eau Rouge, double-apex Pouhon, Blanchimont
    sausage: [18, 19],  // the Bus Stop chicane
    drs: [{from: 4, to: 5, detect: [2, -100]}, {from: 19, to: 1, detect: [18, -60]}],  // Kemmel, start/finish
    turns: {1: 'La Source', 2: 'Eau Rouge', 3: 'Raidillon', 5: 'Les Combes', 8: 'Rivage', 10: 'Pouhon', 12: 'Fagnes', 15: 'Stavelot',
            17: 'Blanchimont', 18: 'Bus Stop'},
  },
  monza: {
    name: 'Autodromo Nazionale Monza', short: 'Monza', lengthKm: 5.793, elevation: 13, aero: {cl: 0.78, cd: 0.72, drs: 0.12},
    aeroLabel: 'Ultra-low downforce', record: ['1:21.046', 'R. Barrichello', 2004],
    wall: 12, runoff: 'gravel', bank: {3: 1, 6: 2.5, 7: 2.5, 11: 3},  // Curva Grande, the Lesmos, Parabolica
    sausage: [1, 2, 4, 5],  // Variante del Rettifilo and della Roggia
    drs: [{from: 11, to: 1, detect: [11, -80]}, {from: 7, to: 8, detect: [7, -80]}],  // start/finish, Lesmo 2 -> Ascari
    turns: {1: 'Rettifilo', 3: 'Curva Grande', 4: 'Roggia', 6: 'Lesmo 1', 7: 'Lesmo 2', 8: 'Ascari', 11: 'Parabolica'},
  },
  // partial presets: just what's distinctive, the rest is derived like any other circuit
  zandvoort: {bank: {3: 19, 14: 18}},  // the steeply banked Hugenholtzbocht and Arie Luyendijkbocht
  rodriguez: {aero: {cl: 1.25, cd: 1.25, drs: 0.2}},  // Monaco's wings, for what the thin air (below) leaves of them
};

// Air density (kg/m^3) at the circuit's altitude (m): the barometric e^(-h / 8500), the ~23 % Mexico City loses
const ALTITUDE = {rodriguez: 2240, kyalami: 1500, interlagos: 760, red_bull_ring: 680, ricard: 430, spa: 400};
export const airDensity = id => 1.225 * Math.exp(-(ALTITUDE[id] ?? 0) / 8500);
// pit lane limit (m/s): 80 km/h, 60 where the lane is tightest
const SLOW_PITS = new Set(['monaco', 'zandvoort', 'marina_bay']);
export const pitLimit = id => (SLOW_PITS.has(id) ? 60 : 80) / 3.6;

// Aero trim for any circuit, from its layout. Teams pick downforce by how much lap time hangs on straights: across the
// four presets the wing level follows the longest straight almost exactly (fit within 0.02):
//   cl = 1.49 - 0.53 x (longest straight, km), clamped to Monza's 0.78 .. Monaco's 1.25
// with drag following the wing (cd 0.72 at Monza to 1.25 at Monaco) and the DRS gain growing with the rear wing's size.
export function autoAero(pts, mpu) {
  const T = buildTrack(pts, mpu);
  let run = 0, longest = 0;
  for (let i = 0; i < 2 * T.n; i++) {
    run = Math.abs(T.ks[i % T.n]) < 1 / 200 ? run + T.ds : 0;  // radius over 200 m
    longest = Math.max(longest, Math.min(run, T.len));
  }
  const cl = Math.min(1.25, Math.max(0.78, 1.49 - 0.53 * longest / 1000));
  return {cl, cd: 0.72 + 1.128 * (cl - 0.78), drs: 0.12 + 0.1 * Math.min(1, (cl - 0.78) / 0.27), longest};
}

// What grows round a circuit (the 3D trees): the calendar's by name, any other by latitude when known
const BIOME = {spa: 'conifer', red_bull_ring: 'conifer', marina_bay: 'palm', yas_marina: 'arid', bahrain: 'arid', losail: 'arid', jeddah: 'arid', vegas: 'arid',
  ...Object.fromEntries('interlagos silverstone zandvoort monza hungaroring catalunya imola baku shanghai suzuka villeneuve rodriguez miami americas albert_park'.split(' ').map(id => [id, 'broadleaf']))};
// Street circuits: a city behind the barriers instead of countryside (circuit3d.js, city.js); 'tall' has towers
export const URBAN = {monaco: 'low', baku: 'tall', marina_bay: 'tall', jeddah: 'tall', vegas: 'tall', madring: 'low'};
export const biome = (id, lat) => BIOME[id] ?? (Math.abs(lat) > 45 ? 'conifer' : 'broadleaf');  // NaN / undefined lat: broadleaf

export const aeroLabel = cl => (cl >= 1.2 ? 'Ultra-high downforce' : cl >= 1.05 ? 'High downforce' : cl >= 0.95 ? 'Medium-high downforce'
  : cl >= 0.88 ? 'Medium downforce' : cl >= 0.82 ? 'Medium-low downforce' : 'Ultra-low downforce');

// MultiViewer outlines and OpenF1 laps (tracks.py lap_track) are in F1 timing coordinates: decimetres, starting at the
// line, the frame car positions and heights come in. GeoJSON outlines are local metres with no known start.
export const f1Coords = track => track?.source === 'multiviewer' || track?.source === 'openf1';

// The track (MultiViewer or OpenF1 lap) with circuitId / width / pit losses, plus heights per outline point (h, metres
// above the lowest point) when OpenF1 has positions for this circuit. Heights: each outline point projects onto the lap
// between its nearest sample and that sample's neighbour (same coordinate system) and interpolates z there (the samples
// are ~20 m apart at speed, so the nearest one's z alone made stairs), then a Gaussian over distance along the lap
// (sigma 20 m) smooths out GPS noise. Smoothing over a fixed number of points instead left 1 m segments (the outline's
// spacing runs 1-20 m) holding steps of a metre: an 80% ramp that cars hopped over.
export async function fetchCircuit(year, round) {
  const [track, elev] = await Promise.all([get(`/api/track/${year}/${round}`), get(`/api/elevation/${year}/${round}`).catch(() => null)]);
  if (!elev || !f1Coords(track)) return track;
  const m = elev.x.length, w = Math.ceil(m * 0.05), d2 = (i, j) => (elev.x[j] - track.x[i]) ** 2 + (elev.y[j] - track.y[i]) ** 2;
  const nearest = (i, js) => js.reduce((b, j) => d2(i, j) < d2(i, b) ? j : b);
  const gap = (a, b) => Math.min(Math.abs(a - b), m - Math.abs(a - b)), best = track.x.map((_, i) => nearest(i, [...elev.x.keys()]));
  // where the track crosses itself (Suzuka's bridge) the nearest sample can be on the other level: a jump in lap
  // order is searched again among the samples next to the previous point's
  best.forEach((b, i) => {
    const p = best[(i - 1 + best.length) % best.length];
    if (i && gap(b, p) > w) best[i] = nearest(i, Array.from({length: 2 * w + 1}, (_, k) => (p - w + k + m) % m));
  });
  // median of 5 lap samples: OpenF1 z has single-sample spikes (Suzuka's bridge reads the road below for one sample)
  const zs = elev.z.map((_, j) => [-2, -1, 0, 1, 2].map(k => elev.z[(j + k + m) % m]).sort((a, b) => a - b)[2]);
  const z = best.map((j, i) => {
    const ahead = (j + 1) % m, behind = (j - 1 + m) % m, px = track.x[i] - elev.x[j], py = track.y[i] - elev.y[j];
    const k = px * (elev.x[ahead] - elev.x[j]) + py * (elev.y[ahead] - elev.y[j]) >= 0 ? ahead : behind;
    const sx = elev.x[k] - elev.x[j], sy = elev.y[k] - elev.y[j], t = Math.min(1, Math.max(0, (px * sx + py * sy) / (sx * sx + sy * sy || 1)));
    return zs[j] + (zs[k] - zs[j]) * t;
  });
  const n = z.length, cum = [0];  // decimetres along the outline
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(track.x[i % n] - track.x[i - 1], track.y[i % n] - track.y[i - 1]));
  const lap = cum[n], SIGMA = 200;  // 20 m: crests stay under ~5 g at 80 m/s; total climb and grades (Eau Rouge ~15%) kept
  const smooth = z.map((_, i) => {
    let sum = 0, wsum = 0;
    for (const dir of [1, -1]) for (let k = dir > 0 ? 0 : 1; k < n; k++) {
      const j = (i + dir * k + n) % n, d = Math.abs(cum[j] - cum[i]), gap = Math.min(d, lap - d);
      if (gap > 3 * SIGMA) break;
      const wt = Math.exp(-gap * gap / (2 * SIGMA * SIGMA));
      sum += wt * z[j]; wsum += wt;
    }
    return sum / wsum;
  });
  const low = Math.min(...smooth);
  return {...track, h: smooth.map(v => (v - low) * 0.1)};  // decimetres -> metres
}

// Everything the physics and scene need per outline point. pts: outline in map coordinates (metres x mpu = map units),
// track: fetchCircuit's result (h, corners, circuitId). Returns {h, bank (rad, roll: + = right side lower), kerb
// ('sausage' | ''), tunnel: [i0, i1] | null, zones: [{start, end, detect}] outline indices | null, preset, wall}.
export function annotate(track, pts, mpu) {
  const n = pts.length, preset = PRESETS[track?.circuitId] ?? null;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * mpu);
  const lap = cum[n - 1] + Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) * mpu;
  const dist = (i, j) => { const d = Math.abs(cum[i] - cum[j]); return Math.min(d, lap - d); };
  const out = {h: track?.h?.length === n ? track.h : new Array(n).fill(0), bank: new Array(n).fill(0), kerb: new Array(n).fill(''),
               tunnel: null, zones: null, preset, wall: preset?.wall ?? 10, aero: preset?.aero ?? autoAero(pts, mpu),
               biome: biome(track?.circuitId, track?.lat), urban: URBAN[track?.circuitId], rho: airDensity(track?.circuitId), pitLimit: pitLimit(track?.circuitId)};
  if (!preset || !track.corners?.length) return out;
  // a corner's outline index: nearest point to its position (corners come in F1 coordinates, rotated like the outline)
  const rot = track.rot ?? (([x, y]) => [x, y]);
  const at = number => {
    const c = track.corners.find(x => x.number === number);
    if (!c) return null;
    const [cx, cy] = rot([c.x, c.y]);
    let best = 0, d = Infinity;
    pts.forEach((p, i) => { const e = (p[0] - cx) ** 2 + (p[1] - cy) ** 2; if (e < d) { d = e; best = i; } });
    return best;
  };
  // which way a corner turns, from the heading change over +-10 points (map y points down: + = right-hander)
  const turn = i => {
    const a = pts[(i - 10 + n) % n], b = pts[i], c = pts[(i + 10) % n];
    const d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    return Math.sign(Math.atan2(Math.sin(d), Math.cos(d))) || 1;
  };
  // index `metres` along the lap from index i
  const step = (i, metres) => {
    let j = i, left = Math.abs(metres);
    while (left > 0) { const k = metres > 0 ? (j + 1) % n : (j - 1 + n) % n; left -= dist(j, k); j = k; }
    return j;
  };
  // Banking: each corner's camber spreads over ~45 m either side as a Gaussian bump; as a roll angle it is signed by
  // the corner's direction, so positive camber tilts the road down towards the corner's inside.
  for (const [num, deg] of Object.entries(preset.bank ?? {})) {
    const i = at(+num);
    if (i === null) continue;
    const roll = turn(i) * deg * Math.PI / 180;
    for (let j = 0; j < n; j++) out.bank[j] += roll * Math.exp(-((dist(i, j) / 45) ** 2));
  }
  for (const num of preset.sausage ?? []) {
    const i = at(num);
    if (i !== null) for (let j = 0; j < n; j++) if (dist(i, j) < 30) out.kerb[j] = 'sausage';
  }
  if (preset.tunnel) {
    const a = at(preset.tunnel.from[0]), b = at(preset.tunnel.to[0]);
    if (a !== null && b !== null) out.tunnel = [step(a, preset.tunnel.from[1]), step(b, preset.tunnel.to[1])];
  }
  out.zones = preset.drs && preset.drs.map(z => {
    const from = at(z.from), to = at(z.to), det = at(z.detect[0]);
    return from === null || to === null || det === null ? null
      : {start: step(from, 80), end: step(to, -110), detect: step(det, z.detect[1])};
  }).filter(Boolean);  // no authored zones (a partial preset): null, so callers fall back to the longest straights
  return out;
}
