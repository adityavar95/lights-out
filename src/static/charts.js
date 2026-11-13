// Results, qualifying, lap chart and standings views.
import {el, svg, teamColor, th} from './util.js';
import {raceModel} from './whatif.js';
import {raceTrace, roadVsClassified} from './pace.js';
import {faces} from './drivers.js';

const tipEl = el('div', {class: 'tooltip', role: 'tooltip', hidden: true});
document.body.append(tipEl);

export function tip(e, ...content) {
  if (!e) { tipEl.hidden = true; return; }
  tipEl.replaceChildren(...content);
  tipEl.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8);
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${e.clientY + 14}px`;
}

export const name = r => `${r['Driver.givenName']} ${r['Driver.familyName']}`;
export const code = r => r['Driver.code'] || r['Driver.familyName'].slice(0, 3).toUpperCase();
const chip = color => el('span', {class: 'chip', style: `background:${color}`});
const empty = text => el('p', {class: 'empty'}, text);
const NO_STOPS = 'Jolpica has no pit stops for this race (its records start in 2011).';
const FOLLOW = 'Hover a line or a name to follow one driver; tap to pin it, tap again to let go.';

function driverCell(r) {
  return el('td', {class: 'drv'}, chip(teamColor(r['Constructor.constructorId'], r['Constructor.name'])),
    el('b', {}, code(r)), ' ', el('span', {class: 'muted'}, name(r)));
}

// The Results tab, Qualifying folded in: the podium, then one classification at a time (Race / Sprint / Qualifying).
// view: the one to show first (falls back to the first that has rows); onView(view): the reader switched
export function renderResults(root, results, sprint, quali, view, onView) {
  const views = [['race', 'Race', results, () => classification(results, 'Race classification')],
    ['sprint', 'Sprint', sprint, () => classification(sprint, 'Sprint classification')],
    ['qualifying', 'Qualifying', quali, () => qualifying(quali)]].filter(v => v[2].length);
  if (!views.length) return root.replaceChildren(empty('No results yet for this race.'));
  const body = el('div'), pick = el('div', {class: 'resviews', role: 'group', 'aria-label': 'Classification'});
  const show = v => {
    body.replaceChildren(v[3]());
    for (const b of pick.children) { b.classList.toggle('on', b.dataset.view === v[0]); b.setAttribute('aria-pressed', b.dataset.view === v[0]); }
  };
  pick.append(...views.map(v => el('button', {class: 'pill', 'data-view': v[0], onclick: () => { show(v); onView?.(v[0]); }}, v[1])));
  show(views.find(v => v[0] === view) ?? views[0]);
  const top = [results[1], results[0], results[2]].filter(Boolean), pics = faces(top);
  const podium = top.map((r, i) =>
    el('div', {class: `step p${r.position}`}, pics[i],
      el('div', {class: 'stepname'}, chip(teamColor(r['Constructor.constructorId'])), el('b', {}, code(r))),
      el('div', {class: 'muted small'}, name(r)),
      el('div', {class: 'muted small'}, r['Constructor.name']),
      el('div', {class: 'block'}, el('span', {}, r.position))));
  root.replaceChildren(...[podium.length && el('div', {class: 'podium'}, podium), views.length > 1 && pick, body].filter(Boolean));
}

function classification(rows, title) {
  return el('div', {class: 'card'},
    el('h2', {}, title),
    el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
      el('thead', {}, el('tr', {}, ['Pos', 'Driver', 'Team', 'Grid', 'Laps', 'Time / status', 'Pts', 'Fastest lap']
        .map(th))),
      el('tbody', {}, rows.map(r => {
        const out = ['W', 'F'].includes(r.positionText), grid = out ? 0 : +r.grid, pos = +r.position, delta = grid ? grid - pos : null;  // W / F: never started
        return el('tr', {},
          el('td', {class: 'num'}, r.positionText),
          driverCell(r),
          el('td', {class: 'muted'}, r['Constructor.name']),
          el('td', {class: 'num'}, out ? '–' : grid || 'PL', delta ? el('span', {class: delta > 0 ? 'up' : 'down'}, ` ${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`) : null),
          el('td', {class: 'num'}, r.laps),
          el('td', {class: 'num'}, r['Time.time'] || r.status),
          el('td', {class: 'num'}, r.points),
          el('td', {class: `num ${r['FastestLap.rank'] === '1' ? 'purple' : ''}`}, r['FastestLap.Time.time'] || ''));
      })))));
}

function qualifying(rows) {
  const best = q => rows.map(r => r[q]).filter(Boolean).sort()[0];  // same-format m:ss.sss strings sort correctly
  const fastest = {Q1: best('Q1'), Q2: best('Q2'), Q3: best('Q3')};
  return el('div', {class: 'card'}, el('h2', {}, 'Qualifying'),
    el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
      el('thead', {}, el('tr', {}, ['Pos', 'Driver', 'Team', 'Q1', 'Q2', 'Q3'].map(th))),
      el('tbody', {}, rows.map(r => el('tr', {},
        el('td', {class: 'num'}, r.position), driverCell(r), el('td', {class: 'muted'}, r['Constructor.name']),
        ...['Q1', 'Q2', 'Q3'].map(q => el('td', {class: `num ${r[q] && r[q] === fastest[q] ? 'purple' : ''}`}, r[q] || ''))))))));
}

// Following a driver in a lap chart: hover or keyboard focus previews one, a tap pins it (phones have no hover) until
// it's tapped again. pinned: the set of driver ids, shared by the chart's views.
export function follower(chart, pinned) {
  const groups = {}, buttons = {};
  const paint = hover => {
    chart.classList.toggle('focus', !!hover || pinned.size > 0);
    for (const id in groups) groups[id].classList.toggle('on', id === hover || pinned.has(id));
    for (const id in buttons) buttons[id].setAttribute('aria-pressed', pinned.has(id));
  };
  const pin = id => { if (!pinned.delete(id)) pinned.add(id); paint(null); };
  return {
    series(id, g, onmove) {
      groups[id] = g;
      g.onmousemove = e => { paint(id); onmove(e); };
      g.onmouseleave = () => { paint(null); tip(null); };
      g.onfocus = () => paint(id);
      g.onblur = () => paint(null);
      g.onclick = () => pin(id);
      g.onkeydown = e => { if (e.key === 'Enter') pin(id); };
    },
    legend(ids, info, label = code) {
      const legend = el('div', {class: 'legend'}, ids.map(id => {
        const r = info[id];
        return buttons[id] = el('button', {class: 'legenditem', onclick: () => pin(id),
          onmouseenter: () => paint(id), onmouseleave: () => paint(null), onfocus: () => paint(id), onblur: () => paint(null)},
          chip(teamColor(r['Constructor.constructorId'], r['Constructor.name'])), label(r));
      }));
      paint(null);
      return legend;
    },
  };
}

// the lap under the pointer, as the [lap, value] point nearest to it
export function nearest(chart, e, pts, m, W, L) {
  const rect = chart.getBoundingClientRect(), lap = ((e.clientX - rect.left) / rect.width * W - m.l) / (W - m.l - m.r) * L;
  return pts.reduce((a, b) => Math.abs(b[0] - lap) < Math.abs(a[0] - lap) ? b : a);
}

export function lapAxis(chart, x, L, y, first) {
  for (let lap = 0; lap <= L; lap += L > 40 ? 10 : 5) {
    const t = svg('text', {x: x(lap), y, class: 'axis', 'text-anchor': 'middle'});
    t.textContent = lap || first;
    chart.append(t);
  }
}

// a team's second driver in this list: same colour, dashed line
export function secondDrivers(ids, info) {
  const seen = new Set();
  return new Set(ids.filter(id => {
    const team = info[id]['Constructor.constructorId'], again = seen.has(team);
    seen.add(team);
    return again;
  }));
}

function positionChart(laps, ids, info, pitstops, pinned) {
  const byDriver = {};
  for (const l of laps) (byDriver[l.driverId] ??= []).push([+l.number, +l.position]);
  // rows down to the last grid slot: with non-starters ahead of them, the back of the grid used to share the bottom row
  const L = Math.max(...laps.map(l => +l.number)), N = Math.max(ids.length, ...ids.map(id => +info[id].grid || 0));
  const W = 1000, rowH = 22, m = {l: 64, r: 64, t: 10, b: 30}, H = m.t + m.b + rowH * (N - 1);
  const x = lap => m.l + lap / L * (W - m.l - m.r), y = pos => m.t + (pos - 1) * rowH;
  const chart = svg('svg', {viewBox: `0 0 ${W} ${H}`, class: 'lapchart', role: 'img', 'aria-label': 'Position by lap for every driver'});
  for (let p = 1; p <= N; p++) chart.append(svg('line', {x1: m.l, x2: W - m.r, y1: y(p), y2: y(p), class: 'grid'}));
  lapAxis(chart, x, L, H - 8, 'Grid');
  const pitLaps = {};
  for (const p of pitstops) (pitLaps[p.driverId] ??= new Set()).add(+p.lap);
  const dashed = secondDrivers(ids, info), f = follower(chart, pinned);
  for (const id of ids) {
    const r = info[id], color = teamColor(r['Constructor.constructorId'], r['Constructor.name']);
    const pts = [...(+r.grid ? [[0, +r.grid]] : []), ...byDriver[id].sort((a, b) => a[0] - b[0])];
    const d = 'M' + pts.map(([lp, ps]) => `${x(lp).toFixed(1)},${y(ps)}`).join('L');
    const g = svg('g', {class: 'series', tabindex: 0, 'aria-label': `${code(r)} finished ${r.positionText}`});
    g.append(svg('path', {d, class: 'line', stroke: color, 'stroke-dasharray': dashed.has(id) ? '6 4' : 'none'}),
             svg('path', {d, class: 'hit'}));
    for (const [lp, ps] of pts) if (pitLaps[id]?.has(lp)) g.append(svg('circle', {cx: x(lp), cy: y(ps), r: 4, fill: color, class: 'pit'}));
    const [lastLap, lastPos] = pts.at(-1);
    const end = svg('text', {x: x(lastLap) + 6, y: y(lastPos), class: 'endlabel'});
    end.textContent = code(r);
    g.append(end);
    if (pts[0][0] === 0) {
      const start = svg('text', {x: m.l - 6, y: y(pts[0][1]), class: 'endlabel', 'text-anchor': 'end'});
      start.textContent = code(r);
      g.append(start);
    }
    f.series(id, g, e => {
      const at = nearest(chart, e, pts, m, W, L);
      tip(e, el('b', {}, code(r)), ` ${name(r)}`, el('br'), at[0] ? `Lap ${at[0]}: P${at[1]}` : `Grid: P${at[1]}`,
          pitLaps[id]?.has(at[0]) ? ' · pit stop' : '');
    });
    chart.append(g);
  }
  return [el('p', {class: 'muted small'}, `Position at the end of every lap. ${pitstops.length ? 'Dots mark pit stops; a' : `${NO_STOPS} A`} team's second driver is dashed. ${FOLLOW}`),
    f.legend(ids, info), el('div', {class: 'chartwrap'}, chart)];
}

