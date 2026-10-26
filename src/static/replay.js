// Race replay: the 3D stage with the broadcast HUD round it (timing tower, telemetry, radar, control deck).
import {get, el, teamColor, fmtClock, fmtLap, lastBefore, trackStatus, led, covered} from './util.js';
import {init3d, setTrack, setCars, updateCars, setView, setParts, setTyre, setGround, setPitLane} from './scene3d.js';
import {setupOnboard, setCameraUi, setWheelAngle} from './onboard.js';
import {fetchLive, liveInfo, liveDrivers, liveFeeds, liveStatus, liveClock, liveState, liveGps, hasGps, gpsAt, liveCar, resetGps} from './live.js';
import {setupHud, setRadar, renderRadar, renderFocus, renderFeed, STATUS} from './hud.js';
import {SIM, simSession, simState, realPitLane} from './simmode.js';
import {setupDecks, updateDecks} from './decks.js';
import {buildTower, timing, renderTower, stableOrder, COLUMNS} from './tower.js';
import {drsZones} from './telemetry.js';
import {fetchCircuit, annotate, f1Coords} from './circuits.js';
import {focusFrame} from './focus.js';
import {pitTrace} from './strategy.js';
import {lanes, GRID} from './lanes.js';

const SPEEDS = [0.5, 1, 2, 5, 10, 20, 50, 100];

let ui, S;  // ui: DOM handles; S: state of the race currently shown


export function setupReplay(root) {
  ui = {
    session: el('select', {class: 'neu sessionsel', 'aria-label': 'Session to replay'}),
    play: el('button', {class: 'neu play', 'aria-label': 'Play replay', onclick: togglePlay}, '▶'),
    speeds: el('select', {class: 'neu speedsel', 'aria-label': 'Replay speed', title: 'Replay speed (- / + keys)', onchange: e => setSpeed(+e.target.value)},
      SPEEDS.map(s => new Option(`${s}×`, s, s === 10, s === 10))),
    speed: 10,
    scrub: el('input', {type: 'range', min: 0, max: 1, step: 1, value: 0, 'aria-label': 'Replay position', class: 'scrub'}),
    clock: el('span', {class: 'clock'}, '0:00:00'),
    lap: el('div', {class: 'lapcount'}, ''),
    flag: el('div', {class: 'flagpill'}, ''),
    mode: el('div', {class: 'mode'}, ''),
    weather: el('div', {class: 'weather'}),
    map: el('div', {class: 'trackmap', role: 'img', 'aria-label': '3D track map: drag to rotate, scroll to zoom'}),
    overlay: el('div', {class: 'overlay'}),
    rc: el('ol', {class: 'rcfeed', 'aria-label': 'Race control messages'}),
    tower: el('ol', {class: 'tower', 'aria-label': 'Timing tower'}),
    column: 0,
    show: {halo: true, body: true, wheel: true},
  };
  ui.colBtn = el('button', {class: 'neu colbtn', onclick: () => { nextColumn(); render(true); }});
  ui.view = el('button', {class: 'neu', 'aria-pressed': false, title: 'Collapse the telemetry panels', onclick: e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on);
    ui.stage.classList.toggle('cinematic', on);
  }}, led(), 'Cinematic');
  showColumn();
  ui.session.onchange = () => loadData(false);
  ui.scrub.oninput = () => { S.t = +ui.scrub.value; render(true); };
  document.addEventListener('keydown', e => {
    if (!S || !S.data || ['INPUT', 'SELECT', 'BUTTON'].includes(e.target.tagName) || !root.offsetParent) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    const step = {Minus: -1, NumpadSubtract: -1, Equal: 1, NumpadAdd: 1}[e.code];  // - / + : slower / faster
    if (step && !S.sim?.player) setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, SPEEDS.indexOf(ui.speed) + step))]);
    if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && !S.sim) {  // a simulation can't be rewound
      S.t = Math.min(S.data.duration, Math.max(0, S.t + (e.code === 'ArrowRight' ? 10 : -10) * Math.max(1, S.speed / 5)));
      render(true);
    }
  });
  const viewport = el('div', {class: 'viewport'}, ui.map, ui.overlay);  // the 3D view; HUD panels float round it
  ui.stage = el('div', {class: 'mapwrap'}, viewport);
  root.append(el('div', {class: 'replay'}, ui.stage, ui.rc));
  let cams = null;
  try {
    init3d(ui.map);
    ui.has3d = true;
    cams = setupOnboard(viewport, {mode: setMode, parts: p => {
      Object.assign(ui.show, p);
      setParts(p);
      setCameraUi(S.cam, ui.show.wheel);
      render(true);
    }});
  } catch (e) {
    ui.map.append(el('p', {class: 'empty'}, '3D view needs WebGL, which is turned off in this browser.'));
  }
  const hud = setupHud(ui.stage, {onClose: () => S?.selected && select(S.selected),
    onErsMode: m => S?.sim?.setErsMode(S.selected, m), onDrsTest: () => S?.sim?.toggleDrsTest(S.selected)});
  hud.top.append(ui.flag, ui.lap, ui.mode, ui.weather);
  hud.left.append(el('div', {class: 'towerhead'}, el('span', {}, 'TIMING'), ui.colBtn), el('div', {class: 'towerscroll'}, ui.tower));
  hud.deck.append(
    el('div', {class: 'deckgroup'}, ui.session, ui.play, ui.speeds),
    el('div', {class: 'deckgroup grow'}, ui.scrub, ui.clock),
    el('div', {class: 'deckgroup'}, cams?.modes, cams?.parts, ui.view));
  setupDecks(ui.stage, hud, () => S, {togglePlay});  // pit wall, driver deck (under the tower), audio mixer, telemetry trace
}

