// F1 race simulation: vehicle dynamics, aerodynamics, wake, tyres, DRS, ERS and AI drivers on a real circuit outline,
// with weather (weather.js), wet tyres (tyres.js), pit stops and strategy (strategy.js) and race control
// (racecontrol.js). Pure (no DOM / three.js) so node tests can run whole races. Units: SI throughout (m, s, kg, N, W, J);
// positions in metres on the map plane (x right, y down), so a right-hand turn has positive curvature, on the +normal side.
import {gearbox, engine, clamp} from './telemetry.js';
import {buildTrack, trackPos, at, idx} from './track.js';
import {COMPOUNDS, thermalGrip, wearGrip, surfaceGrip, aquaplaneSpeed} from './tyres.js';
import {createWeather, weatherStep, setWetness, wetAt, trackWetness} from './weather.js';
import {createControl, controlStep, deploy, neutralised, vscDelta, safetyCar} from './racecontrol.js';
import {createPit, pitControl, inPitLane, aiStrategy, aiPace, predictRejoin, PACE, pitLayout, lanePath, lanePos, pitPath, laneFor, ease} from './strategy.js';
import {racecraft, resolveContacts, blocker} from './racecraft.js';
import {playerDrive, ASSISTS, rpmFor} from './player.js';

export {COMPOUNDS, thermalGrip, wearGrip};
export {racingLine, trackPos} from './track.js';

const RHO = 1.225, G = 9.81;  // air density kg/m^3, gravity
const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- car and tyre constants ----------

// Per regulation era. Engine, energy recovery, DRS and the minimum mass (car + driver) come from telemetry.js
// engine(year); mass adds ~50 kg of average fuel. ClA / CdA are lift and drag coefficients times frontal area, in m^2:
// at 300 km/h (q = 0.5 rho v^2 ~ 4.25 kPa) ClA 4.8 gives ~20 kN of downforce, about 2.5x the car's weight, and CdA 1.5
// sets a ~330 km/h top speed at full power. Power: ICE plus MGU-K.
// shortcut: aero is the same in every era (no published per-car figures); add era multipliers if wanted.
export function carSpec(year) {
  const e = engine(year);
  return {
    mass: e.minMass + 50, ClA: 4.8, CdA: 1.5, crr: 0.015, mu: 1.45, muLong: 0.95,  // muLong: longitudinal / lateral grip
    pIce: e.pIce, pK: e.pK, rpmMax: e.rpmMax, drs: e.drs,                       // W, rev limit, DRS allowed
    battery: e.battery, harvestLap: e.harvestLap, deployLap: e.deployLap,      // J: store, per-lap harvest / deploy limits
    maxBrakeG: 6,                                                           // brake system and driver limit, g
    // heave: plank clearance h0 at rest, spring k, damping ratio; ground-effect cars (2022+) gain downforce as they get
    // lower, which with soft damping makes the car porpoise
    h0: 0.030, k: 700e3, zeta: year >= 2022 ? 0.25 : 0.6, ge: year >= 2022 ? 0.35 : 0.1,
  };
}

// ---------- physics ----------

// Cornering speed limit. Lateral grip must supply the centripetal force: m v^2 |k| <= mu (m g + 0.5 rho v^2 ClA).
// Solving for v: v^2 (|k| - mu rho ClA / 2m) <= mu g. When the aero term exceeds |k| the corner is "flat": downforce
// grows with v^2 as fast as the required force does, so grip never runs out and only power limits the speed.
// Banking adds to it: on a road tilted by beta towards the corner's inside, gravity's component along the road surface
// supplies g sin(beta) of the centripetal force for free (off-camber, beta < 0, takes it away), so the numerator becomes
// g (mu + sin beta). help = sin(beta) signed for this corner's direction.
function cornerSpeed(k, mu, ClA, m, help = 0) {
  const den = Math.abs(k) - mu * RHO * ClA / (2 * m);
  return den <= 0 ? 150 : Math.min(150, Math.sqrt(Math.max(0.05, mu + help) * G / den));
}
const bankHelp = (T, s, k) => at(T, T.sinBank, s) * (Math.sign(k) || 0);

