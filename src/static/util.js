// @ts-check
// Shared helpers: fetching, team colours, flags, formatting.

const cache = new Map(), MAX = 200;
// live URLs carry a one-off ?ts=, so nothing rereads them: 1 is as good as none
const KEEP = [['/api/replay/', 2], ['/api/telemetry/', 4], ['/api/f1tv/telemetry/', 8], ['/api/live', 1]];  // [url prefix, how many kept]
// this season's tables and F1 TV lists change as weekends run, past seasons' don't (5 min: the server's own cache of them)
const TTL = 5 * 60e3;
// the year is read on each call: a tab open past New Year must not keep the old season as "this season"
const fresh = url => new RegExp(`^/api/(jolpica|season|f1tv)/${new Date().getFullYear()}\\b`).test(url);

// the race whose replay is downloading ({key, ctl}): opening another race's aborts it, so fast clicks through the calendar
// don't run several 5 MB downloads side by side. A race's lap replay (&laps=1) and GPS replay share one.
let replay = null;

export async function get(url) {
  if (!cache.has(url) || (fresh(url) && Date.now() - cache.get(url).at > TTL)) {
    let signal;
    if (url.startsWith('/api/replay/')) {
      const key = url.replace(/&laps=1$/, '');
      if (replay?.key !== key) { replay?.ctl.abort(); replay = {key, ctl: new AbortController()}; }
      signal = replay.ctl.signal;
    }
    // a replay with the F1 TV token is built from F1's own archive, 2018 on (archive.py)
    const headers = url.startsWith('/api/replay/') ? tvHeaders() : {};
    cache.set(url, Object.assign(fetch(url, {signal, headers}).then(async res => {
      const body = await res.json().catch(e => { if (e.name === 'AbortError') throw e; return {}; });  // an aborted body isn't an empty answer
      // FastAPI's validation errors (422) send detail as a list
      if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `${res.status} ${res.statusText}`);
      return body;
    }), {at: Date.now()}));
    cache.get(url).catch(() => cache.delete(url));  // let failed requests be retried
    // replays (several MB) and telemetry (0.3-3 MB a driver) keep their last few, not every one opened since the page loaded
    const keep = KEEP.find(([prefix]) => url.startsWith(prefix));
    if (keep) for (const k of [...cache.keys()].filter(k => k.startsWith(keep[0])).slice(0, -keep[1])) cache.delete(k);
    if (cache.size > MAX) cache.delete(cache.keys().next().value);  // the oldest: every race opened left its tables here for the tab's life
  }
  return cache.get(url);
}

// a replay cached before an F1 TV sign-in (or Disconnect) was built from other data: archive GPS with a token, laps without
export function forgetReplays() {
  for (const k of [...cache.keys()]) if (k.startsWith('/api/replay/')) cache.delete(k);
}

// a failed load's message in plain words: browsers report no connection as "Failed to fetch" and the like
export function plain(msg) {
  const m = String(msg?.message ?? msg);
  if (/failed to fetch|networkerror|load failed|network request/i.test(m)) return "Can't reach the server. Check your connection and that the app is still running.";
  if (/^429\b/.test(m)) return 'Too many requests for now. Try again in a minute.';
  if (/^5\d\d\b/.test(m)) return 'The server had a problem. Try again in a moment.';
  return m;
}

// what a view shows when its data didn't load, with a way to ask again (get() has dropped the failed fetch from its cache)
export const failed = (msg, retry) => el('div', {class: 'empty err', role: 'alert'}, el('p', {}, plain(msg)),
  retry && el('button', {class: 'pill', onclick: retry}, 'Retry'));

// the F1 TV token the Connect bookmarklet brought back (f1auth.py): kept for this tab only, sent with each request
export function tvHeaders() {
  try { const t = sessionStorage.getItem('f1tv'); return t ? {'X-F1-Token': t} : {}; } catch (e) { return {}; }
}

// {columns, data} table -> array of row objects
export const rows = t => t.data.map(r => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));

// for what's written every frame: a write of the same value still dirties style and layout (Play wrote ~16k a second)
export const setAttr = (e, k, v) => { v = String(v); if (e.getAttribute(k) !== v) e.setAttribute(k, v); };
export const setText = (e, v) => { v = String(v); if (e.textContent !== v) e.textContent = v; };

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

// One anonymous usage count on our own server (/api/count, server.py EVENTS): the event's name and nothing else. None
// when the browser asks not to be tracked (Do Not Track, Global Privacy Control).
export function count(event) {
  if (navigator.doNotTrack === '1' || /** @type {any} */ (navigator).globalPrivacyControl) return;
  try { navigator.sendBeacon(`/api/count/${event}`); } catch (e) { /* counts are best effort */ }
}

