// Era Regulation Profiles: everything that makes a 1955 car drive differently from a 2026 one, as data. The solver
// (vehicle.js) and the AI never test the year; they read the numbers here. Pure; profile(year) is frozen.
//
// Each entry lists what changed that year, per subsystem, merged over the ones before it (like telemetry.js ENGINES,
// which supplies the power unit and mass). Figures are approximate public ones, calibrated so a qualifying lap of the
// Monaco outline lands near that era's pole speed (tests/test_eras.mjs).
//
// aero      ClA, CdA: lift and drag coefficient x frontal area (m^2) at static ride height, the centre of pressure at
//           the static weight split (a balanced car); ge: ground-effect gain, downforce x (1 + ge * compression / h0);
//           skirts: sliding skirts seal the Venturi tunnels (1977-82), and a kerb strike or the floor touching breaks the seal: the tunnel share of the
//           downforce (skirtShare) is lost until they reseat (~0.25 s); active (2026+): {xCl, xCd}, the straight-mode
//           (X) multipliers on downforce and drag, the corner mode (Z) being the base figures; drs: rear flap (2011-25)
// chassis   wb wheelbase (m); fwd: static front weight share; kz: yaw radius of gyration (m), Iz = m kz^2; hcg: centre of
//           gravity height (m); h0, k, zeta: plank clearance, heave spring (N/m) and damping ratio; activeSusp: a PID
//           ride-height loop (1992-93); fuel: race fuel at the start (kg), burnt in proportion to distance;
//           refuel: refuelling era, a constant average load; maxLock: road-wheel steering lock (rad)
// tyre      kind; mu: peak friction at the car's static load, falling as the load rises, mu (N / m g)^-loadSens (bias-ply
//           little, slicks more: why a slow corner gets ~1.9 and a 5 g one ~1.5 from the same rubber); slipPeak: slip angle (rad) of peak lateral force; shape: Pacejka C, which sets how
//           far the force falls past the peak, to sin(C pi / 2) of it (bias-ply ~0.92: four-wheel drifts; slicks
//           ~0.59: a sharp edge); muLong: longitudinal / lateral grip; warm: shift (C) of the compounds' working window
//           (bias-ply rubber worked ~30 C cooler than modern slicks)
// brakes    maxG: what the brakes and driver can do (drums ~1.3 g, carbon ~6 g)
// power     curve: {peak, width}: power share over rev fraction x = rpm / rpmMax: x / peak below the peak (about
//           constant torque), 1 - ((x - peak) / width)^2 past it;
//           turbo: {na, spool, threshold}: power with no boost (share), spool time constant (s) and the rev fraction
//           where the exhaust starts to drive the compressor; mguh: the MGU-H spins the turbo, no lag; ebrake: engine
//           braking on the overrun (share of peak power); kTaper: 2026 MGU-K power fades with speed; superClip: the ECU
//           harvests at full throttle at the end of straights once the lap's deployment is spent
// gearbox   type H (H-pattern, clutch and heel-and-toe), SEMI (paddles, ignition cut), SEAMLESS; gears; shift: the
//           drive interruption (s); shiftAt: upshift point, rev fraction
// aids      factory electronics that were legal: tc traction control, launch control, abs
// driver    the player's input filter: vRef (m/s), where speed-sensitive lock halves; steerTau / throttleTau (s), damping
import {engine} from './telemetry.js';