// y positions for a column of end labels: as near their lines as possible, at least `gap` apart, inside [top, bottom]
export function spreadLabels(labels, gap, top, bottom) {
  labels.sort((a, b) => a.y - b.y);
  labels.forEach((l, i) => { l.y = Math.max(l.y, i ? labels[i - 1].y + gap : top); });
  labels.reduceRight((below, l) => (l.y = Math.min(l.y, below - gap)), bottom + gap);
}

const away = (gap, ref) => `${Math.abs(gap).toFixed(1)} s ${gap > 0 ? 'ahead of' : 'behind'} ${ref}`;

// Gap to a reference car on every lap: flat means the same pace, a rising line is gaining on it, a cliff is a stop.
function traceChart(M, ids, info, refId, pitted, pinned) {
  const gaps = raceTrace(M, refId), L = M.n, ref = code(info[refId]);
  const W = 1000, H = 480, m = {l: 56, r: 64, t: 10, b: 30};
  // one lap's time either way: past that a car is lapped, and showing it would squash the fight for the lead to a line
  const limit = 1.1 * Math.min(...M.trend.filter(Number.isFinite));
  const all = ids.flatMap(id => gaps[id]), low = Math.min(0, ...all), high = Math.max(0, ...all);
  const lo = Math.max(low, -limit), hi = Math.min(high, limit), span = hi - lo || 1;
  const x = lap => m.l + lap / L * (W - m.l - m.r), y = g => m.t + (hi - g) / span * (H - m.t - m.b);
  const inPlot = g => Math.min(hi, Math.max(lo, g));
  const chart = svg('svg', {viewBox: `0 0 ${W} ${H}`, class: 'lapchart trace', role: 'img',
    'aria-label': `Race trace: every driver's gap to ${ref} at the end of each lap`});
  M.neutral.forEach((ntrl, i) => ntrl && chart.append(svg('rect', {x: x(i), y: m.t, width: x(1) - x(0), height: H - m.t - m.b, class: 'sc'})));
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => span / s <= 8) ?? 1000;
  for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) {
    chart.append(svg('line', {x1: m.l, x2: W - m.r, y1: y(g), y2: y(g), class: g ? 'grid' : 'zero'}));
    const t = svg('text', {x: m.l - 8, y: y(g), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'central'});
    t.textContent = g ? `${g > 0 ? '+' : '−'}${Math.abs(g)} s` : ref;
    chart.append(t);
  }
  lapAxis(chart, x, L, H - 8, 'Lap');
  const clip = svg('clipPath', {id: 'traceplot'});
  clip.append(svg('rect', {x: m.l, y: m.t - 2, width: W - m.l - m.r + 2, height: H - m.t - m.b + 4}));
  chart.append(clip);
  const dashed = secondDrivers(ids, info), f = follower(chart, pinned), column = [];
  for (const id of ids) {
    const r = info[id], color = teamColor(r['Constructor.constructorId'], r['Constructor.name']);
    const pts = gaps[id].map((g, i) => [i + 1, g]);
    if (!pts.length) continue;
    const [lastLap, lastGap] = pts.at(-1), who = `${code(r)} ${id === refId ? 'is the reference' : `${away(lastGap, ref)} on lap ${lastLap}`}`;
    const d = 'M' + pts.map(([lp, g]) => `${x(lp).toFixed(1)},${y(g).toFixed(1)}`).join('L');
    const g = svg('g', {class: 'series', tabindex: 0, 'aria-label': who}), plot = svg('g', {'clip-path': 'url(#traceplot)'});
    plot.append(svg('path', {d, class: 'line', stroke: color, 'stroke-dasharray': dashed.has(id) ? '6 4' : 'none'}),
                svg('path', {d, class: 'hit'}));
    for (const s of M.stops[id]) if (gaps[id][s - 1] !== undefined) plot.append(svg('circle', {cx: x(s), cy: y(gaps[id][s - 1]), r: 4, fill: color, class: 'pit'}));
    const end = svg('text', {x: x(lastLap) + 6, class: 'endlabel'});
    end.textContent = code(r);
    const label = {y: y(inPlot(lastGap)), end};
    // the ones still running at the flag (lapped cars end a lap or so short) share a column; a retirement stands alone
    if (lastLap >= L - 3) column.push(label); else end.setAttribute('y', label.y);
    g.append(plot, end);
    f.series(id, g, e => {
      const [lap, gap] = nearest(chart, e, pts, m, W, L);
      tip(e, el('b', {}, code(r)), ` ${name(r)}`, el('br'), `Lap ${lap}: ${id === refId ? 'reference' : away(gap, ref)}`,
          M.stops[id].includes(lap) ? ' · pit stop' : '', M.neutral[lap - 1] ? ' · SC/VSC' : '');
    });
    chart.append(g);
  }
  spreadLabels(column, 13, m.t, H - m.b);
  for (const {y: at, end} of column) end.setAttribute('y', at);
  const ended = gaps[refId].length < L ? ` ${ref}'s record ends on lap ${gaps[refId].length}, so every line stops there.` : '';
  return [el('p', {class: 'muted small'}, `Each driver's gap to ${ref}: up the chart is ahead of it, a rising line is gaining. Yellow bands are SC/VSC laps. ${pitted ? 'Dots mark pit stops.' : NO_STOPS} A line ends where a driver retired or the lap record has a hole.${ended}${low < lo || high > hi ? ' Cars more than a lap away leave the chart; the tooltip still reads them.' : ''} ${FOLLOW}`),
    f.legend(ids, info), el('div', {class: 'chartwrap'}, chart)];
}

