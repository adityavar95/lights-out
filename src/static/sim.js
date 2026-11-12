// F1 race simulation: vehicle dynamics, aerodynamics, wake, tyres, DRS, ERS and AI drivers on a real circuit outline,
// with weather (weather.js), wet tyres (tyres.js), pit stops and strategy (strategy.js) and race control
// (racecontrol.js). Pure (no DOM / three.js) so node tests can run whole races. Units: SI throughout (m, s, kg, N, W, J);
// positions in metres on the map plane (x right, y down), so a right-hand turn has positive curvature, on the +normal side.
import {clamp} from './telemetry.js';
import {buildTrack, trackPos, at, idx} from './track.js';
import {COMPOUNDS, thermalGrip, wearGrip, surfaceGrip, aquaplaneSpeed} from './tyres.js';
import {createWeather, weatherStep, setWetness, wetAt, trackWetness} from './weather.js';
import {createControl, controlStep, deploy, neutralised, vscDelta, safetyCar} from './racecontrol.js';
import {createPit, pitControl, inPitLane, aiStrategy, aiPace, predictRejoin, PACE, pitLayout, lanePath, lanePos, pitPath, laneFor, ease, PIT_LIMIT} from './strategy.js';
import {racecraft, resolveContacts, blocker} from './racecraft.js';
import {playerControls, ASSISTS} from './player.js';
import {carSpec, gearUp, aero as aeroStep, vehicleStep, lateralLimit, autoShift, control} from './vehicle.js';

export {COMPOUNDS, thermalGrip, wearGrip, carSpec};
export {racingLine, trackPos} from './track.js';

const RHO = 1.225, G = 9.81;  // air density kg/m^3, gravity
const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- the car ----------

// Everything about the car comes from its era's profile (eras.js through vehicle.js carSpec): mass and fuel, aero,
// tyres, power unit, gearbox, aids. Each car gets its own copy (its mass changes as its fuel burns).
// ---------- physics ----------

// Cornering speed limit. Lateral grip must supply the centripetal force: m v^2 |k| <= mu (m g + 0.5 rho v^2 ClA).
// Solving for v: v^2 (|k| - mu rho ClA / 2m) <= mu g. When the aero term exceeds |k| the corner is "flat": downforce
// grows with v^2 as fast as the required force does, so grip never runs out and only power limits the speed.
// Banking adds to it: on a road tilted by beta towards the corner's inside, gravity's component along the road surface
// supplies g sin(beta) of the centripetal force for free (off-camber, beta < 0, takes it away), so the numerator becomes
// g (mu + sin beta). help = sin(beta) signed for this corner's direction.
// Load sensitivity (ls): a tyre's friction falls as it is pressed harder, mu = mu0 (N / m g)^-ls, so a slow corner
// (light load) gets more of mu0 than a fast one; solved here by two fixed-point passes on the speed.
function cornerSpeed(k, mu0, ClA, m, help = 0, ls = 0) {
  let mu = mu0, v = 150;
  for (let pass = 0; pass < (ls ? 3 : 1); pass++) {
    const den = Math.abs(k) - mu * RHO * ClA / (2 * m);
    v = den <= 0 ? 150 : Math.min(150, Math.sqrt(Math.max(0.05, mu + help) * G / den));
    mu = mu0 * (1 + 0.5 * RHO * v * v * ClA / (m * G)) ** -ls;
  }
  return v;
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
    // the racing line's own curvature: the path the AI drives (vs the centre line: corners opened out, the swing across)
    const i = idx(T, s0 + j * T.ds), k = T.kLine[i], help = T.sinBank[i] * (Math.sign(k) || 0);  // ~3,000 samples per car per second
    vmax[j] = cornerSpeed(k, plan.mu, plan.ClA, c.mass, help, c.loadSens);
    if (j < n) {
      // judge the cornering load at the speed the car will have HERE (faster than at the next point), estimated from the
      // full-grip upper bound: using the lower next-point speed would promise braking grip the car doesn't have
      const q = 0.5 * RHO * next * next, load = 1 + q * plan.ClA / (c.mass * G), grip = plan.mu * load ** -c.loadSens * G * load;
      const here = next * next + 2 * grip * T.ds, lat = Math.max(0, here * Math.abs(k) - G * help);
      // x0.9: the brakes really get ~90 % of the circle (ABS pulses at 93-97 %, and a sliver is kept for steering)
      const brake = 0.9 * c.muLong * Math.sqrt(Math.max(0, grip * grip - lat * lat)) + q * plan.CdA / c.mass + G * T.grade[i];
      next = Math.sqrt(next * next + 2 * clamp(brake, 3, c.maxBrakeG * G) * T.ds);
    }
    next = Math.min(next, vmax[j]);
    v[j] = next;
  }
  return {v, vmax};
}

