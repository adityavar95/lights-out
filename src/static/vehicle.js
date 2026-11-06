// The vehicle solver: one deterministic physics step for every car, the player's or the AI's, from the same normalised
// control struct and the car's EraVehicleProfile (eras.js, flattened by carSpec). Pure; sim.js calls it per car per
// physics step. Units SI; lateral quantities are + to the right (the track's convention: right-hand turns have k > 0).
//
// Control struct (player.js filters the player's pedals and wheel into it, sim.js's AI computes it):
//   throttle, brake, clutch 0..1 · steer -1..1 (share of the mechanical lock) · gearShift -1 | 0 | 1
//   aeroMode FIXED | DRS_OPEN | Z_MODE_CORNER | X_MODE_STRAIGHT · ersMode NONE | HARVEST | BALANCED | PUSH | BOOST_OVERRIDE
//   plus the assists the driver has: abs, tc (share of the traction limit or null), autoBlip, autoClutch
import {clamp, mgukTaper} from './telemetry.js';
import {profile} from './eras.js';

const G = 9.81, RHO = 1.225;
export const control = () => ({throttle: 0, brake: 0, clutch: 0, steer: 0, gearShift: 0, aeroMode: 'FIXED', ersMode: 'BALANCED',
                               abs: true, tc: 1, autoBlip: true, autoClutch: true});

// The profile flattened for the hot loops, plus what follows from it. mass is the car with its driver and fuel; sim.js
// updates it as the fuel burns. B: Pacejka stiffness factor that puts the lateral force's peak at slipPeak.
export function carSpec(year) {
  const p = profile(year), e = p.engine, {aero, chassis, tyre} = p;
  return {
    profile: p, year, mass: e.minMass + (chassis.refuel ? chassis.fuel : chassis.fuel / 2),
    minMass: e.minMass, fuel: chassis.fuel, refuel: chassis.refuel,
    ClA: aero.ClA, CdA: aero.CdA, bal: chassis.fwd, ge: aero.ge, skirts: aero.skirts, skirtShare: aero.skirtShare, active: aero.active,
    drs: aero.drs, overtake: !!aero.active, crr: 0.015,
    mu: tyre.mu, muLong: tyre.muLong, loadSens: tyre.loadSens, warm: tyre.warm ?? 0, shape: tyre.shape, B: Math.tan(Math.PI / (2 * tyre.shape)) / tyre.slipPeak,
    maxBrakeG: p.brakes.maxG, pIce: e.pIce, pK: e.pK, pH: e.pH, rpmMax: e.rpmMax, battery: e.battery, harvestLap: e.harvestLap, deployLap: e.deployLap,
    h0: chassis.h0, k: chassis.k, zeta: chassis.zeta, activeSusp: chassis.activeSusp,
    wb: chassis.wb, fwd: chassis.fwd, kz: chassis.kz, hcg: chassis.hcg, maxLock: chassis.maxLock,
    ...p.power, box: p.gearbox, aids: p.aids, driver: p.driver, gearTop: null,
  };
}

// ---------- powertrain ----------

// MGU-K power available at speed v: 2026 fades it past 290 km/h, the overtake override later (telemetry.js mgukTaper);
// before 2026 it's flat
export const kLimit = (c, v, boost) => (c.kTaper ? Math.min(c.pK, mgukTaper(v * 3.6, boost)) : c.pK);
// power over rev fraction x: about constant torque below the peak (power rising with the revs), falling away past it
const share = (c, x) => (x < c.curve.peak ? Math.max(0.1, x / c.curve.peak) : clamp(1 - ((x - c.curve.peak) / c.curve.width) ** 2, 0.1, 1));

// Top speed where full power meets drag and rolling resistance, P(v) = (1/2 rho CdA v^2 + crr m g) v, by bisection
export function topSpeed(c, CdA) {
  let lo = 20, hi = 140;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2, p = c.pIce + kLimit(c, v, false);
    if (p > (0.5 * RHO * CdA * v * v + c.crr * c.mass * G) * v) lo = v; else hi = v;
  }
  return lo;
}

// Gearing for the circuit, as teams choose it: top gear reaches the car's top speed (lowest-drag setting, in a tow)
// at the upshift point; the gears below are spaced closer at the top, speed at the limiter in gear i ~ (i / n)^0.65.
export function gearUp(c, CdAmin) {
  const n = c.box.gears, top = topSpeed(c, CdAmin * 0.88) * 1.03 / c.box.shiftAt;
  c.gearTop = Array.from({length: n + 1}, (_, i) => top * (i / n) ** 0.65);
}
export const rpmOf = (c, v, gear) => c.rpmMax * v / c.gearTop[Math.max(1, gear)];

