// Playable driver: steering with a speed-sensitive damper and self-centring, the car's own path in the track's
// curvilinear (Frenet) frame, pedals through traction control / ABS / braking assist, and an automatic or manual
// sequential gearbox. Pure; sim.js calls playerDrive for the car the player has taken over.
import {clamp} from './telemetry.js';

const G = 9.81, L = 3.6;  // wheelbase, m
export const RPM_LIMIT = 15000;
const GEAR_TOP = [0, 126, 168, 210, 252, 294, 336, 372, 414];  // km/h at 15,000 rpm in each gear
export const ASSISTS = {tc: 'MED', abs: true, gearbox: 'AUTO', brakeAssist: 'LOW', line: 'ON'};

// Engine torque curve as a share of peak power over revs: a turbo V6 is weak below ~5,000 rpm, strong from ~10,500, and
// tails off a little towards the limiter.
const powerShare = rpm => clamp(0.25 + 0.75 * clamp((rpm - 5000) / 5500, 0, 1), 0, 1) * (rpm > 13000 ? 1 - (rpm - 13000) / 8000 : 1);
export const rpmFor = (kmh, gear) => (gear ? RPM_LIMIT * kmh / GEAR_TOP[gear] : 4000);

// Steering. The input (-1..1, + = right) is never applied raw:
//   lock:      maximum road-wheel angle shrinks with speed, 0.32 rad / (1 + (v / 30 m/s)^2): ~18 deg at walking pace,
//              ~1.7 deg at 320 km/h, where even that already asks for far more grip than exists
//   damper:    the wheel follows the target through a first-order lag, tau = 0.06 + 0.0015 v s (a heavier rack under
//              aero load), so a keyboard tap becomes a smooth input
//   centring:  self-aligning torque. The front tyres' pneumatic trail pulls the wheels towards the angle that matches
//              the path the car really follows (delta0 = atan(L kappa_path)); the difference is the front slip angle,
//              and with the hands coming off the wheel it is unwound quickly
export function steer(car, input, h) {
  const v = car.v, lock = 0.32 / (1 + (v / 30) ** 2);
  car.delta += (input.steer * lock - car.delta) * (1 - Math.exp(-h / (0.06 + 0.0015 * v)));
  const slip = car.delta - Math.atan(L * car.kPath);
  car.delta -= slip * (1 - Math.abs(input.steer)) * Math.min(1, 6 * h);
}

