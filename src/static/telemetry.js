// Derived telemetry: what a broadcast HUD shows but the free feeds don't carry (g-forces, tyre temperatures and wear,
// ERS, gear/RPM/pedals when OpenF1 car data is missing), estimated from how the car moves. Pure functions and small
// state objects, no DOM or three.js, so tests can run them in node. Positions are in metres, map orientation
// (x right, y down: the track seen from above), times in seconds.

export const G = 9.81;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Kinematics from three positions h seconds apart, by central differences:
//   v = (p2 - p0) / 2h                   velocity at the middle sample
//   a = (p2 - 2 p1 + p0) / h^2           acceleration
// Longitudinal g is a projected on the direction of travel (+ accelerating, - braking). Lateral g is the component
// across it: with y pointing down the 2D cross product v x a is positive for a clockwise (right-hand) turn seen
// from above, so gLat > 0 means turning right, i.e. the centripetal pull pointing to the driver's right.
export function kinematics(p0, p1, p2, h) {
  const vx = (p2[0] - p0[0]) / (2 * h), vy = (p2[1] - p0[1]) / (2 * h), speed = Math.hypot(vx, vy);
  const ax = (p2[0] - 2 * p1[0] + p0[0]) / (h * h), ay = (p2[1] - 2 * p1[1] + p0[1]) / (h * h);
  if (speed < 1) return {speed, gLong: 0, gLat: 0};  // stopped: direction undefined
  const ux = vx / speed, uy = vy / speed;
  return {speed, gLong: clamp((ax * ux + ay * uy) / G, -6, 6), gLat: clamp((ux * ay - uy * ax) / G, -6, 6)};
}

// Power unit and weight by regulation era, each entry listing what changed that year (approximate public figures:
// teams never published exact power). cyl: cylinders (the audio's firing frequency); rpmMax: rev limit (regulated from
// 2007); turbo: turbocharged (whistle and hiss in the audio); pIce: engine peak power, W; minMass: minimum mass with
// driver, kg; pK: KERS / MGU-K power, W, with the store (battery) and per-lap harvest / deploy limits, J (KERS: 60 kW and
// 400 kJ a lap, unused in 2010; MGU-K: 120 kW, 2 MJ harvest, 4 MJ deploy; 2026: 350 kW, ~8.5 MJ); drs: from 2011.
const ENGINES = [
  [0, {name: '3.0L V10', cyl: 10, rpmMax: 17000, turbo: false, pIce: 520e3, minMass: 595, pK: 0, battery: 4e6, harvestLap: 0,
       deployLap: 0, drs: false}],
  [2000, {rpmMax: 18000, pIce: 600e3}],
  [2003, {rpmMax: 19000, pIce: 670e3}],
  [2004, {minMass: 605}],
  [2006, {name: '2.4L V8', cyl: 8, rpmMax: 20000, pIce: 560e3}],
  [2007, {rpmMax: 19000}],
  [2009, {name: '2.4L V8 + KERS', rpmMax: 18000, pK: 60e3, battery: 0.5e6, harvestLap: 0.5e6, deployLap: 0.4e6}],
  [2010, {name: '2.4L V8', minMass: 620, pK: 0, harvestLap: 0, deployLap: 0}],
  [2011, {name: '2.4L V8 + KERS', minMass: 640, pK: 60e3, harvestLap: 0.5e6, deployLap: 0.4e6, drs: true}],
  [2013, {minMass: 642}],
  [2014, {name: '1.6L V6 turbo hybrid', cyl: 6, rpmMax: 15000, turbo: true, pIce: 450e3, minMass: 691, pK: 120e3, battery: 4e6,
          harvestLap: 2e6, deployLap: 4e6}],
  [2015, {minMass: 702}],
  [2017, {minMass: 728, pIce: 560e3}],
  [2018, {minMass: 733}],
  [2019, {minMass: 743}],
  [2020, {minMass: 746}],
  [2021, {minMass: 752}],
  [2022, {minMass: 798}],
  [2025, {minMass: 800}],
  [2026, {minMass: 768, pIce: 400e3, pK: 350e3, harvestLap: 8.5e6, deployLap: 8.5e6}],
];
export function engine(year) {
  let e = {};
  for (const [from, c] of ENGINES) if (year >= from) e = {...e, ...c};
  return e;
}

// Gear and RPM without car data: an 8-speed box shifts near the top of each gear's band (km/h at the limiter for a
// modern car), and within a gear engine speed is proportional to road speed: rpm = RPM_MAX * v / vTop(gear). RPM_MAX is
// a V6 hybrid's working ceiling; other eras (rpmMax) rev the same share of their limiter.
const GEAR_TOP = [0, 105, 140, 175, 210, 245, 280, 310, 345], RPM_MAX = 12500;
export function gearbox(kmh, rpmMax = 15000) {
  const band = GEAR_TOP.findIndex(v => v >= kmh), gear = kmh < 5 ? 0 : band < 0 ? 8 : Math.max(1, band), top = RPM_MAX * rpmMax / 15000;
  return {gear, rpm: gear ? Math.round(clamp(top * kmh / GEAR_TOP[gear], 4000, top)) : 4000};
}

// Pedals without car data, from longitudinal g: above ~0.6 g of deceleration aero drag alone can't explain it, so the
// driver is braking (full braking at ~4 g); otherwise throttle rises with acceleration and is flat out at high speed
// where drag balances full power.
export function pedals(gLong, kmh) {
  const brake = clamp((-gLong - 0.6) / 3.4, 0, 1);
  const throttle = brake > 0 ? 0 : clamp(0.25 + gLong * 0.9 + kmh / 400, 0, 1);
  return {throttle: Math.round(throttle * 100), brake: Math.round(brake * 100)};
}

