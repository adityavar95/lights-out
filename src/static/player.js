// Playable driver: the player's wheel and pedals filtered into the same control struct the AI drives with (vehicle.js
// runs both through one solver). The filter is era-adaptive, from the car's profile (eras.js driver / aids): a 1960s
// car keeps more lock at speed and a crisp throttle, a 1986 turbo or a 2022 ground-effect car a damped wheel and a
// softer pedal. Pure; sim.js calls playerControls for the car the player has taken over.
import {autoShift, REAR_STIFF} from './vehicle.js';

// rules: OPEN lets every assist work in any era; ERA allows only what was legal that season (TC 1991-93 and 2001-07,
// launch control with it, ABS 1992-93). clutch: AUTO clutches and blips for you; MANUAL needs the clutch (X / pad L3) to
// change gear in an H-pattern car, and a blip of throttle on each downshift or the rear wheels snatch.
// steer: ASSIST asks for front grip (see steer below); RAW is the wheel angle you ask for, for a pad or wheel that can catch a slide
export const ASSISTS = {tc: 'MED', abs: true, gearbox: 'AUTO', clutch: 'AUTO', brakeAssist: 'LOW', line: 'ON', rules: 'OPEN', steer: 'ASSIST'};
const MODERN = {maxLock: 0.35, wb: 3.6, driver: {vRef: 30, steerTau: 0.06}};

// Steering. The input (-1..1, + = right) is never applied raw:
//   lock:      the road-wheel angle allowed shrinks with speed, 0.92 maxLock / (1 + (v / vRef)^2): with a modern car
//              (vRef 30 m/s) ~18 deg at walking pace and ~1.9 deg at 320 km/h; a 1950s car (vRef 45) keeps more,
//              for the opposite lock its drifts need
//   damper:    the wheel follows the target through a first-order lag, tau = steerTau + 0.0006 v s (a heavier rack
//              under aero load), so a keyboard tap becomes a smooth input
//   centring:  self-aligning torque. The front tyres' pneumatic trail pulls the wheels towards zero front slip, the
//              direction the front axle is really going; with the hands coming off the wheel it is unwound quickly
export function steer(car, input, h, c = MODERN, raw = false) {
  const v = car.v, lock = c.maxLock * 0.92 / (1 + (v / c.driver.vRef) ** 2);
  // zero front slip: the wheels point where the front axle is going, atan((v_y + a r) / u) (the kinematic path's angle
  // at walking pace, where the tyres don't slip)
  const a = c.wb * (1 - (c.fwd ?? 0.45)), free = car.v > 3 ? Math.atan(((car.vy ?? 0) + a * (car.r ?? 0)) / car.v) : Math.atan(c.wb * car.kPath);
  // Steering assist, as racing games filter keys and sticks: from 15 m/s the input asks for front grip, not a wheel
  // angle. Centre points the wheels where the front axle is going (no cornering force: a slide is caught by itself),
  // full lock puts the front tyres at their peak slip angle. A held key corners at the limit instead of scrubbing the
  // fronts (understeer), and a digital key can't wind on so much lock that the car snaps round when it bites. Steering
  // into the rotation is backed off as the rear nears its own peak (braking moves load onto the fronts, which would
  // then out-pull it and spin the car); counter-steer always gets the full window.
  const peak = c.profile?.tyre.slipPeak, w = peak && !raw ? Math.min(1, Math.max(0, (v - 5) / 10)) : 0;  // raw: the low-speed branch at every speed
  const rear = Math.abs(car.slipR ?? 0) * REAR_STIFF / (peak || 1), into = input.steer * (car.r ?? 0) > 0;
  const win = into ? Math.min(1, Math.max(0, 1 - 3 * (rear - 0.6))) : 1;
  const target = (1 - w) * input.steer * lock + (w && w * (free + input.steer * peak * win));
  car.delta += (target - car.delta) * (1 - Math.exp(-h / (c.driver.steerTau + 0.0006 * v)));
  const slip = car.delta - free;
  car.delta -= slip * (1 - Math.abs(input.steer)) * Math.min(1, 6 * h);
}

