// Pit-wall telemetry trace: a glass modal over the stage comparing two laps (any two cars, or a car's live lap with
// its previous / fastest lap or a saved reference lap, which survives switching to another era's simulation on the
// same circuit) on five distance-aligned channels, with a scrubbing crosshair synced to a mini-map and the HUD radar,
// sector zoom, race-engineer callouts and CSV / JSON export. Opens from TELEMETRY TRACE in the deck's ⋯ menu, the key T,
// or a timing-tower row's compare icon (`f1:trace` event). In a simulation it records every car, every substep, through
// the race's onStep hook (trace.js does the resampling). On a GPS replay it compares real laps instead (reallap.js):
// each driver's car data is fetched once, and only for the drivers picked, since OpenF1 allows ~30 requests a minute.
import {el, svg, led, get, signed, covered} from './util.js';
import {N, CHANNELS, createRecorder, record, delta, insights, lapRows} from './trace.js';
import {drawTrace, drawCursor, layout} from './tracechart.js';
import {trackPos, at} from './track.js';
import {engine} from './telemetry.js';
import {PRESETS} from './circuits.js';
import {panelFocus} from './circuitdeck.js';
import {setCursor} from './hud.js';
import {isReal, teleUrl, lapTable, fastestClean, lapLabel, realLap, lapPath, nearestBucket, sectorCheck, dominance, dominanceText} from './reallap.js';

const LAPS = [['current', 'Live current lap'], ['previous', 'Previous lap'], ['fastest', 'Fastest lap'], ['ref', 'Saved reference lap']];
const ZOOMS = [['Full lap', 0, 1], ['Sector 1', 0, 1 / 3], ['Sector 2', 1 / 3, 2 / 3], ['Sector 3', 2 / 3, 1]];
const TEAMMATE = '#38f0ff';  // B's colour when both laps are the same team's (or the same car's)
const READ = [['Speed', 'kmh', 0, ' km/h'], ['Throttle', 'throttle', 0, '%'], ['Brake', 'brake', 0, '%'], ['RPM', 'rpm', 0, ''],
              ['Gear', 'gear', 0, ''], ['Lat G', 'gLat', 1, ' g'], ['Long G', 'gLong', 1, ' g'], ['Time', 't', 3, ' s']];

let M, getS, ctl;
let rec = null, ref = null;  // the race's recorder; the saved reference lap (module-level: outlives the race it came from)