const ERAS = [
  [0, {
    aero: {ClA: 0.0, CdA: 0.9, ge: 0, skirts: false, skirtShare: 0, active: null, drs: false},
    chassis: {wb: 2.5, fwd: 0.52, kz: 1.2, hcg: 0.45, h0: 0.12, k: 60e3, zeta: 0.3, activeSusp: false, fuel: 120, refuel: false, maxLock: 0.45},
    tyre: {kind: 'bias-ply', mu: 1.23, slipPeak: 0.2, shape: 1.25, muLong: 0.95, loadSens: 0.05, warm: -30},
    brakes: {maxG: 1.3},
    power: {curve: {peak: 0.92, width: 0.6}, turbo: null, mguh: false, ebrake: 0.14, kTaper: false, superClip: false},
    gearbox: {type: 'H', gears: 4, shift: 0.45, shiftAt: 0.97},
    aids: {tc: false, launch: false, abs: false},
    driver: {vRef: 45, steerTau: 0.05, throttleTau: 0.02},
  }],
  [1954, {aero: {CdA: 0.8}, gearbox: {gears: 5, shift: 0.4}}],
  [1958, {tyre: {mu: 1.37}, brakes: {maxG: 1.5}}],                                   // disc brakes
  [1961, {aero: {CdA: 0.62}, chassis: {wb: 2.3, fwd: 0.4, kz: 1.0, hcg: 0.3, fuel: 90}}],  // mid-engined
  [1966, {aero: {CdA: 0.75}, tyre: {mu: 1.56, slipPeak: 0.16, shape: 1.35}, chassis: {fuel: 130}}],
  [1967, {gearbox: {shift: 0.3}}],                                                      // Hewland boxes
  [1968, {aero: {ClA: 1.44, CdA: 1.0}, chassis: {h0: 0.08, k: 120e3}, driver: {vRef: 38}}],  // wings
  [1971, {tyre: {kind: 'slick', mu: 1.76, slipPeak: 0.11, shape: 1.6, loadSens: 0.15, warm: 0}, aero: {ClA: 1.92, CdA: 1.1}, brakes: {maxG: 2.5}}],
  [1973, {aero: {ClA: 2.4, CdA: 1.15}, chassis: {wb: 2.6, fuel: 140}}],
  [1977, {aero: {ClA: 4.32, CdA: 1.0, ge: 0.6, skirts: true, skirtShare: 0.5}, tyre: {mu: 1.89}, chassis: {h0: 0.05, k: 400e3, zeta: 0.6},
          driver: {vRef: 32}}],                                                        // Venturi tunnels and skirts
  [1983, {aero: {ClA: 3.0, CdA: 1.2, ge: 0.1, skirts: false, skirtShare: 0}, chassis: {h0: 0.04, k: 500e3, fuel: 160},
          power: {curve: {peak: 0.85, width: 0.5}, turbo: {na: 0.25, spool: 0.9, threshold: 0.55}, ebrake: 0.1},
          brakes: {maxG: 4.5}, tyre: {mu: 1.68}, gearbox: {gears: 5, shift: 0.28}, driver: {throttleTau: 0.12}}],  // flat bottoms, turbos
  [1985, {chassis: {fuel: 140}}],
  [1989, {aero: {ClA: 3.3, CdA: 1.25}, tyre: {mu: 1.64}, power: {curve: {peak: 0.95, width: 0.55}, turbo: null, ebrake: 0.14}, chassis: {fuel: 150},
          gearbox: {gears: 6}, driver: {throttleTau: 0.04}}],
  [1991, {gearbox: {type: 'SEMI', shift: 0.08}, aids: {tc: true, launch: true}}],
  [1992, {aero: {ClA: 3.9}, chassis: {activeSusp: true}, aids: {abs: true}, brakes: {maxG: 5}}],
  [1994, {aero: {ClA: 3.0}, chassis: {activeSusp: false, refuel: true, fuel: 45}, aids: {tc: false, launch: false, abs: false}}],
  [1995, {chassis: {wb: 2.9, fwd: 0.44, kz: 1.1}, power: {curve: {peak: 0.97, width: 0.5}}}],
  [1998, {tyre: {kind: 'grooved', mu: 1.72, slipPeak: 0.12, shape: 1.55}, aero: {ClA: 3.96, CdA: 1.3}, gearbox: {gears: 7, shift: 0.05}}],
  [2001, {aero: {ClA: 4.56}, aids: {tc: true, launch: true}}],
  [2004, {aero: {ClA: 4.8, CdA: 1.4}, tyre: {mu: 1.74}, chassis: {wb: 3.05, fwd: 0.46}, brakes: {maxG: 5.5}}],
  [2008, {gearbox: {type: 'SEAMLESS', shift: 0.01}, aids: {tc: false, launch: false}}],
  [2009, {tyre: {kind: 'slick', mu: 1.82, slipPeak: 0.11, shape: 1.6}, aero: {ClA: 4.32, CdA: 1.25}, chassis: {wb: 3.25}}],
  [2010, {chassis: {refuel: false, fuel: 160}, aero: {ClA: 4.92, CdA: 1.35}}],
  [2011, {aero: {drs: true}}],
  [2014, {aero: {ClA: 4.68}, chassis: {wb: 3.45, kz: 1.2, fuel: 100},
          power: {curve: {peak: 0.75, width: 0.5}, turbo: {na: 0.6, spool: 0.4, threshold: 0.4}, mguh: true, ebrake: 0.06},
          gearbox: {gears: 8, shiftAt: 0.82}, driver: {throttleTau: 0.06}}],
  [2017, {aero: {ClA: 6.0, CdA: 1.55}, tyre: {mu: 1.95}, chassis: {wb: 3.6, kz: 1.25}, brakes: {maxG: 6}}],
  [2019, {chassis: {fuel: 110}}],
  [2022, {aero: {ClA: 5.76, CdA: 1.5, ge: 0.35}, tyre: {mu: 1.92, slipPeak: 0.09, shape: 1.7}, chassis: {h0: 0.03, k: 700e3, zeta: 0.25},
          driver: {vRef: 30}}],                                                        // ground effect, 18" tyres
  [2023, {chassis: {zeta: 0.5}}],                                                       // floors stiffened: porpoising tamed
  // 2026: ~30 % less downforce in corner mode, ~55 % less drag in straight mode; no MGU-H, so a little lag again
  [2026, {aero: {ClA: 4.4, CdA: 1.35, ge: 0.25, drs: false, active: {xCl: 0.55, xCd: 0.5}}, chassis: {wb: 3.4, fuel: 75},
          power: {turbo: {na: 0.7, spool: 0.35, threshold: 0.45}, mguh: false, kTaper: true, superClip: true}}],
];

const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
const cache = new Map();

// EraVehicleProfile for a season: {year, engine, aero, chassis, tyre, brakes, power, gearbox, aids, driver}, immutable
export function profile(year) {
  if (cache.has(year)) return cache.get(year);
  const p = {};
  for (const [from, changes] of ERAS) {
    if (year < from) break;
    for (const [sub, fields] of Object.entries(changes)) p[sub] = {...p[sub], ...fields};
  }
  const out = freeze({year, engine: {...engine(year)}, ...p});
  cache.set(year, out);
  return out;
}
