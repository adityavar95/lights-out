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