// The upshift / downshift a driver (or the automatic assist) would call now: up at the profile's shift point, down
// when the gear below would still be under it and the revs have fallen away (earlier on the brakes, for the engine braking)
export function autoShift(car, c, brake) {
  if (car.shiftT > 0) return 0;
  const x = rpmOf(c, car.v, car.gear) / c.rpmMax;
  if (car.gear < c.box.gears && x > c.box.shiftAt) return 1;
  if (car.gear > 1 && rpmOf(c, car.v, car.gear - 1) / c.rpmMax < c.box.shiftAt * 0.97 && x < (brake > 0.2 ? 0.7 : 0.55) * c.box.shiftAt) return -1;
  return 0;
}

// Gear changes. H-pattern: needs the clutch down (or the autoClutch assist), the drive is off for `shift` s, and a
// downshift without a blip of the throttle snatches the rear wheels (rear lock-up for a moment). Paddle boxes refuse a
// downshift past the limiter; an H-pattern lets you make it (and the wheels pay).
function gearbox(car, ctl, c, h) {
  if (car.gear < 1) car.gear = 1;
  if (car.shiftT > 0) { car.shiftT -= h; return; }
  const want = Math.sign(ctl.gearShift), g = car.gear + want;
  if (!want || g < 1 || g > c.box.gears) return;
  const H = c.box.type === 'H';
  if (H && ctl.clutch < 0.5 && !ctl.autoClutch) { car.grind = 0.4; return; }
  const over = want < 0 && rpmOf(c, car.v, g) > c.rpmMax;
  if (over && !H) { car.overRev = 0.4; return; }
  if (want < 0 && H && (over || (!ctl.autoBlip && ctl.throttle < 0.3))) car.snatch = 0.3;
  car.gear = g;
  car.shiftT = c.box.shift;
  car.shifted = want;  // for the audio: a cut / blip
}

// Turbo: boost b (0..1) chases the throttle at a rate set by exhaust flow, (0.3 + 2 x^2) / spool per second at rev fraction
// x, and none below the threshold revs; it bleeds off fast on a lift (the blow-off valve). Power = na + (1 - na) b^2 of
// the full figure, so the shove arrives late and all at once. At full boost the wastegate opens and bleeds the excess.
// With an MGU-H (2014-25) the compressor is spun electrically: no lag. The AI pre-loads the turbo on the way into a
// corner (throttle cracked against the brakes) so the boost is there at the apex.
function turbo(car, c, ctl, x, h) {
  if (!c.turbo || c.mguh) { car.boost = 1; return 1; }
  const t = c.turbo, able = clamp((x - t.threshold + 0.1) / 0.2, 0, 1), want = Math.max(ctl.throttle, ctl.preload ?? 0) * able;
  const rise = want > car.boost, rate = rise ? (0.3 + 2 * x * x) / t.spool : 1 / 0.12;
  if (car.bov > 0) car.bov -= h;
  else if (!rise && car.boost > 0.5 && ctl.throttle < 0.2 && want < car.boost - 0.3) car.bov = 0.4;  // blow-off: the audio's hiss
  car.boost += (want - car.boost) * Math.min(1, rate * h);
  car.wastegate = car.boost > 0.97 && ctl.throttle > 0.9;
  return t.na + (1 - t.na) * car.boost * car.boost;
}