// stage: the 3D stage; deck: the HUD's control deck; getState: () => replay state; controls: {togglePlay}
export function setupTrace(stage, deck, getState, controls) {
  getS = getState;
  ctl = controls;
  M = {open: false, x0: 0, x1: 1, hover: null, drawn: 0, view: null, pause: false, paused: false, race: null, real: false, built: {}, tele: {}, laps: {}};
  const sel = (label, then = () => {}) => el('select', {class: 'neu', 'aria-label': label, onchange: () => { then(); redraw(); }});
  M.carA = sel('Car A (reference)', () => fillLaps(M.carA, M.lapA));
  M.carB = sel('Car B (comparison)', () => fillLaps(M.carB, M.lapB));
  M.lapA = sel('Car A lap');
  M.lapB = sel('Car B lap');
  for (const s of [M.lapA, M.lapB]) s.append(...LAPS.map(([v, t]) => new Option(t, v)));
  M.btn = el('button', {class: 'neu', 'aria-expanded': false, 'aria-controls': 'tracedeck', 'aria-keyshortcuts': 'T',
                        onclick: () => toggle()}, led(), 'TELEMETRY TRACE (T)');
  M.pauseBtn = el('button', {class: 'neu', 'aria-pressed': false, title: 'Pause the simulation while this panel is open',
                             onclick: () => { M.pause = !M.pause; M.pauseBtn.setAttribute('aria-pressed', M.pause); hold(); }}, led(), 'Pause sim while inspecting');
  M.zooms = ZOOMS.map(([t], k) => el('button', {class: 'neu', onclick: () => zoom(...zoomRange(k))}, t));
  M.base = el('canvas', {class: 'trbase'});
  M.over = el('canvas', {class: 'trover', role: 'img', 'aria-label': 'Telemetry traces against lap distance. Move to scrub, scroll to zoom, drag to pan'});
  M.read = el('div', {class: 'trread', hidden: true});
  M.cells = READ.map(([name]) => {
    const r = [el('b'), el('b'), el('b')];
    M.read.append(el('span', {}, name), ...r);
    return r;
  });
  M.head = [el('span'), el('b'), el('b'), el('b', {}, 'Δ')];
  M.read.prepend(...M.head);
  M.wrap = el('div', {class: 'trplot'}, M.base, M.over, M.read);
  M.map = svg('svg', {class: 'trmap', role: 'img', 'aria-label': 'Circuit mini-map with the crosshair position'});
  M.dom = svg('g');
  M.domText = el('p', {class: 'trdomtext', hidden: true});
  M.check = el('p', {class: 'trcheck muted', hidden: true});
  M.sub = el('small', {class: 'cdsub'}, 'Lap comparison against track distance');
  M.simOnly = [el('button', {class: 'neu', title: 'Keep car A\'s lap as the reference lap (kept when you switch era or race)', onclick: saveRef}, 'Save A as reference'), M.pauseBtn];
  M.notes = el('ol', {class: 'trnotes', 'aria-label': 'Race engineer insights', 'aria-live': 'polite'});
  M.msg = el('p', {class: 'trmsg muted'});
  M.panel = el('section', {class: 'glass tracedeck', id: 'tracedeck', hidden: true, 'aria-label': 'Telemetry trace and lap comparison'},
    el('header', {class: 'pwhead'}, el('div', {class: 'phead'}, 'TELEMETRY TRACE'),
      M.sub,
      el('button', {class: 'neu cdclose', 'aria-label': 'Close telemetry trace', onclick: () => toggle(false)}, '✕')),
    el('div', {class: 'trctl'},
      el('label', {class: 'trpick a'}, el('small', {}, 'CAR A · REFERENCE'), M.carA, M.lapA),
      el('label', {class: 'trpick b'}, el('small', {}, 'CAR B · COMPARISON'), M.carB, M.lapB),
      ...M.simOnly,
      el('button', {class: 'neu', onclick: () => exportLaps('csv')}, 'Export CSV'),
      el('button', {class: 'neu', onclick: () => exportLaps('json')}, 'Export JSON')),
    el('div', {class: 'neugroup trzoom', role: 'group', 'aria-label': 'Distance window'}, M.zooms),
    el('div', {class: 'trbody'}, el('div', {class: 'trmain'}, M.wrap, M.msg),
      el('aside', {class: 'trside'}, M.map, M.domText, M.check, el('div', {class: 'phead'}, 'RACE ENGINEER'), M.notes)));
  M.focus = panelFocus(M.panel, M.btn, () => toggle(false));
  // one big panel at a time: another one opening (circuits, cars, telemetry trace) closes this one
  addEventListener('f1:panel', e => { if (e.detail !== M.panel && !M.panel.hidden) toggle(false, false); });
  deck.append(el('div', {class: 'deckgroup'}, M.btn));
  stage.append(M.panel);

  new ResizeObserver(() => { size(); redraw(); }).observe(M.wrap);
  M.over.addEventListener('pointermove', e => {
    const x = e.offsetX;
    if (M.drag) {  // pan: the window follows the pointer
      const v = M.view, {W} = layout(M.over.clientWidth, M.over.clientHeight, M.x0, M.x1), dx = (M.drag - x) / W * (M.x1 - M.x0);
      M.drag = x;
      if (v) zoom(M.x0 + dx, M.x1 + dx);
    }
    const f = layout(M.over.clientWidth, M.over.clientHeight, M.x0, M.x1).frac(x);
    hover(f >= M.x0 && f <= M.x1 ? Math.min(N - 1, Math.max(0, Math.round(f * N))) : null);
  });
  M.over.addEventListener('pointerleave', () => hover(null));
  M.over.addEventListener('pointerdown', e => { M.drag = e.offsetX; M.over.setPointerCapture(e.pointerId); });
  M.over.addEventListener('pointerup', () => { M.drag = null; });
  // wheel zoom about the cursor: the lap fraction under the pointer stays put, the window shrinks / grows by 20 %
  M.over.addEventListener('wheel', e => {
    e.preventDefault();
    const f = layout(M.over.clientWidth, M.over.clientHeight, M.x0, M.x1).frac(e.offsetX), k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    zoom(f - (f - M.x0) * k, f + (M.x1 - f) * k);
  }, {passive: false});
  document.addEventListener('keydown', e => {
    if (e.code !== 'KeyT' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || !stage.offsetParent || covered()) return;
    toggle();
  });
  // the wanted driver goes in before opening, so a replay doesn't first fetch the default comparison's telemetry
  addEventListener('f1:trace', e => { if (M.real) { M.carB.value = e.detail; fillLaps(M.carB, M.lapB); } toggle(true); pickB(e.detail); });
}

