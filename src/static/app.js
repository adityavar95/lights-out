// App shell: the Watch / Simulate switch, race dropdown, race header and tabs. Watch is the race browser (replays of
// real sessions, results, standings, live timing); Simulate drops the browser chrome for a full-window physics race
// on the chosen circuit (circuit and car pickers on the stage, season = the cars' era).
import {get, rows, el, flag, fmtDate, teamColor} from './util.js';
import {setupReplay, showRace, showLive, setSessions} from './replay.js';
import {fetchLive, liveInfo} from './live.js';
import {renderResults, renderQualifying, renderLapChart, renderStandings} from './charts.js';
import {setupExplorer} from './explorer.js';
import {renderStrategyLab} from './strategylab.js';
import {openViewer, loadShaka} from './multiviewer.js';

const $ = id => document.getElementById(id);
const A = {year: null, round: null, races: [], mode: 'watch'};
const today = new Date().toISOString().slice(0, 10);
const ORDER = ['Practice 1', 'Practice 2', 'Practice 3', 'Sprint Qualifying', 'Sprint Shootout', 'Sprint', 'Qualifying', 'Race'];
const jol = (kind, round) => get(`/api/jolpica/${A.year}/${kind}${round ? `?round=${round}` : ''}`).then(rows);
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };  // 1st 2nd 3rd 4th 11th 21st

// Each tab fetches its data, then returns a function that draws it (skipped if the user moved on meanwhile).
const TABS = {
  results: async r => { const [res, spr] = await Promise.all([jol('results', r), jol('sprint', r)]); return () => renderResults($('tab-results'), res, spr); },
  qualifying: async r => { const q = await jol('qualifying', r); return () => renderQualifying($('tab-qualifying'), q); },
  lapchart: async r => {
    const [laps, res, pits] = await Promise.all([jol('laps', r), jol('results', r), jol('pitstops', r)]);
    return () => renderLapChart($('tab-lapchart'), laps, res, pits);
  },
  strategy: async r => {  // same three Jolpica tables as the lap chart, so switching between them is free
    const [laps, res, pits] = await Promise.all([jol('laps', r), jol('results', r), jol('pitstops', r)]);
    const year = A.year;
    return () => renderStrategyLab($('tab-strategy'), laps, res, pits, year);
  },
  standings: async r => {
    const [d, c] = await Promise.all([jol('driverstandings', r), jol('constructorstandings', r).catch(() => [])]);
    return () => renderStandings($('tab-standings'), d, c);
  },
};
let active = 'replay', drawn = {};
// the address keeps the race and tab (#2026/18/results), so a reload or a shared link lands on the same view
const syncHash = () => A.round && history.replaceState(null, '', `#${A.year}/${A.round}/${active}`);

function activate(name) {
  const swap = () => {
    for (const b of document.querySelectorAll('[role=tab]')) {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      $(`tab-${b.dataset.tab}`).hidden = !on;
    }
  };
  // a real tab change cross-fades the panels (View Transitions); older browsers and reduced motion just swap
  // a hidden page (or a transition still running) aborts it with a rejected promise: swap() has run either way
  if (name !== active && document.startViewTransition && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches)
    document.startViewTransition(swap).ready.catch(() => {});
  else swap();
  active = name;
  syncHash();
  drawTab(name);
}

const THEMES = [['auto', '◐', 'Theme: follows the system'], ['light', '☀', 'Theme: light'], ['dark', '☾', 'Theme: dark']];
function setTheme(t) {
  document.documentElement.dataset.theme = t;  // 'auto' matches neither CSS scheme selector, so the system decides
  const [, icon, title] = THEMES.find(x => x[0] === t) ?? THEMES[0];
  Object.assign($('themebtn'), {textContent: icon, title});
  $('themebtn').setAttribute('aria-label', title);
  try { localStorage.setItem('f1theme', t); } catch (e) { /* storage blocked: not remembered */ }
}

// an upcoming race: time to lights out in the hero's podium slot, refreshed every half minute until the race starts
function countdown(r) {
  const at = new Date(`${r.date}T${r.time || '00:00:00Z'}`), box = el('div', {class: 'countdown'});
  const tick = () => {
    const s = (at - Date.now()) / 1000;
    if (s <= 0 || String(A.round) !== r.round) { clearInterval(timer); return box.replaceChildren(el('span', {class: 'muted'}, s <= 0 ? 'Race under way' : '')); }
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    box.replaceChildren(el('small', {class: 'muted'}, 'LIGHTS OUT IN'), el('b', {}, `${d ? `${d}d ` : ''}${h}h ${String(m).padStart(2, '0')}m`));
  };
  const timer = setInterval(tick, 30000);
  tick();
  return box;
}