// a popover menu opening above its invoker (popovertarget): the 3D stage's control deck sits at the bottom of the stage.
// A menu invoked from the right half lines up with its invoker's right edge, so it doesn't run off screen.
export function dropUp(button, menu) {
  menu.addEventListener('toggle', e => {
    button.setAttribute('aria-expanded', e.newState === 'open');
    if (e.newState !== 'open') return;
    const r = button.getBoundingClientRect(), right = r.left > innerWidth / 2;
    Object.assign(menu.style, {left: right ? 'auto' : `${r.left}px`, right: right ? `${innerWidth - r.right}px` : 'auto',
      bottom: `${innerHeight - r.top + 8}px`});
  });
}

// a modal dialog (the F1 TV viewer) covers the whole page: the 3D stage behind it needn't draw (getElementsByTagName is
// a cached live list, so this is cheap every frame)
export const covered = () => document.body.dataset.section === 'stream'  // the Stream page hides the stage too
  || document.body.dataset.globe === 'on'  // and the globe (globe.js), until its flight has a circuit to fade into
  || [...document.getElementsByTagName('dialog')].some(d => d.matches(':modal'));

// placeholder bars in the shape of the rows to come, not a spinner: the layout doesn't jump when they land
export const skeleton = (bars = 7) => el('div', {class: 'skeleton', role: 'status', 'aria-label': 'Loading…'}, ...Array.from({length: bars}, () => el('i')));

// a sortable table's header cell: the button makes it reachable by keyboard; app.js sorts on its click
export const th = text => el('th', {scope: 'col'}, el('button', {class: 'thsort', type: 'button'}, text));

// a table cell's text (explorer.js shows it, the CSV exports it)
export function cellText(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? (x.name ?? JSON.stringify(x)) : x).join(', ');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// A spreadsheet runs a cell starting = + - @ as a formula, and these cells hold other people's text: the leading ' makes it
// plain text. A JS number can't be a formula, so it stays a number a sheet can add up; strings like '+5.123' get the '.
const csvCell = v => {
  const s = typeof v === 'number' ? String(v) : cellText(v).replace(/^\s*[=+\-@]/, "'$&");
  return `"${s.replaceAll('"', '""')}"`;
};
export const toCsv = (columns, rows) => [columns, ...rows].map(r => r.map(csvCell).join(',')).join('\n');

// rows(): read at the click, so a table that hasn't been downloaded costs nothing
export const csvButton = (name, columns, rows) => el('button', {class: 'pill', title: 'Download these rows as CSV', onclick: () => {
  const a = el('a', {href: URL.createObjectURL(new Blob([toCsv(columns, rows())], {type: 'text/csv'})), download: `${name}.csv`});
  a.click();
  URL.revokeObjectURL(a.href);
}}, '⤓ CSV');

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

// black or white, whichever reads better on a #rrggbb fill (WCAG: equal contrast at relative luminance 0.179)
export function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
}