// why: what to say when the race has no laps (it hasn't run, or it's before 1996)
// the followed lines per race (its drivers in finishing order): a tab switch or a redraw keeps them
const PINS = new Map();

export function renderLapChart(root, laps, results, pitstops, why) {
  if (!laps.length) return root.replaceChildren(empty(why));
  const info = Object.fromEntries(results.map(r => [r['Driver.driverId'], r]));
  const seen = new Set(laps.map(l => l.driverId)), ids = results.map(r => r['Driver.driverId']).filter(id => seen.has(id));
  if (!ids.length) return root.replaceChildren(empty(why));
  // 22 lines at full strength read as noise: the podium starts followed, the rest dimmed, until the reader picks
  const key = ids.join(), pinned = PINS.get(key) ?? new Set(ids.slice(0, 3)), body = el('div');
  PINS.set(key, pinned);
  let M, refId = ids[0], view = 'position';  // results come in finishing order: ids[0] is the winner
  const refPick = el('select', {'aria-label': 'Reference driver', onchange: e => { refId = e.target.value; draw(); }},
    ids.map(id => new Option(`Gap to ${code(info[id])}${info[id].position === '1' ? ' (winner)' : ''}`, id)));
  const controls = el('div', {class: 'controls lab-controls'}, refPick);
  const pick = el('div', {class: 'resviews', role: 'group', 'aria-label': 'Chart'},
    [['position', 'Positions'], ['trace', 'Race trace']].map(([v, text]) =>
      el('button', {class: 'pill', 'data-view': v, onclick: () => { view = v; draw(); }}, text)));
  function draw() {
    for (const b of pick.children) { b.classList.toggle('on', b.dataset.view === view); b.setAttribute('aria-pressed', b.dataset.view === view); }
    controls.hidden = view !== 'trace';
    if (view === 'position') return body.replaceChildren(...positionChart(laps, ids, info, pitstops, pinned));
    M ??= raceModel(laps, pitstops);
    body.replaceChildren(...traceChart(M, ids, info, refId, pitstops.length > 0, pinned));
  }
  draw();
  const moved = roadVsClassified(laps, results);
  root.replaceChildren(el('div', {class: 'card'}, el('h2', {}, 'Lap chart'), pick, controls, body, moved.length ? el('p', {class: 'muted small'},
    `This is the order on the road. The classification differs for ${moved.length} drivers, usually through time penalties: `,
    moved.map(x => `${code(info[x.id])} P${x.road} → P${x.classified}`).join(', '), '.') : null));
}

