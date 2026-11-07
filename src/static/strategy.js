// Pit stops and race strategy: the pit-lane state machine, AI pit calls, driver pace modes and the pit-loss / rejoin
// predictor. Pure; sim.js drives it.
import {COMPOUNDS, DRY, isWetTyre, stintLife, blankets} from './tyres.js';
import {trackWetness} from './weather.js';
import {neutralised, vscDelta, safetyCar} from './racecontrol.js';

export const PIT_LIMIT = 80 / 3.6;  // pit lane speed limiter, m/s (R.pit.limit: 60 km/h at the tightest lanes, circuits.js)

// R.pit, the race's pit lane, in metres of progress x from the commit point (lap distance AT), where a car that has
// been called in leaves the racing line: it joins the lane's path by JOIN, has braked to the limiter by ENTRY, stops
// at BOX, accelerates from EXIT, leaves the lane's path from OUT and is back racing at REJOIN. LANE = EXIT - ENTRY at
// 80 km/h. START: where the drawn lane begins. prof: [[x, d]], the path's offset from the track's centre line (m,
// + = right), every 5 m; pitPath reads it.
//
// Made up (pitLayout): alongside the main straight, left of the track, the box 70 m before the timing line; 150 m to
// peel off and brake, `lane` metres at 80 km/h, 150 m back onto the track.
export function pitLayout(T, lane = 400) {
  const L = {AT: T.len - 220 - lane / 2, START: 0, JOIN: 150, ENTRY: 150, BOX: 150 + lane / 2, EXIT: 150 + lane, OUT: 150 + lane,
             REJOIN: 300 + lane, LANE: lane};
  const off = pitOffset(T), edge = -(T.half - 1.5);
  L.prof = Array.from({length: Math.ceil(L.REJOIN / 5) + 1}, (_, i) => {
    const x = i * 5, f = x < L.ENTRY ? ease(x / L.ENTRY) : x > L.EXIT ? 1 - ease(Math.min(1, (x - L.EXIT) / (L.REJOIN - L.EXIT))) : 1;
    return [x, edge + (off - edge) * f];
  });
  return L;
}

