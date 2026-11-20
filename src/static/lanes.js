// Lateral placement for the lap-timing replay, which only knows how far round the lap each car is: it would put every
// car on the centre line, all on one spot at the start and through each other when one passes another. Pure.
import {clamp} from './telemetry.js';
import {CAR_L, CAR_W} from './racecraft.js';

const wrap = (x, len) => ((x % len) + 1.5 * len) % len - len / 2;  // signed distance along the lap, -len/2..len/2

// the grid: two columns, a slot every `row` m with pole `front` m behind the line; the columns close up over `fade` m
export const GRID = {row: 8, front: 6, col: 1.6, fade: 250};
// a passing car sits PASS m off the line from REACH m behind the car it passes until it is AFTER m past it
const PASS = 3.2, REACH = 35, AFTER = 25;
// the n-th car to take the flag (0 = winner) parks past the line in two columns like the grid's, PASS m either side of the line, so finished
// cars don't stack on one spot and a car still on its last lap drives between them
export const parked = n => ({s: GRID.front + GRID.row * n, lat: n % 2 ? -PASS : PASS});
const sideOf = key => ([...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7) & 1 ? 1 : -1);  // + = left

// cars: [{id, s, v, rank, run}]: s metres round the lap (negative before the line), v m/s, rank the grid slot (0 = pole) and
// run the metres driven since the start (both only on lap 1). len: lap length m; half: half the track width m. v must be a
// steady pace (not this lap's speed), so which car is the passer never changes mid-pass. Returns {id: lateral offset m,
// + = left}.
//
// The faster car of a close pair is the one that moves, to a side fixed per pair (a side picked from the track would flip
// mid-pass and carry the car through the other), and it has returned to the line once it is AFTER m clear. Offsets follow
// positions only, so scrubbing stays consistent.
export function lanes(cars, len, half) {
  const out = {}, max = half - 1;
  for (const a of cars) {
    let lat = 0;
    for (const b of cars) {
      if (a === b || a.v < b.v || (a.v === b.v && a.id < b.id)) continue;  // only the faster car moves
      const gap = wrap(b.s - a.s, len), ds = Math.abs(gap), reach = gap > 0 ? REACH : AFTER;
      if (ds >= reach) continue;
      const w = ds <= CAR_L + 2 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (ds - CAR_L - 2) / (reach - CAR_L - 2));
      const m = w * Math.min(PASS, half - 1.5) * sideOf(a.id + b.id);
      if (Math.abs(m) > Math.abs(lat)) lat = m;
    }
    lat *= clamp(((a.run ?? Infinity) - 50) / 200, 0, 1);  // still on the grid: the columns, not passing
    if (a.rank !== undefined) lat += (a.rank % 2 ? -GRID.col : GRID.col) * clamp(1 - a.run / GRID.fade, 0, 1);
    out[a.id] = lat;
  }
  // a chain (A passing B while B passes C) can put two cars on one side: push any overlapping pair apart, the faster car to
  // its pair's side when they are exactly level
  for (let pass = 0; pass < 3; pass++) {
    for (const a of cars) for (const b of cars) {
      const room = CAR_W + 0.6 - Math.abs(out[a.id] - out[b.id]);
      if (a.id >= b.id || room <= 0 || Math.abs(wrap(b.s - a.s, len)) >= CAR_L) continue;
      const [f, s] = a.v > b.v ? [a, b] : [b, a];
      const dir = Math.sign(out[a.id] - out[b.id]) || (f === a ? 1 : -1) * sideOf(f.id + s.id);
      out[a.id] += dir * room / 2;
      out[b.id] -= dir * room / 2;
    }
  }
  for (const id in out) out[id] = clamp(out[id], -max, max);
  return out;
}

// GPS replays: the way a car faces at each frame (radians, in x, y's own axes), from the last stretch of at least min units
// it covered, so a car at a standstill keeps the direction it arrived in, whichever way the replay got there. Before its
// first move it faces the way it sets off. x, y: frames, null where the car has no data.
export function headings(x, y, min) {
  const out = new Float32Array(x.length).fill(NaN);
  let ax = null, ay = null, yaw = NaN;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === null) { ax = null; continue; }
    if (ax === null) { ax = x[i]; ay = y[i]; }
    else if (Math.hypot(x[i] - ax, y[i] - ay) >= min) { yaw = Math.atan2(y[i] - ay, x[i] - ax); ax = x[i]; ay = y[i]; }
    out[i] = yaw;
  }
  const first = out.find(v => !Number.isNaN(v));
  for (let i = 0; i < x.length && Number.isNaN(out[i]); i++) out[i] = first;
  return out;
}