// One physics step for the player's car. env: {T, c (car spec), k (track curvature here), aGrip (m/s^2 of grip),
// N (normal load), drag (N), vAllow (speed it can still brake to for what's ahead), power(throttle, brake, coast) -> W}
export function playerDrive(R, car, h, env) {
  const {T, c, k, drag, N, slope = 0, roll = 0} = env, inp = R.input, A = R.assists, m = c.mass, v = car.v;
  steer(car, inp, h);
  // off the track: run-off and grass past the kerbs hold far less (x0.55) and drag at the car
  const off = Math.abs(car.d) > T.half + 1.6;
  let aGrip = env.aGrip * (off ? 0.55 : 1) * (car.spin > 0 ? 1 - 0.5 * car.spin : 1);

  // --- lateral: kinematic bicycle model, kappa = tan(delta) / L, capped by what the tyres can give ---
  // Friction circle: the lateral grip left is sqrt(a_grip^2 - a_long^2) given last step's longitudinal force; locked
  // fronts (no ABS) can't steer at all. Asking for more is understeer: the car follows the curvature the grip allows.
  // Banking: a road tilted towards the inside of the turn adds g sin(beta) of cornering capacity; off-camber (tilted
  // away) takes it off, which on a corner exit under power is where the rear lets go first.
  const kCmd = Math.tan(car.delta) / L, help = 9.81 * Math.sin(roll) * (Math.sign(kCmd) || 0);
  const latCap = Math.max(0, Math.sqrt(Math.max(0, aGrip * aGrip - car.aLong * car.aLong)) * (car.locked ? 0.25 : 1) + help);
  car.kPath = Math.abs(v * v * kCmd) > latCap ? Math.sign(kCmd) * latCap / Math.max(v * v, 1) : kCmd;
  // Frenet kinematics, with psi the heading relative to the track tangent and d the offset (right +):
  //   s' = v cos(psi) / (1 - kappa d)   (closer to the inside of a bend, a metre of track is shorter)
  //   d' = v sin(psi)
  //   psi' = v kappa_path - kappa s'    (the car turns by its own path curvature, the track by its)
  // Rear grip lost to wheelspin (car.spin) lets the back step out: extra yaw towards the inside of the car's own turn.
  const sDot = v * Math.cos(car.psi) / Math.max(0.3, 1 - k * car.d);
  car.psi += (v * car.kPath - k * sDot + Math.sign(car.kPath || car.psi) * car.spin * 1.6) * h;
  car.psi = clamp(car.psi, -Math.PI / 2, Math.PI / 2);
  car.d += v * Math.sin(car.psi) * h;
  car.s += sDot * h;
  // the barrier 10 m out: the car stops against it, losing speed with the impact angle, and damages its wing
  if (Math.abs(car.d) > T.half + T.wall - 0.5) {  // the circuit's barrier line (Monaco's Armco: right at the edge)
    const hit = v * Math.abs(Math.sin(car.psi));
    car.d = Math.sign(car.d) * (T.half + T.wall - 0.5);
    car.psi *= -0.3;
    car.v *= Math.max(0.2, 1 - hit / 30);
    car.damage = Math.min(1, car.damage + hit / 40);
    car.contact = 0.25;
  }
  if (car.spin > 0) car.spin = Math.max(0, car.spin - 0.6 * h);
  if (Math.abs(car.psi) > 1.1) car.v *= Math.exp(-1.5 * h);  // spun: scrubbing off speed sideways

  // --- pedals, gearbox and assists ---
  let throttle = inp.throttle, brake = inp.brake;
  // Corner braking assist: if the car is well above the speed it can still brake down to for what's ahead, blend in
  // braking (LOW makes up 40 % of the shortfall, HIGH 80 %) and back off the throttle
  if (A.brakeAssist !== 'OFF' && v > env.vAllow + 2) {
    const assist = clamp((v - env.vAllow) / 6, 0, 1) * (A.brakeAssist === 'HIGH' ? 0.8 : 0.4);
    brake = Math.max(brake, assist);
    throttle = Math.min(throttle, 1 - assist);
  }
  gearbox(car, inp, A, v, brake);
  car.rpm = rpmFor(v * 3.6, car.gear);
  const limiter = car.rpm >= RPM_LIMIT;  // rev limiter: the ECU cuts ignition, the revs bounce off 15,000
  if (limiter) { car.rpm = RPM_LIMIT - Math.random() * 250; throttle *= 0.3; }
  const P = env.power(throttle, brake, throttle < 0.05 && brake < 0.05 && v > 40) * powerShare(car.rpm);

  // Traction. The driven rear axle carries ~60 % of the grip that is left after cornering. Up to that limit the tyre
  // deforms (slip ratio rising roughly linearly to ~8 %, where grip peaks, and a little past it on the flat top of the
  // curve, to ~105 % of the nominal force); beyond that the wheels spin up, the tyre slides on its lower kinetic
  // friction (x0.75 of the peak) and the rear loses lateral grip too.
  //   TC FULL holds the drive force to 97 % of the limit, MED to 103 % (a little slip allowed), each intervention an
  //   ignition cut the audio plays as a stutter; TC OFF leaves it all to the right foot.
  const aCap = Math.sqrt(Math.max(0, aGrip * aGrip - Math.max(0, Math.abs(v * v * car.kPath) - help) ** 2));
  const fTrac = 0.6 * c.muLong * aCap * m, fWant = throttle * P / Math.max(v, 5);
  const tcCap = {FULL: 0.97, MED: 1.03, OFF: Infinity}[A.tc];
  let fDrive = fWant;
  car.tcCut = false;
  if (fWant > fTrac * tcCap) { fDrive = fTrac * tcCap; car.tcCut = true; }
  if (fDrive > fTrac * 1.05) { fDrive = 0.75 * fTrac; car.spin = Math.min(1, car.spin + 3 * h * (fWant / fTrac - 1)); car.tcCut = false; }
  // Brakes. The tyres can take muLong x the grip left; pressing harder locks the wheels.
  //   ABS pulses the pressure around 97 % of the lock threshold (a 14 Hz cycle), so the fronts keep rolling and still
  //   steer into the chicane; without ABS the wheels lock, slide at 80 % of the peak force, lose steering and flat-spot
  //   (extra wear and a temperature spike on the fronts).
  const fLock = c.muLong * aCap * m, fWantB = brake * m * c.maxBrakeG * G;
  let fBrake = fWantB;
  car.locked = false;
  car.absOn = A.abs && fWantB > fLock;  // for the deck's status light
  if (fWantB > fLock) {
    if (A.abs) fBrake = fLock * (0.93 + 0.04 * Math.sin(R.t * 2 * Math.PI * 14));
    else { fBrake = 0.8 * fLock; car.locked = true; }
  }
  const a = (fDrive - fBrake - drag - c.crr * N * (off ? 4 : 1)) / m - slope;  // slope: g sin(pitch), uphill +
  car.v = Math.max(0, v + a * h);
  car.aLong = a;
  return {a, aLat: v * v * car.kPath, throttle, brake, locked: car.locked};
}

// Automatic: up at 12,600 rpm, down below 8,500 (10,500 while braking, to keep the engine braking and be ready for the
// exit). Manual: the paddles, with over-rev protection refusing a downshift that would take the revs past the limiter.
function gearbox(car, inp, A, v, brake) {
  const kmh = v * 3.6;
  if (A.gearbox === 'AUTO') {
    if (car.gear < 8 && rpmFor(kmh, car.gear) > 12600) car.gear++;
    else if (car.gear > 1 && rpmFor(kmh, car.gear) < (brake > 0.2 ? 10500 : 8500)) car.gear--;
    if (car.gear < 1) car.gear = 1;
    return;
  }
  if (inp.up && car.gear < 8) car.gear++;
  if (inp.down && car.gear > 1) {
    if (rpmFor(kmh, car.gear - 1) <= RPM_LIMIT) car.gear--;
    else car.overRev = 0.4;  // refused: flash for 0.4 s
  }
  inp.up = inp.down = false;
  if (car.gear < 1) car.gear = 1;
}