// any data table sorts by a clicked header: numbers and lap times compare numerically, text alphabetically
function sortTable(th) {
  const table = th.closest('table'), body = table.tBodies[0], i = th.cellIndex;
  const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
  for (const h of table.tHead.rows[0].cells) h.removeAttribute('aria-sort');
  th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
  const key = tr => tr.cells[i]?.textContent.trim() ?? '';
  body.append(...[...body.rows].sort((a, b) => dir * key(a).localeCompare(key(b), undefined, {numeric: true})));
}

async function drawTab(name) {
  if (!TABS[name] || drawn[name]) return;
  drawn[name] = true;
  const panel = $(`tab-${name}`), key = `${A.year}/${A.round}`;
  // skeleton rows in the shape of the table/chart to come, not a spinner: the layout doesn't jump when it lands
  panel.replaceChildren(el('div', {class: 'skeleton', role: 'status', 'aria-label': 'Loading…'}, ...Array.from({length: 7}, () => el('i'))));
  try {
    const draw = await TABS[name](A.round);
    if (key === `${A.year}/${A.round}`) draw();
  } catch (e) {
    drawn[name] = false;
    if (key === `${A.year}/${A.round}`) panel.replaceChildren(el('p', {class: 'empty err'}, e.message));
  }
}

// Watch or Simulate; reload: show the current race in the new mode (callers about to open a race themselves skip it)
function setMode(mode, reload = true) {
  A.mode = mode;
  document.body.dataset.mode = mode;
  for (const b of document.querySelectorAll('[data-appmode]')) b.setAttribute('aria-pressed', b.dataset.appmode === mode);
  try { localStorage.setItem('f1mode', mode); } catch (e) { /* storage blocked: the mode just isn't remembered */ }
  if (reload && A.round) selectRace(A.round);
}

// round: the race to open (default: the latest one run), sim: open it as a Simulation
async function loadSeason(year, round = null, sim = A.mode === 'sim') {
  A.year = year;
  const cal = $('calendar');
  cal.replaceChildren(el('div', {class: 'loading'}, el('div', {class: 'spinner'}), 'Loading calendar…'));
  try {
    A.races = await jol('races');
  } catch (e) {
    cal.replaceChildren(el('p', {class: 'empty err'}, e.message));
    return;
  }
  const next = A.races.find(r => r.date > today);
  cal.replaceChildren(...A.races.map(r => el('button', {
    class: `racecard ${r.date > today ? 'upcoming' : ''}`, 'data-round': r.round, 'aria-pressed': false,
    onclick: () => { cal.hidePopover(); selectRace(r.round); }},
    el('span', {class: 'rnd'}, ordinal(+r.round)), flag(r['Circuit.Location.country'], 40),
    el('span', {class: 'rc-name'}, el('b', {}, r['Circuit.Location.country']), el('small', {}, `${r.raceName} · ${fmtDate(r.date)}`)),
    r === next ? el('span', {class: 'next'}, 'NEXT') : null)));
  const last = A.races.filter(r => r.date <= today).at(-1) ?? A.races[0];
  if (!A.races.some(r => r.round === String(round))) round = null;  // e.g. a stale link
  if (round ?? last) selectRace(round ?? last.round, sim);
}