// note: what these standings are, when they aren't the race's own
export function renderStandings(root, drivers, constructors, note) {
  if (!drivers.length) return root.replaceChildren(empty('No standings yet.'));
  const bars = (title, rows, label, teamOf) => {
    const max = Math.max(...rows.map(r => +r.points), 1);
    return el('div', {class: 'card'}, el('h2', {}, title), el('ol', {class: 'bars'}, rows.map((r, i) => {
      const [tid, tname] = teamOf(r);
      return el('li', {onmousemove: e => tip(e, el('b', {}, label(r)), el('br'), `${r.points} pts · ${r.wins} win${r.wins === '1' ? '' : 's'}`),
                       onmouseleave: () => tip(null)},
        el('span', {class: 'num pos'}, r.position),
        el('span', {class: 'who'}, chip(teamColor(tid, tname)), label(r)),
        el('span', {class: 'track'}, el('span', {class: 'fill', style: `width:${+r.points / max * 100}%`})),
        el('span', {class: 'num pts'}, r.points),
        el('span', {class: 'num gap', title: 'Points behind the leader'}, i ? `−${+(max - +r.points).toFixed(1)}` : ''));
    })));
  };
  root.replaceChildren(...(note ? [el('p', {class: 'muted small'}, note)] : []), el('div', {class: 'twocol'},
    bars('Drivers', drivers, r => `${r['Driver.givenName']} ${r['Driver.familyName']}`,
         r => [r.Constructors?.at(-1)?.constructorId, r.Constructors?.at(-1)?.name]),
    constructors.length ? bars('Constructors', constructors, r => r['Constructor.name'],
                               r => [r['Constructor.constructorId'], r['Constructor.name']]) : null));
}
