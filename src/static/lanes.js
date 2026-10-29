// Lateral placement for the lap-timing replay, which only knows how far round the lap each car is: it would put every
// car on the centre line, all on one spot at the start and through each other when one passes another. Pure.
import {clamp} from './telemetry.js';
import {CAR_L, CAR_W} from './racecraft.js';

const wrap = (x, len) => ((x % len) + 1.5 * len) % len - len / 2;  // signed distance along the lap, -len/2..len/2

// the grid: two columns, a slot every `row` m with pole `front` m behind the line; the columns close up over `fade` m
export const GRID = {row: 8, front: 6, col: 1.6, fade: 250};
// a passing car sits PASS m off the line from REACH m behind the car it passes until it is AFTER m past it
const PASS = 3.2, REACH = 35, AFTER = 25;
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