// the speed-trap column only exists in live timing (F1's TimingStats); replays skip it
function nextColumn(step = 1) {
  ui.column = (ui.column + step) % COLUMNS.length;
  if (COLUMNS[ui.column][0] === 'trap' && !S?.live) ui.column = (ui.column + 1) % COLUMNS.length;
  showColumn();
}

function showColumn() {
  ui.colBtn.replaceChildren(led(), COLUMNS[ui.column][1]);
  ui.colBtn.setAttribute('aria-label', `Timing column: ${COLUMNS[ui.column][1]}. Click to switch`);
}

function setSpeed(s) {
  ui.speed = s;
  if (S) S.speed = s;
  ui.speeds.value = s;
}

// sim: Simulate mode, a physics race on this circuit (the session list is then just that, and hidden)
export async function showRace(year, round, sessions, sim = false) {
  reset({year, round});
  ui.session.replaceChildren(...(sim ? [SIM] : sessions).map(s => new Option(s, s)));
  ui.session.value = sim ? SIM : sessions.includes('Race') ? 'Race' : sessions.at(-1) ?? '';
  const token = S.token;
  setOverlay('Loading track…');
  try {
    S.track = await fetchCircuit(year, round);  // with heights
  } catch (e) {
    S.track = null;
  }
  if (token !== S.token) return;
  const f1 = f1Coords(S.track);
  drawTrack(S.track?.x, S.track?.y, S.track?.rotation ?? 0, S.track?.corners ?? [], f1, f1 ? 0.1 : 1);
  if (ui.has3d && S.track) setGround(year, round);  // satellite imagery, when it loads
  setOverlay(S.track ? 'Press ▶ to watch the session' : 'No track map for this circuit. Press ▶ to load the session');
  if (sim) { ui.session.value = SIM; loadData(true); }  // the circuit selector: straight into a Simulation
}

