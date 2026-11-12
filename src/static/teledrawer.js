// The telemetry drawer (T): the focused car's last 30 s of race time as strip charts on one shared time axis, with the
// shift lights and gear, active aero and ERS state, a GG diagram and the four tyres. A canvas per chart rather than DOM:
// it redraws at the display's rate while open, and costs one array push per frame while closed.
import {el} from './util.js';
import {GG, RPM_SCALE, LEDS, ggCentre, ggSemi, litLeds, sampleAt, strip, tyreBand} from './pitdata.js';

const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const INK = '#eef0f6', MUTED = '#b4b8c6', GRID = 'rgb(255 255 255 / .09)';
const THROTTLE = '#2fd06f', BRAKE = '#ff4d5e', LINE = '#7fb4ff', FASTER = '#2fd06f', SLOWER = '#ff4d5e';
const MJ_LIMIT = 8.5;

// one chart per measure, never two y-scales on one: min/max are the axis, series the lines drawn on it
const STRIPS = [
  {name: 'SPEED', unit: 'km/h', min: 0, max: 360, ticks: [100, 200, 300], series: [['kmh', LINE]]},
  {name: 'DELTA', unit: 's', min: -1, max: 1, ticks: [0], series: [['delta', MUTED]], zero: true, none: 'no reference lap yet'},
  {name: 'PEDALS', unit: '%', min: 0, max: 100, ticks: [50], series: [['throttle', THROTTLE], ['brake', BRAKE]], legend: [['Throttle', THROTTLE], ['Brake', BRAKE]]},
  {name: 'RPM', unit: '', min: 0, max: RPM_SCALE, ticks: [5000, 10000], series: [['rpm', LINE]]},
];

let D = null;

const fix = (v, n = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(n));

export function setupDrawer(stage) {
  const chart = el('canvas', {class: 'tdchart', role: 'img', 'aria-label': 'Speed, delta, pedals and engine speed over the last 30 seconds'});
  const gg = el('canvas', {class: 'tdgg', role: 'img', 'aria-label': 'Lateral against longitudinal g'});
  const leds = Array.from({length: LEDS}, (_, i) => el('i', {'data-z': i < 5 ? 'g' : i < 10 ? 'r' : 'b'}));
  const tyres = CORNERS.map(name => {
    const box = el('i'), temp = el('b'), core = el('small'), life = el('small');
    return {box, temp, core, life, cell: el('div', {class: 'tdtyre'}, box, el('span', {}, el('em', {}, name), temp, core, life))};
  });
  const v = {gear: el('b', {class: 'tdgear'}), aero: el('b'), soc: el('b'), harvest: el('b'), kw: el('b'), who: el('b'), gLat: el('b'), gLong: el('b'), compound: el('span')};
  const row = (k, val) => el('div', {class: 'tdrow'}, el('small', {}, k), val);
  D = {
    open: false, chart, gg, leds, tyres, ...v, hover: null, strip: strip(30), trail: [], id: null, last: null,
    panel: el('section', {class: 'glass teledrawer', hidden: true, 'aria-label': 'Telemetry drawer'},
      el('header', {class: 'tdhead'}, v.who, el('div', {class: 'tdleds', 'aria-hidden': 'true'}, leds), v.gear,
        el('button', {class: 'neu cdclose', 'aria-label': 'Close telemetry', onclick: () => toggleDrawer(false)}, '✕')),
      el('div', {class: 'tdbody'}, chart,
        el('div', {class: 'tdside'}, gg, el('div', {class: 'tdg'}, row('LAT G', v.gLat), row('LONG G', v.gLong))),
        el('div', {class: 'tdside'}, el('div', {class: 'tdtyres'}, tyres.map(t => t.cell)), v.compound),
        el('div', {class: 'tdside tdstat'}, row('AERO', v.aero), row('ERS', v.soc), row(`HARVEST / ${MJ_LIMIT} MJ`, v.harvest), row('MGU-K', v.kw)))),
  };
  chart.onpointermove = e => { D.hover = e.offsetX; };
  chart.onpointerleave = () => { D.hover = null; };
  stage.append(D.panel);
}

export function toggleDrawer(open = !D.open) {
  D.open = open;
  D.panel.hidden = !open;
  document.body.toggleAttribute('data-drawer', open);
  return open;
}

function fit(c) {
  const dpr = Math.min(devicePixelRatio, 2), w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = '11px system-ui, sans-serif';
  g.textBaseline = 'middle';
  return {g, w, h};
}

