// Wheel-to-wheel racecraft for AI drivers: which lane to drive in (racing line, slipstream, attack, defence), keeping
// the space when side by side, and what happens when cars touch. Pure; sim.js calls it per car per step.
//
// Lanes are a continuous lateral offset d (metres, + = right of the direction of travel, -half..+half): every rule
// below just chooses a target d, and the car steers towards it at a limited lateral rate.
import {clamp} from './telemetry.js';

export const CAR_L = 5.5, CAR_W = 2.0;  // footprint, m
const wrap = (x, len) => ((x % len) + 1.5 * len) % len - len / 2;  // signed distance along the lap, -len/2..len/2

// side-by-side gap: a car's width plus a margin that shrinks as aggression rises (0.7 m conservative, 0.3 m max attack)
const clearance = R => CAR_W + 0.7 - 0.4 * R.ai.aggression;

// Radar: every car within a car length and a half ahead or behind, with its signed longitudinal (ds) and lateral (dd)
// offset. Overlap (|ds| < CAR_L) means the cars are alongside; this is the "360-degree" picture each driver works from.
export function radar(R, car) {
  const out = [];
  for (const o of R.cars) {
    if (o === car || o.finished || o.inLane) continue;
    const ds = wrap(o.s - car.s, R.T.len), dd = o.d - car.d;
    if (Math.abs(ds) < CAR_L * 1.5 && Math.abs(dd) < 6) out.push({o, ds, dd});
  }
  return out;
}

// The car to follow: the nearest one up to 40 m ahead that shares our lane (laterally within a car width + margin of
// where we are or where our lane is taking us). Not necessarily the nearest car: that may be the one alongside.
export function blocker(R, car) {
  let best = null, gap = Infinity;
  for (const o of R.cars) {
    if (o === car || o.finished || o.inLane) continue;
    const ds = wrap(o.s - car.s, R.T.len);
    if (ds <= 0 || ds > 40 || ds >= gap) continue;
    if (Math.min(Math.abs(car.d - o.d), Math.abs((car.dTarget ?? car.d) - o.d)) < CAR_W + 0.4) { best = o; gap = ds; }
  }
  return best && {o: best, gap};
}

// Lane choice. env: {o: car ahead, straight 0..1, brakeAhead: m to the next braking point, turn: +1 / -1 the direction of
// that corner (its inside is d = turn x half), line: racing-line offset here, neutral: VSC / SC}. Returns the target d.
//
// State machine per car (car.craft.mode):
//   LINE    the racing line
//   TOW     on a straight within 1.5 s of the car ahead: sit directly behind it (d = its d) for the slipstream
//   ATTACK  within the gap threshold (0.4-0.8 s with aggression) and either closing approaching the braking zone, or
//           with DRS open / deep in the tow (a follower held back to the leader's speed can't show closing speed until
//           it pulls out): move out of the wake to the clear side (the inside of the next corner unless the defender
//           covers it, then the outside), run ERS push, and brake a few percent deeper to claim the apex
//   DEFEND  a car closing within 0.7 s on a straight: make ONE move to cover the inside of the next corner, leaving a
//           car's width plus margin to the edge (FIA one-move rule); held until the corner, no second move
export function racecraft(R, car, env) {
  const T = R.T, agg = R.ai.aggression, edge = T.half - 1.0, st = car.craft ??= {mode: 'LINE', moved: false};
  const {o, straight, brakeAhead, turn, line, neutral} = env, behind = car.behind;
  car.deeper = 0;
  car.attackPush = false;
  if (straight < 0.5 && brakeAhead > 200) st.moved = false;  // through the corner: a new straight, a new move allowed
  let d = line;
  const closing = o ? car.v - o.v : 0, gapLimit = 0.4 + 0.4 * agg;
  if (neutral) {
    st.mode = 'LINE';
  } else if (o && car.gapSec < gapLimit && !car.blue
             && ((closing > 0.5 && brakeAhead < 260) || car.drs.open || (car.wake > 0.7 && brakeAhead < 400))) {
    if (st.mode !== 'ATTACK') st.side = o.d * turn > 1 ? -turn : turn;  // inside, unless the defender is already there
    st.mode = 'ATTACK';
    d = o.d + st.side * clearance(R) * 1.15;
    car.attackPush = true;
    if (Math.abs(car.d - o.d) > clearance(R)) car.deeper = 0.02 + 0.03 * agg;  // brake late only once out of its wake
  } else if (behind && car.gapBehindSec < 0.7 && car.closingBehind > 1 && straight > 0.7 && brakeAhead < 350 && (!st.moved || st.mode === 'DEFEND')) {
    // one move: cover the inside, but no closer to the edge than a car width + margin (centre |d| <= half - 1.5 W - 0.6)
    if (st.mode !== 'DEFEND') { st.moved = true; st.defendD = turn * Math.min(T.half - 1.5 * CAR_W - 0.6, Math.abs(line) + 1.5); }
    st.mode = 'DEFEND';
    d = st.defendD;
  } else if (o && car.gapSec < 1.5 && straight > 0.8 && brakeAhead > 120) {
    st.mode = 'TOW';
    d = o.d;
  } else {
    st.mode = 'LINE';
  }
  // Leave the space: with any car alongside (overlapping), stay at least the clearance away on our own side of it. The
  // racing line pulls both towards the apex, so this locks them into parallel inside / outside arcs through the
  // corner rather than turning in on each other. If our side is out of track, it's our job to back out: lift.
  car.squeezed = false;
  for (const {o: n, ds, dd} of radar(R, car)) {
    if (Math.abs(ds) >= CAR_L) continue;
    const gap = clearance(R);
    if (dd >= 0) d = Math.min(d, n.d - gap);  // it is to our right: keep left of it
    else d = Math.max(d, n.d + gap);
    if (Math.abs(d) > edge && ds > 0) car.squeezed = true;  // no room and it's ahead: we yield
  }
  return clamp(d, -edge, edge);
}

// Contact physics. Two footprints overlapping are pushed apart: mostly sideways if they touched wheel to wheel, along
// the track if it was nose to tail. In a rear-ending the cars trade momentum (partly inelastic: the closing speed drops
// by 60 %), and above ~4.5 m/s the hitting car breaks its front wing: damage (0..1) grows with the closing speed and costs
// downforce until a pit stop. Contact throws carbon sparks (car.contact > 0 for a moment).
export function resolveContacts(R) {
  const cars = R.cars.filter(c => !c.inLane && !c.finished && c.s > 0);
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], ds = wrap(b.s - a.s, R.T.len), dd = b.d - a.d;
      const lon = CAR_L - Math.abs(ds), lat = CAR_W - Math.abs(dd);
      if (lon <= 0 || lat <= 0) continue;
      if (lat < lon * 0.5) {  // side by side: rubbing wheels, push apart sideways
        const push = lat / 2 + 0.05, sgn = Math.sign(dd) || 1;
        a.d -= sgn * push;
        b.d += sgn * push;
        a.contact = b.contact = 0.15;
        if (a.player || b.player) for (const x of [a, b]) x.damage = Math.min(1, x.damage + 0.04);
      } else {  // nose to tail
        const [rear, front] = ds > 0 ? [a, b] : [b, a], closing = rear.v - front.v;
        rear.s -= lon;  // no interpenetration
        if (closing > 0) {
          rear.v -= 0.6 * closing;
          front.v += 0.3 * closing;
          if (closing > 4.5) rear.damage = Math.min(1, rear.damage + closing / 25);  // a real hit, not a tap
        }
        rear.contact = front.contact = 0.2;
      }
    }
  }
}