// Quasi-steady-state speed envelope over the next n samples from lap distance s0 (the classic lap-simulation solver):
// each point's limit is its cornering speed (curvature, grip, downforce, banking), and a backward pass from the far end
// caps every point by what the car can brake down from it: v_j^2 = v_(j+1)^2 + 2 a_brake ds, where a_brake is the
// longitudinal grip LEFT after cornering at that point (friction circle: sqrt(a_grip^2 - a_lat^2)), plus drag, plus
// gravity on an uphill grade. Braking that has to share the tyres with a corner (a curving approach, like Mirabeau into
// the Monaco hairpin) therefore starts earlier. Returns {v: allowed speeds, vmax: corner limits}, index 0 = s0.
function envelope(T, c, plan, s0, n) {
  const v = new Float64Array(n + 1), vmax = new Float64Array(n + 1);
  let next = 150;
  for (let j = n; j >= 0; j--) {
    const i = idx(T, s0 + j * T.ds), k = T.k[i], help = T.sinBank[i] * (Math.sign(k) || 0);  // ~3,000 samples per car per second
    vmax[j] = cornerSpeed(k, plan.mu, plan.ClA, c.mass, help);
    if (j < n) {
      // judge the cornering load at the speed the car will have HERE (faster than at the next point), estimated from the
      // full-grip upper bound: using the lower next-point speed would promise braking grip the car doesn't have
      const q = 0.5 * RHO * next * next, grip = plan.mu * (G + q * plan.ClA / c.mass);
      const here = next * next + 2 * grip * T.ds, lat = Math.max(0, here * Math.abs(k) - G * help);
      const brake = c.muLong * Math.sqrt(Math.max(0, grip * grip - lat * lat)) + q * plan.CdA / c.mass + G * T.grade[i];
      next = Math.sqrt(next * next + 2 * clamp(brake, 3, c.maxBrakeG * G) * T.ds);
    }
    next = Math.min(next, vmax[j]);
    v[j] = next;
  }
  return {v, vmax};
}

// Peak deceleration at speed v: tyre braking force (longitudinal mu times normal load, downforce included) plus aero drag,
// capped by what the brakes and driver can do.
function brakeDecel(v, mu, ClA, CdA, c) {
  const q = 0.5 * RHO * v * v;
  return Math.min(c.muLong * mu * (c.mass * G + q * ClA) / c.mass + q * CdA / c.mass, c.maxBrakeG * G);
}

const CORNERS = ['FL', 'FR', 'RL', 'RR'];