// Energy store: the MGU-K deploys at full throttle and harvests under braking. Rules: 120 kW and a 4 MJ usable
// window up to 2025, 350 kW from 2026. State of charge integrates power over time: dSOC/dt = P / capacity.
export function ersStep(state, throttle, brake, kmh, dt, year) {
  const {pK: P, battery: CAP} = engine(year);  // no recovery before 2009 (and in 2010): it stays on HOLD
  let mode = 'HOLD', power = 0;
  if (brake > 20) { mode = 'HARVEST'; power = P * brake / 100; }
  else if (throttle > 95 && kmh > 120 && state.soc > 0.02) { mode = 'DEPLOY'; power = -P; }
  state.soc = clamp(state.soc + power * dt / CAP, 0, 1);
  state.mode = mode;
  return state;
}

// Tyres, first-order thermal model per corner (FL, FR, RL, RR) for the surface temperature T:
//   C dT/dt = v (0.12 + 0.08 * 4 share * |g|) - k (6 + sqrt v) (T - T_track)
// Heat comes from rolling plus sliding, and frictional power is force x sliding speed, so it scales with the
// tyre's share of the load times |g| times speed. Load shifts to the outside wheels in corners (lateral weight
// transfer) and to the fronts under braking / rears under traction. Cooling is convective, so it grows with airflow.
// The constants put a modern car at ~90-95 C on a straight and ~110 C after a long fast corner.
const WINDOW = {SOFT: [90, 110], MEDIUM: [90, 110], HARD: [90, 110], INTERMEDIATE: [55, 75], WET: [45, 65]};  // dry: as sim.js
const WEAR = {SOFT: 2.6, MEDIUM: 1.7, HARD: 1.1, INTERMEDIATE: 2.0, WET: 1.5};  // % per lap, typical dry-race degradation
export const CORNERS = ['FL', 'FR', 'RL', 'RR'];

export function tyreState(trackTemp = 35) {
  return {t: CORNERS.map(() => trackTemp + 50), energy: CORNERS.map(() => 1), trackTemp};
}

export function tyreStep(state, {speed, gLong, gLat}, dt) {
  const gAbs = Math.hypot(gLong, gLat), C = 3, k = 0.012;
  CORNERS.forEach((name, i) => {
    const front = name[0] === 'F', left = name[1] === 'L';
    // right turn (gLat > 0) loads the left side; braking (gLong < 0) loads the fronts
    const share = 0.25 + (left ? 1 : -1) * 0.07 * gLat + (front ? -1 : 1) * 0.05 * gLong;
    const heat = speed * (0.12 + 0.08 * 4 * Math.max(share, 0.05) * gAbs);
    state.t[i] += (heat - k * (6 + Math.sqrt(speed)) * (state.t[i] - state.trackTemp)) / C * dt;
    state.energy[i] += Math.max(share, 0.05) * gAbs * speed * dt * 1e-3;  // work done by this tyre, for wear bias
  });
  return state;
}

// wear % per corner: laps on the set x the compound's rate, biased by how much of the work each tyre has done
export function tyreWear(state, compound, age) {
  const rate = WEAR[compound] ?? 1.7, mean = state.energy.reduce((a, b) => a + b) / 4;
  return state.energy.map(e => clamp((age || 0) * rate * (0.8 + 0.4 * e / mean), 0, 100));
}

// colour for a surface temperature against the compound's working window: blue (cold) -> green (in the window) -> red
export function tyreColor(temp, compound) {
  const [lo, hi] = WINDOW[compound] ?? WINDOW.MEDIUM;
  if (temp < lo) return `hsl(${Math.round(120 + 90 * clamp((lo - temp) / 25, 0, 1))} 80% 50%)`;  // 120 green -> 210 blue
  if (temp <= hi) return 'hsl(130 75% 45%)';
  return `hsl(${Math.round(60 - 60 * clamp((temp - hi) / 20, 0, 1))} 90% 50%)`;  // 60 yellow -> 0 red
}

// DRS zones from the outline (metres, closed loop): long straights, curvature |dtheta/ds| under 1/400 m for over
// 450 m, opening 150 m after the corner exit and closing 60 m before the braking point, the three longest kept.
// Returns [startIndex, endIndex] pairs into pts. Approximate: the real zones are set per circuit by the FIA.
export function drsZones(pts) {
  const n = pts.length, seg = i => Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]);
  // heading change across +-30 m rather than between neighbours: outline points a few metres apart are noisy enough
  // to make every straight look curved
  let lap = 0;
  for (let i = 0; i < n; i++) lap += seg(i);
  const w = Math.max(1, Math.round(30 / (lap / n)));
  const straight = pts.map((b, i) => {
    const a = pts[(i - w + n) % n], c = pts[(i + w) % n];
    const d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) / (2 * w * lap / n) < 1 / 400;
  });
  const start = straight.findIndex(s => !s);
  if (start < 0) return [];
  const runs = [];
  let run = null;
  for (let k = 0; k <= n; k++) {  // walk once round from a curved point, so no run wraps past the start
    const i = (start + k) % n;
    if (straight[i] && k < n) {
      run ??= {from: i, len: 0};
      run.len += seg(i);
      run.to = i;
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  return runs.filter(r => r.len > 450).sort((a, b) => b.len - a.len).slice(0, 3).map(r => {
    let i = r.from, j = r.to, d = 0;
    while (d < 150) { d += seg(i); i = (i + 1) % n; }
    d = 0;
    while (d < 60) { j = (j - 1 + n) % n; d += seg(j); }
    return [i, j];
  });
}