// every frame: hook the recorder onto a new simulation; while open, refresh the live laps ~4 times a second
export function updateTrace(S) {
  if (S.sim !== M.race || S.data !== M.data) {
    if (S.sim !== M.race) rec = S.sim ? hook(S) : null;
    M.race = S.sim;
    M.data = S.data;
    M.real = isReal(S);
    M.built = {};
    M.tele = {};
    M.laps = {};
    fillCars(S);
    if (M.open) redraw();
  }
  if (M.open && performance.now() - M.drawn > 250 && [M.lapA.value, M.lapB.value].includes('current')) redraw();
}

// After every substep, each car's channels in trace.js's IN order go into a reused buffer (no garbage per substep).
function hook(S) {
  const R = S.sim, r = createRecorder(R.T.len), vals = new Float64Array(CHANNELS.length - 1), meta = {};
  for (const c of R.cars) {
    const d = S.byId[c.id];
    meta[c.id] = {id: c.id, code: d?.code ?? c.id, teamId: d?.teamId, color: d?.color ?? '#fff', year: S.year, compound: null, len: R.T.len};
  }
  R.onStep = () => {
    for (const c of R.cars) {
      const e = c.ers;
      vals[0] = c.v * 3.6; vals[1] = c.throttle * 100; vals[2] = c.brake * 100; vals[3] = c.rpm; vals[4] = c.gear;
      vals[5] = c.drs.open ? 1 : 0;
      vals[6] = e.deploying && (e.user ?? e.mode) === 'PUSH' ? 3 : e.deploying ? 2 : e.harvesting ? 1 : 0;
      vals[7] = c.gLat; vals[8] = c.gLong; vals[9] = c.d;
      meta[c.id].compound = c.tyre.compound;
      record(r, c.id, c.s, R.t, vals, meta[c.id]);
    }
  };
  return r;
}

function fillCars(S) {
  const opts = () => (S.drivers ?? []).map(d => Object.assign(new Option(`● ${d.code} · ${d.team ?? ''}`, d.id), {style: `color:${d.color}`}));
  const [a, b] = [M.carA.value, M.carB.value];
  M.carA.replaceChildren(...opts());
  M.carB.replaceChildren(...opts());
  if (S.byId?.[a]) M.carA.value = a;
  if (S.byId?.[b]) M.carB.value = b;
  M.corners = corners(S);
  M.simOnly.forEach(c => { c.hidden = M.real; });
  M.sub.textContent = M.real ? 'Real laps from OpenF1 car data, against track distance' : 'Lap comparison against track distance';
  if (M.real) {  // keeps the drivers picked if they're in this session too, else the session's two quickest
    M.quick = S.drivers.map(d => [d.id, fastestClean(rowsOf(d.id))?.dur]).filter(p => p[1]).sort((p, q) => p[1] - q[1]).map(p => p[0]);
    M.carA.value = S.byId?.[a] ? a : M.quick[0];
    M.carB.value = S.byId?.[b] ? b : M.quick[1] ?? M.quick[0];
    fillLaps(M.carA, M.lapA);
    fillLaps(M.carB, M.lapB);
  } else if (M.lapA.options[0]?.value !== 'current') {
    for (const s of [M.lapA, M.lapB]) s.replaceChildren(...LAPS.map(([v, t]) => new Option(t, v)));
  }
  drawMap(S);
}

const rowsOf = id => (M.laps[id] ??= lapTable(getS().data, id));

// the lap picker for the driver in this car select; each driver opens on their fastest clean lap
function fillLaps(car, lapSel) {
  if (!M.real) return;
  const rows = rowsOf(car.value), best = fastestClean(rows);
  lapSel.replaceChildren(...rows.map(r => new Option(lapLabel(r, best), r.lapNo)));
  if (best) lapSel.value = best.lapNo;
}

