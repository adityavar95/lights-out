// "Simulation" session: the race weekend's drivers, gridded in qualifying order, racing under sim.js on the circuit's
// real outline. Turns the simulation into what the replay draws: positions, tower rows, effects, HUD readings.
import {get, rows, teamColor} from './util.js';
import {createRace} from './sim.js';
import {radar, CAR_L} from './racecraft.js';
import {setPitLane} from './scene3d.js';
import {pitTrace} from './strategy.js';

export const SIM = 'Simulation';

const entry = r => {
  const team = r.Constructors?.[0];  // championship standings list a driver's teams
  return {id: r['Driver.driverId'], num: +(r.number ?? r['Driver.permanentNumber']) || null,
          code: r['Driver.code'] || (r['Driver.familyName'] || '').slice(0, 3).toUpperCase(),
          name: `${r['Driver.givenName']} ${r['Driver.familyName']}`,
          team: r['Constructor.name'] ?? team?.name, teamId: r['Constructor.constructorId'] ?? team?.constructorId};
};

// entry list in grid order: the race's grid, else qualifying order, else the championship order (upcoming races)
async function entries(year, round) {
  const jol = (kind, q = `?round=${round}`) => get(`/api/jolpica/${year}/${kind}${q}`).then(rows).catch(() => []);
  let list = (await jol('results')).map(r => ({...entry(r), grid: +r.grid || 99, laps: +r.laps || 0}));  // grid 0 = pit-lane start
  if (!list.length) list = (await jol('qualifying')).map(r => ({...entry(r), grid: +r.position}));
  if (!list.length) list = (await jol('driverstandings', '')).map(r => ({...entry(r), grid: +r.position}));
  return list.sort((a, b) => a.grid - b.grid);
}

// The circuit's real pit lane (map points, entry road to exit road): one pit stop's GPS from OpenF1 (2023+ races
// there, server.py /api/pitlane), cut to the part off the track. null without one, or if it isn't in the outline's
// coordinates (a GeoJSON outline).
export async function realPitLane(year, round, proj, width = 13) {
  const gps = await get(`/api/pitlane/${year}/${round}`).catch(() => null);
  if (!gps || proj.mpu !== 0.1) return null;  // F1 timing coordinates are decimetres
  return pitTrace(gps.x.map((x, i) => proj.rot(x, gps.y[i])), proj.pts, (width / 2 + 3) / proj.mpu, 2 / proj.mpu);
}

// proj: the replay's track projection {pts, mpu, ann}; track: circuits.js fetchCircuit result (width, pit losses).
// proj.ann (circuits.js annotate) gives the physics elevation, banking, kerbs, DRS zones and the aero trim.
export async function simSession(year, round, proj, track) {
  if (!proj) throw new Error('No track outline for this circuit, so there is nothing to simulate on.');
  const [list, pitLane] = await Promise.all([entries(year, round), realPitLane(year, round, proj, track?.width)]);
  if (!list.length) throw new Error('No entry list for this race yet.');
  const ann = proj.ann;
  // the real race distance (the winner's laps) unless it was cut short or the outline is off: then sim.js's 305 km
  const full = Math.ceil(305e3 / (proj.cum.at(-1) * proj.mpu)), run = Math.max(0, ...list.map(e => e.laps ?? 0));
  const race = createRace({year, mapPts: proj.pts, mpu: proj.mpu, width: track?.width, drivers: list.map(e => e.id),
                           laps: Math.abs(run - full) <= full * 0.1 ? run : undefined, ann, aero: ann.aero, pitLoss: track?.pitLoss, pitLane});
  // race control's messages array is the feed itself, so the race-control list and banner see them as they happen
  const data = {mode: 'sim', session: SIM, drivers: list, total_laps: race.total, duration: 1e9, intervals: [], stints: [],
                race_control: race.control.messages, pits: {}, weather: [[0, 26, 38, 0, 2]]};  // air 26 C, track 38 C
  // a garage per team, in the order of each team's best-placed driver
  const teamOf = e => e.teamId ?? e.team ?? e.id, teams = [...new Set(list.map(teamOf))];
  const boxes = race.setBoxes(teams.map(t => list.filter(e => teamOf(e) === t).map(e => e.id)));
  setPitLane(race.pitLane(), boxes.map((b, k) => ({...b, color: teamColor(teams[k], list.find(e => teamOf(e) === teams[k]).team)})));
  return {data, race};
}

// this frame: map positions now and 0.5 s on (heading), tower rows, and the effects each car's physics triggers
export function simState(race, byId) {
  const cars = {}, ahead = {}, fx = {};
  for (const c of race.cars) {
    cars[c.id] = race.pos(c);
    ahead[c.id] = race.posAhead(c, 0.5);
    // contact throws carbon-fibre sparks; the player's car also drives the cockpit camera physics
    fx[c.id] = {sparks: Math.max(c.sparks, c.contact > 0 ? 1 : 0), smoke: c.smoke, spray: c.spray, light: c.ers.harvesting || c.ers.derate,
                cam: c.player ? {gLat: c.gLat, gLong: c.gLong, steer: c.delta, v: c.v} : null};
  }
  const board = race.board().map(({car, pos, lap, gap, lapsDown}) => ({
    d: byId[car.id], pos, lap, gap, tyre: car.tyre.compound, age: car.lapsDone - (car.stintLap ?? 0), out: false,
    pit: car.pit.state !== 'RACING' && car.pit.state !== 'EXIT',
    gapText: pos === 1 ? `LAP ${lap}` : lapsDown >= 1 ? `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}` : gap !== null ? `+${gap.toFixed(3)}` : '',
  }));
  // flag: race control's neutralisation if there is one, else green / chequered (nothing before lights out)
  const status = race.status === 'RED' ? null : race.control.state !== 'GREEN' ? race.control.state : race.status;
  return {cars, ahead, fx, board, lap: board[0]?.lap ?? 1, status};
}

// the focused car's physics, in the shape the HUD cluster / friction circle / tyre matrix read
export function simFocus(race, id) {
  const c = race.cars.find(x => x.id === id);
  if (!c) return null;
  const e = c.ers, state = e.derate ? 'DERATE' : e.harvesting ? 'HARVEST' : e.deploying ? 'DEPLOY' : 'HOLD';
  return {kmh: c.v * 3.6, gear: c.gear, rpm: c.rpm, throttle: Math.round(c.throttle * 100), brake: Math.round(c.brake * 100),
          drs: c.drs.open ? 'open' : c.drs.armed ? 'detected' : 'off', drsForced: c.drs.forced,
          ers: {soc: e.soc, mode: state, user: e.user, plan: e.mode}, g: {gLat: c.gLat, gLong: c.gLong},
          tyres: {temps: c.tyre.ts, wear: c.tyre.health.map(h => 100 - h), compound: c.tyre.compound}, sim: true,
          damage: c.damage, radar: proximity(race, c)};
}

// Blind-spot radar: rivals beside the car or diagonally behind it, up to 1.5 car lengths back, on each side. Red when
// overlapping (alongside: don't turn in), amber when an overlap is coming from behind.
function proximity(race, c) {
  const out = {left: null, right: null};
  for (const {ds, dd} of radar(race, c)) {
    if (ds > CAR_L * 0.5 || Math.abs(dd) < 1 || Math.abs(dd) > 5) continue;
    const side = dd > 0 ? 'right' : 'left', level = Math.abs(ds) < CAR_L ? 'red' : 'amber';
    if (out[side] !== 'red') out[side] = level;
  }
  return out;
}