export function teamColor(teamId = '', fallbackName = '') {
  if (TEAM_COLORS[teamId]) return TEAM_COLORS[teamId];
  let h = 0;
  for (const ch of teamId || fallbackName) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 65%, 58%)`;  // commas: three.js can't parse the space-separated form (the 3D car came out white)
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
  return iso ? el('img', {class: 'flag', src: `/static/assets/flags/w${size}/${iso}.png`, alt: `${country} flag`}) : null;
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

// a signed number with a typographic minus: +1.2 / −1.2; zero: what 0 is prefixed with. dp undefined: as is
export const signed = (v, dp, zero = '+') => `${v > 0 ? '+' : v < 0 ? '−' : zero}${dp === undefined ? Math.abs(v) : Math.abs(v).toFixed(dp)}`;

// table cells in sort order (app.js sortTable): signed numbers (either minus, a trailing s or %) by value, else text with
// its digits as numbers (lap times, names)
const cellNum = c => { const m = /^([+±−-]?)(\d*\.?\d+)\s*(s|%)?$/.exec(c); return m ? (/[−-]/.test(m[1]) ? -m[2] : +m[2]) : NaN; };
export function cellOrder(x, y) {
  const n = x !== '' && y !== '' ? cellNum(x) - cellNum(y) : NaN;
  return Number.isNaN(n) ? x.localeCompare(y, undefined, {numeric: true}) : n;
}

export const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, {day: 'numeric', month: 'short'});

// race-control messages ([t, cat, flag, text], sorted by t) already at or before t: the next one to announce
export function rcIndex(rc, t) {
  let i = 0;
  while (i < rc.length && rc[i][0] <= t) i++;
  return i;
}

// a race-control banner's colour. \bRED\b: "CHEQUERED" contains RED
export const bannerKind = text => (/SAFETY CAR|VSC|YELLOW/.test(text) ? 'yellow' : /CHEQUERED/.test(text) ? 'chequered' : /\bRED\b/.test(text) ? 'red'
  : /SLIPPERY/.test(text) ? 'amber' : /PIT WINDOW/.test(text) ? 'blue' : /DISABLED/.test(text) ? 'grey' : 'green');

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
    if (cat === 'SafetyCar') s = m.includes('VIRTUAL') || m.includes('VSC') ? (m.includes('ENDING') ? 'VSC ENDING' : 'VSC') : (m.includes('IN THIS LAP') ? 'SC IN' : 'SC');
    else if (flag === 'RED' || m === 'SESSION ABORTED' || m.startsWith('RED FLAG')) s = 'RED';  // some races carry it only in these messages
    else if (flag === 'CHEQUERED') s = 'CHEQUERED';
    else if (s === 'RED') { if (m === 'SESSION STARTED' || m === 'SESSION RESUMED') s = 'GREEN'; }  // track-clear messages come during a stoppage
    else if ((flag === 'GREEN' && m.includes('GREEN LIGHT')) || m.includes('TRACK CLEAR')) s = 'GREEN';
  }
  return s;
}

// an FIA race-control message in sentence case, the flag word that leads it dropped when the chip already says it:
// "CLEAR IN TRACK SECTOR 12" with flag CLEAR -> "In track sector 12". "(NOR)" and the acronyms stay capitals
const RC_CAPS = new Set(['DRS', 'SC', 'VSC', 'FIA', 'DNF', 'RC']);
export function rcText(msg, flag) {
  let m = String(msg ?? '').trim();
  if (flag && m.toUpperCase().startsWith(`${flag.toUpperCase()} IN `)) m = m.slice(flag.length + 1);  // "CLEAR IN TRACK SECTOR 12", not "GREEN LIGHT"
  const out = m.split(' ').map(w => (/^\([A-Z]{3}\)/.test(w) || /^[A-Z]+\d+$/.test(w) || RC_CAPS.has(w.replace(/[^A-Z]/g, '')) ? w : w.toLowerCase())).join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// Sonner-style toast: notices stack bottom-centre, slide in, pause their timer while hovered, slide out. ms 0 = stays.
import {play, spring} from './motion.js';
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function toast(children, ms = 5000) {
  let box = document.querySelector('.toasts');
  if (!box) document.body.append(box = el('div', {class: 'toasts'}));
  const n = el('div', {class: 'notice', role: 'status'}, ...children);
  let timer;
  n.style.opacity = 0;  // hidden until the entry plays, so it never flashes before motion.js loads
  const close = () => { clearTimeout(timer); play(n, {opacity: 0, translateY: 8, duration: 180, ease: 'linear'}).finally(() => n.remove()); };  // goes even if anime.js can't load
  const arm = () => { if (ms) timer = setTimeout(close, ms); };
  n.onmouseenter = () => clearTimeout(timer);
  n.onmouseleave = arm;
  n.close = close;
  box.append(n);
  arm();
  spring().then(ease => play(n, {opacity: [0, 1], translateY: [24, 0], duration: 600, ease})).catch(() => { n.style.opacity = ''; });
  return n;
}

// NumberFlow-style: sets node's text one span per character, rolling in only the characters that changed
export function roll(node, text) {
  const old = [...node.children].map(s => s.textContent).join('');
  node.setAttribute('aria-label', text);
  node.replaceChildren(...[...text].map((c, i) => el('span', {class: old && c !== old[i] && !calm() ? 'roll' : '', 'aria-hidden': 'true'}, c)));
}

// What a run race can replay, as replay.py decides (app.js tags the race list with it before the stage loads): every car's GPS position (OpenF1, 2023 on), positions from lap
// times (Jolpica's laps, races from 1996), or nothing but results before that. null: not run yet.
export const REPLAY_KINDS = {gps: ['3D GPS', "Every car's real position on track"], laps: ['Lap replay', 'Positions worked out from lap times'],
  results: ['Results only', 'No lap timing before 1996: results, standings and drivers']};
export const replayKind = (year, date) => date > new Date().toISOString().slice(0, 10) ? null : year >= 2023 ? 'gps' : year >= 1996 ? 'laps' : 'results';