// the real-lap comparison on show, for a shared link (share.js's cmp)
export function compared() {
  const code = id => getS()?.byId?.[id]?.code;
  if (!M?.open || !M.real) return undefined;
  return [[M.carA, M.lapA], [M.carB, M.lapB]].map(([car, lap]) => ({driver: code(car.value), lap: +lap.value}));
}

// a link's pair, by driver code. A lap this driver hasn't got stays on their best. Set before opening, so nothing fetches the default pair's telemetry
export function openCompare([a, b]) {
  const S = getS(), set = (car, lapSel, {driver, lap}) => {
    car.value = S.drivers.find(d => d.code === driver)?.id ?? '';
    if (!car.value) return false;
    fillLaps(car, lapSel);
    const best = lapSel.value;
    lapSel.value = lap;
    if (!lapSel.value) lapSel.value = best;
    return true;
  };
  updateTrace(S);  // this session's drivers and lap lists, or the next frame would refill the pickers
  if (M.real && set(M.carA, M.lapA, a) && set(M.carB, M.lapB, b)) toggle(true, true, true);
}

function toggle(open = !M.open, restore = true, keep = false) {
  M.open = open;
  if (open) dispatchEvent(new CustomEvent('f1:panel', {detail: M.panel}));
  M.panel.hidden = !open;
  M.btn.setAttribute('aria-expanded', open);
  M.btn.setAttribute('aria-pressed', open);
  hold();
  if (!open) { setCursor(null); M.focus.closed(restore); return; }
  M.focus.opened();
  const S = getS();
  if (S && !M.carA.options.length) fillCars(S);
  if (!keep && S?.selected && S.selected !== M.carA.value) { M.carA.value = S.selected; fillLaps(M.carA, M.lapA); }
  if (!keep && M.carB.value === M.carA.value) pickB(null);
  size();
  redraw();
}

// B defaults to the car just behind A (the one ahead for the last car); id: an explicit choice
function pickB(id) {
  const S = getS(), board = S?.board ?? [];
  if (id) {
    M.carB.value = id;
    if (M.real) {
      fillLaps(M.carB, M.lapB);
      if (id === M.carA.value) {  // the same car: its best against its next best
        const next = rowsOf(id).filter(r => !r.tag).sort((p, q) => p.dur - q.dur)[1];
        if (next) M.lapB.value = next.lapNo;
      }
    } else if (id === M.carA.value) { M.lapA.value = 'fastest'; M.lapB.value = 'current'; }  // the same car: its live lap against its best
  } else {
    const k = board.findIndex(b => b.d.id === M.carA.value);
    M.carB.value = board[k + 1]?.d.id ?? board[k - 1]?.d.id ?? (M.real && M.quick.find(q => q !== M.carA.value)) ?? M.carA.value;
    fillLaps(M.carB, M.lapB);
  }
  redraw();
}

// pause the simulation while open (if asked), resume on close only if it was this panel that paused it
function hold() {
  const S = getS();
  if (!S?.sim) return;
  if (M.open && M.pause && S.playing) { ctl.togglePlay(); M.paused = true; }
  else if ((!M.open || !M.pause) && M.paused) { if (!S.playing) ctl.togglePlay(); M.paused = false; }
}

function lap(car, kind) {
  if (M.real) return realOf(car, +kind);
  if (kind === 'ref') return ref && Math.abs(ref.len - rec?.len) < rec?.len * 0.01 ? ref : null;  // only on the same circuit
  const c = rec?.cars[car];
  return c ? c[kind === 'current' ? 'cur' : kind] : null;
}

// A real lap, built once its driver's telemetry has arrived; until then null, and the answer triggers another redraw.
function realOf(id, lapNo) {
  const key = `${id}:${lapNo}`, S = getS(), d = S.byId?.[id], tele = M.tele[id];
  if (key in M.built) return M.built[key];
  if (!d || !lapNo) return null;
  if (!tele) {
    const data = S.data;
    M.tele[id] = 'loading';
    get(teleUrl(S, d)).then(t => { if (S.data === data) { M.tele[id] = t; redraw(); } },
                            e => { if (S.data === data) { M.tele[id] = {error: e.message}; redraw(); } });
    return null;
  }
  const row = rowsOf(id).find(r => r.lapNo === lapNo);
  if (tele === 'loading' || tele.error || !row) return null;
  const L = realLap(tele, row, {id, code: d.code, teamId: d.team, color: d.color, year: S.year}, S.proj ? S.proj.cum.at(-1) * S.proj.mpu : 0);
  if (L) L.pts = lapPath(L, S.data.frames[id], S.data.step, S.proj.rot);
  return M.built[key] = L;
}