// The real thing (lanePath), from a car's GPS through the pit lane (pitTrace's lane, map points): each point projected
// onto the track as lap distance s and offset d, kept while s increases, resampled every 5 m, median-filtered over
// 25 m (GPS glitches) and smoothed over +-20 m (the car's own swerve into its box would be a kink every car follows).
// The commit point is 60 m before the lane leaves the track; the limiter runs from up to 120 m into it to as far
// before its end. Also line: [[x, map x, map y]], the lane itself (the GPS points, smoothed), which is what's
// drawn and where pitting cars are shown: an offset from the track's centre line folds over itself where it's
// larger than the radius of the bend it's beside (Silverstone's lane runs 100 m inside one). null if the trace
// doesn't look like a pit lane (shorter than 150 m or over half a lap).
export function lanePath(T, lanePts) {
  const sd = [];
  let prev = null;
  for (const [mx, my] of lanePts) {
    const x = mx * T.mpu, y = my * T.mpu;
    let best = 0, e = Infinity;
    const scan = i => { i = ((i % T.n) + T.n) % T.n; const q = (T.x[i] - x) ** 2 + (T.y[i] - y) ** 2; if (q < e) { e = q; best = i; } };
    // then onwards from the last point: a lane can run closer to another part of the track behind it (Monaco's, by the
    // swimming pool) than to the stretch it follows
    if (prev === null) for (let i = 0; i < T.n; i++) scan(i);
    else for (let k = -5; k <= 30; k++) scan(prev + k);
    prev = best;
    const dx = x - T.x[best], dy = y - T.y[best];
    let s = best * T.ds + dx * T.tx[best] + dy * T.ty[best];
    const d = -dx * T.ty[best] + dy * T.tx[best];
    if (sd.length) { const last = sd.at(-1)[0]; while (s < last - T.len / 2) s += T.len; while (s > last + T.len / 2) s -= T.len; }
    if (!sd.length || s > sd.at(-1)[0] + 0.5) sd.push([s, d, mx, my, -T.ty[best], T.tx[best]]);  // + the normal there
  }
  if (sd.length < 4) return null;
  // a median of 5 over the projected offsets: a point projected onto the wrong side of the track (where the lap closes)
  const dm = sd.map((_, i) => sd.slice(Math.max(0, i - 2), i + 3).map(p => p[1]).sort((x, y) => x - y));
  sd.forEach((p, i) => { p[1] = dm[i][dm[i].length >> 1]; });
  const s0 = sd[0][0], len = sd.at(-1)[0] - s0;
  if (len < 150 || len > T.len / 2) return null;
  const raw = [];
  for (let s = s0, k = 0; s <= s0 + len; s += 5) {
    while (sd[k + 1][0] < s && k < sd.length - 2) k++;
    const [sa, da] = sd[k], [sb, db] = sd[k + 1], f = Math.min(1, Math.max(0, (s - sa) / (sb - sa)));
    raw.push(da + (db - da) * f);
  }
  // between the limiter lines the lane keeps clear of the track: its inner edge (2.8 m in) at least 1.4 m off the
  // kerb, room for the pit wall (Zandvoort's GPS runs within a metre of that)
  const ramp = Math.min(120, len * 0.25), END = 60 + (raw.length - 1) * 5, clear = T.half + 4.2;
  const med = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 2), i + 3).sort((x, y) => x - y), v = w[w.length >> 1], x = 60 + i * 5;
    return x > 60 + ramp && x < END - ramp && Math.abs(v) < clear ? Math.sign(v || 1) * clear : v;
  });
  const d = med.map((_, i) => { let sum = 0, n = 0; for (let j = Math.max(0, i - 4); j <= Math.min(med.length - 1, i + 4); j++) { sum += med[j]; n++; } return sum / n; });
  // the lane's own points, pushed out to the same clearance where they're closer
  const pts = sd.map(([s, dd, mx, my, nx, ny]) => {
    const x = s - s0 + 60, push = x > 60 + ramp && x < END - ramp && Math.abs(dd) < clear ? (Math.sign(dd || 1) * clear - dd) / T.mpu : 0;
    return [x, mx + nx * push, my + ny * push];
  });
  // smoothed over 7 points, then spread evenly by their own distance along the lane over its progress range, so a car
  // moving steadily along the lane does so on screen too (by the projection, GPS swerves bunched points sideways)
  const sm = pts.map((_, i) => {
    const w = pts.slice(Math.max(0, i - 3), i + 4);
    return [w.reduce((a, p) => a + p[1], 0) / w.length, w.reduce((a, p) => a + p[2], 0) / w.length];
  });
  const run = [0];
  for (let i = 1; i < sm.length; i++) run.push(run[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]));
  const line = sm.map(([mx, my], i) => [60 + (END - 60) * run[i] / (run.at(-1) || 1), mx, my]);
  return {AT: ((s0 - 60) % T.len + T.len) % T.len, START: 60, JOIN: 90, ENTRY: 60 + ramp, BOX: 60 + len / 2, EXIT: END - ramp, OUT: END,
          REJOIN: END + 100, LANE: END - 2 * ramp - 60, prof: [[0, d[0]], ...d.map((v, i) => [60 + i * 5, v])], line};
}

// the real lane's map point at progress x (L.line, held at its ends)
export function lanePos(L, x) {
  const p = L.line;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][0] < x) i++;
  const [xa, ax, ay] = p[i], [xb, bx, by] = p[i + 1], f = Math.min(1, Math.max(0, (x - xa) / (xb - xa || 1)));
  return [ax + (bx - ax) * f, ay + (by - ay) * f];
}

// the lane path's offset at progress x (held at its ends)
export function pitPath(L, x) {
  const p = L.prof, i = Math.min(p.length - 2, Math.max(0, Math.floor((x - p[1][0]) / 5) + 1));
  const [xa, da] = x < p[1][0] ? p[0] : p[i], [xb, db] = x < p[1][0] ? p[1] : p[i + 1];
  return da + (db - da) * Math.min(1, Math.max(0, (x - xa) / (xb - xa || 1)));
}

// The lane length that reproduces a circuit's real green-flag pit loss (MultiViewer's figure), from the loss model
// below with ~65 m/s racing pace past the pits: loss = L / v_limit + OVERHEAD - (L + 300) / 65, solved for L.
export const laneFor = (loss, limit = PIT_LIMIT) => Math.min(650, Math.max(250, (loss - OVERHEAD + 300 / 65) / (1 / limit - 1 / 65)));
const OVERHEAD = 10.5;  // s, see pitLoss
export const pitOffset = T => -(T.half + 6.5);  // made-up lane's centre: left of the track, inside the barrier

