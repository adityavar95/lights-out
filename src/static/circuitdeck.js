// Circuit selector: a CIRCUITS button in the top HUD opens a glass deck with a card per circuit on the season's
// calendar: outline in sector colours with the DRS zones, elevation sparkline and badges (length, corners, elevation
// change, aero trim, lap record). Choosing one dispatches `f1:circuit` {year, round} (its latest race, which app.js
// loads as a Simulation). Previews load lazily, one circuit at a time, when the deck first opens: each can cost a few
// OpenF1 requests on a cold cache, and OpenF1 rate-limits.
import {get, rows, el, svg, led, skeleton} from './util.js';
import {PRESETS, annotate, aeroLabel, fetchCircuit, f1Coords} from './circuits.js';
import {drsZones} from './telemetry.js';
import {SECTOR_COLORS} from './hud.js';

let C, getS;

// A big panel's keyboard behaviour: it takes focus on open and gives it back on close; while open, Esc closes it wherever
// focus is (a click on the stage moves it out) and Tab stays inside. A trap, not `inert` on the rest: the stage still
// orbits and the HUD still clicks, so another panel's button can swap panels (f1:panel). close: closes the panel.
export function panelFocus(panel, btn, close) {
  let back = null;
  const shown = x => x.getClientRects().length > 0;
  const keys = e => {
    // its stage is hidden (Stream), or a dialog or menu over it takes the keys: one Esc closes one thing
    if (!shown(panel) || document.querySelector('dialog:modal, :popover-open')) return;
    if (e.key === 'Escape') close();
    if (e.key !== 'Tab') return;
    const stops = [...panel.querySelectorAll('a[href], button, select, input')].filter(x => !x.disabled && shown(x));
    const now = document.activeElement, k = stops.indexOf(now);
    if (e.shiftKey ? k <= 0 : k === stops.length - 1 || !panel.contains(now)) {
      e.preventDefault();
      stops.at(e.shiftKey ? -1 : 0).focus();
    }
  };
  panel.tabIndex = -1;
  panel.style.outline = 'none';  // the panel itself is no control: the global focus ring would box all of it
  return {
    opened() {
      if (back) return;
      back = document.activeElement;
      document.addEventListener('keydown', keys);
      panel.focus({preventScroll: true});
    },
    // restore: false when something else opened over it and is taking the focus
    closed(restore = true) {
      if (!back) return;
      document.removeEventListener('keydown', keys);
      if (restore) (back.isConnected && shown(back) ? back : btn).focus();
      back = null;
    },
  };
}

// stage: the 3D stage; top: the HUD's top strip; getState: () => the replay state (for the season and current circuit)
export function setupCircuitDeck(stage, top, getState) {
  getS = getState;
  C = {grid: el('div', {class: 'cdgrid'}), year: null, token: null};
  C.btn = el('button', {class: 'neu cdbtn', 'aria-expanded': false, 'aria-controls': 'circuitdeck', onclick: () => toggle()}, led(), 'CIRCUITS');
  C.panel = el('section', {class: 'glass circuitdeck', id: 'circuitdeck', hidden: true, 'aria-label': 'Circuit selector'},
    el('header', {class: 'pwhead'}, el('div', {class: 'phead'}, 'CIRCUIT SELECTOR'),
      el('small', {class: 'cdsub'}, 'Race a simulation on any circuit of the season'),
      el('button', {class: 'neu cdclose', 'aria-label': 'Close circuit selector', onclick: () => toggle(false)}, '✕')),
    C.grid);
  C.focus = panelFocus(C.panel, C.btn, () => toggle(false));
  // one big panel at a time: another one opening (circuits, cars, telemetry trace) closes this one
  addEventListener('f1:panel', e => { if (e.detail !== C.panel && !C.panel.hidden) toggle(false, false); });
  top.append(C.btn);
  stage.append(C.panel);
}

function toggle(open = C.panel.hidden, restore = true) {
  C.panel.hidden = !open;
  if (open) dispatchEvent(new CustomEvent('f1:panel', {detail: C.panel}));
  C.btn.setAttribute('aria-expanded', open);
  if (!open) { C.focus.closed(restore); return; }
  C.focus.opened();
  const year = getS()?.year ?? new Date().getFullYear();
  if (year !== C.year) build(year);
  for (const c of C.grid.children) c.setAttribute('aria-current', c.dataset.round === String(getS()?.round) && year === C.year);
}

async function build(year) {
  C.year = year;
  const token = C.token = {};
  C.grid.replaceChildren(skeleton());
  let races;
  try {
    races = rows(await get(`/api/jolpica/${year}/races`));
  } catch (e) {
    C.grid.replaceChildren(el('p', {class: 'empty err'}, e.message));
    C.year = null;
    return;
  }
  if (token !== C.token) return;
  const seen = new Set(), cards = [];
  for (const r of races) {
    const id = r['Circuit.circuitId'];
    if (seen.has(id)) continue;
    seen.add(id);
    const p = PRESETS[id], card = el('button', {class: `cdcard${p?.name ? ' preset' : ''}`, 'data-round': r.round, disabled: true,
                                                onclick: () => pick(card)},
      el('div', {class: 'cdtitle'}, el('b', {}, p?.short ?? r['Circuit.Location.locality']), p?.name ? el('span', {class: 'cdtag'}, 'SIGNATURE') : null),
      el('div', {class: 'cdname'}, r['Circuit.circuitName']),
      el('div', {class: 'cdmap'}, el('div', {class: 'spinner'})), el('div', {class: 'cdelev'}), el('div', {class: 'cdbadges'}));
    cards.push([card, id]);
  }
  C.grid.replaceChildren(...cards.map(([c]) => c));
  for (const [card, id] of cards) {  // one at a time, in calendar order
    if (token !== C.token) return;
    await preview(card, id).catch(() => token === C.token && preview(card, id)).catch(() => {  // one retry: a cold server cache can 502 once
      card.querySelector('.cdmap').replaceChildren(el('small', {class: 'muted'}, 'No track data'));
    });
  }
}

