// The focused car's readings for the HUD cluster, friction circle and tyre matrix (and the cockpit wheel).
import {lastBefore} from './util.js';
import {updateWheel} from './onboard.js';
import {kinematics, gearbox, engine, pedals, ersStep, tyreState, tyreStep, tyreWear} from './telemetry.js';
import {simFocus} from './simmode.js';

// Everything the cluster, friction circle and tyre matrix show for the focused car. In a simulation: its physics state.
// In a replay: OpenF1 car data (speed, gear, rpm, pedals, DRS) when this is a GPS replay that has it, otherwise
// estimated from motion (telemetry.js); g-forces, tyres and ERS are then modelled from the car's path.
export function focusFrame(S, t, st, status, {pos, nearest}) {
  const id = S.selected, b = st.board.find(x => x.d.id === id), p1 = st.cars[id];
  if (!b || !p1) return null;
  if (S.sim) {
    const f = simFocus(S.sim, id);
    wheel(S, b, status, f.kmh, false, f);
    return {d: b.d, b, drsName: S.drsName, estimated: false, ...f};
  }
  let F = S.focus;
  const track = S.data.weather?.[lastBefore(S.data.weather || [], t)]?.[2] ?? 35;
  if (F?.id !== id || t < F.t || t - F.t > 5) {  // another car, or a scrub: restart the models
    F = S.focus = {id, t, tyres: tyreState(track), ers: {soc: 0.6, mode: 'HOLD'}, g: {gLat: 0, gLong: 0}, hist: []};
  }
  const m = q => q && [q[0] * S.proj.mpu, q[1] * S.proj.mpu];  // map units -> metres
  let k = null;
  if (S.live) {  // live positions only exist now and 0.5 s ahead, so keep half a second of history for the third point
    F.hist.push([t, p1]);
    while (F.hist.length > 2 && F.hist[1][0] <= t - 0.5) F.hist.shift();
    if (t - F.hist[0][0] >= 0.4 && S.ahead[id]) k = kinematics(m(F.hist[0][1]), m(p1), m(S.ahead[id]), 0.5);
  } else {
    const p0 = pos(id, t - 0.5), p2 = pos(id, t + 0.5);
    if (p0 && p2) k = kinematics(m(p0), m(p1), m(p2), 0.5);
  }
  k ??= {speed: 0, gLong: 0, gLat: 0};
  F.g.gLat += (k.gLat - F.g.gLat) * 0.2;  // low-pass: positions are noisy at this scale
  F.g.gLong += (k.gLong - F.g.gLong) * 0.2;

  const tele = typeof S.tele[id] === 'object' ? S.tele[id] : null, i = Math.round(t / S.data.step);
  const now = S.live ? S.liveCar?.(id) : null;  // live car data needs F1 TV, else null and the readings are estimated
  const v = f => (now ? now[f] ?? null : tele?.[f]?.[i] ?? null);
  const kmh = v('speed') ?? k.speed * 3.6, estimated = v('speed') === null;
  const box = gearbox(kmh, engine(S.year ?? new Date().getFullYear()).rpmMax), ped = pedals(F.g.gLong, kmh);
  const gear = v('n_gear') ?? box.gear, rpm = v('rpm') ?? box.rpm, throttle = v('throttle') ?? ped.throttle;
  const brake = v('brake') ?? ped.brake;  // OpenF1 brake is on/off: 0 or 100
  let drs = v('drs') === null ? null : v('drs') >= 10 ? 'open' : v('drs') === 8 ? 'detected' : 'off';  // OpenF1 DRS codes
  if (drs === null) {  // no car data: the rule itself, within 1 s of the car ahead in a race, opens in the zones
    const close = (S.cols?.[id]?.intNum ?? 99) < 1, i0 = nearest(p1);
    const inZone = S.zones.some(([a, z]) => (a <= z ? i0 >= a && i0 <= z : i0 >= a || i0 <= z));
    drs = close && status !== 'SC' && status !== 'VSC' ? (inZone ? 'open' : 'detected') : 'off';
  }
  const dt = t - F.t;
  F.t = t;
  if (dt > 0) {
    tyreStep(F.tyres, {speed: kmh / 3.6, gLong: F.g.gLong, gLat: F.g.gLat}, dt);
    ersStep(F.ers, throttle, brake, kmh, dt, S.year ?? new Date().getFullYear());
  }
  wheel(S, b, status, kmh, estimated, {gear, rpm, throttle, brake, drs});
  return {d: b.d, b, kmh, gear, rpm, throttle, brake, drs, drsName: S.drsName, estimated, ers: F.ers, g: F.g,
          tyres: {temps: F.tyres.t, wear: tyreWear(F.tyres, b.tyre, b.age), compound: b.tyre}};
}

function wheel(S, b, status, kmh, estimated, {gear, rpm, throttle, brake, drs}) {
  if (S.cam === 'onboard')  // the cockpit steering wheel shows the same readings
    updateWheel({speed: kmh, estimated, gear, rpm, throttle, brake, drs: drs === 'open' ? 10 : drs === 'detected' ? 8 : 0,
                 lap: b.lap ?? b.k + 1, total: S.data.total_laps === Infinity ? null : S.data.total_laps, pos: b.pos, gap: b.gapText, tyre: b.tyre, status});
}
