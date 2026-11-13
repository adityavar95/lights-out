// The globe's maths (globe.js), pure: tests/test_globe.mjs. Lengths are Earth radii, angles degrees.
import {mercator} from './satellite.js';

const RAD = Math.PI / 180;
const ease = t => t * t * (3 - 2 * t);

// a point of the unit sphere: north is +y, longitude 0 faces +z, east of it is +x
export const llToVec = (lat, lng) => [Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lng * RAD)];
export const vecToLL = ([x, y, z]) => [Math.asin(y / Math.hypot(x, y, z)) / RAD, Math.atan2(x, z) / RAD];

// [lat, lng] of a Web Mercator tile coordinate (fractions run across the tile)
export const tileLL = (z, x, y) => [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) / RAD, x / 2 ** z * 360 - 180];

// the top-left tile [x, y] of the n x n block at zoom z with [lat, lng] nearest its middle
// shortcut: clamped at the antimeridian instead of wrapping, no circuit is within a block of it
export const tilesRound = (lat, lng, z, n) => mercator([lng, lat], z).map(p => Math.max(0, Math.min(2 ** z - n, Math.round(p / 256 - n / 2))));

// The camera's flight between two views {lat, lng, alt} at f in 0..1: it turns the short way round first, then drops
// straight down, by a constant factor per second (so every height takes as long to cross), since a turn made low
// down is a blur of ground. From low down (one circuit to the next) it first climbs to about as high as the hop is long.
export function flight(a, b, f) {
  const turn = ease(Math.min(1, f / 0.4)), drop = ease(Math.max(0, (f - 0.3) / 0.7)), dl = (b.lng - a.lng + 540) % 360 - 180;
  const [p, q] = [llToVec(a.lat, a.lng), llToVec(b.lat, b.lng)], hop = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  const up = Math.max(a.alt, Math.min(2, hop));
  return {lat: a.lat + (b.lat - a.lat) * turn, lng: a.lng + dl * turn, alt: a.alt * (up / a.alt) ** ease(Math.min(1, f / 0.15)) * (b.alt / up) ** drop};
}

// The pin the view is over: the index of the one of `ats` (unit vectors) nearest the camera's direction `dir` (unit),
// or -1 unless it is in the middle of the window: within 0.4 of the height (the 40° lens sees 0.36 each way), and
// within ~5 km however low, so the circuit can be looked round
export function over(ats, dir, alt) {
  let best = -1, d = Math.cos(Math.max(alt * 0.4, 0.0008));
  ats.forEach(([x, y, z], i) => { const c = x * dir[0] + y * dir[1] + z * dir[2]; if (c >= d) { d = c; best = i; } });
  return best;
}