function drawChart(now) {
  const c = fit(D.chart);
  if (!c) return;
  const {g, w, h} = c, left = 56, right = 8, pad = 6, n = STRIPS.length, rowH = (h - pad * (n - 1)) / n, span = D.strip.window;
  const X = t => left + (1 - (now - t) / span) * (w - left - right);
  let readout = null;
  const hoverT = D.hover !== null && D.hover > left ? now - (1 - (D.hover - left) / (w - left - right)) * span : null;
  if (hoverT !== null) readout = sampleAt(D.strip, hoverT);
  const here = readout ?? D.strip.rows.at(-1) ?? {};
  STRIPS.forEach((s, k) => {
    const top = k * (rowH + pad), Y = v => top + rowH - (Math.max(s.min, Math.min(s.max, v)) - s.min) / (s.max - s.min) * rowH;
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.beginPath();
    for (const tick of s.ticks) { g.moveTo(left, Y(tick) + 0.5); g.lineTo(w - right, Y(tick) + 0.5); }
    g.stroke();
    g.fillStyle = MUTED;
    g.textAlign = 'left';
    g.fillText(s.name, 0, top + 7);
    g.fillStyle = INK;
    const first = here[s.series[0][0]];
    const text = s.legend ? null : first === null || first === undefined ? '–' : s.zero ? `${first < 0 ? '−' : '+'}${Math.abs(first).toFixed(3)}` : Math.round(first).toLocaleString('en');
    if (text) g.fillText(`${text} ${s.unit}`, 0, top + 21);
    if (s.legend) s.legend.forEach(([name, col], i) => {  // pedals share one axis: a key rather than colour alone
      g.fillStyle = col;
      g.fillRect(0, top + 16 + i * 13, 8, 8);
      g.fillStyle = INK;
      g.fillText(`${name[0]} ${Math.round(here[s.series[i][0]] ?? 0)}`, 11, top + 20 + i * 13);
    });
    g.save();
    g.beginPath();
    g.rect(left, top, w - left - right, rowH);
    g.clip();
    for (const [key, col] of s.series) {
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.beginPath();
      let pen = false, seen = false;
      D.strip.rows.forEach((r, i) => {
        const val = r[key];
        if (val === null || val === undefined) { pen = false; return; }
        seen = true;
        const x = X(D.strip.t[i]), y = Y(val);
        if (pen) g.lineTo(x, y); else g.moveTo(x, y);
        pen = true;
      });
      g.stroke();
      if (!seen && s.none) {
        g.fillStyle = MUTED;
        g.textAlign = 'center';
        g.fillText(s.none, (left + w - right) / 2, top + rowH / 2);
      }
    }
    if (s.zero && here.delta !== null && here.delta !== undefined) {  // which way the gap is going, beside its value
      g.fillStyle = here.delta < 0 ? FASTER : SLOWER;
      g.fillRect(w - right - 3, here.delta < 0 ? Y(here.delta) : Y(0), 3, Math.abs(Y(here.delta) - Y(0)));
    }
    g.restore();
  });
  if (hoverT !== null) {
    g.strokeStyle = 'rgb(255 255 255 / .5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(D.hover + 0.5, 0);
    g.lineTo(D.hover + 0.5, h);
    g.stroke();
    g.fillStyle = MUTED;
    g.textAlign = D.hover > w / 2 ? 'right' : 'left';
    g.fillText(`−${(now - hoverT).toFixed(1)} s`, D.hover + (D.hover > w / 2 ? -5 : 5), h - 7);
  }
}

function drawGG(f) {
  const c = fit(D.gg);
  if (!c) return;
  const {g, w, h} = c, [a, b] = ggSemi(), scale = Math.min(w / (2 * a), h / (2 * b)) * 0.94, cx = w / 2, cy = h / 2;
  const X = lat => cx + lat * scale, Y = lon => cy - (lon - ggCentre()) * scale;
  g.strokeStyle = GRID;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(X(-GG.lat), Y(0));
  g.lineTo(X(GG.lat), Y(0));
  g.moveTo(X(0), Y(GG.drive));
  g.lineTo(X(0), Y(GG.brake));
  g.stroke();
  g.strokeStyle = MUTED;
  g.beginPath();
  g.ellipse(cx, cy, a * scale, b * scale, 0, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgb(127 180 255 / .55)';
  g.lineWidth = 2;
  g.beginPath();
  D.trail.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
  g.stroke();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  g.fillStyle = INK;
  g.beginPath();
  g.arc(X(clamp(f.g.gLat, -GG.lat, GG.lat)), Y(clamp(f.g.gLong, GG.brake, GG.drive)), 4, 0, Math.PI * 2);
  g.fill();
}

// every rendered frame, open or not: t is race seconds, f is replay.js's focus frame or null
export function updateDrawer(f, t) {
  if (!D) return;
  if (!f) {
    if (D.id !== null) { D.strip.clear(); D.trail.length = 0; D.id = null; }
    return;
  }
  if (f.d.id !== D.id) { D.id = f.d.id; D.strip.clear(); D.trail.length = 0; }
  const added = D.strip.push(t, {kmh: f.kmh, delta: f.lap?.delta ?? null, throttle: f.throttle, brake: f.brake, rpm: f.rpm});
  if (added) {
    D.trail.push([f.g.gLat, f.g.gLong]);
    if (D.trail.length > 60) D.trail.shift();
  }
  if (!D.open) return;
  drawChart(t);
  drawGG(f);
  D.who.textContent = f.d.code;
  const lit = litLeds(f.rpm);
  D.leds.forEach((l, i) => l.toggleAttribute('data-on', i < lit));
  D.gear.textContent = f.gear === 0 ? 'N' : fix(f.gear);
  D.gLat.textContent = fix(Math.abs(f.g.gLat), 1);
  D.gLong.textContent = fix(f.g.gLong, 1);
  // what the DRS slot means this era: open / armed, or the 2026 X and Z modes
  D.aero.textContent = f.drsName || 'DRS';
  D.aero.dataset.state = f.drs ?? 'off';
  D.soc.textContent = `${Math.round((f.ers?.soc ?? 0) * 100)}% ${f.ers?.mode ?? ''}`;
  D.harvest.textContent = f.ers?.harvested === undefined ? 'modelled lap only' : fix(f.ers.harvested, 1);
  D.kw.textContent = f.ers?.kw ? `${Math.round(f.ers.kw)} kW${f.ers.user === 'PUSH' ? ' OVERRIDE' : ''}` : '–';
  const ty = f.tyres;
  D.compound.textContent = ty?.compound ?? '';
  D.tyres.forEach((c, i) => {
    const s = ty?.temps?.[i];
    c.box.style.background = s === undefined ? 'transparent' : tyreBand(s);
    c.temp.textContent = `${fix(s)}°`;
    c.core.textContent = `core ${ty?.core ? `${fix(ty.core[i])}°` : '–'}`;
    c.life.textContent = `tread ${fix(100 - (ty?.wear?.[i] ?? NaN))}%`;
  });
}