// Live (or most recent) session from F1's free live timing feed, refreshed every second.
export async function showLive() {
  reset({live: true, year: new Date().getFullYear()});
  resetGps();
  const token = S.token;
  setOverlay('Connecting to F1 live timing…', true);
  let first;
  try {
    first = await fetchLive();
  } catch (e) {
    if (token === S.token) setOverlay(e.message);
    return;
  }
  if (token !== S.token) return;
  if (!first.topics.DriverList) return setOverlay(first.error ? `Live timing unavailable: ${first.error}` : 'No live timing data yet.');
  S.track = await fetch('/api/live/track').then(r => (r.ok ? r.json() : null)).catch(() => null);  // not cached: changes per event
  if (token !== S.token) return;
  drawTrack(S.track?.x, S.track?.y, S.track?.rotation ?? 0, S.track?.corners ?? [], !!S.track, 0.1);
  // where each mini-sector starts, as a fraction of the outline (MultiViewer lists the boundaries after the line)
  S.ms = S.track?.minisectors?.length ? [0, ...S.track.minisectors.map(i => S.proj.cum[i] / S.proj.cum.at(-1)), 1] : null;
  const info = liveInfo(first.topics);
  prepare({mode: 'live', session: info.title, drivers: liveDrivers(first.topics), intervals: [], duration: 1});
  applyLive(first);
  setOverlay('');
  S.playing = true;
  requestAnimationFrame(function frame() {
    if (token !== S.token) return;
    if (!covered()) render(false);
    requestAnimationFrame(frame);
  });
  (async function poll() {  // a couple of seconds behind the track at most: feed latency + this 1 s refresh
    while (token === S.token) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const next = await fetchLive();
        if (token === S.token && next.topics.DriverList) applyLive(next);
      } catch (e) { /* keep showing the last state; the next poll retries */ }
    }
  })();
}

function applyLive({topics, auth_error}) {  // one /api/live response
  const info = liveInfo(topics);
  S.live = topics;
  S.liveInfo = info;
  liveGps(topics, Date.now());
  S.liveCar = id => liveCar(topics, id, Date.now());  // live ids are racing numbers, like the feed's keys
  Object.assign(S.data, liveFeeds(topics, info.origin), {race: info.race, total_laps: topics.LapCount?.TotalLaps ?? '–'});
  S.t = (Date.now() - info.origin) / 1000;
  ui.mode.textContent = `${info.live ? '● LIVE' : info.status === 'Inactive' ? 'Next session (not started)' : 'Latest session (finished)'} · ${info.title}${hasGps(Date.now()) ? ' · car GPS' : auth_error ? ` · ${auth_error}` : ''}`;
}

// lap fraction -> outline fraction, through the mini-sector boundaries when they match the live feed
function msFrac(f, segments) {
  const ms = S.ms;
  if (!ms || ms.length - 1 !== segments) return f;
  const n = segments, j = Math.min(n - 1, Math.floor(f * n));
  return ms[j] + (ms[j + 1] - ms[j]) * (f * n - j);
}

function liveRender() {
  const now = Date.now(), s = liveState(S.live, S.drivers, now), cars = {}, ahead = {};
  if (hasGps(now)) {  // real positions (F1 TV); a car without one is in the garage or has stopped sending
    for (const d of S.drivers) {
      const p = gpsAt(d.id, now), q = gpsAt(d.id, now, 500);
      if (p && q) { cars[d.id] = S.proj.rot(...p); ahead[d.id] = S.proj.rot(...q); }
    }
  } else for (const id in s.fracs) {
    cars[id] = pointAt(msFrac(s.fracs[id], s.segments));
    ahead[id] = pointAt(msFrac(s.ahead[id], s.segments));
  }
  return {cars, ahead, board: s.board, lap: s.lap};
}

function reset(extra) {
  S = {t: 0, playing: false, speed: ui.speed, selected: null, data: null, track: null, token: {}, cam: 'overview', tele: {}, ...extra};
  for (const c of [ui.session, ui.play, ui.speeds, ui.scrub]) c.hidden = !!S.live;  // live has no playback controls
  nextColumn(0);  // leaving live timing on its speed-trap column moves on to GAP
  if (ui.has3d) {
    setView('overview');
    setCameraUi('overview', ui.show.wheel);
  }
  ui.play.textContent = '▶';
  ui.tower.replaceChildren();
  ui.rc.replaceChildren();
  renderFocus(null);
  setRadar(null);
  ui.flag.textContent = ui.lap.textContent = ui.mode.textContent = ui.clock.textContent = '';
  ui.weather.replaceChildren();
  ui.scrub.max = 1;
  ui.scrub.value = 0;
}

export function setSessions(list) {
  const cur = ui.session.value;
  if (cur === SIM) return;  // Simulate mode
  ui.session.replaceChildren(...list.map(s => new Option(s, s)));
  ui.session.value = list.includes(cur) ? cur : list.includes('Race') ? 'Race' : list.at(-1);
}