async function selectRace(round, sim = A.mode === 'sim') {
  A.round = round;
  drawn = {};
  for (const b of document.querySelectorAll('.racecard')) b.setAttribute('aria-pressed', b.dataset.round === String(round));
  const r = A.races.find(x => x.round === String(round));
  const podium = el('div', {class: 'heropodium'});
  $('hero').replaceChildren(
    el('div', {class: 'heroflag'}, flag(r['Circuit.Location.country'], 160)),
    el('div', {class: 'herotext'},
      el('div', {class: 'eyebrow'}, `ROUND ${r.round} · ${new Date(r.date + 'T00:00:00').toLocaleDateString(undefined, {day: 'numeric', month: 'long', year: 'numeric'})}`),
      el('h1', {}, r.raceName),
      el('div', {class: 'muted'}, `${r['Circuit.circuitName']} · ${r['Circuit.Location.locality']}, ${r['Circuit.Location.country']}`)),
    el('div', {class: 'heroside'}, podium, el('button', {class: 'tvbtn', popovertarget: 'tvlist', 'aria-haspopup': 'true',
      title: 'Watch this race weekend live or replayed on F1 TV'}, '▶ F1 TV')));
  jol('results', round).then(res => {
    if (A.round !== round) return;
    podium.replaceChildren(...(res.length ? res.slice(0, 3).map(x =>
      el('div', {class: `pp p${x.position}`}, el('span', {class: 'pnum'}, `P${x.position}`),
        el('span', {class: 'chip', style: `background:${teamColor(x['Constructor.constructorId'], x['Constructor.name'])}`}),
        el('b', {}, x['Driver.code'] || x['Driver.familyName']))) : [r.date >= today ? countdown(r) : el('span', {class: 'muted'}, 'No results yet')]));
  }).catch(() => {});

  $('racebtn').replaceChildren(el('span', {class: 'rnd'}, ordinal(+r.round)), flag(r['Circuit.Location.country'], 40),
    el('b', {}, r['Circuit.Location.country']), el('span', {class: 'caret', 'aria-hidden': 'true'}, '▾'));
  showRace(A.year, round, ['Race'], sim);
  activate(sim ? 'replay' : active);
  // Load session choices after showing the race; only 2023+ (OpenF1) sessions can be replayed, and older seasons'
  // lists come from livef1, which takes ~40 s per season.
  const year = A.year;
  if (!sim && year >= 2023) get(`/api/season/${year}`).then(t => {
    if (A.year !== year || A.round !== round) return;
    const rank = s => (ORDER.indexOf(s['Session Name']) + 1) || 99;  // livef1's start dates aren't reliable enough to sort by
    const list = rows(t).filter(s => s.Round === String(round)).sort((a, b) => rank(a) - rank(b));
    if (list.length) setSessions(list.map(s => s['Session Name']));
  }).catch(() => {});
}

async function init() {
  // the season list and this season's calendar are requested before the 3D stage is set up (~0.3 s of main thread)
  const seasons = get('/api/seasons');
  get(`/api/jolpica/${today.slice(0, 4)}/races`).catch(() => {});
  setupReplay($('tab-replay'));
  setupExplorer($('tab-explorer'), () => ({year: A.year, round: A.round}));
  const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  setMode(stored('f1mode') === 'sim' ? 'sim' : 'watch', false);
  setTheme(stored('f1theme') ?? 'auto');
  $('themebtn').onclick = () => setTheme(THEMES[(THEMES.findIndex(x => x[0] === document.documentElement.dataset.theme) + 1) % THEMES.length][0]);
  document.addEventListener('click', e => { const th = e.target.closest('table.data th'); if (th) sortTable(th); });
  const [hashYear, hashRound, hashTab] = location.hash.slice(1).split('/');
  if (TABS[hashTab] || hashTab === 'replay') active = hashTab;
  $('calendar').addEventListener('toggle', e => {  // the race list opens under its button, at the race shown
    if (e.newState !== 'open') return;
    const r = $('racebtn').getBoundingClientRect();
    Object.assign(e.target.style, {left: `${r.left}px`, top: `${r.bottom + 6}px`});
    e.target.querySelector('[aria-pressed=true]')?.scrollIntoView({block: 'center'});
  });
  $('tvlist').addEventListener('toggle', e => {  // the race's F1 TV videos, fetched when first opened for that race
    if (e.newState !== 'open') return;
    loadShaka().catch(() => {});  // the video player downloads while you pick, not after
    const list = e.target, b = document.querySelector('.tvbtn').getBoundingClientRect(), key = `${A.year}/${A.round}`;
    Object.assign(list.style, {left: `${Math.max(8, b.right - list.offsetWidth)}px`, top: `${b.bottom + 6}px`});
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.replaceChildren(el('div', {class: 'loading'}, el('div', {class: 'spinner'}), 'Loading F1 TV…'));
    get(`/api/f1tv/${key}`).then(v => list.dataset.key === key && list.replaceChildren(...tvItems(v))).catch(err => {
      list.dataset.key = '';
      list.replaceChildren(el('p', {class: 'empty err'}, err.message));
    });
  });
  for (const b of document.querySelectorAll('[data-appmode]')) b.onclick = () => A.mode !== b.dataset.appmode && setMode(b.dataset.appmode);
  $('livebtn').onclick = () => {
    setMode('watch', false);
    for (const b of document.querySelectorAll('.racecard')) b.setAttribute('aria-pressed', false);
    $('hero').replaceChildren(el('div', {class: 'herotext'},
      el('div', {class: 'eyebrow'}, 'LIVE TIMING'), el('h1', {}, $('livebtn').title)));
    activate('replay');
    showLive();
  };
  checkLive();
  setInterval(checkLive, 60000);
  // the circuit selector (circuitdeck.js): a simulation at that circuit's latest race, switching season if needed
  addEventListener('f1:circuit', ({detail: {year, round}}) => {
    setMode('sim', false);
    activate('replay');
    if (A.year === year) return selectRace(String(round), true);
    $('year').value = year;
    loadSeason(year, String(round), true);
  });
  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach((b, i) => {
    b.onclick = () => activate(b.dataset.tab);
    b.onkeydown = e => {
      const d = {ArrowRight: 1, ArrowLeft: -1}[e.key];
      if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); activate(n.dataset.tab); }
    };
  });
  const years = (await seasons).slice().reverse();
  const sel = $('year');
  sel.replaceChildren(...years.map(y => new Option(y, y)));
  sel.value = years.includes(hashYear) ? hashYear : years.includes(today.slice(0, 4)) ? today.slice(0, 4) : years[0];
  sel.onchange = () => loadSeason(+sel.value);
  loadSeason(+sel.value, sel.value === hashYear ? hashRound || null : null);
}

