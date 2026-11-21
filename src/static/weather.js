// Dynamic weather and track water. Pure: a state machine for the sky plus a water balance for two lanes of asphalt,
// the racing line (where tyres throw the water off) and everything off-line.
import {clamp} from './telemetry.js';

export const SKIES = ['CLEAR', 'OVERCAST', 'LIGHT_RAIN', 'HEAVY_RAIN'];  // what race control can ask for
const RAIN = {CLEAR: 0, OVERCAST: 0, LIGHT_RAIN: 0.15, HEAVY_RAIN: 1, DRYING: 0};  // rainfall, 1 = monsoon
const CLOUD = {CLEAR: 0.1, OVERCAST: 0.7, LIGHT_RAIN: 0.85, HEAVY_RAIN: 1, DRYING: 0.45};
const raining = s => s === 'LIGHT_RAIN' || s === 'HEAVY_RAIN';

export const createWeather = () => ({state: 'CLEAR', target: 'CLEAR', since: 0, rain: 0, cloud: 0.1, wetLine: 0, wetOff: 0});

// manual "track wetness" override: sets the standing water everywhere (0..1 = 0..100 % water depth)
export function setWetness(W, w) { W.wetLine = W.wetOff = clamp(w, 0, 1); }

// State machine (states CLEAR, OVERCAST, LIGHT_RAIN, HEAVY_RAIN, DRYING; W.target is what was asked for):
//   anything -> rain:     clouds build first (OVERCAST for 20 s), then it rains at the requested intensity
//   rain -> rain:         intensity changes straight away
//   rain -> no rain:      DRYING until the water has gone (< 3 %), then the requested sky
//   dry  -> CLEAR/OVERCAST: straight away
// Rainfall and cloud cover then ease towards the state's values (first-order lags of 15 s and 25 s), so showers build
// and fade rather than switching on and off.
//
// Water balance per lane, in "water depth" units of 0..1 per second:
//   dW/dt = 0.006 rain - 0.002 W - evaporation - displacement
// rain inflow against drainage (proportional to depth) gives an equilibrium of 3 x rainfall: a monsoon floods the
// track in about two minutes, light rain settles off-line around 40 %. Evaporation (only once it stops raining) is
// 0.0015/s in sunshine, less under cloud. On the racing line, tyres squeeze the water out of the contact patch:
// displacement 0.003 W per unit of traffic (traffic 1 = a 20-car field at racing speed), so the line dries about
// twice as fast as the rest and stays shallower in light rain, the "drying line".
export function weatherStep(W, dt, traffic) {
  W.since += dt;
  let next = W.state;
  if (raining(W.target)) next = raining(W.state) ? W.target : W.state === 'OVERCAST' && W.since > 20 ? W.target : 'OVERCAST';
  else if (raining(W.state)) next = 'DRYING';
  else if (W.state !== 'DRYING' || Math.max(W.wetOff, W.wetLine) < 0.03) next = W.target;
  if (next !== W.state) { W.state = next; W.since = 0; }
  W.rain += (RAIN[W.state] - W.rain) * Math.min(1, dt / 15);
  W.cloud += (CLOUD[W.state] - W.cloud) * Math.min(1, dt / 25);
  const inflow = 0.006 * W.rain, evap = W.rain > 0.02 ? 0 : 0.0015 * (1 - 0.6 * W.cloud);
  W.wetOff = clamp(W.wetOff + (inflow - 0.002 * W.wetOff - evap) * dt, 0, 1);
  W.wetLine = clamp(W.wetLine + (inflow - (0.002 + 0.003 * traffic) * W.wetLine - evap * 1.3) * dt, 0, 1);
  return W;
}

// wetness a tyre meets, offLine metres from the racing line: the line's water within ~2 m of it, the rest's beyond
export const wetAt = (W, offLine) => W.wetOff + (W.wetLine - W.wetOff) * Math.exp(-offLine * offLine / 8);
export const trackWetness = W => (W.wetLine + W.wetOff) / 2;

// Sun elevation in degrees over lat, lon (degrees) at a Date: NOAA's low-order formula, within ~1.5° (no equation of time)
export function sunElevation(lat, lon, date) {
  const d = new Date(date), rad = Math.PI / 180;
  const n = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const decl = 23.44 * rad * Math.sin((360 / 365) * (n - 81) * rad);
  const hour = (d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15 - 12) * 15 * rad, phi = lat * rad;
  return Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hour)) / rad;
}
// scene3d.js's SKIES index for a sun elevation: Midday, under 20° Sunrise while the sun climbs else Sunset, Night past civil twilight (-6°)
export const skyFor = (elev, rising = false) => elev > 20 ? 0 : elev > -6 ? (rising ? 4 : 1) : 3;

// A replay's weather look at t: OpenF1's rows [t, air, track, rainfall, wind] only say whether rain is falling, so water
// builds while it does (flooded in ~2 min, as the simulation's balance) and drains for ~25 min after; a field mostly on
// intermediates or wets says the track is wet whatever the flag (it rained before the start). tyres: the compounds out on track
export function replayWeather(weather, t, tyres = []) {
  const step = (w, rain, dt) => rain ? w + (0.9 - w) * (1 - Math.exp(-dt / 120)) : Math.max(0, w - dt / 1500);
  let wet = 0, last = null;
  for (const w of weather || []) {
    if (w[0] > t) break;
    if (last) wet = step(wet, last[3], w[0] - last[0]);
    last = w;
  }
  if (last) wet = step(wet, last[3], t - last[0]);
  const inters = tyres.filter(c => c === 'INTERMEDIATE').length, wets = tyres.filter(c => c === 'WET').length;
  if ((inters + wets) * 2 > tyres.length) wet = Math.max(wet, wets > inters ? 0.7 : 0.35);
  const raining = !!last?.[3];
  return {cloud: raining ? 0.9 : wet > 0.05 ? 0.5 + 0.4 * wet : 0.1, rain: raining ? 0.35 : 0, wetLine: 0.7 * wet, wetOff: wet};
}