function setOverlay(text, spinner = false) {
  ui.overlay.replaceChildren(...(text ? [spinner && el('div', {class: 'spinner'}), el('p', {}, text)].filter(Boolean) : []));
  ui.overlay.hidden = !text;
  ui.overlay.classList.toggle('hint', !spinner);  // hints leave the map visible; loading blurs it
}

async function loadData(autoplay) {
  S.playing = false;
  ui.play.textContent = '▶';
  S.data = null;
  const token = S.token, session = ui.session.value;
  setOverlay(`Loading ${session} replay… the first load of a session fetches every car's GPS trace and can take up to a minute.`, true);
  try {
    const sim = session === SIM && await simSession(S.year, S.round, S.proj, S.track);
    const data = sim ? sim.data : await get(`/api/replay/${S.year}/${S.round}?session=${encodeURIComponent(session)}`);
    if (token !== S.token || session !== ui.session.value) return;
    S.sim = sim?.race ?? null;
    S.t = 0;
    ui.scrub.hidden = !!S.sim;
    prepare(data);
    setOverlay('');
    if (autoplay) togglePlay();
    else render(true);
  } catch (e) {
    // replay.py's 401 message: the session is running now, so show it from F1's free live feed instead
    if (token === S.token && /is live now/.test(e.message)) return showLive();  // server.py LIVE_NOW
    if (token === S.token) setOverlay(e.message);
  }
}

function togglePlay() {
  if (!S || S.live) return;
  if (!S.data) return loadData(true);
  if (S.t >= S.data.duration) S.t = 0;
  S.playing = !S.playing;
  ui.play.textContent = S.playing ? '❚❚' : '▶';
  ui.play.setAttribute('aria-label', S.playing ? 'Pause replay' : 'Play replay');
  ui.play.setAttribute('aria-pressed', S.playing);
  cancelAnimationFrame(S.raf);  // pause + play within one frame would otherwise leave two loops running
  if (S.playing) {
    S.last = performance.now();
    S.raf = requestAnimationFrame(tick);
  }
}

function tick(now) {
  if (!S.playing || !S.data) return;
  if (covered()) return togglePlay();  // the F1 TV viewer opened over it: pause rather than race on unseen
  const dt = (now - S.last) / 1000 * S.speed;
  if (S.sim) S.sim.advance(Math.min(dt, 2));  // the physics runs in race time; a stalled tab doesn't jump minutes ahead
  S.t = S.sim ? S.sim.t : Math.min(S.data.duration, S.t + dt);
  S.last = now;
  render(false);
  if (S.sim ? S.sim.done : S.t >= S.data.duration) togglePlay();
  else S.raf = requestAnimationFrame(tick);
}

// ---------- track drawing ----------

// mpu: metres per map unit (F1 timing coordinates are decimetres)
function drawTrack(xs, ys, rotation, corners, startKnown, mpu) {
  S.proj = null;
  if (!xs?.length) {
    if (ui.has3d) setTrack([], 1, [], false, 1);
    return;
  }
  const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = (x, y) => [x * c - y * s, -(x * s + y * c)];  // F1 coords are y-up, map coords are y-down
  const pts = xs.map((x, i) => rot(x, ys[i]));
  const X = pts.map(p => p[0]), Y = pts.map(p => p[1]);
  const span = Math.max(Math.max(...X) - Math.min(...X), Math.max(...Y) - Math.min(...Y));
  const cornerPts = corners.map(cn => {
    const off = span * 0.045, ang = (cn.angle ?? 0) * Math.PI / 180;
    return [...rot(cn.x + Math.cos(ang) * off, cn.y + Math.sin(ang) * off), cn.number];
  });
  const ann = annotate({...S.track, h: xs === S.track?.x ? S.track.h : null, rot: ([x, y]) => rot(x, y)}, pts, mpu);  // heights, banking, kerbs, DRS
  if (ui.has3d) setTrack(pts, span, cornerPts, startKnown, mpu, S.track?.width, ann);
  // cumulative distance along the outline, for placing cars by lap fraction
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i - 1], q = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  S.proj = {rot, pts, cum, span, mpu, ann};
}

