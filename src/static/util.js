// Shared helpers: fetching, team colours, flags, formatting.

const cache = new Map();

export async function get(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(async res => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `${res.status} ${res.statusText}`);
      return body;
    }));
    cache.get(url).catch(() => cache.delete(url));  // let failed requests be retried
    // replays are several MB each: keep the last two, not every session opened since the page loaded
    if (url.startsWith('/api/replay/')) for (const k of [...cache.keys()].filter(k => k.startsWith('/api/replay/')).slice(0, -2)) cache.delete(k);
  }
  return cache.get(url);
}

// the F1 TV token the Connect bookmarklet brought back (f1auth.py): kept for this tab only, sent with each request
export function tvHeaders() {
  try { const t = sessionStorage.getItem('f1tv'); return t ? {'X-F1-Token': t} : {}; } catch (e) { return {}; }
}

// {columns, data} table -> array of row objects
export const rows = t => t.data.map(r => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  e.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
  return e;
}

// a modal dialog (the F1 TV viewer) covers the whole page: the 3D stage behind it needn't draw (getElementsByTagName is
// a cached live list, so this is cheap every frame)
export const covered = () => document.body.dataset.section === 'stream'  // the Stream page hides the stage too
  || [...document.getElementsByTagName('dialog')].some(d => d.matches(':modal'));

// status light used by every deck's buttons (CSS colours it on/off)
export const led = () => el('i', {class: 'led', 'aria-hidden': 'true'});

export function svg(tag, attrs = {}) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const TEAM_COLORS = {
  red_bull: '#3671C6', ferrari: '#E8002D', mercedes: '#27F4D2', mclaren: '#FF8000', aston_martin: '#229971',
  alpine: '#FF87BC', williams: '#64C4FF', rb: '#6692FF', alphatauri: '#5E8FAA', toro_rosso: '#469BFF',
  sauber: '#52E252', alfa: '#C92D4B', haas: '#B6BABD', racing_point: '#F596C8', force_india: '#F596C8',
  renault: '#FFF500', lotus_f1: '#FFB800', manor: '#ED1C24', marussia: '#ED1C24', virgin: '#ED1C24',
  caterham: '#048646', lotus_racing: '#048646', hrt: '#B2945E', brawn: '#B8FD6E', toyota: '#CC4444',
  bmw_sauber: '#6CD3BF', honda: '#E6E6E6', super_aguri: '#E6E6E6', spyker: '#F27B21', midland: '#F27B21',
  jordan: '#F5D400', jaguar: '#2E8B57', bar: '#E6E6E6', minardi: '#8A8A8A', arrows: '#F27B21',
  prost: '#4169E1', benetton: '#00BFFF', stewart: '#F0F0F0', tyrrell: '#4A6FA5', ligier: '#4169E1',
  audi: '#F50537', cadillac: '#C8A562',
};

export function teamColor(teamId = '', fallbackName = '') {
  if (TEAM_COLORS[teamId]) return TEAM_COLORS[teamId];
  let h = 0;
  for (const ch of teamId || fallbackName) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 58%)`;
}

const ISO = {
  Australia: 'au', Austria: 'at', Azerbaijan: 'az', Bahrain: 'bh', Belgium: 'be', Brazil: 'br', Canada: 'ca',
  China: 'cn', France: 'fr', Germany: 'de', Hungary: 'hu', India: 'in', Italy: 'it', Japan: 'jp', Korea: 'kr',
  Malaysia: 'my', Mexico: 'mx', Monaco: 'mc', Netherlands: 'nl', Portugal: 'pt', Qatar: 'qa', Russia: 'ru',
  'Saudi Arabia': 'sa', Singapore: 'sg', Spain: 'es', Sweden: 'se', Switzerland: 'ch', Turkey: 'tr',
  UAE: 'ae', UK: 'gb', USA: 'us', 'United States': 'us', Argentina: 'ar', 'South Africa': 'za',
  Morocco: 'ma', Vietnam: 'vn',
};

export function flag(country, size = 40) {
  const iso = ISO[country];
  return iso ? el('img', {class: 'flag', src: `https://flagcdn.com/w${size}/${iso}.png`, alt: `${country} flag`}) : null;
}

export function fmtClock(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function fmtLap(s) {
  if (s === null || s === undefined) return '';
  s = Math.round(s * 1000) / 1000;  // else 119.9997 (a simulated lap) prints as 1:60.000
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

export const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, {day: 'numeric', month: 'short'});

// last item with item[0] <= t in an array sorted by item[0]
export function lastBefore(arr, t) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// track status (GREEN, SC, VSC, RED, ...) at time t from race control messages [time, category, flag, message]
export function trackStatus(rc, t) {
  const n = lastBefore(rc, t);
  let s = 'GREEN';
  for (let i = 0; i <= n; i++) {
    const [, cat, flag, msg] = rc[i], m = (msg || '').toUpperCase();
    if (cat === 'SafetyCar') s = m.includes('VIRTUAL') ? (m.includes('ENDING') ? 'VSC ENDING' : 'VSC') : (m.includes('IN THIS LAP') ? 'SC IN' : 'SC');
    else if (flag === 'RED') s = 'RED';
    else if (flag === 'CHEQUERED') s = 'CHEQUERED';
    else if ((flag === 'GREEN' && m.includes('GREEN LIGHT')) || m.includes('TRACK CLEAR')) s = 'GREEN';
  }
  return s;
}
