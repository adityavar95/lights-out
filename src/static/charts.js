// Results, qualifying, lap chart and standings views.
import {el, svg, teamColor} from './util.js';

const tipEl = el('div', {class: 'tooltip', role: 'tooltip', hidden: true});
document.body.append(tipEl);

function tip(e, ...content) {
  if (!e) { tipEl.hidden = true; return; }
  tipEl.replaceChildren(...content);
  tipEl.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8);
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${e.clientY + 14}px`;
}

const name = r => `${r['Driver.givenName']} ${r['Driver.familyName']}`;
const code = r => r['Driver.code'] || r['Driver.familyName'].slice(0, 3).toUpperCase();
const chip = color => el('span', {class: 'chip', style: `background:${color}`});
const empty = text => el('p', {class: 'empty'}, text);

function driverCell(r) {
  return el('td', {class: 'drv'}, chip(teamColor(r['Constructor.constructorId'], r['Constructor.name'])),
    el('b', {}, code(r)), ' ', el('span', {class: 'muted'}, name(r)));
}

export function renderResults(root, results, sprint) {
  if (!results.length) return root.replaceChildren(empty('No results yet for this race.'));
  const podium = [results[1], results[0], results[2]].filter(Boolean).map(r =>
    el('div', {class: `step p${r.position}`},
      el('div', {class: 'stepname'}, chip(teamColor(r['Constructor.constructorId'])), el('b', {}, code(r))),
      el('div', {class: 'muted small'}, name(r)),
      el('div', {class: 'muted small'}, r['Constructor.name']),
      el('div', {class: 'block'}, el('span', {}, r.position))));
  root.replaceChildren(el('div', {class: 'podium'}, podium), classification(results, 'Race classification'),
    sprint.length ? classification(sprint, 'Sprint classification') : null);
}

function classification(rows, title) {
  return el('div', {class: 'card'},
    el('h3', {}, title),
    el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
      el('thead', {}, el('tr', {}, ['Pos', 'Driver', 'Team', 'Grid', 'Laps', 'Time / status', 'Pts', 'Fastest lap']
        .map(h => el('th', {}, h)))),
      el('tbody', {}, rows.map(r => {
        const grid = +r.grid, pos = +r.position, delta = grid ? grid - pos : null;
        return el('tr', {},
          el('td', {class: 'num'}, r.positionText),
          driverCell(r),
          el('td', {class: 'muted'}, r['Constructor.name']),
          el('td', {class: 'num'}, grid || 'PL', delta ? el('span', {class: delta > 0 ? 'up' : 'down'}, ` ${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`) : null),
          el('td', {class: 'num'}, r.laps),
          el('td', {class: 'num'}, r['Time.time'] || r.status),
          el('td', {class: 'num'}, r.points),
          el('td', {class: `num ${r['FastestLap.rank'] === '1' ? 'purple' : ''}`}, r['FastestLap.Time.time'] || ''));
      })))));
}

export function renderQualifying(root, rows) {
  if (!rows.length) return root.replaceChildren(empty('No qualifying results for this race.'));
  const best = q => rows.map(r => r[q]).filter(Boolean).sort()[0];  // same-format m:ss.sss strings sort correctly
  const fastest = {Q1: best('Q1'), Q2: best('Q2'), Q3: best('Q3')};
  root.replaceChildren(el('div', {class: 'card'}, el('h3', {}, 'Qualifying'),
    el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
      el('thead', {}, el('tr', {}, ['Pos', 'Driver', 'Team', 'Q1', 'Q2', 'Q3'].map(h => el('th', {}, h)))),
      el('tbody', {}, rows.map(r => el('tr', {},
        el('td', {class: 'num'}, r.position), driverCell(r), el('td', {class: 'muted'}, r['Constructor.name']),
        ...['Q1', 'Q2', 'Q3'].map(q => el('td', {class: `num ${r[q] && r[q] === fastest[q] ? 'purple' : ''}`}, r[q] || '')))))))));
}

export function renderLapChart(root, laps, results, pitstops) {
  if (!laps.length) return root.replaceChildren(empty('No lap-by-lap data for this race (available from 1996).'));
  const info = Object.fromEntries(results.map(r => [r['Driver.driverId'], r]));
  const byDriver = {};
  for (const l of laps) (byDriver[l.driverId] ??= []).push([+l.number, +l.position]);
  const ids = results.map(r => r['Driver.driverId']).filter(id => byDriver[id]);
  const L = Math.max(...laps.map(l => +l.number)), N = ids.length;
  const W = 1000, rowH = 22, m = {l: 64, r: 64, t: 10, b: 30}, H = m.t + m.b + rowH * (N - 1);
  const x = lap => m.l + lap / L * (W - m.l - m.r), y = pos => m.t + (pos - 1) * rowH;
  const chart = svg('svg', {viewBox: `0 0 ${W} ${H}`, class: 'lapchart', role: 'img', 'aria-label': 'Position by lap for every driver'});
  for (let p = 1; p <= N; p++) chart.append(svg('line', {x1: m.l, x2: W - m.r, y1: y(p), y2: y(p), class: 'grid'}));
  for (let lap = 0; lap <= L; lap += L > 40 ? 10 : 5) {
    const t = svg('text', {x: x(lap), y: H - 8, class: 'axis', 'text-anchor': 'middle'});
    t.textContent = lap ? lap : 'Grid';
    chart.append(t);
  }
  const pitLaps = {};
  for (const p of pitstops) (pitLaps[p.driverId] ??= new Set()).add(+p.lap);
  const seenTeam = new Set(), groups = {};
  for (const id of ids) {
    const r = info[id], team = r['Constructor.constructorId'], color = teamColor(team, r['Constructor.name']);
    const dashed = seenTeam.has(team);  // second driver of a team: same colour, dashed line
    seenTeam.add(team);
    const pts = [...(+r.grid ? [[0, Math.min(+r.grid, N)]] : []), ...byDriver[id].sort((a, b) => a[0] - b[0])];
    const d = 'M' + pts.map(([lp, ps]) => `${x(lp).toFixed(1)},${y(ps)}`).join('L');
    const g = svg('g', {class: 'series', tabindex: 0, 'aria-label': `${code(r)} finished ${r.positionText}`});
    g.append(svg('path', {d, class: 'line', stroke: color, 'stroke-dasharray': dashed ? '6 4' : 'none'}),
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
    const show = e => {
      chart.classList.add('focus');
      g.classList.add('on');
      if (!e) return;
      const rect = chart.getBoundingClientRect(), lap = ((e.clientX - rect.left) / rect.width * W - m.l) / (W - m.l - m.r) * L;
      const at = pts.reduce((a, b) => Math.abs(b[0] - lap) < Math.abs(a[0] - lap) ? b : a);
      tip(e, el('b', {}, code(r)), ` ${name(r)}`, el('br'), at[0] ? `Lap ${at[0]}: P${at[1]}` : `Grid: P${at[1]}`,
          pitLaps[id]?.has(at[0]) ? ' · pit stop' : '');
    };
    const hide = () => { chart.classList.remove('focus'); g.classList.remove('on'); tip(null); };
    g.onmousemove = show;
    g.onmouseleave = hide;
    g.onfocus = () => show(null);
    g.onblur = hide;
    groups[id] = g;
    chart.append(g);
  }
  const legend = el('div', {class: 'legend'}, ids.map(id => {
    const r = info[id];
    return el('button', {class: 'legenditem', onmouseenter: () => groups[id].onfocus(), onmouseleave: () => groups[id].onblur(),
                         onfocus: () => groups[id].onfocus(), onblur: () => groups[id].onblur()},
      chip(teamColor(r['Constructor.constructorId'], r['Constructor.name'])), code(r));
  }));
  root.replaceChildren(el('div', {class: 'card'}, el('h3', {}, 'Lap chart'),
    el('p', {class: 'muted small'}, 'Position at the end of every lap. Dots mark pit stops; a team\'s second driver is dashed. Hover a line or a name to follow one driver.'),
    legend, el('div', {class: 'chartwrap'}, chart)));
}

export function renderStandings(root, drivers, constructors) {
  if (!drivers.length) return root.replaceChildren(empty('No standings yet.'));
  const bars = (title, rows, label, teamOf) => {
    const max = Math.max(...rows.map(r => +r.points), 1);
    return el('div', {class: 'card'}, el('h3', {}, title), el('ol', {class: 'bars'}, rows.map(r => {
      const [tid, tname] = teamOf(r);
      return el('li', {onmousemove: e => tip(e, el('b', {}, label(r)), el('br'), `${r.points} pts · ${r.wins} win${r.wins === '1' ? '' : 's'}`),
                       onmouseleave: () => tip(null)},
        el('span', {class: 'num pos'}, r.position),
        el('span', {class: 'who'}, chip(teamColor(tid, tname)), label(r)),
        el('span', {class: 'track'}, el('span', {class: 'fill', style: `width:${+r.points / max * 100}%`})),
        el('span', {class: 'num pts'}, r.points));
    })));
  };
  root.replaceChildren(el('div', {class: 'twocol'},
    bars('Drivers', drivers, r => `${r['Driver.givenName']} ${r['Driver.familyName']}`,
         r => [r.Constructors?.at(-1)?.constructorId, r.Constructors?.at(-1)?.name]),
    constructors.length ? bars('Constructors', constructors, r => r['Constructor.name'],
                               r => [r['Constructor.constructorId'], r['Constructor.name']]) : null));
}