function pointAt(frac) {
  const {pts, cum} = S.proj, target = (((frac % 1) + 1) % 1) * cum.at(-1);  // before the line (grid slots) wraps to the lap's end
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= target) lo = m; else hi = m; }
  const p = pts[lo], q = pts[(lo + 1) % pts.length], f = (target - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
}

const nearest = p => {  // outline index closest to a map point
  let best = 0, d = Infinity;
  S.proj.pts.forEach((q, i) => { const e = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (e < d) { d = e; best = i; } });
  return best;
};

// ---------- data preparation ----------

function prepare(data) {
  S.data = data;
  S.drivers = data.drivers.map(d => ({...d, color: d.color || teamColor(d.teamId, d.team)}));
  S.byId = Object.fromEntries(S.drivers.map(d => [d.id, d]));
  [...S.drivers].sort((a, b) => (a.grid || 99) - (b.grid || 99)).forEach((d, i) => d.rank = i);  // grid slot; 0 = pit-lane start
  if (data.mode === 'laps') {  // a steady pace per driver (median lap time) says who passes whom, whatever this lap's time was
    for (const d of S.drivers) {
      const c = data.cum[d.id], laps = c.map((x, i) => x - (c[i - 1] ?? 0)).sort((a, b) => a - b);
      d.pace = laps[laps.length >> 1];
    }
  }
  if (data.mode === 'gps') {
    const group = (feed, f) => {
      const m = {};
      for (const e of feed) (m[e[1]] ??= []).push(f(e));
      return m;
    };
    S.pos = group(data.positions, e => [e[0], e[2]]);
    S.lapsBy = group(data.laps, e => [e[0], e[2], e[3], e[4], e[5], e[6]]);  // [start, lap, duration, s1, s2, s3]
    S.gaps = group(data.intervals, e => [e[0], e[2]]);
    S.pitsBy = group(data.pits, e => [e[0], e[2], e[3]]);
    if (!f1Coords(S.track)) drawOutlineFromGps();
  }
  if (!S.proj) {  // no map at all: run the cars round an oval
    drawTrack(Array.from({length: 120}, (_, i) => Math.cos(i / 120 * 2 * Math.PI) * 1000),
              Array.from({length: 120}, (_, i) => Math.sin(i / 120 * 2 * Math.PI) * 600), 0, [], true, 1);
  }
  if (ui.has3d) setCars(S.drivers, select, S.year ?? new Date().getFullYear());
  if (ui.has3d && !S.sim) {  // pit lane: this replay's own from GPS, else the circuit's real one (from a 2023+ race there)
    const lane = data.mode === 'gps' && gpsPitLane(), token = S.token;
    if (lane) setPitLane(lane);
    else realPitLane(S.year, S.round, S.proj, S.track?.width).then(l => l && token === S.token && setPitLane(l));
  }
  if (S.sim) S.lapsBy = S.sim.laps;  // same shape, filled in as the simulated laps complete
  S.rows = buildTower(ui.tower, S.drivers, select);
  S.zones = S.proj.ann.zones?.length ? S.proj.ann.zones.map(z => [z.start, z.end]) : drsZones(S.proj.pts.map(p => [p[0] * S.proj.mpu, p[1] * S.proj.mpu]));
  S.drsName = S.year >= 2026 ? 'OVERTAKE' : 'DRS';  // 2026 rules replaced DRS with the overtake mode energy boost
  setRadar(S.proj.pts, sectorCuts(), S.zones, S.drivers, S.year >= 2026 ? 'OVERTAKE' : 'DRS');
  ui.scrub.max = Math.floor(data.duration);
  ui.mode.textContent = data.mode === 'gps' ? `${data.session} · GPS replay` : data.mode === 'sim' ? 'Physics simulation'
                     : data.mode === 'live' ? ui.mode.textContent
                                            : 'Race · lap-timing replay (approximate positions)';
  S.towerAt = 0;
}

