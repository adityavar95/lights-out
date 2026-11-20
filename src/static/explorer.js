// Data explorer: every raw dataset as a filterable table.
import {get, el, th, skeleton, cellText, csvButton} from './util.js';
import {stagger} from './motion.js';

const SEASON = [['Sessions', y => `/api/season/${y}`],
  ['Calendar', y => `/api/jolpica/${y}/races`], ['Drivers', y => `/api/jolpica/${y}/drivers`],
  ['Constructors', y => `/api/jolpica/${y}/constructors`], ['Circuits', y => `/api/jolpica/${y}/circuits`],
  ['Driver standings', y => `/api/jolpica/${y}/driverstandings`], ['Constructor standings', y => `/api/jolpica/${y}/constructorstandings`]];
const ROUND = [['Results', 'results'], ['Qualifying', 'qualifying'], ['Sprint', 'sprint'], ['Laps', 'laps'],
  ['Pit stops', 'pitstops'], ['Driver standings', 'driverstandings'], ['Constructor standings', 'constructorstandings']]
  .map(([label, k]) => [label, (y, r) => `/api/jolpica/${y}/${k}?round=${r}`]);

let ctx, status, table, request = 0;

export function setupExplorer(root, getContext) {
  ctx = getContext;
  status = el('div', {class: 'xstatus', role: 'status'}, 'Pick a table: the whole season, the race shown, or live timing.');
  table = el('table', {class: 'data'});
  const group = (title, defs, urlOf) => el('div', {class: 'xgroup'}, el('b', {}, title),
    defs.map(([label, f]) => el('button', {class: 'pill', onclick: e => { const u = urlOf(f); if (u) show(u, e.target); }}, label)));
  root.append(
    group('Season', SEASON, f => f(ctx().year)),
    group('Round', ROUND, f => ctx().round && f(ctx().year, ctx().round)),
    group('Live', [['Live timing (current session)', () => `/api/live?ts=${Date.now()}`]], f => f()),
    status, el('div', {class: 'tablewrap tall'}, table));
}

async function show(url, btn) {
  const me = ++request;
  document.querySelectorAll('.xgroup .pill.on').forEach(b => b.classList.remove('on'));
  btn?.classList.add('on');
  status.className = 'xstatus';
  status.replaceChildren(skeleton());
  table.replaceChildren();
  try {
    const t = await get(url);
    if (me !== request) return;  // another table was picked meanwhile
    if (!t.columns) return topics(t);
    render(t);
    stagger(table.querySelectorAll('tbody tr'));
    const all = `${t.total} rows${t.total > t.data.length ? `, showing first ${t.data.length}` : ''}`, shown = el('span', {}, all);
    const filter = el('input', {placeholder: 'Filter rows…', 'aria-label': 'Filter rows', oninput: () => {
      const q = filter.value.toLowerCase();
      let n = 0;
      for (const tr of table.tBodies[0]?.rows || []) {
        tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
        if (!tr.hidden) n++;
      }
      shown.textContent = q ? `${n} of ${t.data.length} rows` : all;
    }});
    const csv = csvButton(url.split('?')[0].slice(5).replaceAll('/', '_'), t.columns, () => t.data);
    status.replaceChildren(shown, filter, csv);
  } catch (e) {
    if (me !== request) return;
    status.className = 'xstatus err';
    status.textContent = e.message;
  }
}

function topics(live) {
  const names = Object.keys(live.topics);
  if (!names.length) return status.replaceChildren(live.error ? `Live timing unavailable: ${live.error}` : 'No live timing data yet.');
  // ts: a fresh fetch each click, since live tables change every second
  status.replaceChildren('Live timing topics: ', ...names.map(n =>
    el('button', {class: 'pill', onclick: e => show(`/api/live/table/${encodeURIComponent(n)}?ts=${Date.now()}`, e.target)}, n)));
}

function render(t) {
  table.replaceChildren(
    el('thead', {}, el('tr', {}, t.columns.map(th))),
    el('tbody', {}, t.data.map(r => el('tr', {}, r.map(v => {
      const s = cellText(v);
      return el('td', {}, /^https:\/\/media\.formula1\.com\/.*image/.test(s) ? el('img', {src: s, alt: '', class: 'thumb'}) : s);
    })))));
}
