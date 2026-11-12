// The address as shareable state: #year/round/tab[?t=&focus=&session=&cmp=]. Pure. A link is someone else's input, so every
// value is checked here and a bad one is dropped alone; only the names below can be written, so a token (#f1tv=) never is.
export const TABS = ['replay', 'results', 'lapchart', 'strategy', 'standings', 'drivers', 'explorer', 'sim',
  'qualifying'];  // qualifying: links from before it joined Results
export const SESSIONS = ['Practice 1', 'Practice 2', 'Practice 3', 'Sprint Qualifying', 'Sprint Shootout', 'Sprint', 'Qualifying', 'Race'];
const MAX_T = 86400;  // a day: longer than any session, red flags included
const DRIVER = /^[A-Za-z0-9_-]{1,24}$/;

const pick = (v, ok) => (ok(v) ? v : undefined);
const validCmp = c => Array.isArray(c) && c.length === 2 && c.every(x => DRIVER.test(x?.driver) && Number.isInteger(x?.lap) && x.lap >= 1 && x.lap <= 200);

// what's fit to read or write: anything else is left out
function clean({stream, year, round, tab, t, focus, session, cmp}) {
  if (stream) return {stream: true};
  return {
    year: pick(String(year), y => /^\d{4}$/.test(y) && +y >= 1950 && +y <= 2100),
    round: pick(String(round), r => /^[1-9]\d?$/.test(r)),
    tab: pick(tab, x => TABS.includes(x)),
    t: pick(t, x => Number.isFinite(x) && x >= 0 && x <= MAX_T),
    focus: pick(focus, x => DRIVER.test(x)),
    session: pick(session, x => SESSIONS.includes(x)),
    cmp: pick(cmp, validCmp),
  };
}

// strict: Number() would take '', '1e3', '0x10' and 'Infinity'
const number = s => (/^\d+(\.\d+)?$/.test(s ?? '') ? +s : undefined);
function pairs(s) {
  const parts = (s ?? '').split(',').map(p => p.match(/^([^:]+):(\d+)$/));
  return parts.every(Boolean) ? parts.map(m => ({driver: m[1], lap: +m[2]})) : undefined;
}

export function parseHash(hash = '') {
  const raw = hash.replace(/^#/, ''), q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q), params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1));
  if (path === 'stream') return {stream: true};
  const [year, round, tab] = path.split('/');
  return clean({year, round, tab, t: number(params.get('t')), focus: params.get('focus'), session: params.get('session'), cmp: pairs(params.get('cmp'))});
}

// whether the replay (replay.js moment()) is still where a link put it: its session, and its time once there is one
export const held = (link, now) => (link.session ?? 'Race') === (now.session ?? 'Race')
  && (link.t === undefined || now.t === undefined || Math.abs(now.t - link.t) <= 1);

export function formatHash(state) {
  const s = clean(state);
  if (s.stream) return '#stream';
  if (!s.year) return '';
  const params = new URLSearchParams();
  if (s.t !== undefined) params.set('t', Math.round(s.t * 10) / 10);
  if (s.focus) params.set('focus', s.focus);
  if (s.session) params.set('session', s.session);
  if (s.cmp) params.set('cmp', s.cmp.map(c => `${c.driver}:${c.lap}`).join(','));
  const query = params.toString().replaceAll('%3A', ':').replaceAll('%2C', ',');  // a readable compare pair
  return `#${[s.year, s.round, s.round && s.tab].filter(Boolean).join('/')}${query ? `?${query}` : ''}`;
}