// A real pit lane, from one car's GPS trace round a pit stop. trace: map points (null where there are none); pts: the
// track outline; off: distance from the outline beyond which the car has left the track; gap: minimum spacing (the car
// standing at its box adds no points). Distances are a median of 5 samples (a single GPS spike is not the lane), and
// the lane is the longest stretch off the track, bridging up to 8 samples back within `off` (a lane that runs close
// to the track dips in and out with GPS noise; those samples are left out). Returns its centre line from the last
// on-track point before it to the first one after, or null when the trace never leaves the track or drops out off it.
export function pitTrace(trace, pts, off, gap) {
  const raw = trace.map(p => p && Math.sqrt(Math.min(...pts.map(q => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2))));
  const d = raw.map((v, i) => {
    if (v === null) return null;
    const w = raw.slice(Math.max(0, i - 2), i + 3).filter(x => x !== null).sort((x, y) => x - y);
    return w[w.length >> 1];
  });
  let best = null;
  for (let i = 0; i < d.length; i++) {
    if (d[i] === null || d[i] <= off || (i && d[i - 1] !== null && d[i - 1] > off)) continue;  // where a stretch starts
    let j = i;
    for (let k = i; k < d.length && d[k] !== null && k - j <= 8; k++) if (d[k] > off) j = k;
    if (!best || j - i > best[1] - best[0]) best = [i, j];
  }
  if (!best) return null;
  const a = best[0] - 1, b = best[1] + 1;
  if (a < 0 || b >= d.length || d[a] === null || d[b] === null) return null;
  const lane = [];
  for (let k = a; k <= b; k++) {
    const p = trace[k];
    if (k > a && k < b && raw[k] <= off) continue;
    if (!lane.length || Math.hypot(p[0] - lane.at(-1)[0], p[1] - lane.at(-1)[1]) >= gap) lane.push(p);
  }
  return lane.length > 3 ? lane : null;
}

// driver pace modes: share of the available grip the driver plans with, tyre wear factor, and the ERS mode Auto uses
export const PACE = {
  PUSH: {plan: 1, wear: 1.15, ers: 'PUSH'},
  BALANCED: {plan: 0.985, wear: 1, ers: 'BALANCED'},
  SAVE: {plan: 0.965, wear: 0.8, ers: 'HARVEST'},  // lift and coast: early lifts, gentler on tyres, harvests energy
};

export const createPit = compound => ({state: 'RACING', box: null, start: 0, timer: 0, stops: 0, used: new Set([compound])});

// Pit state machine, run every physics step before the car plans its speed:
//   RACING --box requested, reaching the commit point--> ENTRY --entry line--> LANE --box--> STOPPED (2.2-3.0 s)
//   --tyres changed--> LANE --exit line--> EXIT --back up to speed, rejoined--> RACING
// Returns null while racing, else {vCap, d, hold}: the speed it may do, where across the track it heads (from where it
// committed onto the lane's path by JOIN, along it, then from OUT back onto the racing line) and whether it is
// stationary. Each car stops at its team's box, car.boxAt metres along from the lane's middle (sim.js setBoxes).
export const ease = f => f * f * (3 - 2 * f);
export function pitControl(R, car, h, line) {
  const P = car.pit, L = R.T.len, lapS = ((car.s % L) + L) % L;
  const {JOIN, ENTRY, EXIT, OUT, REJOIN, limit} = R.pit, BOX = R.pit.BOX + (car.boxAt ?? 0), path = x => pitPath(R.pit, x);
  if (P.state === 'RACING') {
    const past = ((lapS - R.pit.AT) % L + L) % L;  // metres past the commit point
    segmentTiming(R, car, past);
    if (!P.box || past > 40) return null;
    P.state = 'ENTRY';
    car.seg = null;  // a run through the pit lane isn't racing pace: it would take the stop off the pit-loss estimate
    P.start = car.s - past;
    P.d0 = car.d;
  }
  const x = car.s - P.start;
  if (P.state === 'ENTRY') {
    if (x >= ENTRY) P.state = 'LANE';
    return {vCap: Math.sqrt(limit ** 2 + 2 * 20 * Math.max(0, ENTRY - x)),  // brake to the limit by the line
            d: P.d0 + (path(x) - P.d0) * ease(Math.min(1, x / JOIN))};
  }
  if (P.state === 'LANE' && !P.changed) {
    // crews vary by a few tenths; changing a broken front wing as well takes ~7 s more
    if (x >= BOX - 0.5) { P.state = 'STOPPED'; P.timer = 2.2 + Math.random() * 0.8 + (car.damage > 0.05 ? 7 : 0); }
    return {vCap: Math.min(limit, Math.sqrt(2 * 10 * Math.max(0, BOX - x)) + 0.3), d: path(x)};  // ~1 g into the box
  }
  if (P.state === 'STOPPED') {
    P.timer -= h;
    if (P.timer <= 0) {  // new set: compound as called, full health, out of the blankets
      const c = P.box.compound;
      car.tyre = {compound: c, health: [100, 100, 100, 100], ts: blankets(c), tc: blankets(c)};
      car.damage = 0;
      P.used.add(c);
      P.stops++;
      P.box = null;
      P.changed = true;
      P.state = 'LANE';
      car.stint++;
      car.stintLap = car.lapsDone;
    }
    return {vCap: 0, d: path(x), hold: true};
  }
  if (P.state === 'LANE') {
    if (x >= EXIT) P.state = 'EXIT';
    return {vCap: limit, d: path(x)};
  }
  // EXIT: accelerate from the exit line along the lane's path, then from OUT merge back to the racing line
  if (x >= REJOIN) { P.state = 'RACING'; P.changed = false; return null; }
  const f = ease(Math.min(1, Math.max(0, (x - OUT) / (REJOIN - OUT))));
  return {vCap: 150, d: path(x) + (line - path(x)) * f};
}