// ERS: deploys at full throttle down to the mode's reserve and the lap's deployment limit (plus 0.5 MJ on the 2026
// override); harvests under braking (the MGU-K limit, and never more than the brakes are taking) and a third of that
// lifting. The MGU-H (2014-25) recovers exhaust energy at full throttle with no lap limit: it feeds the MGU-K first, so
// only the rest counts against the 4 MJ from the store, and it charges the store otherwise. 2026 "super clipping": with
// the lap's energy spent or the store at its floor, the ECU harvests at the MGU-K limit (350 kW since Miami 2026) at
// full throttle past 250 km/h, in bursts of 5 % of the store. thr: the throttle after the limiter. Returns MGU-K power, W (- harvest).
function ers(car, c, ctl, thr, h) {
  const e = car.ers, v = car.v, boost = ctl.ersMode === 'BOOST_OVERRIDE', was = e.clipping;
  e.deploying = e.derate = e.clipping = false;
  if (!c.pK || ctl.ersMode === 'NONE') return 0;
  const reserve = {PUSH: 0.02, BOOST_OVERRIDE: 0.02, BALANCED: 0.25, HARVEST: 1.1}[ctl.ersMode] ?? 0.25;
  const budget = c.deployLap + (boost ? 0.5e6 : 0), cap = kLimit(c, v, boost), floor = Math.min(reserve, 0.25);
  const recharging = was && e.soc < floor + 0.05;
  const deploy = thr > 0.95 && v > 28 && e.soc > reserve && e.deployed < budget && cap > 0 && !recharging;
  e.derate = thr > 0.95 && ctl.ersMode !== 'HARVEST' && e.soc <= 0.03;
  const mguh = thr > 0.95 ? c.pH : 0;
  let p = 0;
  if (deploy) { p = cap; e.soc -= (p - mguh) * h / c.battery; e.deployed += Math.max(0, p - mguh) * h; e.deploying = true; }
  else e.soc += mguh * h / c.battery;
  const room = e.harvested < c.harvestLap && e.soc < 1;
  let regen = room ? (ctl.brake > 0 ? Math.min(c.pK, ctl.brake * c.mass * c.maxBrakeG * G * v) : thr < 0.05 && v > 40 ? c.pK * 0.35 : 0) : 0;
  if (!deploy && c.superClip && room && thr > 0.95 && v * 3.6 > 250 && (e.deployed >= budget || e.soc <= floor || recharging)) { regen = c.pK; e.clipping = true; p = -regen; }
  e.harvesting = regen > 0;
  e.soc = clamp(e.soc + regen * h / c.battery, 0, 1);
  e.harvested += regen * h;
  return p;
}

// ---------- aero and ride height ----------

// Downforce and drag coefficients this step, and the heave of the car on its springs:
//   m z'' = F_down(z) + F_vertical - k z - c z' (+ F_active)     z: compression from static ride height
// Ground effect: ClA (1 + ge z / h0); below 8 mm the floor stalls (-25 %): porpoising on soft 2022+ dampers. Skirts
// (1977-82): a kerb strike or the floor touching breaks the seal and the tunnels' share of the downforce goes at once,
// back over ~0.25 s. Active suspension (1992-93): a PID actuator holds the platform at 60 % of h0 whatever the load.
// 2026: the flaps' position x (0 corner, 1 straight) blends to the X-mode multipliers in 0.25 s; any lift or brake
// shuts them, which the ECU does automatically. env: {mult: dirty air / damage / wing, drag: tow / wing,
// vertical (N), kerb, bump (m), drsCut}.
export function aero(car, c, ctl, h, env) {
  const q = 0.5 * RHO * car.v * car.v;
  car.clearance = c.h0 - car.z - env.bump - env.kerb;
  if (c.skirts) car.seal = env.kerb > 0.01 || car.clearance < 0 ? 0 : Math.min(1, (car.seal ?? 1) + h / 0.25);
  const stall = !c.skirts && c.ge > 0.2 && car.clearance < 0.008 ? 0.75 : 1;
  const flaps = ctl.aeroMode === 'X_MODE_STRAIGHT' && ctl.throttle > 0.95 && ctl.brake === 0 ? 1 : 0;
  car.aeroX = c.active ? car.aeroX + clamp(flaps - car.aeroX, -h / 0.25, h / 0.25) : 0;
  const x = car.aeroX, act = c.active;
  const ClAz = c.ClA * (1 + c.ge * clamp(car.z / c.h0, 0, 1.5)) * stall * env.mult * (1 - (c.skirtShare ?? 0) * (1 - (car.seal ?? 1)));
  const ClA = ClAz * (act ? 1 + (act.xCl - 1) * x : 1);
  // what a driver counts on: the downforce at the ride height the springs settle at for this speed (z = q ClA / k), not
  // this instant's bounce
  const ClAplan = c.ClA * env.mult * (1 + c.ge * clamp(q * c.ClA * env.mult / c.k / c.h0, 0, 1.5));
  const CdA = c.CdA * env.drag * (ctl.aeroMode === 'DRS_OPEN' ? 1 - env.drsCut : 1) * (act ? 1 + (act.xCd - 1) * x : 1);
  const down = q * ClA;
  // heave, in substeps of <= 1/480 s (a stiff active loop at 100x replay speed would otherwise blow up)
  const n = Math.ceil(h * 480), dt = h / n, m = c.mass, damp = 2 * c.zeta * Math.sqrt(c.k * m);
  for (let i = 0; i < n; i++) {
    let f = down + env.vertical - c.k * car.z - damp * car.zv;
    if (c.activeSusp) {  // PID on the ride height error
      const err = car.z - 0.6 * c.h0;
      car.zi = (car.zi ?? 0) + err * dt;
      f = down + env.vertical - (c.k + 3 * c.k) * err - 2 * 0.8 * Math.sqrt(4 * c.k * m) * car.zv - 20 * c.k * car.zi - c.k * 0.6 * c.h0;
    }
    car.zv += f / m * dt;
    car.z += car.zv * dt;
  }
  const plank = Math.max(0, -car.clearance);  // the floor below the track surface: the skid block grinds
  if (plank > 0) { car.z -= plank * 0.5; car.zv = Math.min(car.zv, 0); }
  car.sparks = car.v > 50 ? clamp(plank / 0.003, 0, 1) : 0;
  return {ClA, ClAplan, CdA, down, drag: q * CdA};
}

