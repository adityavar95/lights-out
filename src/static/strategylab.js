// Strategy Lab tab: move one driver's pit stops in a real race and see where they'd have finished (whatif.js), or
// search every 1-3 stop plan for the best one.
import {el, svg, teamColor} from './util.js';
import {raceModel, simulate, optimise, ranked, PASS, SC_LOSS} from './whatif.js';

const code = r => r['Driver.code'] || r['Driver.familyName'].slice(0, 3).toUpperCase();
const chip = color => el('span', {class: 'chip', style: `background:${color}`});
const signed = s => `${s > 0 ? '+' : s < 0 ? '−' : '±'}${Math.abs(s).toFixed(1)} s`;

export function renderStrategyLab(root, laps, results, pits, year) {
  if (!laps.length || !results.length) return root.replaceChildren(el('p', {class: 'empty'}, 'No lap-by-lap timing for this race (Jolpica has it from 1996 onwards).'));
  const M = raceModel(laps, pits);
  const info = Object.fromEntries(results.map(r => [r['Driver.driverId'], r]));
  const ids = results.map(r => r['Driver.driverId']).filter(id => M.times[id]?.length > 5);
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
  driver.onchange = () => { S.id = driver.value; S.plan = [...M.stops[S.id]]; best.replaceChildren(); draw(); };
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
    best.replaceChildren(el('h4', {}, 'Best plans found'), ...plans.map(p => el('button', {
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
        ...warnings(res.plan, n));
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

  function warnings(plan, n) {
    const w = [];
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

  draw();
  root.replaceChildren(el('div', {class: 'card lab'},
    el('h3', {}, 'Strategy lab'),
    el('p', {class: 'muted small'}, 'Replay this race with different pit stops. Drag a stop to another lap, add or remove one, or let the lab try every plan. It reruns the real lap times, so the real strategy gives the real result.'),
    el('div', {class: 'controls lab-controls'}, driver, pass, resetBtn, search),
    el('div', {class: 'lab-grid'},
      el('div', {}, stopsBox, verdict, chart,
        el('p', {class: 'legend-line muted small'}, el('span', {class: 'key real'}), 'real race ', el('span', {class: 'key whatif'}), 'what-if ', '● stop'),
        notes),
      el('div', {}, best, el('h4', {}, 'What-if finishing order'), order))));
}