const lapName = L => (L ? `${L.code}${L === ref ? ` ${L.year} REF` : ''} L${L.lapNo + 1}` : '');

// ---------- drawing ----------

function size() {
  const dpr = devicePixelRatio || 1, w = M.wrap.clientWidth, h = M.wrap.clientHeight;
  for (const c of [M.base, M.over]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);  // draw in CSS pixels, rasterise at device resolution
  }
}

function redraw() {
  if (!M.open) return;
  M.drawn = performance.now();
  const S = getS();
  if ((!rec && !M.real) || !S) {
    M.msg.textContent = 'Telemetry traces need car data: pick a session from 2023 on, or choose Simulation in the session list and press ▶.';
    M.msg.hidden = false;
    M.wrap.hidden = true;
    M.notes.replaceChildren();
    return;
  }
  const A = lap(M.carA.value, M.lapA.value), B = lap(M.carB.value, M.lapB.value);
  M.wrap.hidden = false;
  M.msg.hidden = !!(A && B);
  M.msg.textContent = M.real ? realMessage(A, B) : A || B ? 'Waiting for the other lap: previous and fastest laps appear once a car completes a lap from the line.'
                             : 'Nothing recorded for these laps yet. Laps record while the simulation runs.';
  const colA = A?.color ?? '#fff', colB = B && A && (B.teamId === A.teamId || B.color === A.color) ? TEAMMATE : B?.color ?? TEAMMATE;
  const len = M.real ? A?.len ?? B?.len ?? 1 : rec.len, check = M.real ? sectorCheck(A, B) : null, on = (A ?? B)?.pts;
  const years = [A, B].filter(Boolean).map(L => engine(L.year).rpmMax);
  M.view = {A, B, colA, colB, nameA: lapName(A), nameB: lapName(B), len, x0: M.x0, x1: M.x1, corners: on ? corners(S, on) : M.corners, cuts: check?.cuts,
            rpmMax: Math.max(15000, Math.ceil(Math.max(0, ...years) / 1000) * 1000), dt: A && B ? delta(A, B) : new Float32Array(N).fill(NaN)};
  const w = M.wrap.clientWidth, h = M.wrap.clientHeight;
  drawTrace(M.base.getContext('2d'), w, h, M.view);
  drawCursor(M.over.getContext('2d'), w, h, M.view, M.hover);
  M.head[1].textContent = M.view.nameA;
  M.head[1].style.setProperty('--head-color', colA);
  M.head[2].textContent = M.view.nameB;
  M.head[2].style.setProperty('--head-color', colB);
  readout();
  // callouts: worth recomputing only when a lap changed, i.e. at most every redraw (O(N) passes, well under 1 ms)
  const notes = A && B ? insights(A, B, {len, a: M.view.nameA, b: M.view.nameB, corner, cuts: check?.cuts}) : [];
  M.notes.replaceChildren(...notes.map(n => el('li', {onclick: () => zoomAt(n.at)}, el('small', {}, n.kind), n.text)));
  drawDominance(A, B, colA, colB);
  showCheck(check, A, B);
}

function realMessage(A, B) {
  const wait = [M.carA, M.carB].map(c => M.tele[c.value]);
  if (wait.includes('loading')) return 'Fetching these drivers\' car data from OpenF1 (once per driver, then cached).';
  const failed = wait.find(t => t?.error);
  if (failed) return `No car data for one of these drivers: ${failed.error}`;
  return A || B ? 'One of these laps can\'t be compared: it has no timed lap, or a gap in its car data.' : 'No comparable laps for these drivers.';
}

// Track dominance on the mini-map: each mini-sector in the colour of whoever was quicker through it, drawn along lap
// A's own GPS path so it sits at the right distance whatever point the outline starts from. Ties stay neutral.
function drawDominance(A, B, colA, colB) {
  M.dom.replaceChildren();
  const pts = A && B ? A.pts : null;
  M.domText.hidden = !pts;
  if (!pts) return;
  const dom = dominance(A, B);
  for (const {from, to, winner} of dom.sectors) {
    const line = [];
    for (let i = from; i <= to; i++) { const p = pts[i % N]; if (p) line.push(p.join(',')); }
    const seg = svg('polyline', {points: line.join(' '), class: winner ? 'trdom' : 'trdom tie'});
    if (winner) seg.style.stroke = winner === 'A' ? colA : colB;
    M.dom.append(seg);
  }
  const text = dominanceText(dom, M.view.nameA, M.view.nameB);
  M.domText.textContent = text;
  M.map.setAttribute('aria-label', `Circuit mini-map coloured by the faster lap in each mini-sector. ${text}`);
}