// Where sectors 2 and 3 start: where the car was when the fastest lap with sector times crossed each sector line
// (GPS replays); thirds of the outline when there are no sector times.
function sectorCuts() {
  const n = S.proj.pts.length, thirds = [Math.round(n / 3), Math.round(2 * n / 3)];
  if (S.data.mode !== 'gps') return thirds;
  let best = null;
  for (const [id, laps] of Object.entries(S.lapsBy))
    for (const l of laps) if (l[2] && l[3] && l[4] && (!best || l[2] < best.l[2])) best = {id, l};
  const a = best && gpsPos(best.id, best.l[0] + best.l[3]), b = best && gpsPos(best.id, best.l[0] + best.l[3] + best.l[4]);
  return a && b ? [nearest(a), nearest(b)].sort((x, y) => x - y) : thirds;
}

function drawOutlineFromGps() {
  // use the fastest timed lap's GPS trace as the outline
  let best = null;
  for (const [id, laps] of Object.entries(S.lapsBy))
    for (const [t, , dur] of laps) if (dur && S.data.frames[id] && (!best || dur < best.dur)) best = {id, t, dur};
  if (!best) return;
  const f = S.data.frames[best.id], i0 = Math.ceil(best.t / S.data.step), i1 = Math.floor((best.t + best.dur) / S.data.step);
  const xs = [], ys = [];
  for (let i = i0; i <= i1; i++) if (f.x[i] !== null) { xs.push(f.x[i]); ys.push(f.y[i]); }
  drawTrack(xs, ys, S.track?.rotation ?? 0, [], true, 0.1);
}

// The real pit lane: a car's GPS trace through its first usable pit stop, or, in a session without stops, through
// a car leaving the pits in the first 4 minutes.
function gpsPitLane() {
  const off = ((S.track?.width ?? 13) / 2 + 3) / S.proj.mpu, gap = 2 / S.proj.mpu;
  const tries = S.data.pits.length ? S.data.pits.map(([t, id]) => [id, t - 60, t + 40]) : S.drivers.map(d => [d.id, 0, 240]);
  for (const [id, t0, t1] of tries.slice(0, 10)) {
    const trace = [];
    for (let t = Math.max(0, t0); t <= t1; t += S.data.step) trace.push(gpsPos(id, t));
    const lane = pitTrace(trace, S.proj.pts, off, gap);
    if (lane) return lane;
  }
  return null;
}

// ---------- per-frame state ----------

// a car's map position at time t: GPS frames interpolated (null when it has none), or along the outline by lap time
function gpsPos(id, t) {
  const f = S.data.frames[id], fi = t / S.data.step, i = Math.floor(fi), k = fi - i;
  if (!f || f.x[i] === null || f.x[i] === undefined) return null;
  const j = f.x[i + 1] !== null && f.x[i + 1] !== undefined ? i + 1 : i;
  return S.proj.rot(f.x[i] + (f.x[j] - f.x[i]) * k, f.y[i] + (f.y[j] - f.y[i]) * k);
}

function lapPos(id, t) {
  const c = S.data.cum[id];
  let k = 0;
  while (k < c.length && c[k] <= t) k++;
  if (k >= c.length) return null;
  const start = k ? c[k - 1] : 0;
  return pointAt((t - start) / (c[k] - start));
}

// Laps mode: every running car's map position at t, in its lane. Lap 1 starts from the car's grid slot behind the line;
// lanes() fans the grid out into two columns and moves the faster car of a close pair aside to pass.
function lapCars(t) {
  const {cum, mpu} = S.proj, len = cum.at(-1) * mpu, runs = [];
  for (const d of S.drivers) {
    const c = S.data.cum[d.id];
    let k = 0;
    while (k < c.length && c[k] <= t) k++;
    if (k >= c.length) continue;
    const start = k ? c[k - 1] : 0, frac = (t - start) / (c[k] - start), back = k ? 0 : GRID.front + GRID.row * d.rank;
    const run = frac * (len + back);
    runs.push({id: d.id, s: run - back, v: len / d.pace, rank: k ? undefined : d.rank, run: k ? undefined : run});
  }
  const lat = lanes(runs, len, (S.track?.width ?? 13) / 2), cars = {};
  for (const r of runs) {
    const p = pointAt(r.s / len), q = pointAt((r.s + 2) / len), n = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, m = lat[r.id] / mpu / n;
    cars[r.id] = [p[0] + (q[1] - p[1]) * m, p[1] - (q[0] - p[0]) * m];  // the left normal of the direction of travel
  }
  return cars;
}