// The envelope reads the track per sample, so it only moves when the car crosses a sample (every ~4 steps at speed) or its
// grip shifts. It was a quarter of the page's CPU at 10x, recomputed for every car every step.
function planned(T, car, c, plan, look) {
  const i = idx(T, car.s), e = car.env;
  if (e?.i === i && e.look >= look && Math.abs(plan.mu - e.mu) < 0.003 * e.mu && Math.abs(plan.ClA - e.ClA) < 0.005 * e.ClA) return e;
  return (car.env = {...envelope(T, c, plan, car.s, look), i, look, mu: plan.mu, ClA: plan.ClA});
}

const CORNERS = ['FL', 'FR', 'RL', 'RR'];

// entry list in grid order, one car per driver: a shared drive lists its driver once per car (Moss, Britain 1957)
export function gridOrder(list) {
  const seen = new Set();
  return list.slice().sort((a, b) => a.grid - b.grid).filter(e => !seen.has(e.id) && seen.add(e.id));
}

// ann: circuits.js annotate() output (elevation, banking, kerbs, zones); aero: the circuit's wing trim {cl, cd, drs}
// (multipliers on ClA / CdA, DRS drag cut); pitLoss: MultiViewer's real pit losses, which size the pit lane.
// fuel: share of the race fuel load aboard (Play's time trial: a qualifying load, with laps Infinity)
export function createRace({year, mapPts, mpu, width, drivers, laps, compounds, ann, aero, pitLoss, pitLane, fuel = 1}) {
  const T = buildTrack(mapPts, mpu, width, ann), c = carSpec(year);
  c.fuel *= fuel;
  // Circuit aero trim: Monaco runs maximum wing (more downforce, more drag), Monza "skinny" wings (~360 km/h)
  c.ClA *= aero?.cl ?? 1;
  c.CdA *= aero?.cd ?? 1;
  c.drsCut = aero?.drs ?? 0.22;  // a small Monza rear wing gains less from opening the flap
  // Thin air at altitude takes downforce and drag alike (both go as rho), and the power of an engine with no turbo
  const air = (ann?.rho ?? RHO) / RHO;
  c.ClA *= air;
  c.CdA *= air;
  if (!c.turbo) c.pIce *= air;
  gearUp(c, c.CdA * (c.active ? c.active.xCd : c.drs ? 1 - c.drsCut : 1));  // geared for the circuit's top speed
  const total = laps ?? Math.ceil(305e3 / T.len);  // race distance: the fewest complete laps covering 305 km
  const cars = drivers.map((id, g) => ({
    id, grid: g, s: -(8 * g + 6), d: g % 2 ? -1.6 : 1.6, v: 0, a: 0, gLat: 0, gLong: 0, throttle: 0, brake: 0, gear: 1, rpm: 4000,
    spec: {...c}, ctl: control(),  // its own copy of the car (its fuel burns) and the controls it is driven with
    skill: 1 + 0.012 * (1 - 2 * g / Math.max(1, drivers.length - 1)),  // qualifying order as car/driver pace, +-1.2 %
    tyre: {compound: compounds?.[g] ?? ['MEDIUM', 'SOFT', 'MEDIUM', 'HARD'][g % 4], health: [100, 100, 100, 100],
           ts: [70, 70, 70, 70], tc: [70, 70, 70, 70]},                     // off the blankets: 70 C
    pit: createPit(compounds?.[g] ?? ['MEDIUM', 'SOFT', 'MEDIUM', 'HARD'][g % 4]), stint: 0, hist: [], attackLaps: 0,
    pace: 'BALANCED', paceUser: null, slide: 0, wet: 0, spray: 0, vref: new Float32Array(T.n),  // green-flag speed per sample
    player: false, delta: 0, kPath: 0, psi: 0, vy: 0, r: 0, aLong: 0, spin: 0, locked: false, tcCut: false, damage: 0, contact: 0,
    shiftT: 0, boost: 0, aeroX: 0, seal: 1, snatch: 0,
    ers: {soc: 0.9, mode: 'BALANCED', user: null, harvested: 0, deployed: 0, harvesting: false, deploying: false, derate: false},
    drs: {armed: false, open: false, forced: false, zone: -1},
    z: 0, zv: 0, clearance: c.h0, sparks: 0, smoke: 0, wake: 0, dirty: 0, ahead: null, gapAhead: Infinity,
    pass: null, lapStart: 0, secStart: 0, secs: [], lapsDone: 0, finished: false,
    react: 0.15 + 0.2 * Math.random(), err: 0,  // reaction to lights out (s); a driver error's time left (s)
    lapTrace: new Float32Array(T.n), bestTrace: null, best: Infinity, lapDelta: null,  // lap time at each sample: the delta
  }));
  // the start: five red lights come on a second apart, then go out together after a random 0.2-3 s hold
  const R = {T, c, total, cars, t: 0, status: 'RED', lightsOut: 5.2 + 2.8 * Math.random(), laps: {}, leaderPass: [], winner: null, done: false,
             W: createWeather(), control: createControl(c.overtake ? 'OVERTAKE' : 'DRS', year >= 2024 ? 1 : 2),
             ai: {pace: 1, aggression: 0.5}, assists: {...ASSISTS}, input: {throttle: 0, brake: 0, steer: 0, clutch: 0}, player: null,
             wing: 0,  // pit-wall trim, -5..+5 clicks
             gravel: ann?.preset?.runoff === 'gravel',  // the circuit's traps on the corners' outsides: slower than grass for the player
             // the circuit's real pit lane from GPS when there is one, else one alongside the main straight
             pit: Object.assign((pitLane && lanePath(T, pitLane)) ?? pitLayout(T, pitLoss ? laneFor(+pitLoss.normal, ann?.pitLimit ?? PIT_LIMIT) : 400), {limit: ann?.pitLimit ?? PIT_LIMIT})};
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
    if (R.status === 'RED' && R.t >= R.lightsOut) R.status = 'GREEN';
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
    if (R.status === 'RED' || (!car.player && R.t < R.lightsOut + car.react)) return;  // the player reacts for themself
    const c = car.spec, X = car.ctl, tyre = car.tyre, comp = COMPOUNDS[tyre.compound], v = car.v;
    const k = at(T, T.k, car.s), ks = at(T, T.ks, car.s), lapS = ((car.s % T.len) + T.len) % T.len, line = at(T, T.line, car.s), ctl = R.control;
    // fuel burns in proportion to race distance (refuelling era: a constant average stint load)
    c.mass = c.minMass + (c.refuel ? c.fuel : Math.max(1, c.fuel * (1 - Math.max(0, car.s) / (total * T.len))));
    const pit = pitControl(R, car, h, line);
    if (pit?.hold) {  // stationary in the box while the crew changes tyres
      Object.assign(car, {v: 0, a: 0, throttle: 0, brake: 1, gear: 1, rpm: 0.3 * c.rpmMax, sparks: 0, smoke: 0, spray: 0, vy: 0, r: 0, psi: 0});
      return;
    }

    // --- wake: within 0.1-1.5 s behind another car and roughly in line with it ---
    // tow: the leading car's wake is a low-pressure region, so drag falls (up to -18 % Cd) on straights;
    // dirty air: the same turbulent, downwashed air starves the wings and floor in corners (up to -22 % Cl)
    const o = car.ahead, aligned = o ? 1 - clamp(Math.abs(car.d - o.d) / 2.2, 0, 1) : 0;
    const inWake = car.gapSec >= 0.1 && car.gapSec <= 1.5 ? 1 - (car.gapSec - 0.1) / 1.4 : 0;
    const straight = clamp(1 - Math.abs(ks) * 75, 0, 1), cornering = (1 - straight) * smooth(v, 25, 45);  // 90+ km/h corners
    car.wake = aligned * inWake;
    car.dirty = car.wake * cornering;

    // --- aero and ride height (vehicle.js aero): bumps, kerbs, the wake, a broken wing, the pit wall's trim ---
    const bump = 0.003 * Math.sin(lapS * 0.071) * Math.sin(lapS * 0.013 + 1.3) + 0.0015 * Math.sin(lapS * 0.53);
    // riding the kerb at the apex: flat FIA kerbs lift the floor ~12 mm; the tall "sausage" kerbs at chicanes like Monza's
    // Rettifilo ~50 mm, enough to slam the plank into the track
    const sausage = at(T, T.kerb, car.s) === 'sausage' && Math.abs(car.d) > T.half - 1.3 && v > 15;
    const kerb = sausage ? 0.05 : Math.abs(car.d) > T.half - 1.6 && Math.abs(k) > 1 / 100 ? 0.012 : 0;
    car.sausage = sausage;
    car.kerb = kerb;
    // Elevation: the road's pitch angle is atan(grade). Gravity along it, g sin(pitch), slows the car uphill and pushes
    // it downhill; across it, g cos(pitch) plus v^2 kv presses the car into the road: a compression (kv > 0) piles
    // several g of extra load onto the suspension (bottoming at Eau Rouge), a crest (kv < 0) unloads the tyres.
    const grade = at(T, T.grade, car.s), pitchCos = 1 / Math.sqrt(1 + grade * grade), slope = G * grade * pitchCos;
    const vertical = c.mass * (v * v * at(T, T.kv, car.s));
    // a broken front wing (damage 0..1) costs up to 18 % of the downforce until the nose is changed in the pits; each
    // click of pit-wall wing ~4 % downforce for ~3 % drag
    const A = aeroStep(car, c, X, h, {mult: (1 - 0.22 * car.dirty) * (1 - 0.18 * car.damage) * (1 + 0.04 * R.wing),
      drag: (1 - 0.18 * car.wake * straight) * (1 + 0.03 * R.wing), vertical, kerb, bump, drsCut: c.drsCut});

    // --- grip: compound x surface water x temperature x wear x driver, on a normal load that includes downforce ---
    // Water: the track's wetness where this car is (the racing line dries first) against what its tread can handle.
    // Aquaplaning: above the tread's critical speed for this much water, high-speed corners bring brief micro-slides
    // (a 0.3 s grip loss to 65 %), more often the further over that speed it is. Off the track: run-off and grass x0.55.
    const w = car.wet = wetAt(R.W, Math.abs(car.d - line)), surf = surfaceGrip(tyre.compound, w);
    const vAq = aquaplaneSpeed(tyre.compound, w);
    if (car.slide > 0) car.slide -= h;
    else if (v > vAq && Math.abs(ks) > 1 / 300 && Math.random() < h * 3 * (v / vAq - 1)) car.slide = 0.3;
    const temp = tyre.ts.reduce((a, b) => a + b) / 4, health = tyre.health.reduce((a, b) => a + b) / 4;
    const win = [comp.window[0] + c.warm, comp.window[1] + c.warm];  // the era's rubber (eras.js tyre.warm)
    const skill = car.player ? 1 : car.skill * R.ai.pace;  // the AI pace slider (80-110 %) scales the AI cars' grip
    const off = !pit && Math.abs(car.d) > T.half + 1.6;
    // The player's car feels the surface; the AI never leaves the track on purpose and its plan knows only the flat 0.55.
    // Off: gravel on a corner's outside (a gravel circuit) 0.5, else grass 0.45 (0.3 wet). Rubber picked up there costs 8 %
    // until ~1.5 km have cleaned it off. A flat kerb ripples the load +-8 % (zero mean: lap times hold), a sausage kerb
    // unsettles the tyres for 0.15 s (the slide grip loss).
    let offMu = off ? 0.55 : 1, ripple = 1;
    const trap = car.player && off && R.gravel && Math.abs(ks) > 1 / 150 && car.d * ks < 0;
    if (car.player) {
      car.dirt = off ? 1 : Math.max(0, (car.dirt ?? 0) - v * h / 1500);
      if (off) offMu = trap ? 0.5 : 0.45 * (1 - 0.3 * trackWetness(R.W));
      if (kerb && !sausage) ripple = 1 + 0.08 * Math.sin(car.s * 6.9) * Math.sin(car.s * 2.3 + 1);
      if (sausage && !(car.slide > 0)) car.slide = 0.15;
    }
    const mu = c.mu * skill * comp.grip * surf.grip * thermalGrip(temp, win) * wearGrip(health) * (car.slide > 0 ? 0.65 : 1) * offMu * (1 - 0.08 * (car.dirt ?? 0));
    const N = Math.max(0.2 * c.mass * G, c.mass * G * pitchCos + vertical + A.down) * ripple;
    const muN = mu * (N / (c.mass * G)) ** -c.loadSens, aGrip = muN * N / c.mass;  // load sensitivity (cornerSpeed)
    const help = bankHelp(T, car.s, k);  // banking towards the corner's inside carries g sin(beta) of the cornering load
    // the driver's pace mode sets how much of that grip they plan to use (pushing, standard, saving tyres)
    car.pace = aiPace(R, car);
    // the plan counts on the weaker axle's share (vehicle.js lateralLimit), what the car can really hold, judged without
    // the moment's braking or drive (counting it, the plan would chase its own braking down)
    const balance = Math.min(1, lateralLimit(car, c, muN, N, A.down, 0) / aGrip);
    // driver error: now and then an AI driver commits too late to a braking zone (more often pushing and in the wet),
    // planning on 12 % more grip than there is: it locks the fronts and runs wide, a second or so lost (~2 a race)
    if (car.err > 0) car.err -= h;
    else if (!car.player && !pit && !neutralised(ctl) && car.brake > 0.5
             && Math.random() < h * 0.003 * (0.5 + R.ai.aggression) * (1 + 3 * trackWetness(R.W))) car.err = 1.5;
    // attacking: brakes a little later, up to the car's full grip (planning past it only misses the corner)
    const pace = PACE[car.pace], muPlan = mu * balance * (car.err > 0 ? 1.12 : Math.min(1, pace.plan * (1 + (car.deeper || 0))));

    // --- what speed can the car carry? scan the next braking distance for the tightest constraint ---
    // horizon: enough to brake at ~0.8 g plus margin; braking shares grip with curving approaches, so it can take far
    // longer than a straight-line stop (the envelope must see the corner before the car is committed). The plan uses
    // corner-mode aero (the 2026 flaps shut the moment the driver lifts) at the settled ride height.
    const look = Math.min(140, Math.ceil((v * v / 16 + 80) / T.ds));
    car.plan = {mu: muPlan, ClA: A.ClAplan, CdA: A.CdA};  // also for the racing-line ribbon
    const env = planned(T, car, c, car.plan, look);
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
    if (pit) vAllow = Math.min(vAllow, pit.vCap);  // pit entry braking and the limiter
    if (car.finished) vAllow = Math.min(vAllow, 45);  // cool-down lap

    // --- ERS mode, and (AI) the lane: racecraft.js picks racing line / tow / attack / defence and leaves the space ---
    const ers = car.ers, manual = car.player && !pit, drs = car.drs;
    ers.mode = ers.user ?? (car.attackPush ? 'PUSH' : ers.soc < 0.2 ? 'HARVEST' : pace.ers);
    let dTarget = car.d;
    if (!manual) {
      dTarget = racecraft(R, car, {o, straight, brakeAhead, turn, line, neutral: neutralised(ctl) || !!pit});
      if (car.blue) dTarget = (car.d >= 0 ? 1 : -1) * (T.half - 1.2);  // blue flag: move over to the edge and let the leader by
      if (c.skirts) dTarget = clamp(dTarget, 1.7 - T.half, T.half - 1.7);  // a kerb breaks the skirts' seal: stay off them
      if (pit) dTarget = pit.d;
      car.dTarget = dTarget;
    }

    // --- the controls: the player's (player.js filters their input), or the AI driver's ---
    // Straight-line aero (2026 X mode) wherever the track runs straight with the next braking point well ahead, on a
    // green flag and a dry track; DRS (2011-25) or the overtake override (2026) once armed (below).
    const xOk = !!c.active && straight > 0.9 && brakeAhead > Math.max(100, v) && !neutralised(ctl) && trackWetness(R.W) <= 0.2 && !pit;
    X.aeroMode = c.active ? (xOk ? 'X_MODE_STRAIGHT' : 'Z_MODE_CORNER') : drs.open ? 'DRS_OPEN' : 'FIXED';
    X.ersMode = c.overtake && drs.open ? 'BOOST_OVERRIDE' : ers.mode;
    const sinBank = at(T, T.sinBank, car.s), coast = ers.mode === 'HARVEST' && brakeAhead < 70 && v > 40;
    if (manual) playerControls(R, car, h, X, {vAllow, aGrip, help, k});
    else {
      // pedals track the speed envelope: the brake above it (the foot of a pro, which like ABS holds each axle at what
      // the corner leaves it: vehicle.js), part throttle up to it, lift and coast to harvest
      X.brake = v > vAllow + 0.3 ? clamp((v - vAllow) / 0.8, 0.4, 1) : 0;
      X.throttle = X.brake || coast ? 0 : clamp((vAllow - v) / 2, 0, 1);
      // a turbo without an MGU-H: crack the throttle against the brakes into the corner so the boost is up at the apex
      X.preload = c.turbo && !c.mguh && X.brake > 0 && v < vAllow + 12 ? 0.6 : 0;
      X.gearShift = autoShift(car, c, X.brake);
      Object.assign(X, {clutch: 0, abs: true, tc: 1, autoBlip: true, autoClutch: true});  // a pro's feet: no lock-ups, no wheelspin
      // Lateral: the AI drives its lane (racing line, tow, attack, defence: racecraft.js) as an ideal driver, moving
      // across at up to 2.5 m/s (20 in the pit sequence) and cornering on its lane's curvature (the track's where it
      // is, plus the racing line's own bend, which its lanes follow); the car
      // takes the corner as far as its tyres allow and runs wide by the rest (vehicle.js)
      X.kappa = k / Math.max(0.3, 1 - k * car.d) + at(T, T.dd, car.s);  // its lane bends with the racing line
      X.lane = {d: dTarget, rate: pit ? 20 : 2.5};
      X.steer = Math.atan(c.wb * X.kappa) / c.maxLock;  // for the cockpit wheel and the front wheels
      // what to keep back for cornering (trail braking); about to run into the car ahead, the brakes come first and
      // the car runs wide instead
      const closing = car.block && car.block.gap < 10 + 0.15 * v && v > car.block.o.v + 1;
      X.fyNeed = closing ? 0 : c.mass * v * v * Math.abs(X.kappa);
    }
    const s0 = car.s, out = vehicleStep(R, car, X, h, {T, k, mu: muN, N, down: A.down, drag: A.drag, slope, sinBank, off: trap ? 'gravel' : off, rail: !!pit, dRail: dTarget});
    const {a, aLat, throttle, brake} = out;

    // --- DRS: armed when crossing a detection point within 1.000 s of the car ahead, opens in the zone on throttle,
    // snaps shut on the brakes or at the end of the zone. From 2026 the overtake override (extra MGU-K power and energy)
    // replaces the flap: one detection point before the line, then the whole of the next lap to spend it on ---
    if (!neutralised(ctl) && !pit && car.lapsDone >= 1 && !car.player) car.vref[vi] = car.v;  // learn racing pace (after lap 1)
    const cross = x => { const p = ((s0 % T.len) + T.len) % T.len; return p <= x && p + (car.s - s0) > x; };
    // Race control's interlock (green flag, dry track, laps after the start or a restart) gates it all; the testing
    // toggle stands in for the 1-second rule but not for the safety interlocks.
    const allowed = (c.drs || c.overtake) && (ctl.drs || (drs.forced && !neutralised(ctl) && trackWetness(R.W) <= 0.2));
    const detected = i => { drs.armed = allowed && (car.gapSec <= 1 || drs.forced) && !pit; drs.zone = i; };
    if (c.overtake) { if (cross(T.len - 150)) detected(0); }
    else T.zones.forEach((z, i) => { if (cross(z.detect)) detected(i); });
    const zone = T.zones[drs.zone];  // zone ends may lie past the line (end > len), so test the lap position both ways
    const inZone = c.overtake ? !pit : !!zone && ((lapS >= zone.start && lapS <= zone.end) || (lapS + T.len >= zone.start && lapS + T.len <= zone.end));
    // the player opens it with the DRS button (R / Space / pad A), the AI whenever it isn't braking (a follower held at
    // the speed of the car ahead may be on part throttle)
    const ask = manual ? R.input.drs : brake === 0;
    if (manual) R.input.drs = false;
    if (drs.open && (brake > 0 || !inZone || !allowed || (manual && ask))) { drs.open = false; if (!c.overtake || !allowed) drs.armed = false; }
    else if (drs.armed && inZone && ask) drs.open = true;

    // --- tyres, per corner: load share, sliding heat, airflow cooling, wear ---
    const gLong = a / G, gLat = aLat / G, util = clamp(Math.hypot(a, aLat) / Math.max(aGrip, 1), 0, 1.2);
    const size = c.minMass / 800;  // tyres are sized to the car they carry: cooling area and heat capacity scale with it
    CORNERS.forEach((name, i) => {
      const front = name[0] === 'F', left = name[1] === 'L';
      // weight transfer: a right-hander (gLat > 0) loads the left tyres, braking (gLong < 0) the fronts
      const share = clamp(0.25 + (left ? 1 : -1) * 0.045 * gLat + (front ? -1 : 1) * 0.04 * gLong, 0.05, 0.6);
      // frictional power at the contact patch ~ force x sliding speed; the slip grows with how hard the tyre works
      const slide = share * c.mass * Math.hypot(a, aLat) * v * (0.02 + 0.08 * util * util) * (1 + 0.6 * car.dirty);
      // + rolling resistance: its power, crr x load x speed, is dissipated in the tyre as heat (carcass flexing)
      const heat = (0.45 * slide + c.crr * share * N * v) * Math.sqrt(comp.warm) * surf.heat;  // dry-running wets overheat
      // airflow cooling, W per K above the 26 C air; a water film on the track draws heat out up to 4x faster
      const conv = (20 + 1.5 * v) * (1 + 3 * w) * (tyre.ts[i] - 26) * size;
      const cond = 90 * size * (tyre.ts[i] - tyre.tc[i]);      // surface -> carcass
      // thin surface layer, heats and cools in seconds; softer compounds respond faster (less effective heat capacity)
      tyre.ts[i] += (heat + (car.locked && front ? 40000 : 0) * size - conv - cond) / (9000 * size / comp.warm) * h;
      tyre.tc[i] += (cond - 15 * size * (tyre.tc[i] - 26)) / (60000 * size) * h;  // carcass: tens of seconds
      const wear = comp.wear * surf.wear * pace.wear * (car.v * h / T.len) * (0.5 + 0.8 * util) * share * 4
                 * (tyre.ts[i] > win[1] + 10 ? 2 : 1)  // blistering above the window: twice the wear
                 * (car.locked && front ? 3 : 1);  // a locked wheel grinds a flat spot
      tyre.health[i] = Math.max(0, tyre.health[i] - wear);
    });
    // a lock-up: braking at the limit on tyres that have lost their grip smokes the fronts
    car.smoke = (car.locked || (car.err > 0 && brake > 0.5) || (brake > 0.95 &&(wearGrip(health) < 0.8 || thermalGrip(temp, win) < 0.7))) && w < 0.2 ? 1 : 0;
    car.spray = w * smooth(v, 15, 60);  // rooster tail: the diffuser and tyres throw up water in proportion to both

    Object.assign(car, {a, gLat, gLong, throttle, brake, onKerb: kerb > 0, util});  // onKerb / util: for the audio
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
        if (R.t - car.lapStart < car.best) {
          car.best = R.t - car.lapStart;
          [car.bestTrace, car.lapTrace] = [car.lapTrace, car.bestTrace ?? new Float32Array(T.n)];
        }
      }
      car.lapsDone = lapsDone;
      car.attackLaps = car.gapSec < 1.2 ? car.attackLaps + 1 : 0;  // laps spent stuck behind a car (undercut trigger)
      car.lapStart = car.secStart = R.t;
      car.secs = [];
      // the chequered flag: the winner after `total` laps, then every car the next time it crosses the line, lapped or not
      if ((lapsDone >= total || R.winner) && !car.finished) {
        car.finished = true;
        R.winner ??= car.id;
        car.finishT = R.t;
        car.finishLaps = lapsDone;
        R.status = 'CHEQUERED';
      }
      car.ers.harvested = car.ers.deployed = 0;  // per-lap energy limits reset at the line
    }
    // live delta: this lap's time here against the best lap's at the same point
    const i = idx(T, car.s);
    car.lapTrace[i] = R.t - car.lapStart;
    car.lapDelta = car.bestTrace ? car.lapTrace[i] - car.bestTrace[i] : null;
  }

  // advance by dt seconds of race time in equal substeps (<= 1/120 s, more when the replay runs fast); they end exactly on
  // the frame's time, so nothing needs interpolating between physics states and cars don't judder
  R.advance = dt => {
    if (!(dt > 0)) return;  // a zero step divides by h: an AI car's lateral rate goes 0/0 and its d stays NaN for good
    const n = clamp(Math.ceil(dt * 120), 1, 40), h = dt / n;
    for (let i = 0; i < n; i++) { step(h); R.onStep?.(); }  // onStep: the telemetry recorder (tracemodal.js)
    // every car has taken the flag, or a lap and a half (at the winner's average) has passed: one stopped out on track
    const win = R.winner && cars.find(y => y.id === R.winner);
    if (win && cars.every(x => x.finished || R.t - win.finishT > 1.5 * win.finishT / total)) R.done = true;
  };

  // race order (at the flag: laps completed, then crossing time) and time gaps to the leader (leader's passage time
  // at this car's distance)
  R.board = () => {
    const order = cars.slice().sort((x, y) => (y.finished && x.finished ? y.finishLaps - x.finishLaps || x.finishT - y.finishT : y.s - x.s));
    return order.map((car, i) => {
      const lapsDown = car.finished && order[0].finished ? order[0].finishLaps - car.finishLaps : Math.floor((order[0].s - car.s) / T.len);
      const at = car.s / 20, b = Math.floor(at), from = R.leaderPass[b], to = R.leaderPass[b + 1] ?? from;
      const pass = from === undefined ? undefined : from + (to - from) * (at - b);  // between the 20 m marks, or cars inside one show one gap
      const gap = i === 0 || car.s < 0 ? null : car.finished && order[0].finished && !lapsDown ? car.finishT - order[0].finishT
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
    const env = envelope(T, car.spec, car.plan, car.s, n), out = new Array(n);
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