function pick(card) {
  if (!card.where) return;
  toggle(false);
  dispatchEvent(new CustomEvent('f1:circuit', {detail: card.where}));
}

async function preview(card, id) {
  const where = await get(`/api/circuit/${id}`);  // the latest race held there: its track, elevation and results
  const track = await fetchCircuit(where.year, where.round);
  const f1 = f1Coords(track), mpu = f1 ? 0.1 : 1, a = (track.rotation ?? 0) * Math.PI / 180;
  const rot = (x, y) => [x * Math.cos(a) - y * Math.sin(a), -(x * Math.sin(a) + y * Math.cos(a))];  // as replay.js draws it
  const pts = track.x.map((x, i) => rot(x, track.y[i])), n = pts.length;
  const ann = annotate({...track, rot: ([x, y]) => rot(x, y)}, pts, mpu);
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i % n][0] - pts[i - 1][0], pts[i % n][1] - pts[i - 1][1]) * mpu);
  const lap = cum[n];
  // the outline in three equal-length sectors, DRS zones (the preset's, else the longest straights) over it
  const X = pts.map(p => p[0]), Y = pts.map(p => p[1]), x0 = Math.min(...X), y0 = Math.min(...Y);
  const span = Math.max(Math.max(...X) - x0, Math.max(...Y) - y0), pad = span * 0.08;
  const map = svg('svg', {viewBox: `${x0 - pad} ${y0 - pad} ${Math.max(...X) - x0 + 2 * pad} ${Math.max(...Y) - y0 + 2 * pad}`,
                          role: 'img', 'aria-label': `${track.name ?? id} outline`});
  const line = (from, to) => {
    const out = [];
    for (let i = from; ; i = (i + 1) % n) { out.push(pts[i]); if (i === to) break; }
    return out.map(p => p.join(',')).join(' ');
  };
  const cut = f => cum.findIndex(c => c >= f * lap) % n, cuts = [0, cut(1 / 3), cut(2 / 3), 0];
  for (let s = 0; s < 3; s++) map.append(svg('polyline', {points: line(cuts[s], cuts[s + 1]), class: 'sector', stroke: SECTOR_COLORS[s]}));
  const zones = ann.zones?.length ? ann.zones.map(z => [z.start, z.end]) : drsZones(pts.map(p => [p[0] * mpu, p[1] * mpu]));
  for (const [s, e] of zones) map.append(svg('polyline', {points: line(s, e), class: 'drszone'}));
  map.append(svg('circle', {cx: pts[0][0], cy: pts[0][1], r: span * 0.025, class: 'cdstart'}));
  card.querySelector('.cdmap').replaceChildren(map);
  // elevation along the lap
  const h = ann.h, lo = Math.min(...h), hi = Math.max(...h), rise = hi - lo, elev = card.querySelector('.cdelev');
  if (rise > 0.5) {
    const spark = svg('svg', {viewBox: '0 0 100 24', preserveAspectRatio: 'none', role: 'img', 'aria-label': `Elevation, ${rise.toFixed(0)} m range`});
    const P = h.map((v, i) => `${(cum[i] / lap * 100).toFixed(1)},${(22 - (v - lo) / rise * 20).toFixed(1)}`);
    spark.append(svg('polygon', {points: `0,24 ${P.join(' ')} 100,24`, class: 'cdfill'}), svg('polyline', {points: P.join(' '), class: 'cdline'}));
    elev.replaceChildren(spark);
  } else elev.replaceChildren(el('small', {class: 'muted'}, f1 ? 'Flat · no height data' : 'No height data'));
  // badges; lap record: the preset's all-time record, else the fastest lap of that latest race
  const preset = PRESETS[id];
  let record = preset?.record && `${preset.record[0]} · ${preset.record[1]} ${preset.record[2]}`;
  if (!record) {
    const fl = rows(await get(`/api/jolpica/${where.year}/results?round=${where.round}`).catch(() => ({columns: [], data: []})))
      .find(r => r['FastestLap.rank'] === '1');
    record = fl ? `${fl['FastestLap.Time.time']} · ${fl['Driver.code'] ?? fl['Driver.familyName']} ${where.year} (race)` : null;
  }
  const badge = (k, v) => el('span', {class: 'cdbadge'}, el('small', {}, k), el('b', {}, v));
  card.querySelector('.cdbadges').replaceChildren(
    badge('LENGTH', `${(lap / 1000).toFixed(3)} km`), badge('CORNERS', String(track.corners?.length || '—')),
    badge('ELEVATION', rise > 0.5 ? `${rise.toFixed(0)} m` : '—'),
    badge('AERO', preset?.aeroLabel ?? aeroLabel(ann.aero.cl)), record ? badge(preset?.record ? 'LAP RECORD' : 'FASTEST LAP', record) : null);
  card.where = {year: where.year, round: where.round};
  card.title = `Simulate at ${where.raceName} ${where.year}`;
  card.disabled = false;
}