// GPS replays: OpenF1's sample times jitter, so on the 0.5 s grid a car's pace see-saws (226, 163, 200 km/h a frame
// apart) and every camera saw it surge back and forth. Smooths the distance covered over time (gaussian, sigma frames)
// and puts each frame back on the car's own path at that distance: the line stays the GPS one, only the surge goes.
// x, y: frames, null where the car has no data (each run is smoothed on its own). Returns new [x, y].
export function retime(x, y, sigma = 1.5) {
  const X = x.slice(), Y = y.slice(), r = Math.ceil(sigma * 3), w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-k * k / (2 * sigma * sigma)));
  for (let a = 0; a < x.length; a++) {
    if (x[a] === null) continue;
    let b = a;
    while (b + 1 < x.length && x[b + 1] !== null) b++;
    const s = [0];
    for (let i = a + 1; i <= b; i++) s.push(s.at(-1) + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]));
    for (let i = a, j = 0; i <= b; i++) {  // j: the path segment the smoothed distance lands in, only ever moves on
      let sum = 0, n = 0;
      const e = Math.min(r, i - a, b - i);  // symmetric near a gap, or a one-sided window would pull the car ahead
      for (let k = -e; k <= e; k++) { sum += w[k + r] * s[i + k - a]; n += w[k + r]; }
      const d = sum / n;
      while (j < b - a && s[j + 1] < d) j++;
      const f = j < b - a && s[j + 1] > s[j] ? (d - s[j]) / (s[j + 1] - s[j]) : 0;
      X[i] = x[a + j] + f * ((x[a + j + 1] ?? x[a + j]) - x[a + j]);
      Y[i] = y[a + j] + f * ((y[a + j + 1] ?? y[a + j]) - y[a + j]);
    }
    a = b;
  }
  return [X, Y];
}

// GPS replays: OpenF1 positions are metres off and not quite in sync between cars, so two cars side by side or in a close
// pass land on top of each other. cars: [{id, x, y, dx, dy}]: position (m, map axes, y down) and unit direction of travel.
// sides: {pair: +1 / -1}, the caller's between frames: which side of the first car the second keeps until they're apart
// again, taken when they first need the room, so a noisy gap never flips one through the other. Each car of an overlapping pair moves
// half the overlap across its direction; the room needed tapers to nothing over 3 m past a car length. Returns {id: [ex, ey]} m.
export function apart(cars, sides) {
  const out = {}, room = CAR_W + 0.4;
  for (const c of cars) out[c.id] = [0, 0];
  for (let pass = 0; pass < 3; pass++) {  // chains: a pair pushed apart can push into a third car
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], key = a.id + '|' + b.id, ea = out[a.id], eb = out[b.id];
      const rx = b.x + eb[0] - a.x - ea[0], ry = b.y + eb[1] - a.y - ea[1];
      if (Math.hypot(rx, ry) > CAR_L + 10) { if (pass === 0) delete sides[key]; continue; }
      const ds = Math.abs(rx * a.dx + ry * a.dy), dl = rx * a.dy - ry * a.dx;  // along a's direction; + = b on a's left
      const need = ds <= CAR_L ? room : ds >= CAR_L + 3 ? 0 : room * (0.5 + 0.5 * Math.cos(Math.PI * (ds - CAR_L) / 3));
      if (need === 0) continue;
      const side = sides[key] ??= Math.sign(dl) || 1;  // taken once alongside: by then the passer has pulled out
      const push = side * need - dl;  // what b still has to move left of a (and a right of b)
      if (push * side <= 0) continue;
      const [nx, ny] = [a.dy * push / 2, -a.dx * push / 2];  // a's left normal (map y down), half each
      eb[0] += nx; eb[1] += ny;
      ea[0] -= nx; ea[1] -= ny;
    }
  }
  return out;
}