// ann: circuits.js annotate() output (elevation, banking, kerbs, zones); aero: the circuit's wing trim {cl, cd, drs}
// (multipliers on ClA / CdA, DRS drag cut); pitLoss: MultiViewer's real pit losses, which size the pit lane.
export function createRace({year, mapPts, mpu, width, drivers, laps, compounds, ann, aero, pitLoss, pitLane}) {
  const T = buildTrack(mapPts, mpu, width, ann), c = carSpec(year);
  // Circuit aero trim: Monaco runs maximum wing (more downforce, more drag), Monza "skinny" wings (~360 km/h)
  c.ClA *= aero?.cl ?? 1;
  c.CdA *= aero?.cd ?? 1;
  c.drsCut = aero?.drs ?? 0.22;  // a small Monza rear wing gains less from opening the flap
  const total = laps ?? Math.ceil(305e3 / T.len);  // race distance: the fewest complete laps covering 305 km
  const cars = drivers.map((id, g) => ({
    id, grid: g, s: -(8 * g + 6), d: g % 2 ? -1.6 : 1.6, v: 0, a: 0, gLat: 0, gLong: 0, throttle: 0, brake: 0, gear: 0, rpm: 4000,
    skill: 1 + 0.012 * (1 - 2 * g / Math.max(1, drivers.length - 1)),  // qualifying order as car/driver pace, +-1.2 %
    tyre: {compound: compounds?.[g] ?? ['MEDIUM', 'SOFT', 'MEDIUM', 'HARD'][g % 4], health: [100, 100, 100, 100],
           ts: [70, 70, 60, 60], tc: [70, 70, 60, 60]},                     // blankets: ~70 C front, 60 C rear
    pit: createPit(compounds?.[g] ?? ['MEDIUM', 'SOFT', 'MEDIUM', 'HARD'][g % 4]), stint: 0, hist: [], attackLaps: 0,
    pace: 'BALANCED', paceUser: null, slide: 0, wet: 0, spray: 0, vref: new Float32Array(T.n),  // green-flag speed per sample
    player: false, delta: 0, kPath: 0, psi: 0, aLong: 0, spin: 0, locked: false, tcCut: false, damage: 0, contact: 0,
    ers: {soc: 0.9, mode: 'BALANCED', user: null, harvested: 0, deployed: 0, harvesting: false, deploying: false, derate: false},
    drs: {armed: false, open: false, forced: false, zone: -1},
    z: 0, zv: 0, clearance: c.h0, sparks: 0, smoke: 0, wake: 0, dirty: 0, ahead: null, gapAhead: Infinity,
    pass: null, lapStart: 0, secStart: 0, secs: [], lapsDone: 0, finished: false,
  }));
  const R = {T, c, total, cars, t: 0, status: 'RED', laps: {}, leaderPass: [], winner: null, done: false,
             W: createWeather(), control: createControl(year >= 2026 ? 'OVERTAKE' : 'DRS'),
             ai: {pace: 1, aggression: 0.5}, assists: {...ASSISTS}, input: {throttle: 0, brake: 0, steer: 0}, player: null,
             wing: 0,  // pit-wall trim, -5..+5 clicks
             // the circuit's real pit lane from GPS when there is one, else one alongside the main straight
             pit: (pitLane && lanePath(T, pitLane)) ?? pitLayout(T, pitLoss ? laneFor(+pitLoss.normal) : 400)};
  for (const car of cars) R.laps[car.id] = [];

  // the car on track directly in front (any lap), as a distance and a time gap at the follower's speed
  function findAhead(car) {
    let best = null, gap = Infinity;
    for (const o of cars) {
      if (o === car || o.finished || inPitLane(o) || inPitLane(car)) continue;  // the pit lane is off the track
      const g = ((o.s - car.s) % T.len + T.len) % T.len;
      if (g > 0 && g < gap) { gap = g; best = o; }
    }
    car.ahead = best;
    car.gapAhead = gap;
    car.gapSec = gap / Math.max(car.v, 10);
    if (best && gap < (best.gapBehind ?? Infinity)) {  // and, from the other side: who is chasing that car, how fast
      Object.assign(best, {behind: car, gapBehind: gap, gapBehindSec: gap / Math.max(car.v, 10), closingBehind: car.v - best.v});
    }
    // blue flag: the car ahead is a lap (or more) down and we're within a second, so it must let us by
    if (best && car.gapSec < 1 && car.s - best.s > T.len / 2) best.blue = car;
  }

  function step(h) {
    R.t += h;
    if (R.status === 'RED' && R.t >= 3) R.status = 'GREEN';  // five red lights, then lights out
    for (const car of cars) Object.assign(car, {blue: null, behind: null, gapBehind: Infinity, inLane: inPitLane(car)});
    for (const car of cars) findAhead(car);
    // weather: traffic = car passes per point of track per second, relative to a 20-car field at ~180 km/h
    const traffic = cars.reduce((sum, x) => sum + (inPitLane(x) ? 0 : x.v), 0) / T.len / 0.2;
    weatherStep(R.W, h, traffic);
    const leader = R.leader = cars.reduce((m, x) => (x.s > m.s ? x : m));
    leader.healthAvg = leader.tyre.health.reduce((a, b) => a + b) / 4;
    controlStep(R.control, h, R.t, leader, trackWetness(R.W));
    for (const car of cars) {
      aiStrategy(R, car);
      drive(car, h);
      timing(car);
      if (!car.hist.length || R.t - car.hist.at(-1)[0] >= 0.25) {  // position history, for the rejoin predictor
        car.hist.push([R.t, car.s]);
        if (car.hist[0][0] < R.t - 45) car.hist.shift();
      }
      car.contact = Math.max(0, car.contact - h);
    }
    if (R.status !== 'RED') resolveContacts(R);
  }

  function drive(car, h) {
    if (R.status === 'RED') return;
    const tyre = car.tyre, comp = COMPOUNDS[tyre.compound], k = at(T, T.k, car.s), ks = at(T, T.ks, car.s), v = car.v;
    const lapS = ((car.s % T.len) + T.len) % T.len, line = at(T, T.line, car.s), ctl = R.control;
    const pit = pitControl(R, car, h, line);
    if (pit?.hold) {  // stationary in the box while the crew changes tyres
      Object.assign(car, {v: 0, a: 0, throttle: 0, brake: 1, gear: 0, rpm: 4000, sparks: 0, smoke: 0, spray: 0});
      return;
    }

    // --- wake: within 0.1-1.5 s behind another car and roughly in line with it ---
    // tow: the leading car's wake is a low-pressure region, so drag falls (up to -18 % Cd) on straights;
    // dirty air: the same turbulent, downwashed air starves the wings and floor in corners (up to -22 % Cl)
    const o = car.ahead, aligned = o ? 1 - clamp(Math.abs(car.d - o.d) / 2.2, 0, 1) : 0;
    const inWake = car.gapSec >= 0.1 && car.gapSec <= 1.5 ? 1 - (car.gapSec - 0.1) / 1.4 : 0;
    const straight = clamp(1 - Math.abs(ks) * 150, 0, 1), cornering = (1 - straight) * smooth(v, 25, 45);  // 90+ km/h corners
    car.wake = aligned * inWake;
    car.dirty = car.wake * cornering;
    const tow = 1 - 0.18 * car.wake * straight;
    const dirtyAir = 1 - 0.22 * car.dirty;

    // --- heave: ride height under aero load, bumps and kerbs ---
    // m z'' = F_down(z) - k z - c z'   (z = compression from static ride height)
    // Ground effect makes downforce rise as the floor nears the track (ge * z / h0); if the gap closes below ~8 mm the
    // floor flow stalls and downforce collapses, the car springs up, the flow reattaches: porpoising.
    const bump = 0.003 * Math.sin(lapS * 0.071) * Math.sin(lapS * 0.013 + 1.3) + 0.0015 * Math.sin(lapS * 0.53);
    // riding the kerb at the apex: flat FIA kerbs lift the floor ~12 mm; the tall "sausage" kerbs at chicanes like Monza's
    // Rettifilo ~50 mm, enough to slam the plank into the track
    const sausage = at(T, T.kerb, car.s) === 'sausage' && Math.abs(car.d) > T.half - 1.3 && v > 15;
    const kerb = sausage ? 0.05 : Math.abs(car.d) > T.half - 1.6 && Math.abs(k) > 1 / 200 ? 0.012 : 0;
    car.sausage = sausage;
    car.clearance = c.h0 - car.z - bump - kerb;
    const stall = c.ge > 0.2 && car.clearance < 0.008 ? 0.75 : 1;
    // a broken front wing (damage 0..1) costs up to 18 % of the downforce until the nose is changed in the pits
    // wing trim from the pit wall: each click ~4 % downforce for ~3 % drag
    const ClA = c.ClA * (1 + c.ge * clamp(car.z / c.h0, 0, 1.5)) * dirtyAir * stall * (1 - 0.18 * car.damage) * (1 + 0.04 * R.wing);
    const drsOpen = car.drs.open;
    // open flap: -22 % drag by default (less at Monza), worth ~15-18 km/h at the end of a straight
    const CdA = c.CdA * tow * (drsOpen ? 1 - c.drsCut : 1) * (1 + 0.03 * R.wing);
    const q = 0.5 * RHO * v * v, down = q * ClA, drag = q * CdA;
    const damp = 2 * c.zeta * Math.sqrt(c.k * c.mass);
    // Elevation: the road's pitch angle is atan(grade). Gravity along it, g sin(pitch), slows the car uphill and pushes
    // it downhill; across it, g cos(pitch) plus v^2 kv presses the car into the road: a compression (kv > 0) piles
    // several g of extra load onto the suspension (bottoming at Eau Rouge), a crest (kv < 0) unloads the tyres.
    const grade = at(T, T.grade, car.s), pitchCos = 1 / Math.sqrt(1 + grade * grade), slope = G * grade * pitchCos;
    const vertical = c.mass * (v * v * at(T, T.kv, car.s));
    car.zv += (down + vertical - c.k * car.z - damp * car.zv) / c.mass * h;
    car.z += car.zv * h;
    const plank = Math.max(0, -car.clearance);  // floor below the track surface: the skid block is grinding
    if (plank > 0) { car.z -= plank * 0.5; car.zv = Math.min(car.zv, 0); }
    car.sparks = v > 50 ? clamp(plank / 0.003, 0, 1) : 0;

    // --- grip: compound x surface water x temperature x wear x driver, on a normal load that includes downforce ---
    // Water: the track's wetness where this car is (the racing line dries first) against what its tread can handle.
    // Aquaplaning: above the tread's critical speed for this much water, high-speed corners bring brief micro-slides
    // (a 0.3 s grip loss to 65 % that pushes the car wide), more often the further over that speed it is.
    const w = car.wet = wetAt(R.W, Math.abs(car.d - line)), surf = surfaceGrip(tyre.compound, w);
    const vAq = aquaplaneSpeed(tyre.compound, w);
    if (car.slide > 0) car.slide -= h;
    else if (v > vAq && Math.abs(ks) > 1 / 600 && Math.random() < h * 3 * (v / vAq - 1)) car.slide = 0.3;
    const temp = tyre.ts.reduce((a, b) => a + b) / 4, health = tyre.health.reduce((a, b) => a + b) / 4;
    const skill = car.player ? 1 : car.skill * R.ai.pace;  // the AI pace slider (80-110 %) scales the AI cars' grip
    const mu = c.mu * skill * comp.grip * surf.grip * thermalGrip(temp, comp.window) * wearGrip(health) * (car.slide > 0 ? 0.65 : 1);
    const N = Math.max(0.2 * c.mass * G, c.mass * G * pitchCos + vertical + down), aGrip = mu * N / c.mass;
    let aLat = v * v * k;
    const help = bankHelp(T, car.s, k);  // banking towards the corner's inside carries g sin(beta) of the cornering load
    // the driver's pace mode sets how much of that grip they plan to use (pushing, standard, saving tyres)
    car.pace = aiPace(R, car);
    const pace = PACE[car.pace], muPlan = mu * pace.plan * (1 + (car.deeper || 0));  // attacking: brakes a little later

    // --- what speed can the car carry? scan the next braking distance for the tightest constraint ---
    // allowed speed now = min over points j ahead of sqrt(vmax_j^2 + 2 a_brake(vmax_j) x_j)
    // horizon: enough to brake at ~0.8 g plus margin; braking shares grip with curving approaches, so it can take far
    // longer than a straight-line stop (the envelope must see the corner before the car is committed)
    const look = Math.min(140, Math.ceil((v * v / 16 + 80) / T.ds));
    car.plan = {mu: muPlan, ClA, CdA};  // also for the racing-line ribbon
    const env = envelope(T, c, car.plan, car.s, look);
    let vAllow = env.v[0], brakeAhead = Infinity, turn = 1, slowest = 150;
    for (let j = 1; j <= look; j++) {
      if (env.vmax[j] < v - 8 && j * T.ds < brakeAhead) brakeAhead = j * T.ds;
      if (env.vmax[j] < slowest) { slowest = env.vmax[j]; turn = Math.sign(at(T, T.k, car.s + j * T.ds)) || 1; }  // next corner, its way
    }
    // VSC: a minimum time for every stretch of track, 35 % slower than racing pace, which is the car's own green-flag
    // speed here (vref) times 0.65; behind the Safety Car the leader runs at ~60 % of it
    const vi = Math.floor(lapS / T.ds) % T.n, ref = car.vref[vi] || vAllow;
    if (vscDelta(ctl) < 1) vAllow = Math.min(vAllow, ref * vscDelta(ctl));
    if (safetyCar(ctl) && car === R.leader) vAllow = Math.min(vAllow, ref * 0.6);
    // traffic: can't drive through a car that overlaps laterally (within a car width + margin); keep 8 m + 0.15 s of
    // speed centre to centre (~20 m at 300 km/h, as both may brake at the limit) and match its speed. Behind the safety
    // car the field queues ~15 m apart.
    if (car.squeezed) vAllow *= 0.97;  // out of room alongside a car ahead: back out of it
    if (o && safetyCar(ctl) && car.gapAhead < 80) vAllow = Math.min(vAllow, o.v + (car.gapAhead - 15) * 0.8);
    // (racecraft.js blocker: lanes judged on where the car is and where it's heading, so converging lines count)
    else if (!car.player && (car.block = blocker(R, car))) vAllow = Math.min(vAllow, car.block.o.v + (car.block.gap - 8 - 0.15 * v) * 1.5);
    if (pit) vAllow = Math.min(vAllow, pit.vCap);  // pit entry braking and the 80 km/h limiter
    if (car.finished) vAllow = Math.min(vAllow, 45);  // cool-down lap

    // --- ERS mode, and (AI) the lane: racecraft.js picks racing line / tow / attack / defence and leaves the space ---
    const ers = car.ers, manual = car.player && !pit;
    ers.mode = ers.user ?? (car.attackPush ? 'PUSH' : ers.soc < 0.2 ? 'HARVEST' : pace.ers);
    if (!manual) {
      let dTarget = racecraft(R, car, {o, straight, brakeAhead, turn, line, neutral: neutralised(ctl) || !!pit});
      if (car.blue) dTarget = (car.d >= 0 ? 1 : -1) * (T.half - 1.2);  // blue flag: move over to the edge and let the leader by
      dTarget -= Math.sign(ks) * (0.8 * car.dirty + (car.slide > 0 ? 1.5 : 0));  // understeer / a slide pushes it wide
      if (pit) dTarget = pit.d;
      car.dTarget = dTarget;
      const rate = pit ? 20 : 2.5;  // m/s across; in the pit sequence it follows the lane's entry and exit paths (eased)
      car.d += clamp(dTarget - car.d, -rate * h, rate * h);
    }

    // --- energy: returns the power available (ICE + any MGU-K deployment) and books the battery ---
    // Deployment by mode: push spends down to 2 %, balanced keeps a 25 % reserve, harvest saves it all. Regenerative
    // braking turns up to the MGU-K's power limit of the car's kinetic energy back into charge; lifting harvests ~a third.
    ers.deploying = ers.derate = false;
    const power = (thr, brk, lift) => {
      const reserve = {PUSH: 0.02, BALANCED: 0.25, HARVEST: 1.1}[ers.mode];
      const deploy = thr > 0.95 && v > 28 && ers.soc > reserve && ers.deployed < c.deployLap;
      ers.derate = thr > 0.95 && ers.mode !== 'HARVEST' && ers.soc <= 0.03;  // flat out with an empty battery
      ers.deploying = deploy;
      if (deploy) { ers.soc -= c.pK * h / c.battery; ers.deployed += c.pK * h; }
      const regen = (brk > 0 ? c.pK : lift ? c.pK * 0.35 : 0) * (ers.harvested < c.harvestLap ? 1 : 0);
      ers.harvesting = regen > 0;
      ers.soc = clamp(ers.soc + regen * h / c.battery, 0, 1);
      ers.harvested += regen * h;
      return c.pIce + (deploy ? c.pK : 0);
    };

    // --- longitudinal: brake, lift and coast, or drive (AI), or the player's pedals and steering (player.js) ---
    // friction circle: whatever lateral grip the corner uses is not available for braking or traction
    let throttle = 0, brake = 0, a;
    const s0 = car.s;
    const coast = ers.mode === 'HARVEST' && brakeAhead < 70 && v > 40;  // lift early to recharge (lift and coast)
    if (manual) {
      ({a, aLat, throttle, brake} = playerDrive(R, car, h, {T, c, k, drag, N, aGrip, vAllow, power, slope, roll: at(T, T.bank, car.s)}));
    } else {
      // the friction circle only has to supply the cornering force the banking doesn't
      const aLong = Math.sqrt(Math.max(0, aGrip * aGrip - (Math.abs(aLat) - G * help) ** 2));
      if (v > vAllow + 0.3) {
        brake = clamp((v - vAllow) / 0.8, 0.4, 1);  // track the envelope tightly: a lagging controller arrives too fast
        // over the limit mid-corner the friction circle leaves no braking; a real car scrubs speed anyway (understeer)
        a = -brake * Math.min(c.muLong * Math.max(aLong, 0.35 * aGrip), c.maxBrakeG * G) - drag / c.mass;
        power(0, brake, false);
      } else if (coast) {
        a = -(drag + c.crr * N) / c.mass;
        power(0, 0, true);
      } else {
        throttle = clamp((vAllow - v) / 2, 0, 1);
        // power-limited thrust P / v, traction-limited: the driven rear axle (~60 % of the load) and only the grip the
        // corner leaves over (friction circle)
        const thrust = Math.min(power(throttle, 0, false) / Math.max(v, 5), 0.6 * c.muLong * aLong * c.mass) * throttle;
        a = (thrust - drag - c.crr * N) / c.mass;
      }
    }

    // --- DRS: armed when crossing a detection point within 1.000 s of the car ahead (from lap 3), opens in the zone
    // on throttle, snaps shut on the brakes or at the end of the zone ---
    const drs = car.drs;
    if (!manual) {
      a -= slope;  // uphill / downhill
      car.v = Math.max(0, v + a * h);
      car.s += car.v * h;
    }
    if (!neutralised(ctl) && !pit && car.lapsDone >= 1 && !car.player) car.vref[vi] = car.v;  // learn racing pace (after lap 1)
    const cross = x => { const p = ((s0 % T.len) + T.len) % T.len; return p <= x && p + (car.s - s0) > x; };
    // Race control's interlock (green flag, dry track, lap 3+, 2 laps after a restart) gates it all; the testing
    // toggle stands in for the 1-second rule but not for the safety interlocks.
    const allowed = c.drs && (ctl.drs || (drs.forced && !neutralised(ctl) && trackWetness(R.W) <= 0.2));  // DRS from 2011
    T.zones.forEach((z, i) => {
      if (cross(z.detect)) { drs.armed = allowed && (car.gapSec <= 1 || drs.forced) && !pit; drs.zone = i; }
    });
    const zone = T.zones[drs.zone];  // zone ends may lie past the line (end > len), so test the lap position both ways
    const inZone = !!zone && ((lapS >= zone.start && lapS <= zone.end) || (lapS + T.len >= zone.start && lapS + T.len <= zone.end));
    // the player opens it with the DRS button (R / Space / pad A), the AI whenever it isn't braking (a follower held at
    // the speed of the car ahead may be on part throttle)
    const ask = manual ? R.input.drs : brake === 0;
    if (manual) R.input.drs = false;
    if (drs.open && (brake > 0 || !inZone || !allowed || (manual && ask))) { drs.open = false; drs.armed = false; }
    else if (drs.armed && inZone && ask) drs.open = true;

    // --- tyres, per corner: load share, sliding heat, airflow cooling, wear ---
    const gLong = a / G, gLat = aLat / G, util = clamp(Math.hypot(a, aLat) / Math.max(aGrip, 1), 0, 1.2);
    CORNERS.forEach((name, i) => {
      const front = name[0] === 'F', left = name[1] === 'L';
      // weight transfer: a right-hander (gLat > 0) loads the left tyres, braking (gLong < 0) the fronts
      const share = clamp(0.25 + (left ? 1 : -1) * 0.045 * gLat + (front ? -1 : 1) * 0.04 * gLong, 0.05, 0.6);
      // frictional power at the contact patch ~ force x sliding speed; the slip grows with how hard the tyre works
      const slide = share * c.mass * Math.hypot(a, aLat) * v * (0.02 + 0.08 * util * util) * (1 + 0.6 * car.dirty);
      // + rolling resistance: its power, crr x load x speed, is dissipated in the tyre as heat (carcass flexing)
      const heat = (0.45 * slide + c.crr * share * N * v) * Math.sqrt(comp.warm) * surf.heat;  // dry-running wets overheat
      // airflow cooling, W per K above the 26 C air; a water film on the track draws heat out up to 4x faster
      const conv = (20 + 1.5 * v) * (1 + 3 * w) * (tyre.ts[i] - 26);
      const cond = 90 * (tyre.ts[i] - tyre.tc[i]);      // surface -> carcass
      // thin surface layer, heats and cools in seconds; softer compounds respond faster (less effective heat capacity)
      tyre.ts[i] += (heat + (car.locked && front ? 40000 : 0) - conv - cond) / (9000 / comp.warm) * h;
      tyre.tc[i] += (cond - 15 * (tyre.tc[i] - 26)) / 60000 * h;  // carcass: tens of seconds
      const wear = comp.wear * surf.wear * pace.wear * (car.v * h / T.len) * (0.5 + 0.8 * util) * share * 4
                 * (tyre.ts[i] > comp.window[1] + 10 ? 2 : 1)  // blistering above the window: twice the wear
                 * (car.locked && front ? 3 : 1);  // a locked wheel grinds a flat spot
      tyre.health[i] = Math.max(0, tyre.health[i] - wear);
    });
    // a lock-up: braking at the limit on tyres that have lost their grip smokes the fronts
    car.smoke = (car.locked || (brake > 0.95 && (wearGrip(health) < 0.8 || thermalGrip(temp, comp.window) < 0.7))) && w < 0.2 ? 1 : 0;
    car.spray = w * smooth(v, 15, 60);  // rooster tail: the diffuser and tyres throw up water in proportion to both

    Object.assign(car, {a, gLat, gLong, throttle, brake, onKerb: kerb > 0, util});  // onKerb / util: for the audio
    if (manual) car.rpm *= c.rpmMax / 15000;  // the player's gearbox works on a 15,000 rpm scale: same share of this limiter
    else ({gear: car.gear, rpm: car.rpm} = gearbox(car.v * 3.6, c.rpmMax));
  }

  // lap and sector times, plus the leader's passage time at every 20 m of race distance (for time gaps)
  function timing(car) {
    if (car.s < 0) return;
    const b = Math.floor(car.s / 20);
    if (R.leaderPass[b] === undefined) R.leaderPass[b] = R.t;
    const lapsDone = Math.floor(car.s / T.len), sector = Math.floor((car.s % T.len) / (T.len / 3));
    if (car.secs.length === 0 && sector === 0 && car.lapStart === 0) car.lapStart = car.secStart = R.t;
    if (car.secs.length < sector) { car.secs.push(R.t - car.secStart); car.secStart = R.t; }
    if (lapsDone > car.lapsDone) {
      if (car.lapsDone >= 0 && car.secs.length >= 2) {
        car.secs.push(R.t - car.secStart);
        R.laps[car.id].push([car.lapStart, car.lapsDone + 1, R.t - car.lapStart, ...car.secs.slice(0, 3)]);
      }
      car.lapsDone = lapsDone;
      car.attackLaps = car.gapSec < 1.2 ? car.attackLaps + 1 : 0;  // laps spent stuck behind a car (undercut trigger)
      car.lapStart = car.secStart = R.t;
      car.secs = [];
      if (lapsDone >= total && !car.finished) {
        car.finished = true;
        R.winner ??= car.id;
        car.finishT = R.t;
        R.status = 'CHEQUERED';
      }
      car.ers.harvested = car.ers.deployed = 0;  // per-lap energy limits reset at the line
    }
  }

  // advance by dt seconds of race time in equal substeps (<= 1/120 s, more when the replay runs fast); they end exactly on
  // the frame's time, so nothing needs interpolating between physics states and cars don't judder
  R.advance = dt => {
    const n = clamp(Math.ceil(dt * 120), 1, 40), h = dt / n;
    for (let i = 0; i < n; i++) { step(h); R.onStep?.(); }  // onStep: the telemetry recorder (tracemodal.js)
    if (R.winner && cars.every(x => x.finished || R.t - (cars.find(y => y.id === R.winner).finishT) > 90)) R.done = true;
  };

  // race order and time gaps to the leader (leader's passage time at this car's distance)
  R.board = () => {
    const order = cars.slice().sort((x, y) => (y.finished && x.finished ? x.finishT - y.finishT : y.s - x.s));
    return order.map((car, i) => {
      const lapsDown = Math.floor((order[0].s - car.s) / T.len), pass = R.leaderPass[Math.floor(car.s / 20)];
      const gap = i === 0 || car.s < 0 ? null : car.finished && order[0].finished ? car.finishT - order[0].finishT
                : pass !== undefined ? R.t - pass : null;
      return {car, pos: i + 1, lap: clamp(car.lapsDone + 1, 1, total), gap, lapsDown};
    });
  };

  const byId = id => cars.find(x => x.id === id);
  R.setErsMode = (id, mode) => { const car = byId(id); if (car) car.ers.user = mode; };
  R.toggleDrsTest = id => { const car = byId(id); if (car) car.drs.forced = !car.drs.forced; };
  R.setPace = (id, mode) => { const car = byId(id); if (car) car.paceUser = mode; };  // null hands it back to the AI
  // pit-wall call: box this lap for `compound`; null cancels a call not yet acted on
  R.box = (id, compound) => {
    const car = byId(id);
    if (car && car.pit.state === 'RACING') car.pit.box = compound ? {compound, user: true} : null;
  };
  R.predict = id => { const car = byId(id); return car && predictRejoin(R, car); };
  R.setWeather = target => { R.W.target = target; };
  R.setWetness = w => setWetness(R.W, w);
  R.deploy = state => deploy(R.control, state);
  // hand a car to the player (null: back to the AI), carrying its speed and gear over so nothing jumps
  R.setPlayer = id => {
    for (const x of cars) x.player = x.id === id;
    R.player = id;
    const car = byId(id);
    if (car) Object.assign(car, {psi: 0, delta: 0, kPath: 0, spin: 0, gear: Math.max(1, car.gear), paceUser: null});
  };
  // Racing-line ribbon ahead of a car: 60 samples (300 m) on the line, coloured by comparing the car's speed with the
  // speed it can carry at each point: the braking envelope v_j = min(corner speed_j, sqrt(v_(j+1)^2 + 2 a_brake ds))
  // built backwards from the far end. 0 green (can accelerate), 1 amber (lift), 2 red (must brake).
  R.ribbon = (id, n = 60) => {
    const car = byId(id);
    if (!car?.plan) return null;
    const env = envelope(T, c, car.plan, car.s, n), out = new Array(n);
    for (let j = 1; j <= n; j++) {
      const s = car.s + j * T.ds, va = env.v[j];
      out[j - 1] = {pos: trackPos(T, s, at(T, T.line, s)), state: car.v > va + 3 ? 2 : car.v > va - 8 ? 1 : 0, corner: env.vmax[j] < 80};
    }
    return out;
  };
  R.car = byId;
  // the pit lane in map coordinates, entry road to exit road: the real lane's own points, else the made-up path
  // (an offset from the track every 5 m)
  const L = R.pit, laneAt = x => L.line ? lanePos(L, x) : trackPos(T, L.AT + x, pitPath(L, x));
  R.pitLane = () => L.line ? L.line.filter(([x]) => x >= L.START).map(([, mx, my]) => [mx, my])
                           : L.prof.filter(([x]) => x >= L.START).map(([x, d]) => trackPos(T, L.AT + x, d));
  // pit boxes, one per team (groups: each team's driver ids, in pit-lane order), 12 m apart about the lane's middle
  // (closer in a short lane); each car stops at its team's. Returns [{ids, at}]: each box's map point.
  R.setBoxes = groups => {
    const gap = Math.min(12, (L.EXIT - L.ENTRY - 20) / Math.max(1, groups.length - 1));
    return groups.map((ids, k) => {
      const off = (k - (groups.length - 1) / 2) * gap;
      for (const id of ids) { const car = byId(id); if (car) car.boxAt = off; }
      return {ids, at: laneAt(L.BOX + off)};
    });
  };
  // A car in the pit sequence `ahead` metres on, on the real lane: its progress x along the lane read off the lane's
  // own points, eased in over the 40 m where the lane leaves the track and out where it rejoins. null otherwise.
  const onLane = (car, ahead) => {
    if (!L.line || car.pit.state === 'RACING') return null;
    const x = car.s + ahead - car.pit.start, w = ease(Math.max(0, Math.min(1, (x - L.START) / 40, (L.OUT - x) / 40)));
    if (w <= 0) return null;
    const a = trackPos(T, car.s + ahead, car.d), b = lanePos(L, x);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  R.pos = car => onLane(car, 0) ?? trackPos(T, car.s, car.d);
  // where the car points: along the track, plus its own heading psi when the player has it sliding or spinning
  R.posAhead = (car, dt) => onLane(car, Math.max(car.v, 1) * dt)
    ?? trackPos(T, car.s + Math.max(car.v, 1) * dt * Math.cos(car.psi), car.d + Math.max(car.v, 1) * dt * Math.sin(car.psi));
  return R;
}
