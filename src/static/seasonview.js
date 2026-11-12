// The Standings tab's Season trends section: cumulative points, who can still win, team qualifying supertimes. Its season
// tables (~5 Jolpica pages each) load only when the section is opened; the maths is in season.js.
import {el, svg, teamColor, failed, skeleton} from './util.js';
import {tip, code, name, follower, nearest, lapAxis, secondDrivers, spreadLabels} from './charts.js';
import {numbered} from './drivers.js';
import {qualiRounds, cumulative, maxRemaining, alive, clinch, reconcile, supertimes} from './season.js';

const TOP = 10;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const raceOf = (calendar, round) => calendar.find(c => +c.round === round)?.raceName ?? `Round ${round}`;

// One line per id over the season's rounds, on the lap chart's follow-and-pin. lo/hi map to the bottom/top, so hi < lo
// plots upside down. extra: ids hidden until hovered or pinned in the legend. bands: rounds to mark.
function trendChart({ids, info, points, N, lo, hi, tick, end, tipLine, legend, extra = new Set(), dashed = new Set(), bands = [], right = 64, aria}) {
  const W = 1000, H = 440, m = {l: 56, r: right, t: 10, b: 30}, min = Math.min(lo, hi), max = Math.max(lo, hi);
  const x = r => m.l + r / N * (W - m.l - m.r), y = v => m.t + (hi - v) / (hi - lo || 1) * (H - m.t - m.b);
  const chart = svg('svg', {viewBox: `0 0 ${W} ${H}`, class: 'lapchart trend', role: 'img', 'aria-label': aria});
  for (const r of bands) chart.append(svg('rect', {x: x(r - .5), y: m.t, width: x(1) - x(0), height: H - m.t - m.b, class: 'sc'}));
  const step = [.1, .2, .5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => (max - min) / s <= 8) ?? 1000;
  for (let g = Math.ceil(min / step) * step; g <= max + 1e-9; g += step) {
    chart.append(svg('line', {x1: m.l, x2: W - m.r, y1: y(g), y2: y(g), class: 'grid'}));
    const t = svg('text', {x: m.l - 8, y: y(g), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'central'});
    t.textContent = tick(+g.toFixed(1));
    chart.append(t);
  }
  lapAxis(chart, x, N, H - 8, 'Rd');
  const f = follower(chart, new Set()), column = [];
  for (const id of ids) {
    const pts = points(id), color = teamColor(info[id]['Constructor.constructorId'], info[id]['Constructor.name']);
    const d = 'M' + pts.map(([r, v]) => `${x(r).toFixed(1)},${y(v).toFixed(1)}`).join('L'), [lastR, lastV] = pts.at(-1);
    const g = svg('g', {class: `series${extra.has(id) ? ' extra' : ''}`, tabindex: 0, 'aria-label': end(id)});
    g.append(svg('path', {d, class: 'line', stroke: color, 'stroke-dasharray': dashed.has(id) ? '6 4' : 'none'}), svg('path', {d, class: 'hit'}));
    const label = svg('text', {x: x(lastR) + 6, y: y(lastV), class: 'endlabel'});
    label.textContent = end(id);
    g.append(label);
    if (!extra.has(id)) column.push({y: y(lastV), end: label});  // the extras show alone, so they needn't make room
    f.series(id, g, e => tip(e, ...tipLine(id, nearest(chart, e, pts, m, W, N))));
    chart.append(g);
  }
  spreadLabels(column, 13, m.t, H - m.b);
  for (const {y: at, end: label} of column) label.setAttribute('y', at);
  return [f.legend(ids, info, legend), el('div', {class: 'chartwrap'}, chart)];
}

function pointsChart(year, calendar, series, last, info, standings, recon) {
  const ids = [...series.keys()].filter(id => series.get(id).at(-1) > 0).sort((a, b) => series.get(b).at(-1) - series.get(a).at(-1));
  if (!ids.length) return [el('p', {class: 'empty'}, `No points scored yet in ${year}.`)];
  const top = ids.slice(0, TOP), N = Math.max(calendar.length, last), total = id => series.get(id).at(-1);
  const who = id => { const s = standings.find(x => x['Driver.driverId'] === id); return s ? name(s) : id; };
  const worst = recon.diffs.slice(0, 3).map(d => `${who(d.id)} scored ${d.scored}, ${d.counted} counted`).join('; ');
  const notice = recon.dropped
    ? el('p', {class: 'seasonnote', role: 'note'}, `In ${year} only a driver's best results counted (${worst}). These lines are the points scored, so they don't end on the championship totals; the Standings above have those.`)
    : recon.diffs.length && el('p', {class: 'seasonnote', role: 'note'}, `Race results and the standings disagree (${worst}): a late penalty, or standings still to catch up with the latest race.`);
  const running = last < N ? `Through round ${last} of ${N}; the rest hasn't run.` : `All ${N} rounds.`;
  return [notice, el('p', {class: 'muted small'}, `${running} The top ${TOP} are drawn; the legend's others show on hover, and a tap pins anyone.`),
    ...trendChart({ids, info, N, lo: 0, hi: total(ids[0]), points: id => series.get(id).map((v, i) => [i, v]),
      tick: v => v, legend: r => code(r), extra: new Set(ids.slice(TOP)), dashed: secondDrivers(top, info),
      end: id => (recon.dropped ? code(info[id]) : `${code(info[id])} ${+total(id).toFixed(1)}`),
      tipLine: (id, [r, v]) => [el('b', {}, code(info[id])), ` ${name(info[id])}`, el('br'), r ? `${raceOf(calendar, r)}: ${+v.toFixed(1)} ${recon.dropped ? 'scored' : 'pts'}` : 'Start of the season'],
      aria: `Cumulative points by round, ${year}`})];
}