// car positions only (no timing board), for the heading half a second ahead
function carsAt(t) {
  if (S.data.mode === 'laps') return lapCars(t);
  const cars = {}, pos = gpsPos;
  for (const d of S.drivers) { const p = pos(d.id, t); if (p) cars[d.id] = p; }
  return cars;
}

function gpsState(t) {
  const cars = {}, board = [];
  for (const d of S.drivers) {
    const p0 = gpsPos(d.id, t);
    if (p0) cars[d.id] = p0;
    const at = (arr) => { const n = arr ? lastBefore(arr, t) : -1; return n < 0 ? null : arr[n]; };
    const p = at(S.pos[d.id]), lp = at(S.lapsBy[d.id]), g = at(S.gaps[d.id]), pit = at(S.pitsBy[d.id]);
    const lap = lp?.[1] ?? 0;
    const best = Math.min(...(S.lapsBy[d.id] || []).filter(e => e[2] && e[0] + e[2] <= t).map(e => e[2]));
    const stint = S.data.stints.find(s => s[0] === d.id && s[1] <= Math.max(lap, 1) && (s[2] ?? 999) >= lap);
    board.push({d, pos: p?.[1] ?? 99, lap, best: isFinite(best) ? best : null, gap: g ? g[1] : null, tyre: stint?.[3],
                age: stint ? Math.max(lap, 1) - stint[1] + (stint[4] ?? 0) : null,
                pit: pit && t - pit[0] < (pit[2] || 25), out: !cars[d.id]});
  }
  board.sort((a, b) => a.pos - b.pos);
  const race = S.data.intervals.length > 0;
  for (const b of board) {
    b.gapText = race ? (b.pos === 1 ? `LAP ${b.lap}` : typeof b.gap === 'number' ? `+${b.gap.toFixed(3)}` : (b.gap ?? ''))
                     : fmtLap(b.best);
  }
  return {cars, board, lap: board[0]?.lap};
}

function lapsState(t) {
  const cars = lapCars(t), board = [];
  for (const d of S.drivers) {
    const c = S.data.cum[d.id];
    let k = 0;
    while (k < c.length && c[k] <= t) k++;
    const done = k >= c.length, finished = done && (d.status === 'Finished' || /^\+\d+ Laps?$/.test(d.status) || d.status === 'Lapped');
    const lapStart = k ? c[k - 1] : 0, frac = done ? 0 : (t - lapStart) / (c[k] - lapStart);
    if (finished) cars[d.id] = pointAt(0);
    const pits = S.data.pits[d.id] || [], lastPit = Math.max(0, ...pits.filter(p => p <= k));
    board.push({d, k, p: k + frac, last: k ? c[k - 1] : 0, out: done && !finished, finished, age: k + 1 - lastPit,
                pit: !done && pits.includes(k + 1) && frac > 0.9});
  }
  board.sort((a, b) => (a.out - b.out) || (b.p - a.p) || (a.last - b.last));
  const lead = board[0], cl = S.data.cum[lead.d.id];
  board.forEach((b, i) => {
    b.pos = i + 1;
    if (b.out) b.gapText = 'OUT';
    else if (i === 0) b.gapText = `LAP ${Math.min(b.k + 1, S.data.total_laps)}`;
    else if (!b.k) b.gapText = '';
    else {
      const c = S.data.cum[b.d.id];
      let leaderLaps = 0;  // laps the leader had completed when this driver completed their last lap
      while (leaderLaps < cl.length && cl[leaderLaps] <= c[b.k - 1]) leaderLaps++;
      const down = leaderLaps - b.k;
      b.gapNum = down >= 1 ? null : c[b.k - 1] - cl[b.k - 1];
      b.gapText = down >= 1 ? `+${down} LAP${down > 1 ? 'S' : ''}` : `+${b.gapNum.toFixed(3)}`;
    }
  });
  return {cars, board, lap: Math.min(lead.k + 1, S.data.total_laps)};
}

