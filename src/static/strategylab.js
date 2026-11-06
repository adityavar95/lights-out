// Strategy Lab tab: move one driver's pit stops in a real race and see where they'd have finished (whatif.js), or
// search every 1-3 stop plan for the best one.
import {el, svg, teamColor, th, csvButton} from './util.js';
import {raceModel, simulate, optimise, ranked, PASS, SC_LOSS} from './whatif.js';
import {fuelPerLap, paceRanking, undercuts} from './pace.js';

const code = r => r['Driver.code'] || r['Driver.familyName'].slice(0, 3).toUpperCase();
const chip = color => el('span', {class: 'chip', style: `background:${color}`});
const signed = s => `${s > 0 ? '+' : s < 0 ? '−' : '±'}${Math.abs(s).toFixed(1)} s`;
const slope = s => `${s < 0 ? '−' : '+'}${Math.abs(s).toFixed(3)}`;
const lapTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const NO_STOPS = year => (year < 2011 ? 'Jolpica has no pit stops before 2011' : 'Jolpica has no pit stops for this race yet');

// why: what to say when the race has no laps (it hasn't run, or it's before 1996)
export function renderStrategyLab(root, laps, results, pits, year, why, round) {
  if (!laps.length || !results.length) return root.replaceChildren(el('p', {class: 'empty'}, why));
  const M = raceModel(laps, pits);
  const info = Object.fromEntries(results.map(r => [r['Driver.driverId'], r]));
  const ids = results.map(r => r['Driver.driverId']).filter(id => M.times[id]?.length > 5);
  if (!ids.length) return root.replaceChildren(el('p', {class: 'empty'}, 'Nobody ran more than 5 laps in this race: too few to model a strategy.'));
  const raceLaps = Math.max(...ids.map(id => M.times[id].length));
  const label = id => (info[id] ? code(info[id]) : id);
  const color = id => (info[id] ? teamColor(info[id]['Constructor.constructorId'], info[id]['Constructor.name']) : 'var(--muted)');
  const S = {id: ids[1] ?? ids[0], plan: [], pass: 'normal'};

  const driver = el('select', {'aria-label': 'Driver'}, ids.map(id => new Option(`${label(id)} · ${info[id].positionText}`, id)));
  const pass = el('select', {'aria-label': 'How hard it is to pass on track'},
    [['easy', 'Overtaking: easy'], ['normal', 'Overtaking: normal'], ['hard', 'Overtaking: hard (Monaco)']].map(([v, t]) => new Option(t, v)));
  const stopsBox = el('div', {class: 'lab-stops'}), verdict = el('div', {class: 'lab-verdict', 'aria-live': 'polite'});
  const chart = el('div', {class: 'chartwrap'}), notes = el('p', {class: 'muted small'}), best = el('div', {class: 'lab-best'});
  const order = el('ol', {class: 'lab-order'});
  const add = el('button', {class: 'labbtn', onclick: () => {
    const last = S.plan.at(-1) ?? 0, n = M.times[S.id].length;
    S.plan.push(Math.min(n - 2, Math.max(last + 5, Math.round((last + n) / 2))));
    draw();
  }}, '+ Stop');
  const resetBtn = el('button', {class: 'labbtn', onclick: () => { S.plan = [...M.stops[S.id]]; draw(); }}, 'Real strategy');
  const search = el('button', {class: 'labbtn primary', onclick: findBest}, 'Find best strategy');

  driver.value = S.id;
  pass.value = S.pass;
  const load = id => { S.id = id; driver.value = id; S.plan = [...M.stops[id]]; best.replaceChildren(); draw(); };
  driver.onchange = () => load(driver.value);
  pass.onchange = () => { S.pass = pass.value; best.replaceChildren(); draw(); };
  S.plan = [...M.stops[S.id]];

  async function findBest() {
    best.replaceChildren(el('div', {class: 'loading'}, el('div', {class: 'spinner'}), 'Trying every 1, 2 and 3-stop plan…'));
    const id = S.id, opts = {pass: PASS[S.pass], minStops: year >= 2007 ? 1 : 0}, n = Math.min(8, navigator.hardwareConcurrency || 2);
    // the plans split over the CPU's cores (optimiser.js workers): ~0.3 s on this thread froze the page
    const parts = await Promise.all(Array.from({length: n}, (_, k) => new Promise((ok, fail) => {
      const w = new Worker(new URL('./optimiser.js', import.meta.url), {type: 'module'});
      w.onmessage = e => { w.terminate(); ok(e.data); };
      w.onerror = e => { w.terminate(); fail(e); };
      w.postMessage({M, id, opts: {...opts, part: [k, n]}});
    }))).catch(() => [optimise(M, id, opts)]);  // no workers: here, as before
    if (id !== S.id) return;
    const plans = ranked(parts.flat()), real = simulate(M, id, M.stops[id], {pass: PASS[S.pass]});
    best.replaceChildren(el('h3', {}, 'Best plans found'), ...plans.map(p => el('button', {
      class: 'labplan', onclick: () => { S.plan = [...p.plan]; draw(); }},
      el('b', {}, `P${p.finish}`), ` ${p.plan.length ? `stop${p.plan.length > 1 ? 's' : ''} on lap ${p.plan.join(', ')}` : 'no stop'}`,
      el('span', {class: p.time < real.time ? 'up' : 'down'}, ` ${signed(p.time - real.time)}`))));
  }

  function draw() {
    const id = S.id, n = M.times[id].length, p = PASS[S.pass];
    S.plan = [...new Set(S.plan)].filter(s => s >= 1 && s < n).sort((a, b) => a - b);
    const real = simulate(M, id, M.stops[id], {pass: p});
    stopsBox.replaceChildren(...S.plan.map((lap, k) => {
      const out = el('output', {}, `lap ${lap}`);
      const range = el('input', {type: 'range', min: 1, max: n - 1, value: lap, 'aria-label': `Stop ${k + 1} lap`});
      range.oninput = () => { S.plan[k] = +range.value; out.textContent = `lap ${range.value}`; update(); };
      range.onchange = draw;  // re-sort and redraw the sliders once the drag ends
      return el('div', {class: 'lab-stop'}, el('span', {class: 'muted small'}, `Stop ${k + 1}`), range, out,
        el('button', {class: 'labx', 'aria-label': `Remove stop ${k + 1}`, onclick: () => { S.plan.splice(k, 1); draw(); }}, '×'));
    }), add);
    update();

    function update() {
      const res = simulate(M, id, S.plan, {pass: p}), moved = real.finish - res.finish;
      const fits = M.fits[id].map(f => f.b.toFixed(3)).join(', ');
      verdict.replaceChildren(
        el('div', {class: 'lab-pos'}, el('span', {class: 'muted'}, `P${real.finish}`), ' → ', el('b', {}, `P${res.finish}`),
          moved ? el('span', {class: moved > 0 ? 'up' : 'down'}, ` ${moved > 0 ? '▲' : '▼'}${Math.abs(moved)}`) : null),
        el('div', {}, `${signed(res.time - real.time)} over the race vs the real strategy`),
        ...warnings(res.plan, n, real));
      notes.textContent = `Pit stop ≈ ${M.pitLoss.toFixed(1)} s (this race's green-flag stops), ≈ ${(M.pitLoss * SC_LOSS).toFixed(1)} s under SC/VSC, `
        + `and the queue closes up behind it. ${label(id)}'s tyres lost ${fits} s/lap per stint relative to the field. `
        + 'Other cars keep their real race; shaded laps were neutralised.';
      chart.replaceChildren(positionChart(real, res, id, n));
      order.replaceChildren(...res.order.slice(0, Math.max(10, res.finish + 1)).map((o, i) => {
        const was = real.order.findIndex(x => x.id === o.id) - i;
        return el('li', {class: o.id === id ? 'me' : ''}, chip(color(o.id)), label(o.id),
          was ? el('span', {class: was > 0 ? 'up' : 'down'}, ` ${was > 0 ? '▲' : '▼'}${Math.abs(was)}`) : null);
      }));
    }
  }

  function warnings(plan, n, real) {
    const w = [], official = +info[S.id].position;
    if (official !== real.finish) w.push(`Official result: P${official}. This model runs the road order, before penalties and disqualifications.`);
    if (n < raceLaps) w.push(`${label(S.id)} ran ${n} of ${raceLaps} laps: every plan here, and the search, stops there.`);
    if (year >= 1994 && year <= 2009) w.push('Refuelling era: stops were set by fuel load, which this model leaves out.');
    if (year >= 2007 && !plan.length) w.push('No stop: a dry race has needed two tyre compounds since 2007.');
    if (plan.some((s, i) => s - (plan[i - 1] ?? 0) > 40) || n - (plan.at(-1) ?? 0) > 40) w.push('A 40+ lap stint: the model has no tyre cliff, so it is optimistic.');
    return w.map(t => el('div', {class: 'lab-warn'}, t));
  }

  function positionChart(real, res, id, n) {
    const N = Math.max(...real.position, ...res.position, 3), W = 1000, H = 260, m = {l: 40, r: 16, t: 10, b: 26};
    const x = L => m.l + L / n * (W - m.l - m.r), y = pos => m.t + (pos - 1) / (N - 1) * (H - m.t - m.b);
    const s = svg('svg', {viewBox: `0 0 ${W} ${H}`, class: 'labchart', role: 'img',
      'aria-label': `${label(id)} position by lap: real P${real.finish}, what-if P${res.finish}`});
    M.neutral.forEach((ntrl, i) => ntrl && s.append(svg('rect', {x: x(i), y: m.t, width: x(1) - x(0), height: H - m.t - m.b, class: 'sc'})));
    for (let pos = 1; pos <= N; pos += N > 12 ? 2 : 1) {
      s.append(svg('line', {x1: m.l, x2: W - m.r, y1: y(pos), y2: y(pos), class: 'grid'}));
      const t = svg('text', {x: m.l - 8, y: y(pos), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'central'});
      t.textContent = `P${pos}`;
      s.append(t);
    }
    for (let L = 0; L <= n; L += n > 40 ? 10 : 5) {
      const t = svg('text', {x: x(L), y: H - 6, class: 'axis', 'text-anchor': 'middle'});
      t.textContent = L || 'Lap';
      s.append(t);
    }
    const line = (run, cls) => svg('path', {class: cls, d: 'M' + run.position.map((pos, i) => `${x(i + 1).toFixed(1)},${y(pos).toFixed(1)}`).join('L')});
    s.append(line(real, 'real'), line(res, 'whatif'));
    for (const lap of real.plan) s.append(svg('circle', {cx: x(lap), cy: y(real.position[lap - 1]), r: 5, class: 'pitreal'}));
    for (const lap of res.plan) s.append(svg('circle', {cx: x(lap), cy: y(res.position[lap - 1]), r: 5, class: 'pitnew'}));
    return s;
  }

  function paceCard() {
    const rows = paceRanking(M).filter(r => info[r.id]), hasStops = pits.length > 0, fuel = fuelPerLap(M.n);
    const intro = el('p', {class: 'muted small'}, 'Clean laps only: no lap 1, in-laps, out-laps or SC/VSC laps, and none 2 s off the driver\'s stint median. The median is not adjusted for fuel or traffic, so compare drivers who ran the whole race.');
    if (!rows.length) return el('div', {class: 'card lab'}, el('h2', {}, 'Race pace and tyre wear'), intro, el('p', {class: 'empty'}, 'Nobody has 5 clean laps in this race.'));
    const k = hasStops ? Math.max(...rows.map(r => r.stints.length)) : 0;
    const head = ['#', 'Driver', 'Median lap', 'Gap', 'Clean laps', ...Array.from({length: k}, (_, i) => `Stint ${i + 1}`)];
    return el('div', {class: 'card lab pace'}, el('h2', {}, 'Race pace and tyre wear'), intro,
      el('p', {class: 'muted small'}, hasStops
        ? `Each stint: the lap time's slope on tyre age in s/lap, ± its standard error, from at least 5 clean laps. "est." adds ${fuel.toFixed(3)} s/lap for fuel burn (0.03 s/kg × 110 kg over ${M.n} laps, the same on every stint), because a car getting lighter hides tyre loss. The slope is measured; the "est." figure is an estimate, and cars before 2014 carried more fuel.`
        : `${NO_STOPS(year)}, so stints can't be split and tyre wear isn't fitted: this is the pace ranking only.`),
      el('p', {class: 'muted small'}, year < 2023 ? 'No tyre compounds: OpenF1\'s records of them start in 2023.'
        : 'Tyre compounds aren\'t shown: here they only come with a full GPS replay, about 30 requests to build, too many to spend on a table.'),
      el('div', {class: 'ledgerbar'}, csvButton(`pace_${year}_${round}`, head, () => rows.map((r, i) => [i + 1, label(r.id), +r.median.toFixed(3), i ? +(r.median - rows[0].median).toFixed(3) : '', r.n,
        ...Array.from({length: k}, (_, j) => stintText(r.stints[j]))]))),
      el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
        el('thead', {}, el('tr', {}, head.map(th))),
        el('tbody', {}, rows.map((r, i) => el('tr', {},
          el('td', {class: 'num'}, i + 1),
          el('td', {}, chip(color(r.id)), el('b', {}, label(r.id))),
          el('td', {class: 'num'}, lapTime(r.median)),
          el('td', {class: 'num'}, i ? `+${(r.median - rows[0].median).toFixed(3)}` : ''),
          el('td', {class: 'num'}, r.n),
          ...Array.from({length: k}, (_, j) => el('td', {class: 'stintcell'}, stintCell(r.stints[j])))))))));
  }

  const stintText = s => (!s ? '' : `L${s.from}-${s.to} ${s.slope === null ? `${s.n} clean` : `${s.slope.toFixed(3)} s/lap ±${s.se.toFixed(3)}, est. ${s.corrected.toFixed(3)}`}`);

  function stintCell(s) {
    if (!s) return null;
    const laps = el('span', {class: 'muted small'}, `L${s.from}–${s.to}`);
    if (s.slope === null) return [laps, el('br'), el('span', {class: 'muted small'}, `${s.n} clean: too few`)];
    return [laps, ' ', `${slope(s.slope)} ±${s.se.toFixed(3)}`, el('br'), el('span', {class: 'muted small'}, `est. ${slope(s.corrected)}`)];
  }

  function ledgerCard() {
    const card = (...body) => el('div', {class: 'card lab ledger'}, el('h2', {}, 'Undercut ledger'), ...body);
    if (!pits.length) return card(el('p', {class: 'empty'}, `${NO_STOPS(year)}, so there are no undercuts to measure here.`));
    const rows = undercuts(M).filter(u => ids.includes(u.a) && info[u.b]);
    const gapText = g => `${Math.abs(g).toFixed(1)} s ${g > 0 ? 'behind' : 'ahead'}`;
    return card(el('p', {class: 'muted small'}, 'A car under 4 s behind another stops up to 5 laps before it. Gaps are the first car\'s, on the lap before its stop and the lap after the other car\'s; it worked if it came out ahead. Windows with SC/VSC laps, missing laps, another stop or a swing over 15 s are left out. Pick a row to load that driver into the what-if above.'),
      rows.length && el('div', {class: 'ledgerbar'}, csvButton(`undercuts_${year}_${round}`, ['Undercutting', 'Undercut', 'Stop lap', 'Other stop lap', 'Gap before (s)', 'Gap after (s)', 'Gain (s)', 'Result'],
        () => rows.map(u => [label(u.a), label(u.b), u.lapA, u.lapB, u.before, u.after, u.gain, u.worked ? 'Worked' : 'Failed']))),
      rows.length ? el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
        el('thead', {}, el('tr', {}, ['Undercut', 'Stops', 'Before', 'After', 'Gain', 'Result'].map(th))),
        el('tbody', {}, rows.map(u => el('tr', {class: 'pick', onclick: () => { load(u.a); driver.focus(); }},
          el('td', {}, el('button', {class: 'rowbtn', type: 'button'}, chip(color(u.a)), el('b', {}, label(u.a)), ' on ', chip(color(u.b)), label(u.b))),
          el('td', {class: 'num'}, `L${u.lapA} / L${u.lapB}`),
          el('td', {class: 'num'}, gapText(u.before)),
          el('td', {class: 'num'}, gapText(u.after)),
          el('td', {class: 'num'}, signed(u.gain)),
          el('td', {}, el('span', {class: u.worked ? 'up' : 'down'}, u.worked ? 'Worked' : 'Failed')))))))
        : el('p', {class: 'empty'}, 'No undercut attempts in this race pass those filters.'));
  }

  draw();
  root.replaceChildren(el('div', {class: 'card lab'},
    el('h2', {}, 'Strategy lab'),
    el('p', {class: 'muted small'}, 'Replay this race with different pit stops. Drag a stop to another lap, add or remove one, or let the lab try every plan. It reruns the real lap times, so the real strategy gives the real result.'),
    el('div', {class: 'controls lab-controls'}, driver, pass, resetBtn, search),
    el('div', {class: 'lab-grid'},
      el('div', {}, stopsBox, verdict, chart,
        el('p', {class: 'legend-line muted small'}, el('span', {class: 'key real'}), 'real race ', el('span', {class: 'key whatif'}), 'what-if ', '● stop'),
        notes),
      el('div', {}, best, el('h3', {}, 'What-if finishing order'), order))),
    paceCard(), ledgerCard());
}
