// Pit-wall telemetry maths. Pure (no DOM, no canvas), so node tests can run it.

const BLUE = [56, 132, 255], GREEN = [47, 208, 111], RED = [255, 64, 72];
const blend = (a, b, f) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(' ')})`;

// A slick's surface temperature as a colour: cold under 75 C, in its working window 90-110 C, overheating past 125 C,
// and a blend between, so a tyre coming up to temperature shows it before it arrives.
export function tyreBand(c) {
  if (c <= 75) return blend(BLUE, BLUE, 0);
  if (c < 90) return blend(BLUE, GREEN, (c - 75) / 15);
  if (c <= 110) return blend(GREEN, GREEN, 0);
  if (c < 125) return blend(GREEN, RED, (c - 110) / 15);
  return blend(RED, RED, 0);
}

// The GG diagram's traction ellipse: a car brakes harder than it accelerates, so the grip limit isn't a circle.
export const GG = {lat: 5, brake: -5.5, drive: 2.2};
export const ggCentre = () => (GG.drive + GG.brake) / 2;
export const ggSemi = () => [GG.lat, (GG.drive - GG.brake) / 2];
// 1 = on the ellipse, over 1 = past it
export function ggLoad(gLat, gLong) {
  const [a, b] = ggSemi(), y = gLong - ggCentre();
  return Math.hypot(gLat / a, y / b);
}

// 15 shift lights across the rev range's 0-15,000 rpm scale: one per 1,000 rpm, so they read off the chart beside them
export const RPM_SCALE = 15000, LEDS = 15;
export const litLeds = rpm => Math.max(0, Math.min(LEDS, Math.round((rpm ?? 0) / RPM_SCALE * LEDS)));

// A race-time strip of samples for one car. Time only runs forwards: a scrub back starts afresh rather than drawing
// two histories over each other. window: seconds kept.
export function strip(window = 30) {
  const s = {t: [], window, push(t, row) {
    const last = s.t.at(-1);
    if (last !== undefined && t < last) s.clear();
    else if (last !== undefined && t - last < 1 / 30) return false;  // a 10x replay has plenty of frames for 30 Hz of race time
    s.t.push(t);
    s.rows.push(row);
    const old = t - window;
    let n = 0;
    while (n < s.t.length - 1 && s.t[n] < old) n++;
    if (n > 0) { s.t.splice(0, n); s.rows.splice(0, n); }
    return true;
  }, clear() { s.t.length = 0; s.rows.length = 0; }, rows: []};
  return s;
}

// the sample nearest race time t, by bisection
export function sampleAt(s, t) {
  let lo = 0, hi = s.t.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s.t[m] < t) lo = m + 1; else hi = m;
  }
  return lo > 0 && t - s.t[lo - 1] < s.t[lo] - t ? s.rows[lo - 1] : s.rows[lo];
}

// the outline point nearest p. around: start index of a local search (cars move a few points a frame); undefined searches all
export function nearestPoint(pts, p, around) {
  const n = pts.length;
  let best = 0, bd = Infinity;
  const look = around === undefined ? n : Math.min(n, 40);
  const from = around === undefined ? 0 : around - 20;
  for (let k = 0; k < look; k++) {
    const i = ((from + k) % n + n) % n, dx = pts[i][0] - p[0], dy = pts[i][1] - p[1], d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