// who can still win: the sum of everything left, against the gap to the leader
function aliveBlock(year, calendar, results, sprint, series, info, recon) {
  if (recon.dropped) return el('p', {class: 'muted small'}, `Who could still win isn't worked out for ${year}: with only the best results counting, the gap to the leader isn't points behind.`);
  const left = maxRemaining(year, calendar, results.at(-1)?.round ?? 0, sprint.at(-1)?.round ?? 0);
  const state = alive(new Map([...series].map(([id, s]) => [id, s.at(-1)])), left.points);
  const list = yes => [...state].filter(([, s]) => s.alive === yes).sort((a, b) => a[1].gap - b[1].gap)
    .map(([id, s]) => `${code(info[id])}${s.gap ? ` −${+s.gap.toFixed(1)}` : ''}`).join(', ');
  const on = list(true), off = list(false), count = yes => [...state.values()].filter(s => s.alive === yes).length;
  const racesRun = +(results.at(-1)?.round ?? 0);
  const c = clinch(new Map([...series].map(([id, s]) => [id, s.at(-1)])), year, calendar, racesRun, sprint.at(-1)?.round ?? 0);
  const where = c && raceOf(calendar, c.round), hard = c?.rivals.filter(r => r.by > 0) ?? [];
  return el('div', {class: 'alive'},
    el('p', {class: 'muted small'}, left.points ? `${left.points} points left at most: ${plural(left.races, 'race')}${left.sprints ? `, ${plural(left.sprints, 'sprint')}` : ''}. A driver is alive while their gap to the leader is no more than that.` : 'No points left: the season is over.'),
    el('p', {}, el('b', {}, `${left.points ? 'Can still win' : 'Top of the table'} (${count(true)}): `), on),
    c && el('p', {}, el('b', {}, `At the ${where}: `), !hard.length
      ? `${code(info[c.leader])} is champion whatever happens.`
      : hard.every(r => r.possible)
        ? `${code(info[c.leader])} is champion by outscoring ${hard.map(r => `${code(info[r.id])} by ${plural(r.by, 'point')}`).join(' and ')} over the weekend.`
        : `the title can't be settled: ${code(info[c.leader])} would have to outscore ${code(info[hard.find(r => !r.possible).id])} by ${hard.find(r => !r.possible).by}, more than the weekend offers.`),
    off && el('p', {}, el('b', {}, `${left.points ? 'Out of it' : 'Behind'} (${count(false)}): `), el('span', {class: 'muted'}, off)));
}

function supertimeChart(year, calendar, quali) {
  const {rounds, teams} = supertimes(quali);
  if (!rounds.length) return [el('p', {class: 'muted small'}, `Jolpica has no qualifying times for ${year}.`)];
  const ids = [...teams.keys()], N = Math.max(calendar.length, rounds.at(-1).round), wet = rounds.filter(r => r.wet);
  const info = Object.fromEntries(ids.map(id => [id, {'Constructor.constructorId': id, 'Constructor.name': teams.get(id).name}]));
  const worst = Math.max(...ids.flatMap(id => teams.get(id).points.map(p => p[1])), .1);
  return [el('p', {class: 'muted small'}, `Each team's best lap of qualifying, as % off the round's fastest: lower is quicker, and it compares across circuits where seconds can't. Yellow marks a round whose fastest lap is over 10 % off the median driver's best, likely a wet or changing track, where the number isn't the car${wet.length ? `: ${wet.map(r => raceOf(calendar, r.round)).join(', ')}` : ' (none here)'}.`),
    ...trendChart({ids, info, N, lo: worst, hi: 0, right: 120, points: id => teams.get(id).points, bands: wet.map(r => r.round),
      tick: v => `${v} %`, legend: r => r['Constructor.name'], end: id => teams.get(id).name,
      tipLine: (id, [r, v]) => [el('b', {}, teams.get(id).name), el('br'), `${raceOf(calendar, r)}: +${v.toFixed(2)} %`, rounds.find(x => x.round === r)?.wet ? ' · likely wet' : ''],
      aria: `Team qualifying supertime by round, ${year}`})];
}

export function seasonTrends(year, jol) {
  const body = el('div');
  const load = () => {
    body.replaceChildren(skeleton());
    Promise.all([jol('results'), jol('sprint'), jol('qualifying'), jol('races'), jol('driverstandings')]).then(([res, spr, q, calendar, standings]) => {
      const results = numbered(res), sprint = numbered(spr), quali = qualiRounds(q);
      const {last, series} = cumulative(results, sprint, calendar), recon = reconcile(year, series, standings);
      const info = Object.fromEntries([...sprint, ...results].map(r => [r['Driver.driverId'], r]));  // results last: the driver's latest team
      body.replaceChildren(...[...pointsChart(year, calendar, series, last, info, standings, recon), aliveBlock(year, calendar, results, sprint, series, info, recon),
        el('h3', {}, 'Qualifying supertime'), ...supertimeChart(year, calendar, quali)].filter(Boolean));
      for (const w of body.querySelectorAll('.chartwrap')) w.scrollLeft = w.scrollWidth;  // a phone scrolls the chart: start on the latest rounds and the labels
    }).catch(e => body.replaceChildren(failed(e, load)));
  };
  const box = el('details', {class: 'card seasontrends', ontoggle: () => { if (box.open && !body.hasChildNodes()) load(); }},
    el('summary', {}, `${year} season trends`), body);
  return box;
}
