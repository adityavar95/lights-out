// Broadcast / pit-wall HUD: glass panels laid round the edge of the 3D view (bento layout, the centre stays clear),
// with the telemetry cluster, g-force friction circle, tyre thermal matrix and circuit radar.
import {el, svg, fmtClock, lastBefore, led, rcText, setAttr, setText} from './util.js';
import {CORNERS, tyreColor} from './telemetry.js';
import {nearestPoint} from './pitdata.js';

const LEDS = 15, RPM_LOW = 9500, RPM_HIGH = 12300;  // shift lights start at RPM_LOW, all lit at RPM_HIGH
const G_PX = 10;  // friction circle: 10 svg units per g, so the 1 / 3 / 5 g rings are r = 10 / 30 / 50
const TRAIL = 24;
export const SECTOR_COLORS = ['#ff4d5e', '#38b6ff', '#ffd23f'];
export const STATUS = {GREEN: 'green', YELLOW: 'yellow', SC: 'yellow', 'SC IN': 'yellow', VSC: 'yellow', 'VSC ENDING': 'yellow', RED: 'red', CHEQUERED: 'chequered'};
const TYRE_LETTER = {SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W'};

let h, radar = null, trail = [], focusNow = null, whoKey = '', peak = {lat: 0, brk: 0};  // peak: the biggest g lately, fading over ~10 s

const glass = (cls, ...children) => el('section', {class: `glass ${cls}`}, ...children);

const ERS_MODES = [[null, 'Auto', 'AI chooses'], ['HARVEST', 'Harvest', 'Harvest / charge'], ['BALANCED', 'Balanced', 'Balanced'],
                   ['PUSH', 'Push', 'Overtake (push): deploy until empty']];

// wrap: the 3D stage; returns the containers replay.js fills (status strip, tower dock, control deck).
// onErsMode(mode | null) / onDrsTest(): simulation controls for the focused car (null hands ERS back to the AI).
export function setupHud(wrap, {onClose, onErsMode, onDrsTest}) {
  h = {
    top: el('div', {class: 'hud-top glass'}),
    left: glass('hud-left'),
    deck: el('div', {class: 'hud-deck glass'}),
    radarSvg: svg('svg', {class: 'radar', role: 'img', 'aria-label': 'Circuit map with car positions; click a point to read the focused car there'}),
    radarInfo: el('div', {class: 'radarinfo', 'aria-live': 'polite'}),
    leds: Array.from({length: LEDS}, () => svg('circle', {r: 3.4})),
    speed: el('b', {class: 'speed'}), gear: el('b', {class: 'gearbig'}), src: el('span', {class: 'src'}),
    thr: el('i'), brk: el('i'), drs: el('span', {class: 'drsmod'}), ers: el('i'), ersPct: el('b'), ersMode: el('span'),
    who: el('div', {class: 'who'}),
    gDot: svg('circle', {r: 3.2, class: 'gdot'}), gTrail: svg('polyline', {class: 'gtrail'}),
    gLat: el('b'), gLong: el('b'), pkLat: el('b', {class: 'pk'}), pkBrk: el('b', {class: 'pk'}),
    tyres: CORNERS.map(name => ({name, swatch: el('i'), temp: el('b'), wear: el('span')})),
    compound: el('span', {class: 'compound'}),
    ersBtns: ERS_MODES.map(([m, text, title]) => el('button', {class: 'neu', title, onclick: () => onErsMode(m)}, led(), text)),
    drsTest: el('button', {class: 'neu', title: 'Testing: arm DRS at every detection point', onclick: () => onDrsTest()}, led(), 'DRS'),
  };
  // shift lights on a shallow arc: LED i sits at angle -24..24 deg on a circle of radius 180 centred below the strip
  const shift = svg('svg', {class: 'shift', viewBox: '-90 -8 180 22', 'aria-hidden': 'true'});
  h.leds.forEach((led, i) => {
    const a = (i / (LEDS - 1) - 0.5) * 48 * Math.PI / 180;
    led.setAttribute('cx', (180 * Math.sin(a)).toFixed(2));
    led.setAttribute('cy', (180 - 180 * Math.cos(a)).toFixed(2));
    led.setAttribute('class', i < 5 ? 'g' : i < 10 ? 'r' : 'b');
    shift.append(led);
  });
  h.cluster = glass('cluster',
    el('header', {class: 'chead'}, h.who, el('button', {class: 'neu close', 'aria-label': 'Stop following this driver', onclick: onClose}, '×')),
    shift,
    el('div', {class: 'cgrid'},
      el('div', {class: 'pedal brk', title: 'Brake'}, h.brk),
      el('div', {class: 'speedo'}, h.speed, el('small', {}, 'KM/H')),
      el('div', {class: 'gearbox'}, h.gear, el('small', {}, 'GEAR')),
      el('div', {class: 'pedal thr', title: 'Throttle'}, h.thr)),
    el('div', {class: 'cfoot'}, h.drs,
      el('div', {class: 'ersbox', title: 'Energy store (modelled)'}, el('small', {}, 'ERS'), el('div', {class: 'ersbar'}, h.ers), h.ersPct, h.ersMode)),
    h.lap = el('div', {class: 'laptime', title: 'Lap time, live delta to this car’s best lap, best lap'},
      h.lapT = el('b'), h.lapD = el('span', {class: 'dt'}), h.lapB = el('span', {class: 'muted'})),
    h.proxL = el('i', {class: 'prox left', 'aria-hidden': 'true'}), h.proxR = el('i', {class: 'prox right', 'aria-hidden': 'true'}),
    h.simCtl = el('div', {class: 'simctl'},
      el('div', {class: 'neugroup', role: 'group', 'aria-label': 'ERS deployment mode'}, h.ersBtns), h.drsTest),
    h.src);

  const gsvg = svg('svg', {class: 'gmeter', viewBox: '-60 -60 120 120', role: 'img', 'aria-label': 'G-force friction circle'});
  for (const g of [1, 3, 5]) {
    gsvg.append(svg('circle', {r: g * G_PX, class: 'ring'}));
    const t = svg('text', {x: 2, y: -g * G_PX - 1.5, class: 'ringlabel'});
    t.textContent = `${g}G`;
    gsvg.append(t);
  }
  gsvg.append(svg('line', {x1: -55, x2: 55, y1: 0, y2: 0, class: 'axis'}), svg('line', {x1: 0, x2: 0, y1: -55, y2: 55, class: 'axis'}), h.gTrail, h.gDot);
  const tyreCell = (ty, cls) => el('div', {class: `tcell ${cls}`}, ty.swatch, el('div', {}, ty.temp, ty.wear));
  h.gpanel = glass('gpanel',
    el('div', {class: 'phead'}, 'G-FORCE', el('span', {class: 'src', title: 'Estimated from speed and track curvature, not measured on the car'}, 'ESTIMATED')),
    el('div', {class: 'gwrap'}, gsvg, el('div', {class: 'gread'}, el('small', {}, 'LAT'), h.gLat, el('small', {}, 'LONG'), h.gLong, el('small', {}, 'PK LAT'), h.pkLat, el('small', {}, 'PK BRK'), h.pkBrk)),
    el('div', {class: 'phead'}, 'TYRES', h.compound),
    el('div', {class: 'tmatrix'},
      tyreCell(h.tyres[0], 'fl'), chassis(), tyreCell(h.tyres[1], 'fr'), tyreCell(h.tyres[2], 'rl'), tyreCell(h.tyres[3], 'rr')));
  h.radarPanel = glass('radarpanel', el('div', {class: 'phead'}, 'CIRCUIT',
    el('span', {class: 'legend'}, ...SECTOR_COLORS.map((c, i) => el('span', {style: `--c:${c}`}, `S${i + 1}`)), el('span', {class: 'drsleg'}, 'DRS'))), h.radarSvg, h.radarInfo);
  h.right = el('div', {class: 'hud-right'}, h.radarPanel, h.gpanel, h.cluster);
  wrap.append(h.top, h.left, h.right, h.deck);
  // the deck wraps onto more rows as controls are added; the docked panels sit above whatever height it has
  new ResizeObserver(() => wrap.style.setProperty('--deck-h', `${h.deck.offsetHeight}px`)).observe(h.deck);
  renderFocus(null);
  return h;
}

function chassis() {
  const s = svg('svg', {class: 'chassis', viewBox: '0 0 40 90', 'aria-hidden': 'true'});
  s.innerHTML = '<path d="M17 2h6l2 18 7 4v6l-6 2 2 34 6 6v10l-14 6-14-6V72l6-6 2-34-6-2v-6l7-4z"/>';
  return s;
}

// ---------- circuit radar ----------

// pts: outline [[x, y]] in map coords; sectors: outline indices where S2 and S3 start; zones: [[from, to]] index pairs
export function setRadar(pts, sectors, zones, drivers, zoneName = 'DRS') {
  h.radarSvg.replaceChildren();
  h.radarInfo.textContent = '';
  radar = null;
  if (!pts?.length) return;
  const X = pts.map(p => p[0]), Y = pts.map(p => p[1]), x0 = Math.min(...X), y0 = Math.min(...Y);
  const span = Math.max(Math.max(...X) - x0, Math.max(...Y) - y0), pad = span * 0.06;
  h.radarSvg.setAttribute('viewBox', `${x0 - pad} ${y0 - pad} ${Math.max(...X) - x0 + 2 * pad} ${Math.max(...Y) - y0 + 2 * pad}`);
  const line = (from, to) => {  // outline from index `from` to `to`, wrapping round the loop
    const out = [];
    for (let i = from; ; i = (i + 1) % pts.length) { out.push(pts[i]); if (i === to) break; }
    return out.map(p => p.join(',')).join(' ');
  };
  const cuts = [0, ...sectors, pts.length - 1];
  for (let s = 0; s < 3; s++)
    h.radarSvg.append(svg('polyline', {points: line(cuts[s], s < 2 ? cuts[s + 1] : 0), class: 'sector', stroke: SECTOR_COLORS[s]}));
  for (const [a, b] of zones) h.radarSvg.append(svg('polyline', {points: line(a, b), class: 'drszone'}));
  h.radarPanel.querySelector('.drsleg').textContent = zoneName;
  const r = span * 0.014;
  radar = {pts, seen: new Array(pts.length), at: undefined, probe: svg('circle', {r: r * 1.8, class: 'radarprobe', style: 'display:none'}), dots: {}, ring: svg('circle', {r: r * 2.1, class: 'selring'}), ghost: svg('circle', {r: r * 2.2, class: 'ghost'}),
           cursor: svg('circle', {r: r * 1.6, class: 'trcursor'})};
  for (const d of drivers) {
    const dot = svg('circle', {r, fill: d.color, class: 'cardot'});
    dot.append(Object.assign(svg('title'), {textContent: d.code}));
    radar.dots[d.id] = dot;
    h.radarSvg.append(dot);
  }
  h.radarSvg.append(radar.ghost, radar.ring, radar.cursor, radar.probe);
  // click a point on the circuit: what the focused car was doing there on its latest pass
  h.radarSvg.onclick = e => {
    const m = h.radarSvg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()), i = nearestPoint(pts, [p.x, p.y]), q = pts[i], s = radar.seen[i];
    radar.probe.classList.remove('hidden');
    radar.probe.setAttribute('cx', q[0]);
    radar.probe.setAttribute('cy', q[1]);
    h.radarInfo.textContent = s ? `${s.code}: ${Math.round(s.kmh)} km/h, gear ${s.gear === 0 ? 'N' : s.gear}, brake ${Math.round(s.brake ?? 0)}%` : 'Follow a driver past this point to read it';
  };
  setGhost(null);
  setCursor(null);
}