// how far the integrated gap is from the official one at the sector lines: shown, so nobody reads more into Δt than it holds
function showCheck(check, A, B) {
  M.check.hidden = !(check && A && B);
  if (M.check.hidden) return;
  const sign = v => `${signed(v, 3)} s`;
  const parts = check.offsets.map((v, k) => (v === null ? null : `S${k + 1} ${sign(v)}`)).filter(Boolean);
  M.check.textContent = `${parts.length ? `Δt accuracy, integrated minus official gap: ${parts.join(' · ')}.` : 'No official sector times for these laps, so Δt can\'t be checked.'}`
    + ` Lap times are official (Δ ${sign(B.time - A.time)}).`;
}

// the zoom buttons' ranges: on real laps the sector buttons go to the real sector lines
function zoomRange(k) {
  const c = M.view?.cuts;
  return k && c ? [[0, c[0]], [c[0], c[1]], [c[1], 1]][k - 1] : ZOOMS[k].slice(1);
}

function zoom(a, b) {
  const w = Math.min(1, Math.max(0.01, b - a));  // never narrower than 1 % of the lap (5 buckets)
  M.x0 = Math.min(1 - w, Math.max(0, a));
  M.x1 = M.x0 + w;
  M.zooms.forEach((z, k) => { const [p, q] = zoomRange(k); z.setAttribute('aria-pressed', Math.abs(p - M.x0) < 1e-6 && Math.abs(q - M.x1) < 1e-6); });
  redraw();
}
const zoomAt = i => zoom(i / N - 0.04, i / N + 0.04);  // a callout's corner, ~8 % of the lap round it

function hover(i) {
  M.hover = i;
  if (!M.view) return;
  drawCursor(M.over.getContext('2d'), M.wrap.clientWidth, M.wrap.clientHeight, M.view, i);
  readout();
  const pa = i !== null && M.view.A && worldPos(M.view.A, i), pb = i !== null && M.view.B && worldPos(M.view.B, i);
  for (const [dot, p] of [[M.dotA, pa], [M.dotB, pb]]) {
    if (!dot) continue;
    p ? dot.classList.remove('hidden') : dot.classList.add('hidden');
    if (p) { dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); }
  }
  setCursor(pa || pb || null);  // the HUD's circuit radar shows the same spot
}

// the floating readout: both laps' values at the crosshair and their difference (B - A), in tabular figures
function readout() {
  const i = M.hover, v = M.view;
  M.read.hidden = i === null || !v || !(v.A || v.B);
  if (M.read.hidden) return;
  M.head[0].textContent = `${Math.round(i * v.len / N)} m`;
  READ.forEach(([, key, dp, unit], r) => {
    const a = v.A?.[key][i], b = v.B?.[key][i], f = x => (x === undefined || Number.isNaN(x) ? '–' : `${x.toFixed(dp)}${unit}`);
    const [ca, cb, cd] = M.cells[r];
    ca.textContent = f(a);
    cb.textContent = f(b);
    const d = b - a;
    cd.textContent = Number.isNaN(d) ? '–' : signed(d, dp, '');
  });
  const x = layout(M.wrap.clientWidth, M.wrap.clientHeight, v.x0, v.x1).X(i);
  // on a phone neither side of the crosshair has the readout's width: keep it inside the plot, which clips it
  M.read.style.left = `${Math.max(0, Math.min(M.wrap.clientWidth - M.read.offsetWidth, x > M.wrap.clientWidth * 0.6 ? x - M.read.offsetWidth - 14 : x + 14))}px`;
}

// world position of bucket i of lap L: the lap distance and the car's recorded lateral offset on the current track
function worldPos(L, i) {
  if (L.pts) return L.pts[i];
  const T = M.race?.T;
  if (!T || Number.isNaN(L.d[i])) return null;
  return trackPos(T, i * T.len / N, L.d[i]);
}

