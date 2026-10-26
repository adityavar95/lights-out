// Data explorer: every raw dataset as a filterable table.
import {get, el} from './util.js';

const SEASON = [['Sessions', y => `/api/season/${y}`], ['F1.com schedule', y => `/api/season/${y}/f1schedule`],
  ['Calendar', y => `/api/jolpica/${y}/races`], ['Drivers', y => `/api/jolpica/${y}/drivers`],
  ['Constructors', y => `/api/jolpica/${y}/constructors`], ['Circuits', y => `/api/jolpica/${y}/circuits`],
  ['Driver standings', y => `/api/jolpica/${y}/driverstandings`], ['Constructor standings', y => `/api/jolpica/${y}/constructorstandings`]];
const ROUND = [['Results', 'results'], ['Qualifying', 'qualifying'], ['Sprint', 'sprint'], ['Laps', 'laps'],
  ['Pit stops', 'pitstops'], ['Driver standings', 'driverstandings'], ['Constructor standings', 'constructorstandings']]
  .map(([label, k]) => [label, (y, r) => `/api/jolpica/${y}/${k}?round=${r}`]);

let ctx, status, table;

export function setupExplorer(root, getContext) {
  ctx = getContext;
  status = el('div', {class: 'xstatus', role: 'status'});
  table = el('table', {class: 'data'});
  const group = (title, defs, urlOf) => el('div', {class: 'xgroup'}, el('b', {}, title),
    defs.map(([label, f]) => el('button', {class: 'pill', onclick: e => { const u = urlOf(f); if (u) show(u, e.target); }}, label)));
  root.append(
    group('Season', SEASON, f => f(ctx().year)),
    group('Round', ROUND, f => f(ctx().year, ctx().round)),
    group('Live', [['Live timing (current session)', () => `/api/live?ts=${Date.now()}`]], f => f()),
    status, el('div', {class: 'tablewrap tall'}, table));
}

async function show(url, btn) {
  document.querySelectorAll('.xgroup .pill.on').forEach(b => b.classList.remove('on'));
  btn?.classList.add('on');
  status.className = 'xstatus';
  status.textContent = 'Loading…';
  table.replaceChildren();
  try {
    const t = await get(url);
    if (!t.columns) return topics(t);
    render(t);
    const filter = el('input', {placeholder: 'Filter rows…', 'aria-label': 'Filter rows', oninput: () => {
      const q = filter.value.toLowerCase();
      for (const tr of table.tBodies[0]?.rows || []) tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
    }});
    const csv = el('button', {class: 'pill', title: 'Download these rows as CSV', onclick: () => {
      const q = v => `"${cell(v).replaceAll('"', '""')}"`;
      const a = el('a', {href: URL.createObjectURL(new Blob([[t.columns, ...t.data].map(r => r.map(q).join(',')).join('\n')], {type: 'text/csv'})),
        download: `${url.split('?')[0].slice(5).replaceAll('/', '_')}.csv`});
      a.click();
      URL.revokeObjectURL(a.href);
    }}, '⤓ CSV');
    status.replaceChildren(el('span', {}, `${t.total} rows${t.total > t.data.length ? `, showing first ${t.data.length}` : ''}`), filter, csv);
  } catch (e) {
    status.className = 'xstatus err';
    status.textContent = e.message;
  }
}

function topics(live) {
  const names = Object.keys(live.topics);
  if (!names.length) return status.replaceChildren(live.error ? `Live timing unavailable: ${live.error}` : 'No live timing data yet.');
  // ts defeats get()'s cache: live tables change every second
  status.replaceChildren('Live timing topics: ', ...names.map(n =>
    el('button', {class: 'pill', onclick: e => show(`/api/live/table/${encodeURIComponent(n)}?ts=${Date.now()}`, e.target)}, n)));
}

function cell(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? (x.name ?? JSON.stringify(x)) : x).join(', ');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function render(t) {
  table.replaceChildren(
    el('thead', {}, el('tr', {}, t.columns.map(c => el('th', {}, c)))),
    el('tbody', {}, t.data.map(r => el('tr', {}, r.map(v => {
      const s = cell(v);
      return el('td', {}, /^https:\/\/media\.formula1\.com\/.*image/.test(s) ? el('img', {src: s, alt: '', class: 'thumb'}) : s);
    })))));
}