// The player's controls this step, written into the car's control struct X. env: {vAllow: the speed the car can still
// brake down to for what's ahead}.
export function playerControls(R, car, h, X, env) {
  const c = car.spec, inp = R.input, A = R.assists, legal = A.rules === 'ERA' ? c.aids : {tc: true, abs: true, launch: true};
  steer(car, inp, h, c, A.steer === 'RAW');
  X.steer = car.delta / c.maxLock;
  X.kappa = null;  // the player's car runs the full tyre dynamics
  X.fyNeed = c.mass * Math.abs(car.v * (car.r ?? 0)) * 1.15;  // TC keeps back the cornering force the car is pulling, and some
  // throttle map: the pedal reaches the engine through the era's lag (throttleTau)
  car.thrF = (car.thrF ?? 0) + (inp.throttle - (car.thrF ?? 0)) * (1 - Math.exp(-h / c.driver.throttleTau));
  let throttle = car.thrF, brake = inp.brake;
  // Corner braking assist: if the car is well above the speed it can still brake down to for what's ahead, blend in
  // braking (LOW makes up 40 % of the shortfall, HIGH 80 %) and back off the throttle
  if (A.brakeAssist !== 'OFF' && car.v > env.vAllow + 2) {
    const assist = Math.min(1, Math.max(0, (car.v - env.vAllow) / 6)) * (A.brakeAssist === 'HIGH' ? 0.8 : 0.4);
    brake = Math.max(brake, assist);
    throttle = Math.min(throttle, 1 - assist);
  }
  X.throttle = throttle;
  X.brake = brake;
  X.preload = 0;
  // ABS pulses around the lock threshold; TC FULL holds the drive at 97 % of the traction limit, MED at it (a little
  // slip allowed), OFF leaves it to the right foot; launch control, where legal, holds it off the grid
  X.abs = A.abs && !!legal.abs;
  X.tc = legal.tc ? {FULL: 0.97, MED: 1.0, OFF: null}[A.tc] : null;
  X.reserve = X.tc == null ? 0.25 : A.tc === 'FULL' ? 0.5 : 0.42;  // grip TC keeps for steering, so a correction holds
  if (X.tc == null && legal.launch && car.lapsDone === 0 && car.s < 30) X.tc = 1;  // the standing start only
  X.stability = A.tc === 'FULL' || A.brakeAssist !== 'OFF';  // ESC-like rear rescue (vehicle.js); TC MED/OFF and no braking assist: raw
  X.autoClutch = A.clutch === 'AUTO';
  X.autoBlip = A.clutch === 'AUTO' || A.gearbox === 'AUTO';
  X.clutch = inp.clutch ?? 0;
  if (A.gearbox === 'AUTO') X.gearShift = autoShift(car, c, brake);
  else { X.gearShift = inp.up ? 1 : inp.down ? -1 : 0; inp.up = inp.down = false; }
}

// What a gamepad should feel, 0..1 each: the strong (low-frequency) motor for kerbs, the grass and contact; the weak one for
// the tyres, a front lock-up or ABS, wheelspin and the stability control stepping in; on impulse triggers a lock-up or ABS
// also buzzes the brake trigger (left) and wheelspin the throttle trigger (right). off: the player's `dirt` (sim.js) is 1
// only while the car is off the track.
export function rumbleFor(car) {
  const kerb = car.kerb > 0 ? (car.sausage ? 0.9 : 0.5) : 0, off = car.dirt === 1 ? 0.7 * Math.min(1, car.v / 60) : 0;
  return {
    strong: Math.max(kerb, off, car.contact > 0 ? 1 : 0),
    weak: Math.max(car.absOn || car.locked ? 0.6 : 0, Math.min(1, car.spin ?? 0), car.escOn ? 0.3 : 0),
    left: car.locked ? 0.9 : car.absOn ? 0.5 : 0,
    right: Math.min(1, 0.8 * (car.spin ?? 0)),
  };
}