// every frame: cars {id: [x, y]} in map coords
export function renderRadar(cars, selected) {
  if (!radar) return;
  const carAt = cars[selected];
  if (carAt && focusNow && focusNow.kmh !== null) {
    radar.at = nearestPoint(radar.pts, carAt, radar.at);
    radar.seen[radar.at] = {code: focusNow.d.code, kmh: focusNow.kmh, gear: focusNow.gear, brake: focusNow.brake};
  }
  for (const [id, dot] of Object.entries(radar.dots)) {
    const p = cars[id];
    p ? dot.classList.remove('hidden') : dot.classList.add('hidden');
    if (p) { setAttr(dot, 'cx', p[0]); setAttr(dot, 'cy', p[1]); }
  }
  const p = selected && cars[selected];
  p ? radar.ring.classList.remove('hidden') : radar.ring.classList.add('hidden');
  if (p) { setAttr(radar.ring, 'cx', p[0]); setAttr(radar.ring, 'cy', p[1]); }
}

// ---------- focused car ----------

const dash = v => (v === null || v === undefined || Number.isNaN(v) ? '–' : v);

// f: null, or {d, b, kmh, gear, rpm, throttle, brake, drs: 'off' | 'detected' | 'open' | null, drsName, estimated,
//              ers: {soc, mode}, g: {gLat, gLong}, tyres: {temps, wear, compound}}
export function renderFocus(f) {
  focusNow = f;
  for (const p of [h.cluster, h.gpanel]) if (p.hidden !== !f) p.hidden = !f;
  if (!f) { trail = []; return; }
  const {d, b} = f;
  if (h.who.dataset.id !== d.id) {  // the headshot only changes with the driver
    h.who.dataset.id = d.id;
    peak = {lat: 0, brk: 0};
    h.face = d.headshot ? el('img', {src: d.headshot, alt: ''}) : null;
  }
  const pos = b && b.pos < 99 ? `P${b.pos}` : '', key = [d.id, d.color, d.code, d.team, pos, h.face?.src].join();
  if (key !== whoKey) {
    whoKey = key;
    h.who.replaceChildren(...[h.face].filter(Boolean), el('span', {class: 'chip', style: `background:${d.color}`}), el('b', {}, d.code),
      el('span', {class: 'muted'}, d.team || ''), el('span', {class: 'pos'}, pos));
  }
  setText(h.speed, dash(f.kmh === null ? null : Math.round(f.kmh)));
  setText(h.gear, f.gear === 0 ? 'N' : dash(f.gear));
  setText(h.src, f.sim ? 'PHYSICS SIMULATION' : f.estimated ? 'ESTIMATED FROM GPS' : 'CAR DATA · OPENF1');
  if (h.simCtl.hidden !== !f.sim) h.simCtl.hidden = !f.sim;
  setAttr(h.proxL, 'data-level', f.radar?.left ?? '');  // blind-spot chevrons either side of the cluster
  setAttr(h.proxR, 'data-level', f.radar?.right ?? '');
  if (f.sim) {
    h.ersBtns.forEach((btn, i) => setAttr(btn, 'aria-pressed', ERS_MODES[i][0] === f.ers.user));
    setAttr(h.drsTest, 'aria-pressed', !!f.drsForced);
  }
  if (h.lap.hidden !== !f.lap) h.lap.hidden = !f.lap;
  if (f.lap) {
    const lapT = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`, dt = f.lap.delta;
    setText(h.lapT, f.lap.time === null ? '–:––.–––' : lapT(f.lap.time));
    setText(h.lapD, dt === null ? '' : `${dt < 0 ? '−' : '+'}${Math.abs(dt).toFixed(3)}`);
    setAttr(h.lapD, 'data-s', dt < 0 ? '-' : '+');
    setText(h.lapB, f.lap.best ? `BEST ${lapT(f.lap.best)}` : '');
  }
  h.thr.style.height = `${f.throttle ?? 0}%`;
  h.brk.style.height = `${f.brake ?? 0}%`;
  // shift lights: the lit count follows rpm between RPM_LOW and RPM_HIGH; at the limiter every LED flashes blue
  const frac = f.rpm ? Math.min(1, Math.max(0, (f.rpm - RPM_LOW) / (RPM_HIGH - RPM_LOW))) : 0, lit = Math.round(frac * LEDS);
  h.leds.forEach((led, i) => led.classList.toggle('on', i < lit));
  h.cluster.classList.toggle('limiter', frac >= 0.97);
  setText(h.drs, f.drsName);
  setAttr(h.drs, 'data-state', f.drs ?? 'off');
  setAttr(h.drs, 'title', {open: 'Active', detected: 'Detected: within 1 s at the detection point', off: 'Unavailable'}[f.drs ?? 'off']);
  h.ers.style.width = `${Math.round(f.ers.soc * 100)}%`;
  setText(h.ersPct, `${Math.round(f.ers.soc * 100)}%`);
  setText(h.ersMode, f.ers.mode);
  setAttr(h.ersMode, 'data-mode', f.ers.mode);

  // friction circle: x = lateral (right turn to the right), y = longitudinal (acceleration up, braking down)
  const x = f.g.gLat * G_PX, y = -f.g.gLong * G_PX;
  trail.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  if (trail.length > TRAIL) trail.shift();
  h.gDot.setAttribute('cx', x);
  h.gDot.setAttribute('cy', y);
  h.gTrail.setAttribute('points', trail.join(' '));
  setText(h.gLat, Math.abs(f.g.gLat).toFixed(1));
  peak.lat = Math.max(Math.abs(f.g.gLat), peak.lat * 0.999);  // per frame: ~11 s half-life at 60 fps
  peak.brk = Math.max(-f.g.gLong, peak.brk * 0.999);
  setText(h.pkLat, peak.lat.toFixed(1));
  setText(h.pkBrk, peak.brk.toFixed(1));
  setText(h.gLong, `${f.g.gLong < 0 ? '−' : ' '}${Math.abs(f.g.gLong).toFixed(1)}`);

  const ty = f.tyres;
  setText(h.compound, ty.compound ? `${TYRE_LETTER[ty.compound] ?? ''} ${ty.compound}` : 'compound unknown');
  setAttr(h.compound, 'data-c', ty.compound || '');
  h.tyres.forEach((t, i) => {
    t.swatch.style.background = tyreColor(ty.temps[i], ty.compound);
    setText(t.temp, `${Math.round(ty.temps[i])}°`);
    setText(t.wear, `${Math.round(ty.wear[i])}% worn`);
  });
}

// race control messages (the last four) and the weather strip at time t
export function renderFeed(ui, data, t) {
  const rc = data.race_control || [], n = lastBefore(rc, t);
  ui.rc.replaceChildren(...rc.slice(Math.max(0, n - 3), n + 1).reverse().map(([mt, , flag, msg]) =>
    el('li', {'data-t': mt, title: 'Jump the replay here'}, el('time', {}, fmtClock(mt)),
      flag ? el('b', {class: `rcflag ${(STATUS[flag] || flag).toLowerCase()}`}, flag.charAt(0) + flag.slice(1).toLowerCase()) : null, rcText(msg, flag))));
  const w = data.weather?.[lastBefore(data.weather || [], t)];
  ui.weather.replaceChildren(...(w ? [
    el('span', {title: 'Air temperature'}, `AIR ${w[1]}°`), el('span', {title: 'Track temperature'}, `TRACK ${w[2]}°`),
    el('span', {title: 'Wind speed'}, `WIND ${w[4]} m/s`), w[3] && el('span', {class: 'rain'}, 'RAIN')].filter(Boolean) : []));
}

// telemetry trace crosshair on the radar (tracemodal.js): where on the lap the cursor is
export function setCursor(p) {
  if (!radar) return;
  p ? radar.cursor.classList.remove('hidden') : radar.cursor.classList.add('hidden');
  if (p) { radar.cursor.setAttribute('cx', p[0]); radar.cursor.setAttribute('cy', p[1]); }
}

// predicted pit rejoin on the radar: a translucent ghost of the selected car where it would come out if it boxed this lap
export function setGhost(p) {
  if (!radar) return;
  p ? radar.ghost.classList.remove('hidden') : radar.ghost.classList.add('hidden');
  if (p) { radar.ghost.setAttribute('cx', p[0]); radar.ghost.setAttribute('cy', p[1]); }
}