// ---------- tyres and the chassis ----------

// Pacejka's lateral force, D sin(C atan(B alpha)), and its inverse on the rising side (share f of the peak -> slip angle).
// Combined slip: braking or drive leaves the axle Dy of its pure peak D (friction ellipse); the tyre keeps its cornering
// stiffness B C D at small slip angles and reaches the lower peak sooner (as in the brush model), so a car on the
// power stays straight on a straight and only lets go when the corner asks for more than is left.
// The wider rear tyres are also ~30 % stiffer in cornering (stiff = 1.3): same peak, reached at a smaller slip angle.
// With identical tyres a car is neutral at rest, and the load that braking moves forward tips it into oversteer.
const lateral = (alpha, Dy, D, c, stiff = 1) => Dy * Math.sin(c.shape * Math.atan(stiff * c.B * D / Math.max(Dy, 0.05 * D) * alpha));
const slipFor = (f, c, stiff = 1) => Math.tan(Math.asin(clamp(f, -0.999, 0.999)) / c.shape) / (stiff * c.B);
export const REAR_STIFF = 1.3;

// Grip per axle relative to the car's mu: the wider rear tyres hold a little more, so at the limit the front lets go
// first (understeer: the car runs wide) rather than the rear (a spin), as every race car is set up
const FRONT = 0.99, REAR = 1.03;

// Axle loads: static weight split, the downforce at its aero balance, and longitudinal weight transfer m a h / wb
// Pitch: a passively sprung car dives under braking and squats under power, and the floor and wings tilt with it: the
// downforce's centre of pressure moves ~1.2 % forward per g of braking (and back under power). Active suspension
// (1992-93) holds the platform level, so its balance stays put.
function axles(car, c, N, down) {
  const a = car.aLong ?? 0, bal = c.activeSusp ? c.bal : clamp(c.bal - 0.012 * a / G, 0.3, 0.6);
  const Fzf = clamp((N - down) * c.fwd + down * bal - c.mass * a * c.hcg / c.wb, 0.15 * N, 0.85 * N);
  return [Fzf, N - Fzf];
}

// The cornering acceleration the car can hold: each axle must carry its share of the force (front fwd, rear 1 - fwd),
// so the axle with less grip for its share sets it (braking moves load forward and makes that the rear). aLong: the
// longitudinal acceleration to judge the load transfer at (the car's own by default)
export function lateralLimit(car, c, mu, N, down, aLong = car.aLong) {
  const [Fzf, Fzr] = axles({aLong}, c, N, down);
  return Math.min(mu * FRONT * Fzf / c.fwd, mu * REAR * Fzr / (1 - c.fwd)) / c.mass;
}