export const inPitLane = car => car.pit.state !== 'RACING' && car.pit.state !== 'ENTRY' && car.pit.state !== 'EXIT';

// best dry compound for the laps left: the fastest one expected to reach the flag before its cliff; in a dry race
// the rules require two different dry compounds, so a car that has only used one picks another
function dryChoice(car, lapsLeft, w) {
  const used = [...car.pit.used], dryRace = !used.some(isWetTyre);
  let options = DRY.filter(c => !(dryRace && used.length < 2 && used.includes(c)));
  if (!options.length) options = DRY;
  return options.find(c => stintLife(c, w) >= lapsLeft) ?? options.at(-1);
}

// AI pit calls, decided mid-lap (before the commit point). In priority order:
//  1. weather crossover: slicks past 20 % wetness -> inters (wets past 60 %); inters past 65 % -> wets; wets below
//     45 % -> inters; inters once the line is dry (< 8 %, track < 10 %) -> slicks
//  2. the cliff: tyre health under 38 %
//  3. a cheap stop: under a VSC or Safety Car with tyres past 35 % worn, the stop costs ~40 % less time
//  4. the undercut: stuck within 1.2 s of the same car for 3 laps on tyres past 45 % worn, pit to jump it on fresh rubber
//  5. the two-compound rule (full-distance races; sprints are exempt): a dry race on one compound so far stops once a
//     fresh set of another can reach the flag
export function aiStrategy(R, car) {
  const P = car.pit, len = R.T.len, lapS = ((car.s % len) + len) % len, toGo = ((R.pit.AT - lapS) % len + len) % len;
  if (P.state !== 'RACING' || P.box || toGo < 20 || toGo > len * 0.5 || car.finished || car.player) return;  // the half lap before the commit point
  const w = trackWetness(R.W), lapsLeft = R.total - car.lapsDone - 1, comp = car.tyre.compound;
  const health = car.tyre.health.reduce((a, b) => a + b) / 4;
  if (lapsLeft < 1) return;
  let want = null;
  if (!isWetTyre(comp) && w > 0.2) want = w > 0.6 || R.W.rain > 0.6 ? 'WET' : 'INTERMEDIATE';  // monsoon: straight to wets
  else if (comp === 'INTERMEDIATE' && w > 0.65) want = 'WET';
  else if (comp === 'WET' && w < 0.45) want = 'INTERMEDIATE';
  else if (comp === 'INTERMEDIATE' && w < 0.1 && R.W.wetLine < 0.08) want = dryChoice(car, lapsLeft, w);
  else if (car.damage > 0.35 && lapsLeft > 3) want = isWetTyre(comp) ? comp : dryChoice(car, lapsLeft, w);  // a new nose
  else if (health < 38 && lapsLeft > 1) want = isWetTyre(comp) ? comp : dryChoice(car, lapsLeft, w);
  else if (neutralised(R.control) && R.control.state !== 'VSC ENDING' && health < 65 && lapsLeft > 8)
    want = isWetTyre(comp) ? comp : dryChoice(car, lapsLeft, w);
  else if (car.attackLaps >= 3 && health < 55 && lapsLeft > 10 && !isWetTyre(comp)) want = dryChoice(car, lapsLeft, w);
  else if (P.used.size < 2 && ![...P.used].some(isWetTyre) && car.lapsDone >= 1 && R.total * len >= 250e3) {  // sprints are exempt
    const next = dryChoice(car, lapsLeft, w);
    if (lapsLeft <= stintLife(next, w)) want = next;
  }
  if (want) P.box = {compound: want, user: false};
}