// ---------- rendering ----------

function render(force) {
  if (!S.data || !S.proj) return;
  if (S.live) S.t = (Date.now() - S.liveInfo.origin) / 1000;
  const t = S.t, st = S.live ? liveRender() : S.sim ? simState(S.sim, S.byId) : S.data.mode === 'gps' ? gpsState(t) : lapsState(t);
  if (ui.has3d) {  // the position half a second later gives each car its heading
    S.ahead = st.ahead ?? carsAt(Math.min(t + 0.5, S.data.duration));
    const progress = S.live ? 1 : S.sim ? st.lap / S.data.total_laps : t / S.data.duration;
    const steer = updateCars(st.cars, S.ahead, S.selected, S.live ? 1 : S.playing ? S.speed : 0, progress, st.fx);
    if (S.cam === 'onboard') setWheelAngle(steer);
  }
  S.board = st.board;
  renderRadar(st.cars, S.selected);
  ui.scrub.value = Math.floor(t);
  const left = S.live && S.liveInfo.live ? liveClock(S.live) : null;
  ui.clock.textContent = S.live ? (left !== null ? `${fmtClock(left)} remaining` : '') : S.sim ? fmtClock(t) : `${fmtClock(t)} / ${fmtClock(S.data.duration)}`;
  const race = S.live ? S.data.race : S.sim || S.data.mode === 'laps' || S.data.intervals.length > 0;
  ui.lap.textContent = race ? `LAP ${st.lap || 0} / ${S.data.total_laps}` : S.data.session.toUpperCase();
  const status = S.live ? liveStatus(S.live) : S.sim ? st.status : S.data.mode === 'gps' ? trackStatus(S.data.race_control || [], t) : null;
  if (status) {
    ui.flag.textContent = status;
    ui.flag.className = `flagpill ${STATUS[status] || ''}`;
  } else {
    ui.flag.textContent = '';
    ui.flag.className = 'flagpill';
  }
  const now = performance.now();
  if (force || now - S.towerAt >= 120) {  // the tower and feed only need ~8 updates a second
    S.towerAt = now;
    S.cols = timing(S, st.board, t);
    renderTower(S.rows, stableOrder(S.order ??= {}, st.board, now, force), S.cols, COLUMNS[ui.column][0], S.selected,
                (id, c) => ui.has3d && setTyre(id, c));
    renderFeed(ui, S.data, t);
  }
  const f = S.selected ? focusFrame(S, t, st, status, {pos: S.data.mode === 'gps' ? gpsPos : lapPos, nearest}) : null;
  renderFocus(f);  // gauges every frame, so they move smoothly
  updateDecks(S, st, f);
}

// m: 'overview' | 'chase' | 'onboard' | 'tcam' | 'heli'; all but overview follow the selected driver (the leader
// if none is selected). Picking another driver keeps the camera mode, and the chase camera pans across.
function setMode(m) {
  if (m !== 'overview' && !S.selected) {
    S.selected = S.board?.[0]?.d.id ?? null;
    if (!S.selected) return;  // nothing loaded yet
  }
  if (m === 'overview') S.selected = null;
  const changed = m !== S.cam;
  S.cam = m;
  if (ui.has3d && changed) setView(m);
  if (ui.has3d) setCameraUi(m, ui.show.wheel);
  loadTelemetry(S.selected);
  render(true);
}

// speed / gear / rpm / pedals / DRS for the focused car (GPS replays only), fetched once per driver
function loadTelemetry(id) {
  const d = S.byId?.[id], tele = S.tele;
  if (!d || S.data?.mode !== 'gps' || tele[id]) return;
  tele[id] = 'loading';
  get(`/api/telemetry/${S.year}/${S.round}?session=${encodeURIComponent(S.data.session)}&driver=${d.num}`
      + `&start=${encodeURIComponent(S.data.start)}&duration=${S.data.duration}`)
    .then(t => { tele[id] = t; }, () => { tele[id] = 'none'; });
}

function select(id) {
  S.selected = S.selected === id ? null : id;
  setMode(!S.selected ? 'overview' : S.cam === 'overview' ? 'chase' : S.cam);
}