// One step. env: {T, k (track curvature), mu (grip), N (normal load incl. downforce, N), down, drag (N), slope
// (g sin pitch), sinBank (signed: + tilts to the right), off (on the grass), rail / dRail (in the pit sequence the
// car runs on the lane's path, eased towards offset dRail, as on rails)}. Moves the car (s, d, heading psi, speed v,
// lateral velocity vy, yaw rate r) and returns {a, aLat, throttle, brake}.
export function vehicleStep(R, car, ctl, h, env) {
  const {T, k, mu, N, down, drag, slope, sinBank, off, rail} = env;
  const c = car.spec, M = c.mass, u0 = car.v, a = c.wb * (1 - c.fwd), b = c.wb * c.fwd, Iz = M * c.kz * c.kz;

  // --- powertrain: gearbox, revs, turbo, ERS ---
  gearbox(car, ctl, c, h);
  const shifting = car.shiftT > 0, wheelRpm = rpmOf(c, u0, car.gear);
  car.rpm = Math.max(wheelRpm, car.gear === 1 && u0 < 15 ? (ctl.throttle > 0.1 ? 0.6 : 0.3) * c.rpmMax : 0.3 * c.rpmMax);  // clutch slip off the line
  let thr = ctl.throttle;
  if (car.rpm >= c.rpmMax) { car.rpm = c.rpmMax * (1 - 0.02 * (R.t * 40 % 1)); thr *= 0.3; }  // the limiter cuts ignition
  const x = car.rpm / c.rpmMax, boostShare = turbo(car, c, ctl, x, h), pK = ers(car, c, ctl, thr, h);
  const P = shifting ? 0 : thr * c.pIce * share(c, x) * boostShare + pK;  // pK: + deploying (full throttle), - clipping
  // engine braking on the overrun (and an unblipped H-pattern downshift snatching the rears)
  const overrun = !shifting && thr < 0.05 ? c.ebrake * c.pIce * x * x / Math.max(u0, 10) : 0;
  if (car.snatch > 0) car.snatch -= h;

  const ideal = !rail && ctl.kappa != null;  // an AI car (see the lateral section)
  // --- tyre forces along the car: friction ellipse per axle against last step's lateral forces ---
  const [Fzf, Fzr] = axles(car, c, N, down), Df = mu * FRONT * Fzf, Dr = mu * REAR * Fzr;
  const lon = (D, Fy, floor) => c.muLong * D * Math.max(floor, Math.sqrt(Math.max(0, 1 - (Fy / D) ** 2)));
  // A controller (ABS, TC, or the AI's feet) keeps back on each axle what the path needs (fyNeed: the cornering force
  // split by the static weight), a sliver more, and at least 25 % of the axle's grip (costing ~3 % of the longitudinal
  // force; much more and the car could no longer trail-brake as hard as the speed plan expects): working
  // an axle at the very edge of its ellipse would leave it only its last lateral force, never more, and the car would
  // step out at the first correction. Without the controller, the limit is the ellipse itself.
  const need = ctl.fyNeed ?? 0, floor = ctl.reserve ?? 0.25;  // the player's TC setting keeps more (player.js)
  const keep = (Fy, D, share) => clamp(Math.max(Math.abs(Fy ?? 0) * 1.02, need * share) + 0.03 * D, floor * D, D);
  const lockF = lon(Df, car.Fyf ?? 0, 0.1), lockR0 = lon(Dr, car.Fyr ?? 0, 0.1), grip = lon(Dr, car.Fyr ?? 0, 0);
  const capF = ctl.abs ? lon(Df, keep(car.Fyf, Df, c.fwd), 0.1) : lockF, capR = ctl.abs ? lon(Dr, keep(car.Fyr, Dr, 1 - c.fwd), 0.1) : lockR0;
  const traction = lon(Dr, keep(car.Fyr, Dr, 1 - c.fwd), 0);
  // brakes: a driven car has a fixed 60 / 40 balance, as real ones do: the fronts reach their limit (or lock) first and
  // the rear keeps grip in hand to hold the car straight while braking moves the load forward. The AI (whose lane can't
  // spin) brakes at the ideal balance, following the axle loads. ABS holds each axle at ~97 % of its threshold (a 14 Hz pulse); without it a wheel asked for more
  // locks, slides at 80 % of the peak and stops steering (fronts) or holding the rear (a spin)
  const Fb = ctl.brake * M * c.maxBrakeG * G, bias = ideal ? clamp(Fzf / N, 0.4, 0.8) : 0.6;
  let Fbf = bias * Fb, Fbr = (1 - bias) * Fb, lockedF = false, lockR = false;
  // the rear also carries the engine braking: ABS (or the AI's foot) brakes it only with what that leaves
  const capRb = ctl.abs ? Math.max(0, capR - overrun) : capR;
  car.absOn = ctl.abs && Fb > 0 && (Fbf > capF || Fbr > capRb);
  const pulse = 0.93 + 0.04 * Math.sin(R.t * 2 * Math.PI * 14);
  if (Fbf > capF) { if (ctl.abs) Fbf = capF * pulse; else { Fbf = 0.8 * lockF; lockedF = true; } }
  if (Fbr > capRb) { if (ctl.abs) Fbr = capRb * pulse; else { Fbr = 0.8 * lockR0; lockR = true; } }
  // drive on the rear axle: P / v, up to the traction the corner leaves. TC (a share of the limit) cuts ignition there;
  // without it the wheels spin up past ~105 %: the tread slides at 75 % of the peak and the rear lets go sideways.
  const want = P / Math.max(u0, 5);
  let Fd = want;
  car.tcCut = false;
  if (ctl.tc != null && want > traction * ctl.tc) { Fd = traction * ctl.tc; car.tcCut = car.player && thr > 0.05; }  // the AI's feet aren't an ECU
  const spinning = Fd > grip * 1.05;
  if (spinning) { Fd = 0.75 * grip; car.spin = Math.min(1, car.spin + 3 * h * (want / Math.max(grip, 1) - 1)); car.tcCut = false; }
  else car.spin = Math.max(0, car.spin - 0.6 * h);
  if (car.snatch > 0) lockR = true;
  // stability control (a player assist, ESC-like): the rear past ~80 % of its peak slip and it lets the rear wheels
  // roll free of brakes and drive, giving the rear all its grip to hold the car's line
  car.escOn = !!ctl.stability && Math.abs(car.slipR ?? 0) > 0.8 * c.profile.tyre.slipPeak / REAR_STIFF;
  if (car.escOn) { Fbr = 0; Fd = 0; lockR = false; }  // (and below, a yaw moment from one side's brakes)
  car.locked = lockedF;
  const Fxr = Fd - Fbr - overrun * (lockR ? 0 : 1);
  if (-Fxr > lockR0) lockR = true;  // engine braking on top of the brakes: past the ellipse the rear wheels lock
  // what's left for cornering on each axle (a locked or spinning axle keeps ~25-45 %)
  const Dyf = lockedF ? 0.25 * Df : Math.sqrt(Math.max(0, Df * Df - (Fbf / c.muLong) ** 2));
  const Dyr = lockR ? 0.25 * Dr : spinning ? 0.45 * Dr : Math.sqrt(Math.max(0, Dr * Dr - (Fxr / c.muLong) ** 2));

  // --- longitudinal ---
  const delta = clamp(ctl.steer, -1, 1) * c.maxLock;
  const aLong = (Fxr - Fbf - drag - c.crr * N * (off ? 4 : 1) - (car.Fyf ?? 0) * Math.sin(delta)) / M - slope;
  car.v = Math.max(0, u0 + aLong * h);
  car.aLong = aLong;

  // --- lateral: dynamic single-track (bicycle) model in substeps of <= 1/240 s ---
  //   alpha_f = delta - atan((v_y + a r) / u),  alpha_r = -atan((v_y - b r) / u)
  //   m (v_y' + u r) = F_yf cos(delta) + F_yr + m g sin(bank),   I_z r' = a F_yf cos(delta) - b F_yr
  // Frenet frame (psi: heading relative to the track): s' = (u cos psi - v_y sin psi) / (1 - k d),
  // d' = u sin psi + v_y cos psi, psi' = r - k s'. Below 3 m/s the tyres' slip is meaningless: kinematic steering.
  const n = rail ? 0 : Math.ceil(h * 240), dt = h / n, u = Math.max(car.v, 0.01);
  let Fyf = 0, Fyr = 0;
  if (rail) {  // the pit lane can run 100 m off the centre line, where track-relative dynamics fold over themselves
    car.s += car.v * h;
    car.d += clamp(env.dRail - car.d, -20 * h, 20 * h);
    car.psi = car.vy = car.r = 0;
  }
  // The AI is an ideal driver: its car follows its lane (ctl.lane: target offset and how fast it may move across) on
  // the path curvature ctl.kappa, which the tyres carry as far as the weaker axle's share of what the friction ellipse
  // leaves (plus the banking); the shortfall pushes it wide (understeer: d'' ~ the missing lateral acceleration, here
  // over ~0.5 s of response). It never steps out: the driver never takes a tyre past its peak slip.
  if (ideal) {
    const cap = Math.min(Dyf / c.fwd, Dyr / (1 - c.fwd)) / M, gb = G * sinBank, want = u * u * ctl.kappa - gb;
    const ay = clamp(want, -cap, cap), drift = 0.5 * (want - ay);  // m/s outwards (k > 0 turns right: outside is -d)
    Fyf = M * ay * c.fwd;
    Fyr = M * ay * (1 - c.fwd);
    car.slipF = slipFor(Fyf / Math.max(Df, 1), c);
    car.slipR = slipFor(Fyr / Math.max(Dr, 1), c, REAR_STIFF);
    const dDot = clamp(ctl.lane.d - car.d, -ctl.lane.rate * h, ctl.lane.rate * h) / h - drift;
    car.d += dDot * h;
    car.s += u * h;
    car.psi = Math.atan2(dDot, Math.max(u, 1));
    car.r = u * ctl.kappa;
    car.vy = 0;
  }
  for (let i = 0; i < (ideal ? 0 : n); i++) {
    if (u < 3) {
      car.r = u * Math.tan(delta) / c.wb;
      car.vy = b * car.r;  // the rear axle rolls without sliding sideways
      Fyf = Fyr = car.slipF = car.slipR = 0;
    } else {
      const af = delta - Math.atan((car.vy + a * car.r) / u), ar = -Math.atan((car.vy - b * car.r) / u);
      Fyf = lateral(af, Dyf, Df, c);
      Fyr = lateral(ar, Dyr, Dr, c, REAR_STIFF);
      car.slipF = af;
      car.slipR = ar;
      car.vy += ((Fyf * Math.cos(delta) + Fyr) / M + G * sinBank - u * car.r) * dt;
      car.r += (a * Fyf * Math.cos(delta) - b * Fyr) / Iz * dt;
      if (ctl.stability) {
        // Stability control: one side's brakes give a yaw moment against a yaw rate past the one the steering asks for
        // (u tan(delta) / wb, as far as the grip allows), up to what braking one side can do (~0.6 g at 0.8 m half-track)
        const rRef = clamp(u * Math.tan(delta) / c.wb, -(Df + Dr) / M / u, (Df + Dr) / M / u), err = car.r - rRef;
        if (Math.abs(err) > 0.05) {
          const Mz = clamp(-Iz * 8 * err, -0.5 * M * G, 0.5 * M * G);
          car.r += Mz / Iz * dt;
          car.v = Math.max(0, car.v - Math.abs(Mz) / 0.8 / M * dt);  // the braking it takes
          car.escOn = true;
        }
      }
    }
    const sDot = (u * Math.cos(car.psi) - car.vy * Math.sin(car.psi)) / Math.max(0.3, 1 - k * car.d);
    car.psi += (car.r - k * sDot) * dt;
    car.d += (u * Math.sin(car.psi) + car.vy * Math.cos(car.psi)) * dt;
    car.s += sDot * dt;
  }
  // at right angles to the track it goes no further round (lap distance must not run backwards): the yaw that would
  // turn it past stops there, and steering back brings it straight round
  if (Math.abs(car.psi) > Math.PI / 2) { car.psi = Math.sign(car.psi) * Math.PI / 2; if (car.r * car.psi > 0) car.r = 0; }
  if (Math.abs(car.vy) > 0.5 * Math.max(car.v, 1)) car.v *= Math.exp(-1.5 * h);  // sliding sideways: scrubbing off speed
  car.Fyf = Fyf;
  car.Fyr = Fyr;
  car.kPath = u > 3 ? car.r / u : Math.tan(delta) / c.wb;
  car.delta = delta;
  car.scrub = Math.max(Math.abs(car.slipF ?? 0), Math.abs(car.slipR ?? 0)) / c.profile.tyre.slipPeak;  // 1 = at the peak

  // the barrier: the car stops against it, losing speed with the impact angle, and damages its wing
  const wall = T.half + T.wall - 0.5;
  if (!rail && Math.abs(car.d) > wall) {
    const hit = car.v * Math.abs(Math.sin(car.psi));
    car.d = Math.sign(car.d) * wall;
    car.psi *= -0.3;
    car.vy = 0;
    car.r *= 0.3;
    car.v *= Math.max(0.2, 1 - hit / 30);
    car.damage = Math.min(1, car.damage + hit / 40);
    car.contact = 0.25;
  }
  return {a: aLong, aLat: (Fyf * Math.cos(delta) + Fyr) / M + G * sinBank, throttle: thr, brake: ctl.brake};
}