// AI pace: attack within a second of the car ahead (or on the out-lap, to make an undercut stick), nurse worn tyres
// over the last few laps, otherwise standard pace. The console's choice overrides it.
export function aiPace(R, car) {
  if (car.paceUser) return car.paceUser;
  const health = car.tyre.health.reduce((a, b) => a + b) / 4, lapsLeft = R.total - car.lapsDone;
  if (neutralised(R.control)) return 'BALANCED';
  if (car.gapSec < 1 || (car.pit.stops && car.tyre.health[0] > 97)) return 'PUSH';
  if (health < 45 && lapsLeft <= 5) return 'SAVE';
  return 'BALANCED';
}

// Each car times its own green-flag runs through the 800 m the pit stop replaces (commit point to rejoin point), so
// the pit-loss estimate compares against that car's current racing pace in the current conditions.
function segmentTiming(R, car, past) {  // past: metres past the commit point
  const {REJOIN} = R.pit;
  if (car.seg && car.s - car.seg.s >= REJOIN) {
    if (car.seg.green && !neutralised(R.control)) car.segT = R.t - car.seg.t;
    car.seg = null;
  }
  if (!car.seg && past < 40) car.seg = {s: car.s, t: R.t, green: !neutralised(R.control)};
  if (car.seg && neutralised(R.control)) car.seg.green = false;
}

// Time lost by pitting this lap. The stop covers lane + 300 m (commit to rejoin): e.g. 400 m of pit lane at 80 km/h (18 s), plus
// an overhead of ~10.5 s (braking to and accelerating from the limiter, stopping in and leaving the box, ~2.6 s
// stationary, and an out-lap on tyres still coming up to temperature; calibrated against simulated stops), against
// the time the same 700 m takes at this car's racing pace, which a VSC slows by 1/0.65 and a Safety Car by ~1/0.6
// for everyone else too:   loss = 400 / v_limit + OVERHEAD - t_racing / slowdown
// Green flag: about 20-24 s; under a VSC or Safety Car the same stop costs about 12 s, the "cheap stop".
export function pitLoss(R, car) {
  const {REJOIN, LANE} = R.pit, racing = car?.segT ?? REJOIN / 65;  // until timed, assume ~235 km/h down the pit straight
  const slow = safetyCar(R.control) ? 0.6 : vscDelta(R.control);
  return LANE / R.pit.limit + OVERHEAD - racing / slow;
}

// Where the car would come out if it boxed this lap: `loss` seconds further back. Its ghost is where the car itself
// was `loss` seconds ago (from its position history); the predicted position counts the cars whose gap to the leader
// would then be smaller than its own. Returns {loss, pos, s, ahead, behind} with the neighbours' ids and gaps in s.
export function predictRejoin(R, car) {
  const loss = pitLoss(R, car), hist = car.hist, t = R.t - loss;
  if (!hist.length || hist[0][0] > t) return {loss, pos: null};
  let i = hist.length - 1;
  while (i > 0 && hist[i][0] > t) i--;
  const [t0, s0] = hist[i], [t1, s1] = hist[Math.min(i + 1, hist.length - 1)];
  const s = t1 > t0 ? s0 + (s1 - s0) * (t - t0) / (t1 - t0) : s0;
  const board = R.board(), mine = board.find(b => b.car === car)?.gap ?? 0, len = R.T.len;
  const pos = 1 + board.filter(b => b.car !== car && !inPitLane(b.car) && (b.gap ?? 0) < mine + loss).length;
  let ahead = null, behind = null;
  for (const o of R.cars) {
    if (o === car || o.finished || inPitLane(o)) continue;
    const dAhead = ((o.s - s) % len + len) % len, gap = Math.min(dAhead, len - dAhead) / Math.max(o.v, 10);
    if (dAhead < len / 2 && (!ahead || gap < ahead.gap)) ahead = {id: o.id, gap};
    if (dAhead >= len / 2 && (!behind || gap < behind.gap)) behind = {id: o.id, gap};
  }
  return {loss, pos, s, ahead, behind};
}