// header button: red while a session is running, otherwise it opens the most recent session's final state
async function checkLive() {
  try {
    const info = liveInfo((await fetchLive()).topics);
    const btn = $('livebtn');
    btn.hidden = false;
    btn.classList.toggle('on', info.live);
    btn.textContent = info.live ? '● LIVE' : 'Latest session';
    btn.title = info.title;
  } catch (e) { /* live timing unreachable: keep the button hidden */ }
}

// what an F1 TV video is, in plain words: F1 TV files every session and the studio shows round it as REPLAY
function tvLabel(v) {
  const t = v.title.toLowerCase();
  if (v.kind === 'REPLAY') return /show|warm-up/.test(t) ? 'Show' : /sprint (qualifying|shootout)/.test(t) ? 'Sprint quali'
    : /sprint/.test(t) ? 'Sprint' : /qualifying/.test(t) ? 'Qualifying' : /practice|\bfp\d/.test(t) ? 'Practice' : 'Race';
  return {'PRESS CONFERENCE': 'Interview', 'RACE HIGHLIGHTS': 'Highlights', 'EXTENDED HIGHLIGHTS': 'Highlights'}[v.kind]
    ?? v.kind[0] + v.kind.slice(1).toLowerCase();
}
const TV_GROUPS = [['Sessions', ['Race', 'Sprint', 'Sprint quali', 'Qualifying', 'Practice']], ['Highlights', ['Highlights']],
  ['Studio shows', ['Show']], ['Interviews & analysis', ['Interview', 'Analysis']]];

// the race weekend's F1 TV videos (popover under the hero's ▶ F1 TV button): what each one is, its full title, when
// and whether it's live
function tvItems(videos) {
  if (!videos.length) return [el('p', {class: 'empty'}, 'F1 TV has no videos of this race.')];
  const now = Date.now();
  // shortcut: live = within the scheduled session times + 30 min for overruns; F1 TV's own state field reads "Pre-Live" long after
  const state = v => !v.start ? null : v.start > now ? 'Upcoming' : now <= v.end + 1800e3 ? '● LIVE' : 'Replay';
  const when = v => v.start ? new Date(v.start).toLocaleString(undefined, {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : null;
  // a click plays it here in the multiviewer (every channel and onboard); ↗ opens it on F1 TV's own site
  const item = v => {
    const label = tvLabel(v), s = state(v);
    return el('div', {class: 'tvitem'},
      el('span', {class: `tvkind k-${label.split(' ')[0].toLowerCase()}`}, label),
      el('button', {class: 'tvplay', title: `Watch here: ${v.title}`, onclick: () => { $('tvlist').hidePopover(); openViewer({...v, label, year: A.year, round: A.round}); }},
        el('b', {}, v.title),
        el('small', {}, [when(v), s && el('span', {class: s === '● LIVE' ? 'tvlive' : ''}, s), v.tier && `F1 TV ${v.tier}`].filter(Boolean)
          .flatMap((x, i) => i ? [' · ', x] : [x]))),
      el('a', {href: v.url, target: '_blank', rel: 'noopener', title: 'Open on f1tv.formula1.com', 'aria-label': `Open ${v.title} on F1 TV`}, '↗'));
  };
  const known = TV_GROUPS.flatMap(g => g[1]);
  return [...TV_GROUPS, ['More', null]].flatMap(([name, labels]) => {
    const list = videos.filter(v => labels ? labels.includes(tvLabel(v)) : !known.includes(tvLabel(v)));
    return list.length ? [el('h4', {}, name), ...list.map(item)] : [];
  });
}

init();