function drawMap(S) {
  M.map.replaceChildren();
  M.dom.replaceChildren();
  M.dotA = M.dotB = null;
  const pts = S.proj?.pts;
  if (!pts?.length) return;
  const X = pts.map(p => p[0]), Y = pts.map(p => p[1]), x0 = Math.min(...X), y0 = Math.min(...Y);
  const span = Math.max(Math.max(...X) - x0, Math.max(...Y) - y0), pad = span * 0.08;
  M.map.setAttribute('viewBox', `${x0 - pad} ${y0 - pad} ${Math.max(...X) - x0 + 2 * pad} ${Math.max(...Y) - y0 + 2 * pad}`);
  M.map.append(svg('polyline', {points: [...pts, pts[0]].map(p => p.join(',')).join(' '), class: 'trline'}));
  M.dotA = svg('circle', {r: span * 0.022, class: 'trdot a'});
  M.dotB = svg('circle', {r: span * 0.022, class: 'trdot b'});
  M.dotA.classList.add('hidden');
  M.dotB.classList.add('hidden');
  M.map.append(M.dom, M.dotB, M.dotA);
}

// ---------- corners, reference, export ----------

// the circuit's corners as buckets with labels: "T10 Pouhon" for the preset circuits' named turns, "T10" elsewhere
// path: a real lap's positions per bucket, so its corners go where that lap actually passed them
function corners(S, path) {
  const list = S.track?.corners ?? [], proj = S.proj;
  if (!proj || !list.length) return [];
  const names = PRESETS[S.track.circuitId]?.turns ?? {}, total = proj.cum.at(-1);
  return list.map(c => {
    const [cx, cy] = proj.rot(c.x, c.y), label = `T${c.number}${names[c.number] ? ` ${names[c.number]}` : ''}`;
    if (path) return {i: nearestBucket(path, cx, cy), label};
    let best = 0, d = Infinity;
    proj.pts.forEach((p, i) => { const e = (p[0] - cx) ** 2 + (p[1] - cy) ** 2; if (e < d) { d = e; best = i; } });
    return {i: Math.round(proj.cum[best] / total * N) % N, label};
  }).sort((a, b) => a.i - b.i);
}

// for the callouts: the first corner within ~30 buckets after bucket i, else the nearest one
function corner(i) {
  const cs = M.view?.corners ?? [];
  const next = cs.find(c => c.i >= i && c.i - i <= 30);
  const near = cs.reduce((m, c) => (!m || Math.abs(c.i - i) < Math.abs(m.i - i) ? c : m), null);
  return (next ?? near)?.label ?? `${Math.round(i * (M.view?.len ?? 0) / N)} m`;
}

function saveRef() {
  const L = lap(M.carA.value, M.lapA.value);
  if (!L) return;
  ref = {...L, ...Object.fromEntries(CHANNELS.map(k => [k, L[k].slice()]))};  // a copy: the live lap keeps filling
  M.lapB.value = 'ref';
  redraw();
}

function exportLaps(kind) {
  const v = M.view, laps = [v?.A, v?.B].filter(Boolean);
  if (!laps.length) return;
  const out = laps.map(L => ({lap: lapName(L), car: L.code, year: L.year, lapNumber: L.lapNo + 1, lapTime: L.time,
                              rows: lapRows(L, v.len, i => (L.pts ? L.pts[i] ?? [] : [...(worldPos(L, i) ?? [NaN, NaN]), heightAt(i)]))}));  // x, y: map units; z: m, none on real laps
  let text;
  if (kind === 'json') text = JSON.stringify({lapLength: v.len, buckets: N, laps: out}, null, 1);
  else {
    const cols = Object.keys(out[0].rows[0] ?? {}).filter(k => k !== 'worldPos');
    text = [['lap', ...cols, 'x', 'y', ...(laps[0].pts ? [] : ['z'])].join(','),
            ...out.flatMap(o => o.rows.map(r => [o.lap, ...cols.map(k => r[k]), ...r.worldPos].join(',')))].join('\n');
  }
  const a = el('a', {href: URL.createObjectURL(new Blob([text], {type: kind === 'json' ? 'application/json' : 'text/csv'})),
                     download: `telemetry-${out.map(o => o.lap.replace(/\s+/g, '_')).join('-vs-')}.${kind}`});
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const heightAt = i => { const T = M.race?.T; return T ? at(T, T.h, i * T.len / N) : 0; };
