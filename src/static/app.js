// App shell: the Races / Simulate / Stream switch (Stream is the F1 TV browse page, stream.js), the Watch / Simulate switch, race dropdown, race header and tabs. Watch is the race browser (replays of
// real sessions, results, standings, live timing); Simulate drops the browser chrome for a full-window physics race
// on the chosen circuit (circuit and car pickers on the stage, season = the cars' era).
import {get, rows, el, flag, fmtDate, cellOrder, teamColor, inkOn, count, failed, skeleton, toast, roll, replayKind, REPLAY_KINDS} from './util.js';
import {renderResults, renderLapChart, renderStandings} from './charts.js';
import {seasonTrends} from './seasonview.js';
import {setupExplorer} from './explorer.js';
import {renderStrategyLab} from './strategylab.js';
import {renderDrivers, decided} from './drivers.js';
import {showStream, noStream, upcoming, until, at, when, SESSIONS} from './stream.js';
import {setupGlass} from './glass.js';
import {capturing} from './input.js';
import {setupPalette, openPalette, openSheet, openCounts, copyLink} from './palette.js';
import {openReaction} from './reaction.js';
import {PRESETS} from './circuits.js';
import {parseHash, formatHash, held} from './share.js';
import {resultLedgers} from './ledgers.js';
import {setupDownloads, startDownload, canDownload} from './downloads.js';
import {spoilerFree, setSpoilerFree, hides, reveal, recent} from './spoilers.js';

// The 3D stage (replay.js, three.js, ~5 MB of JS, then textures and the sky) loads on first need: the replay tab, Play,
// live, the globe, a palette stage command. A link straight to Results or Stream never pulls it.
let R = null, G = null, stageP = null, globeP = null, globeWanted = false;
let staged = null, shownP = null, sessions = null;  // the race the stage is to show (showRace's args), its promise, its session list
const loadStage = () => stageP ??= import('./replay.js').then(m => {
  m.setupReplay($('tab-replay'), copyView);
  R = m;
  if (staged) shownP = m.showRace(...staged);
  if (sessions) m.setSessions(sessions);
  return m;
});
const onStage = f => loadStage().then(f);
const stageRace = (...args) => { staged = args; sessions = null; if (R) shownP = R.showRace(...args); };
const shown = () => loadStage().then(() => shownP);  // the shown race, loading the stage first if need be
const loadGlobe = () => globeP ??= loadStage().then(() => import('./globe.js')).then(m => G = m);  // the globe shares the stage's renderer
const globeOpen = () => (G ? G.globeOpen() : globeWanted);  // asked for, still loading: the address stays bare meanwhile
const moment = () => (R ? R.moment() : {});

const $ = id => document.getElementById(id);
// extra: the open view's own state in the address (share.js career, focus + stops, car), sent by its module as f1:address
const A = {year: null, round: null, races: [], mode: 'watch', section: 'analytics', extra: {}};
const today = () => new Date().toISOString().slice(0, 10);  // read per call: a tab open past midnight or New Year
const ORDER = ['Practice 1', 'Practice 2', 'Practice 3', 'Sprint Qualifying', 'Sprint Shootout', 'Sprint', 'Qualifying', 'Race'];
const jol = (kind, round) => get(`/api/jolpica/${A.year}/${kind}${round ? `?round=${round}` : ''}`).then(rows);
const ordinal = n => `R${n}`;  // round, as F1's graphics write it
const race = round => A.races.find(x => x.round === String(round));
const hasRun = r => at(r, '') <= new Date();  // lights out has gone: a race later today hasn't
// the session list's names -> Jolpica's keys for their start times
const SESSION_KEY = {'Practice 1': 'FirstPractice', 'Practice 2': 'SecondPractice', 'Practice 3': 'ThirdPractice', 'Sprint Qualifying': 'SprintQualifying',
  'Sprint Shootout': 'SprintShootout', Sprint: 'Sprint', Qualifying: 'Qualifying', Race: ''};
const ran = (r, name) => { const d = at(r, SESSION_KEY[name]); return d && d <= new Date(); };  // the weekend has it, and it has started
const sessionStarted = (r, name) => { const d = at(r, SESSION_KEY[name] ?? ''); return !d || d <= new Date(); };
// why a race has no lap tables
const noLaps = round => {
  const r = race(round);
  return !hasRun(r) ? `The ${r.raceName} hasn't run yet.` : A.year < 1996 ? 'No lap-by-lap data before 1996.' : `No lap-by-lap data for the ${r.raceName} yet.`;
};

// Each tab fetches its data, then returns a function that draws it (skipped if the user moved on meanwhile).
const TABS = {
  results: async r => {  // Race / Sprint / Qualifying; the one picked last stays picked from race to race
    const [res, spr, q] = await Promise.all([jol('results', r), jol('sprint', r), jol('qualifying', r)]);
    return () => { renderResults($('tab-results'), res, spr, q, A.resView, v => { A.resView = v; }); $('tab-results').append(...resultLedgers(A.year, r, res, jol, ORDER.filter(n => ran(race(r), n)))); };
  },
  lapchart: async r => {
    const [laps, res, pits] = await Promise.all([jol('laps', r), jol('results', r), jol('pitstops', r)]);
    const why = noLaps(r);
    return () => renderLapChart($('tab-lapchart'), laps, res, pits, why);
  },
  strategy: async r => {  // same three Jolpica tables as the lap chart, so switching between them is free
    const [laps, res, pits] = await Promise.all([jol('laps', r), jol('results', r), jol('pitstops', r)]);
    const year = A.year, why = noLaps(r);
    const {focus, stops} = A.extra;  // a link's plan
    return () => renderStrategyLab($('tab-strategy'), laps, res, pits, year, why, r, stops && {id: focus, stops});
  },
  standings: async r => {
    let [d, c] = await Promise.all([jol('driverstandings', r), jol('constructorstandings', r).catch(() => [])]), note;
    if (!d.length) {  // none after this race (yet): the season so far, saying so
      [d, c] = await Promise.all([jol('driverstandings'), jol('constructorstandings').catch(() => [])]);
      const x = race(r);
      note = `${hasRun(x) ? `No standings after the ${x.raceName} yet` : `The ${x.raceName} hasn't run yet`}. These are the latest ${A.year} standings.`;
    }
    const year = A.year;
    return () => { renderStandings($('tab-standings'), d, c, note); $('tab-standings').append(seasonTrends(year, jol)); };
  },
  drivers: async () => {  // the whole season, whichever race is picked
    const [st, res, dr] = await Promise.all([jol('driverstandings'), jol('results'), jol('drivers')]);
    const year = A.year, over = decided(A.races);
    const open = A.extra.career;  // a link's career
    return () => renderDrivers($('tab-drivers'), year, st, res, dr, over, jol('qualifying'), open);
  },
};
let active = 'replay', drawn = {};
// the address keeps the view (#stream, #2026/18/results, a Simulation #2026/18/sim), so a reload or a shared link lands on it
// (none under the globe: the address stays as it was, so a reload of the bare address comes back to the globe)
const view = () => (globeOpen() ? null : A.section === 'stream' ? '#stream'
  : A.round ? formatHash({year: A.year, round: A.round, tab: A.mode === 'sim' ? 'sim' : active, ...A.extra}) : null);
// a link's moment stays in the address, so a reload lands on it again, until the replay moves on or the view changes
let pending = null;  // {link, path, hash, open}
const address = () => {
  const h = view();
  if (pending && (!h || h !== pending.path || (pending.open && !held(pending.link, moment())))) pending = null;
  return pending?.hash ?? h;
};
// a link to this view, with the replay's moment only when asked for: the address itself doesn't follow playback
const copyView = () => copyLink(location.origin + location.pathname + formatHash({...parseHash(address() ?? ''),
  ...(A.section === 'analytics' && A.mode === 'watch' && active === 'replay' ? moment() : {})}));
// each change is one Back step: what follows in the same task (a tab after its race) amends it, and route() writes only at its end
let amend = false;
const syncHash = (replace = false) => {
  const h = address();
  if (A.routing || !h || h === location.hash) return;
  history[replace || amend ? 'replaceState' : 'pushState'](null, '', h);
  amend = true;
  setTimeout(() => { amend = false; });
};
// the browser tab names the race, without its result
const syncTitle = () => {
  const r = A.section === 'analytics' && A.races.find(x => x.round === String(A.round));
  document.title = `${r ? `${r.raceName} ${A.year} · ` : ''}Lights Out`;
};

function activate(name) {
  document.body.dataset.tab = name;  // style.css: phones drop the hero over the replay
  const swap = () => {
    if (name === 'replay' && A.section === 'analytics') loadStage();
  for (const b of document.querySelectorAll('[role=tab]')) {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      $(`tab-${b.dataset.tab}`).hidden = !on;
      if (!on) continue;
      // the strip alone: scrollIntoView would also scroll the page to a strip that's above the fold
      const strip = b.parentElement, t = b.getBoundingClientRect(), s = strip.getBoundingClientRect();
      strip.scrollLeft += t.left < s.left ? t.left - s.left : t.right > s.right ? t.right - s.right : 0;
    }
  };
  // a real tab change cross-fades the panels (View Transitions); older browsers and reduced motion just swap
  // a hidden page (or a transition still running) aborts it with a rejected promise: swap() has run either way
  if (name !== active && document.startViewTransition && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches)
    document.startViewTransition(swap).ready.catch(() => {});
  else swap();
  if (name !== active && !A.routing) A.extra = {};
  active = name;
  syncHash();
  drawTab(name);
}

// team colours: the accent (focus rings, primary buttons, sliders, the next race's tag) in the reader's team's colour
const TEAMS = [['mercedes', 'Mercedes'], ['ferrari', 'Ferrari'], ['mclaren', 'McLaren'], ['red_bull', 'Red Bull'], ['aston_martin', 'Aston Martin'],
  ['alpine', 'Alpine'], ['williams', 'Williams'], ['rb', 'Racing Bulls'], ['haas', 'Haas'], ['audi', 'Audi'], ['cadillac', 'Cadillac']];
function setTeam(id) {
  const s = document.documentElement.style, c = TEAMS.some(t => t[0] === id) && teamColor(id);
  if (c) { s.setProperty('--accent', c); s.setProperty('--accent-ink', inkOn(c)); }
  else { s.removeProperty('--accent'); s.removeProperty('--accent-ink'); }
  try { if (c) localStorage.setItem('f1team', id); else localStorage.removeItem('f1team'); } catch (e) { /* storage blocked: not remembered */ }
}
const teamCommands = () => [...TEAMS.map(([id, name]) => ({label: `Team colours: ${name}`, hint: 'Accent', group: 'Settings', text: `team colours colour theme ${name}`, run: () => setTeam(id)})),
  {label: 'Team colours: off', hint: 'Accent', group: 'Settings', text: 'team colours colour theme off default', run: () => setTeam(null)}];

const THEMES = [['auto', '◐', 'Theme: follows the system'], ['light', '☀', 'Theme: light'], ['dark', '☾', 'Theme: dark']];
function setTheme(t) {
  document.documentElement.dataset.theme = t;  // 'auto' matches neither CSS scheme selector, so the system decides
  const [, icon, title] = THEMES.find(x => x[0] === t) ?? THEMES[0];
  Object.assign($('themebtn'), {textContent: icon, title});
  $('themebtn').setAttribute('aria-label', title);
  try { localStorage.setItem('f1theme', t); } catch (e) { /* storage blocked: not remembered */ }
}

// an upcoming race: time to lights out in the hero's podium slot, refreshed every half minute until the race starts
let timer;
function countdown(r) {
  const start = at(r, ''), box = el('div', {class: 'countdown'}), left = el('b');
  box.append(el('small', {class: 'muted'}, 'LIGHTS OUT IN'), left, el('small', {class: 'muted'}, when(start)));
  const tick = () => {
    const s = (start - Date.now()) / 1000;
    if (s <= 0) { clearInterval(timer); return box.replaceChildren(el('span', {class: 'muted'}, 'Race under way')); }
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    roll(left, `${d ? `${d}d ` : ''}${h}h ${String(m).padStart(2, '0')}m`);
  };
  clearInterval(timer);
  timer = setInterval(tick, 30000);
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
  body.append(...[...body.rows].sort((a, b) => dir * cellOrder(key(a), key(b))));
}

// Spoiler-free mode (spoilers.js): the races of this season whose result is still hidden. Standings and Drivers are
// season totals, so any hidden race hides them; the other tabs and the podium go by the race on screen.
const hiddenRaces = () => A.races.filter(r => hides(A.year, r.round, r.date));
const hidden = (round = A.round) => hiddenRaces().some(r => r.round === String(round));
const SEASON_TABS = ['standings', 'drivers'];
function redraw() {  // after a reveal or a change of the mode: the podium and every tab again, the replay untouched
  drawn = {};
  A.podium?.();
  drawTab(active);
}
function revealRaces(list) {
  for (const r of list) reveal(A.year, r.round);
  redraw();
}
function setSpoilers(on) {
  setSpoilerFree(on);
  redraw();
}

async function drawTab(name) {
  if (!TABS[name] || drawn[name] || !A.round) return;
  drawn[name] = true;
  const panel = $(`tab-${name}`), key = `${A.year}/${A.round}`;
  const veiled = SEASON_TABS.includes(name) ? hiddenRaces() : hiddenRaces().filter(r => r.round === String(A.round));
  if (veiled.length) {
    return panel.replaceChildren(el('div', {class: 'empty'},
      el('p', {}, `Hidden while spoiler-free mode is on: you haven't watched ${veiled.length > 1 ? `${veiled.length} recent races` : `the ${veiled[0].raceName}`} to the flag.`),
      el('button', {class: 'tvbtn', onclick: () => revealRaces(veiled)}, 'Show anyway')));
  }
  panel.replaceChildren(skeleton());
  try {
    const draw = await TABS[name](A.round);
    if (key === `${A.year}/${A.round}`) draw();
  } catch (e) {
    drawn[name] = false;
    if (key === `${A.year}/${A.round}`) panel.replaceChildren(failed(e, () => drawTab(name)));
  }
}

// Watch or Simulate; reload: show the current race in the new mode (callers about to open a race themselves skip it)
function setMode(mode, reload = true) {
  A.mode = mode;
  document.body.dataset.mode = mode;
  syncSwitch();
  try { localStorage.setItem('f1mode', mode); } catch (e) { /* storage blocked: the mode just isn't remembered */ }
  if (reload && A.round) selectRace(A.round);
}

// Analytics (replays, simulation, results, data) or Stream (F1 TV); round: the weekend Stream scrolls to
function setSection(section, round = null) {
  A.section = section;
  document.body.dataset.section = section;
  syncSwitch();
  syncTitle();
  syncHash();
  if (section === 'analytics') { if (active === 'replay') loadStage(); return; }
  // the 3D stage (GPU device, textures, cars, ~5 MB of modules) can't be unloaded: a fresh page at #stream never loads it
  // shortcut: the reload drops the weekend to scroll to and a Play race in progress; a real stage teardown if that matters
  if (stageP) {
    if (location.hash !== '#stream') history.pushState(null, '', '#stream');
    return location.reload();
  }
  count('stream_open');
  if (A.races.length) showStream(A.year, A.races, round);
}

// the header's one switch: Races (Watch mode + Analytics section), Simulate (Simulate mode), Stream (Stream section)
function setView(view) {
  if (view === 'stream') return setSection('stream');
  if (A.section !== 'analytics') setSection('analytics');
  const mode = view === 'sim' ? 'sim' : 'watch';
  if (A.mode !== mode) setMode(mode);
}
function syncSwitch() {
  const view = A.section === 'stream' ? 'stream' : A.mode === 'sim' ? 'sim' : 'analytics';
  for (const b of document.querySelectorAll('.viewswitch button')) b.setAttribute('aria-pressed', b.dataset.view === view);
}

// First visit (or #intro): the latest race from the grid, filling the window, with one card that says what this is.
// Reduced motion: the card without the autoplay.
function startIntro(r, shown) {
  document.body.classList.add('intro');
  try { localStorage.setItem('f1seen', '1'); } catch (e) { /* storage blocked: it shows again next visit */ }
  const go = (event, then) => () => { count(event); endIntro(); then?.(); };
  count('intro_shown');
  if (hasRun(r)) get(`/api/replay/${A.year}/${r.round}?session=Race`).catch(() => {});  // beside the track's requests: showRace's turn for it comes ~2 s in
  $('intro').replaceChildren(
    el('div', {class: 'eyebrow'}, `ROUND ${r.round} · ${r.raceName.toUpperCase()}`),
    el('h1', {}, 'Relive every race in 3D.'),
    el('p', {}, `This is lights out at the ${r.raceName}: every car where it really was, on the real circuit. `
      + 'Follow any driver, ride onboard, rewind any lap.'),
    el('div', {class: 'introbtns'},
      el('button', {class: 'tvbtn', onclick: go('intro_explore')}, 'Explore this race →'),
      el('button', {class: 'ighost', onclick: go('intro_simulate', () => setView('sim'))}, 'Drive a race'),
      el('button', {class: 'ighost', onclick: go('intro_stream', () => setView('stream'))}, 'Watch on F1 TV')));
  $('intro').querySelector('.tvbtn').focus({preventScroll: true});
  document.querySelector('.topbar').addEventListener('click', endIntro, {once: true});
  addEventListener('keydown', introEsc);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) shown.then(() => A.round === r.round && R.intro());
}
const introEsc = e => e.key === 'Escape' && endIntro();
const endIntro = () => {
  removeEventListener('keydown', introEsc);
  if (!document.body.classList.contains('intro')) return;  // the top bar's listener outlives the card
  const held = $('intro').contains(document.activeElement);
  document.body.classList.remove('intro');
  if (held) document.querySelector('.hud-deck .deckgroup button')?.focus({preventScroll: true});  // the card is going: the keyboard lands on ▶, where Space still plays
  R?.setCinematic(false);  // past the card: the tower and panels the intro kept out of the way
};

// A return visit after a race that wasn't run at the last visit: a notice with a button that plays it. The first visit
// only remembers the latest race (the intro covers that visit).
function newRace() {
  const r = A.races.filter(x => x.date < today()).at(-1), year = A.year;  // run by now, not just today
  if (!r) return;
  let seen;
  try { seen = localStorage.getItem('f1latest'); localStorage.setItem('f1latest', `${A.year}/${r.round}`); } catch (e) { return; }
  if (!seen || seen === `${A.year}/${r.round}`) return;
  const box = toast([
    el('span', {class: 'eyebrow'}, 'NEW'), el('span', {}, `${r.raceName} replay`),
    el('button', {class: 'tvbtn', onclick: async () => {
      count('new_race_watch');
      box.close();
      setView('analytics');
      if (A.year !== year) await loadSeason(year, r.round);  // the reader has moved to another season since
      else if (A.round !== r.round) selectRace(r.round);
      activate('replay');
      shown().then(() => R.play());
    }}, '▶ Watch'),
    el('button', {class: 'noticex', 'aria-label': 'Dismiss', onclick: () => box.close()}, '✕')], 0);
}

// Header: the current season's next session, ticking; a click opens Stream on the Coming up row
async function nextSession() {
  const list = y => get(`/api/jolpica/${y}/races`).then(rows).catch(() => []), btn = $('nextbtn');
  let races = await list(today().slice(0, 4));
  // after the season's last race: next season's first session, once Jolpica has that calendar
  if (!upcoming(races).length) races = await list(+today().slice(0, 4) + 1);
  const tick = () => {
    const s = upcoming(races)[0];
    btn.hidden = !s;
    if (!s) return;
    btn.replaceChildren(el('span', {class: 'muted'}, 'NEXT'), ` ${s.name}`, el('span', {class: 'nextwhere'}, ` · ${s.r['Circuit.Location.country']}`),
      ` · ${s.d.toLocaleString(undefined, {weekday: 'short', hour: '2-digit', minute: '2-digit'})} `, el('b', {}, until(s.d)));
    btn.title = `${s.r.raceName}, ${s.name}: ${s.d.toLocaleString(undefined, {weekday: 'long', hour: '2-digit', minute: '2-digit'})}`;
    btn.onclick = async () => {
      if (A.year !== +s.r.season) await loadSeason(+s.r.season, s.r.round);
      setSection('stream', s.r.round);
    };
  };
  tick();
  setInterval(tick, 30000);
}

// Nothing to show (a failed load, an empty calendar): a page-level message instead of the last race and a ▶ that does nothing.
// message() makes the message: Stream hides the main column, so it goes on the billboard too
function noRace(title, message) {
  $('norace')?.remove();
  A.round = null;
  A.races = [];
  staged = null;
  if (R) shownP = R.showRace(A.year, null, []);  // stops and empties the stage (its track request just fails)
  document.title = 'Lights Out';
  $('hero').replaceChildren(el('div', {class: 'herotext'}, el('h1', {}, title)));
  $('racebtn').replaceChildren('Races ▾');
  document.querySelector('.tabs').classList.add('hidden');
  for (const b of document.querySelectorAll('[role=tab]')) $(`tab-${b.dataset.tab}`).hidden = true;
  document.querySelector('main').append(el('div', {id: 'norace'}, message()));
  noStream(A.year, message());
}

// round: the race to open (default: the latest one run), sim: open it as a Simulation
async function loadSeason(year, round = null, sim = A.mode === 'sim') {
  A.year = year;
  A.round = null;  // until a race of this season opens: no tab or address pairs the old round with the new year
  $('year').value = year;
  const cal = $('calendar');
  cal.replaceChildren(skeleton());
  let races;
  try {
    races = await jol('races');
  } catch (e) {
    if (A.year !== year) return;
    const message = () => failed(e, () => loadSeason(year, round, sim));
    cal.replaceChildren(message());
    return noRace(`${year} season`, message);
  }
  if (A.year !== year) return;  // the reader has picked another season meanwhile
  A.races = races;
  G?.setPins(pins());
  const next = A.races.find(r => !hasRun(r));
  cal.replaceChildren(...A.races.map(r => el('button', {
    class: `racecard ${hasRun(r) ? '' : 'upcoming'}`, 'data-round': r.round,
    onclick: () => { cal.hidePopover(); selectRace(r.round); }},
    el('span', {class: 'rnd'}, ordinal(+r.round)), flag(r['Circuit.Location.country'], 40),
    el('span', {class: 'rc-name'}, el('b', {}, r['Circuit.Location.country']), el('small', {}, r.raceName)),  // the name truncates on phones, the date doesn't
    el('span', {class: 'rc-tags'}, el('small', {class: 'rc-date'}, fmtDate(r.date)), r === next && el('span', {class: 'next'}, 'NEXT'), kindTag(year, r)))));
  const last = A.races.filter(hasRun).at(-1) ?? A.races[0];
  if (!race(round)) round = null;  // e.g. a stale link
  if (round ?? last) selectRace(round ?? last.round, sim, round !== null);  // the season's default race doesn't fly the globe
  else noRace(`${year} season`, () => el('p', {class: 'empty'}, `No races on the ${year} calendar yet.`));
  if (A.intro && A.round && !sim) startIntro(A.races.find(x => x.round === String(A.round)), shown());
  if (A.firstSeason && year === +today().slice(0, 4)) newRace();
  A.intro = A.firstSeason = false;
  if (A.section === 'stream') showStream(year, A.races);
}

// the race picker's tag: what ▶ will give for this race
function kindTag(year, r) {
  const kind = hasRun(r) && replayKind(year, r.date);  // replayKind goes by date alone: a race later today has nothing yet
  return kind && el('span', {class: `rkind k-${kind}`, title: REPLAY_KINDS[kind][1]}, REPLAY_KINDS[kind][0]);
}

const markRace = round => {
  for (const b of document.querySelectorAll('.racecard')) {
    if (b.dataset.round === String(round)) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  }
};

async function selectRace(round, sim = A.mode === 'sim', fly = true) {
  clearInterval(timer);
  $('norace')?.remove();
  document.querySelector('.tabs').classList.remove('hidden');
  A.round = round;
  if (!A.routing) A.extra = {};
  syncTitle();
  drawn = {};
  markRace(round);
  const r = race(round);
  const podium = el('div', {class: 'heropodium'});
  // one line: the race picker above already shows the flag and country
  $('hero').replaceChildren(
    el('div', {class: 'herotext'},
      el('h1', {}, r.raceName),
      el('span', {class: 'muted'}, `Round ${r.round} · ${new Date(r.date + 'T00:00:00').toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})}`
        + ` · ${r['Circuit.circuitName']}, ${r['Circuit.Location.locality']}`)),
    // a weekend still to finish: every session in the reader's own time, and the season as a calendar file
    // '' when there is none: replaceChildren would print a bare false as text
    r.date < today() ? '' : el('div', {class: 'herosched'},
      ...SESSIONS.map(([k, name]) => [name, at(r, k)]).filter(([, d]) => d).map(([name, d]) =>
        el('span', {class: d < new Date() ? 'muted' : ''}, el('b', {}, name), ` ${d.toLocaleString(undefined, {weekday: 'short', hour: '2-digit', minute: '2-digit'})}`)),
      el('a', {href: `/api/calendar/${A.year}.ics`, download: `grand-prix-${A.year}.ics`, title: `Every ${A.year} session, for your calendar app`}, 'Add to calendar')),
    el('div', {class: 'heroside'}, podium, el('button', {class: 'tvbtn', onclick: () => setSection('stream', round),
      title: 'Watch this race weekend live or replayed on F1 TV'}, '▶ F1 TV')));
  const fillPodium = res => {
    if (A.round !== round) return;
    if (res.length && hidden(round)) {
      return podium.replaceChildren(el('button', {class: 'spoilbtn', title: 'Spoiler-free mode is on. Show this result.',
        onclick: () => revealRaces([r])}, 'Result hidden · Show'));
    }
    podium.replaceChildren(...(res.length ? res.slice(0, 3).map(x =>
      el('div', {class: `pp p${x.position}`}, el('span', {class: 'pnum'}, `P${x.position}`),
        el('span', {class: 'chip', style: `background:${teamColor(x['Constructor.constructorId'], x['Constructor.name'])}`}),
        el('b', {}, x['Driver.code'] || x['Driver.familyName']))) : [r.date >= today() ? countdown(r) : el('span', {class: 'muted'}, 'No results yet')]));
    // where the mode is found: beside a recent result, which is what it would have hidden
    if (res.length && !spoilerFree() && recent(r.date, today())) {
      podium.append(el('button', {class: 'spoilbtn', title: 'Spoiler-free mode: hide the results of recent races until you have watched them to the flag',
        onclick: () => setSpoilers(true)}, 'Hide results'));
    }
  };
  A.podium = () => jol('results', round).then(fillPodium).catch(() => fillPodium([]));
  A.podium();

  $('racebtn').replaceChildren(el('span', {class: 'rnd'}, ordinal(+r.round)), flag(r['Circuit.Location.country'], 40),
    el('b', {}, r['Circuit.Location.country']), el('span', {class: 'caret', 'aria-hidden': 'true'}, '▾'));
  stageRace(A.year, round, ['Race'], sim);
  // chosen with the globe up: it flies to the circuit, where Play fades it into the stage
  if (fly && G?.globeOpen()) G.flyTo(pin(r));
  // a results-only race opens on Results, not on a stage with nothing to play; the next replayable race goes back
  const kind = replayKind(A.year, r.date);
  if (!sim && kind === 'results' && active === 'replay') { A.bounced = true; activate('results'); }
  else if (A.bounced && active === 'results' && (sim || kind !== 'results')) { A.bounced = false; activate('replay'); }
  else activate(sim ? 'replay' : active);
  if (active !== 'results') A.bounced = false;
  // Load session choices after showing the race; only 2023+ (OpenF1) sessions can be replayed.
  const year = A.year;
  if (!sim && year >= 2023) get(`/api/season/${year}`).then(t => {
    if (A.year !== year || A.round !== round) return;
    const rank = s => (ORDER.indexOf(s['Session Name']) + 1) || 99;  // a fixed weekend order, not start dates
    // a session still to come has nothing to replay: not offered, so the default is the latest that has run
    const list = rows(t).filter(s => s.Round === String(round) && sessionStarted(r, s['Session Name'])).sort((a, b) => rank(a) - rank(b));
    if (list.length) { sessions = list.map(s => s['Session Name']); R?.setSessions(sessions); }
  }).catch(() => {});
}

// The launch view (globe.js): the Earth with the header season's circuits pinned on it. A pin flies to its circuit, and
// Play there opens that season's race (its first, where a season went twice), in the mode the header is in, and starts
// it once the globe has gone; a race picked in the header flies there too (selectRace), and another season changes the pins.
// state: the race on screen ('shown') and the next one to run ('next') get their own pin look (style.css .gpin)
const pin = (r, next) => ({round: r.round, name: r['Circuit.circuitName'], place: `${r['Circuit.Location.locality']}, ${r['Circuit.Location.country']}`,
  // country is the pin's label: the place, since three races are in the USA
  country: r['Circuit.Location.locality'] || r['Circuit.Location.country'], state: String(r.round) === String(A.round) ? 'shown' : r === next ? 'next' : '',
  lat: +r['Circuit.Location.lat'], lng: +r['Circuit.Location.long'], label: hasRun(r) ? '▶ Play' : 'Open', ...dossier(r)});
// the pin's dossier: what's known about the circuit (length and lap record where circuits.js has a preset) and its other ways in
function dossier(r) {
  const p = PRESETS[r['Circuit.circuitId']], watch = hasRun(r) && A.mode !== 'sim';
  return {
    facts: [`Round ${r.round} · ${fmtDate(r.date)}`, p?.record && `${p.lengthKm} km · lap record ${p.record[0]} (${p.record[1]}, ${p.record[2]})`].filter(Boolean),  // not every preset has a record
    actions: [
      ...(watch ? [{label: 'Highlights', enter: true, run: () => onStage(R => R.stageCommands.highlights())},
        {label: 'Strategy lab', enter: true, run: () => activate('strategy')}] : []),
      {label: 'Drive it', run: () => { if (A.section !== 'analytics') setSection('analytics'); setMode('sim', false); selectRace(r.round); }},
      {label: 'Stream', run: () => setView('stream')},
    ],
  };
}
const pins = () => {
  const next = A.races.find(r => !hasRun(r));
  return A.races.filter((r, i, all) => all.findIndex(x => x['Circuit.circuitId'] === r['Circuit.circuitId']) === i).map(r => pin(r, next));
};
const showGlobe = () => {
  globeWanted = true;
  loadGlobe().then(g => {
    globeWanted = false;
    g.openGlobe(c => {
      if (String(c.round) !== String(A.round)) selectRace(c.round, undefined, false);  // the header's race is loaded already
      return shown();
    }, (entered, after) => { syncHash(); if (after) { after(); syncHash(); } else if (entered) R.play(); });
    g.setPins(pins());
  });
};

// the command palette's list (palette.js). Circuits and Cars live in Play; the trace and cinematic on the stage of the current mode
function commands() {
  const stage = () => { if (A.section !== 'analytics') setSection('analytics'); activate('replay'); };
  const open = panel => onStage(() => document.querySelector(`[aria-controls=${panel}]`).click());  // the decks are the stage's
  return [
    ...[['analytics', 'Races'], ['sim', 'Play'], ['stream', 'Stream']].map(([v, label]) => ({label, hint: 'View', group: 'Go to', run: () => setView(v)})),
    ...(A.round ? [...document.querySelectorAll('[role=tab]')].map(b => ({label: b.textContent, hint: 'Tab', group: 'Go to', run: () => {
      setView('analytics');
      A.bounced = false;
      activate(b.dataset.tab);
    }})) : []),
    ...(canDownload() ? [{label: 'Download assets', hint: 'About 600 MB', run: startDownload}] : []),
    {label: 'World map', hint: 'Every circuit', text: 'world map globe earth circuits', run: showGlobe},
    {label: 'Circuits', hint: 'Play', run: () => { setView('sim'); open('circuitdeck'); }},
    {label: 'Cars', hint: 'Play', run: () => { setView('sim'); open('carsdeck'); }},
    ...(A.round ? [{label: 'Telemetry trace', hint: 'Shift T', run: () => { stage(); open('tracedeck'); }},
      {label: 'Race highlights', hint: 'H', run: () => { stage(); onStage(R => R.stageCommands.highlights()); }},
      {label: 'Telemetry drawer', hint: 'T', run: () => { stage(); onStage(R => R.stageCommands.drawer()); }},
      {label: 'Next time of day', hint: 'L', run: () => { stage(); onStage(R => R.stageCommands.sky()); }},
      {label: 'Next graphics quality', hint: 'G', run: () => { stage(); onStage(R => R.stageCommands.tier()); }},
      {label: 'Cinematic view', hint: 'Replay', run: () => { stage(); onStage(R => R.setCinematic()); }}] : []),
    {label: 'Start reaction game', hint: 'Five red lights', text: 'lights out reaction start game test', run: openReaction},
    {label: 'Switch theme', run: () => $('themebtn').click()},
    ...teamCommands(),
    ...('Notification' in globalThis ? [{label: `Session start notices: turn ${notices() ? 'off' : 'on'}`, hint: 'When a session goes live', group: 'Settings', text: 'notify notification session start live alert', run: () => setNotices(!notices())}] : []),
    {label: `Spoiler-free mode: turn ${spoilerFree() ? 'off' : 'on'}`, hint: 'Hides recent results until watched', group: 'Settings', text: 'spoiler free mode hide results', run: () => setSpoilers(!spoilerFree())},
    {label: 'Keyboard shortcuts', hint: '?', run: openSheet},
    {label: 'Usage counts', run: openCounts},
    {label: 'Copy link', run: copyView},
    ...A.races.map(r => ({label: r.raceName, group: 'Races', hint: `Round ${r.round} · ${fmtDate(r.date)}`,
      text: `${r.raceName} ${r['Circuit.Location.country']} ${r['Circuit.Location.locality']} ${r['Circuit.circuitName']} round ${r.round}`,
      run: () => {
        if (A.section !== 'analytics') setSection('analytics');
        if (String(A.round) !== r.round) selectRace(r.round);
      }})),
  ].map(c => ({...c, run: () => { endIntro(); c.run(); }}));
}

// back from formula1.com through the F1 TV Connect bookmarklet (multiviewer.js): the token goes to this tab's storage and
// its address is rewritten, so it never stays in the history, even where storage is blocked
function takeToken() {
  if (!location.hash.startsWith('#f1tv=')) return;
  count('f1tv_connected');
  let back = '';
  try {
    sessionStorage.setItem('f1tv', location.hash.slice(6));
    back = sessionStorage.getItem('f1tv-back');
  } catch (e) { /* storage blocked: not connected */ }
  history.replaceState(null, '', back || location.pathname);
}

// Put the app where the address says: at start-up, on Back / Forward and for a link opened in the running tab
async function route() {
  const years = [...$('year').options].map(o => o.value);
  if (!years.length) return;  // still starting: boot() reads the address itself
  // only checked values get past parseHash. Any stray token leaves the address when syncHash below tidies it
  const link = parseHash(location.hash), {stream, year, round, tab} = link;
  const wasSim = A.mode === 'sim', thisYear = today().slice(0, 4);
  A.routing = true;
  pending = null;
  // the view's own state: only the fields the link's tab reads
  const EXTRA = {drivers: ['career'], strategy: ['focus', 'stops'], replay: ['car'], sim: ['car']};
  A.extra = Object.fromEntries((EXTRA[tab] ?? []).filter(k => link[k] !== undefined).map(k => [k, link[k]]));
  if (A.extra.career || A.extra.stops) drawn[tab] = false;  // drawn already (Back to it): drawn again, to open the link's
  try {
    if (tab) setMode(tab === 'sim' ? 'sim' : 'watch', false);  // the link's view, over the stored mode
    if (TABS[tab] || tab === 'replay' || tab === 'explorer') active = tab;
    if (tab === 'sim') active = 'replay';
    if (tab === 'qualifying') [active, A.resView] = ['results', 'qualifying'];  // links from before Qualifying joined Results
    if (A.section !== (stream ? 'stream' : 'analytics')) setSection(stream ? 'stream' : 'analytics');
    const y = years.includes(year) ? +year : A.year ?? +(years.includes(thisYear) ? thisYear : years[0]);
    if (y !== A.year || !A.round) await loadSeason(y, round || null);
    else if (!stream && race(round) && (round !== String(A.round) || wasSim !== (A.mode === 'sim'))) selectRace(round);
    else if (!stream) activate(active);
    const here = A.round, car = A.extra.car;
    if (here && !stream && car) shown().then(() => A.round === here && A.extra.car === car && import('./carsdeck.js').then(m => m.openCar(car)));
    if (here && !stream && A.mode === 'watch' && active === 'replay') {
      const path = view(), hash = formatHash({...link, year: A.year, round: here, tab: 'replay'}), mine = hash !== path && {link, path, hash};
      if (mine) pending = mine;
      shown().then(() => {
        if (A.round !== here) return;
        R.openMoment(link);
        if (pending === mine) mine.open = true;  // from here the replay is the link's, and moving it lets go
      });
    }
  } finally {
    A.routing = false;
    syncHash(true);  // tidies the address the app ended up on (#intro, a stale link, a bare #2026)
  }
}

// the season list, then the season the address asks for; Retry comes back here
async function boot() {
  let seasons;
  try {
    seasons = await get('/api/seasons');
  } catch (e) {
    return noRace('Lights Out', () => failed(e, boot));
  }
  $('norace')?.remove();
  const years = seasons.slice().reverse(), sel = $('year');
  sel.replaceChildren(...years.map(y => new Option(y, y)));
  sel.onchange = () => loadSeason(+sel.value);
  route();
}

async function init() {
  // the season list and this season's calendar are requested before the 3D stage is set up (~0.3 s of main thread)
  get('/api/seasons').catch(() => {});
  get(`/api/jolpica/${today().slice(0, 4)}/races`).catch(() => {});
  setupExplorer($('tab-explorer'), () => ({year: A.year, round: A.round}));
  const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const last = +stored('f1visit') || 0, now = Date.now();  // a return: another day than the last visit, within a week
  count('visit');
  if (last && new Date(last).toDateString() !== new Date(now).toDateString() && now - last < 7 * 864e5) count('return_7d');
  try { localStorage.setItem('f1visit', now); } catch (e) { /* storage blocked: no returns counted */ }
  setMode(stored('f1mode') === 'sim' ? 'sim' : 'watch', false);
  setTheme(stored('f1theme') ?? 'dark');
  setTeam(stored('f1team'));
  $('teambtn').onclick = () => openPalette(teamCommands());
  $('reactbtn').onclick = openReaction;
  addEventListener('f1:address', e => { A.extra = e.detail; syncHash(true); });  // a career, plan or car opened or closed: replaces, no Back step
  $('skip').onclick = e => {  // not a #fragment: the hash is the app's route
    e.preventDefault();
    const to = document.body.dataset.section === 'stream' ? $('stream') : document.querySelector('main');
    to.tabIndex = -1;
    to.focus();
  };
  $('themebtn').onclick = () => setTheme(THEMES[(THEMES.findIndex(x => x[0] === document.documentElement.dataset.theme) + 1) % THEMES.length][0]);
  document.addEventListener('click', e => { const th = e.target.closest('table.data th'); if (th) sortTable(th); });
  takeToken();
  if (location.hash === '#stream') setSection('stream');
  A.intro = location.hash === '#intro';  // the intro replay is by link only: home is the globe
  A.firstSeason = true;  // the first season loaded checks for a race new since the last visit
  // a bare address opens on the globe, over the latest race
  if (!location.hash) showGlobe();
  $('globebtn').onclick = showGlobe;
  // shortcut: polled, since the replay's time moves in a dozen places; replay.js could say so itself if a second reader appears
  setInterval(() => {
    pending?.open && syncHash(true);
    if (R?.ended() && hidden()) revealRaces([race(A.round)]);  // watched to the flag: nothing left to spoil
  }, 1000);
  addEventListener('hashchange', () => {
    takeToken();
    const open = [...document.querySelectorAll('dialog')].filter(d => d.matches(':modal'));
    if (!open.length) return location.hash ? route() : showGlobe();  // Back to the bare address: the globe again
    open.forEach(d => d.close());  // Back closes the dialog and stays on the page under it
    syncHash();
  });
  $('calendar').addEventListener('toggle', e => {  // the race list opens under its button, at the race shown
    if (e.newState !== 'open') return;
    const r = $('racebtn').getBoundingClientRect();
    Object.assign(e.target.style, {left: `${Math.max(12, Math.min(r.left, document.documentElement.clientWidth - e.target.offsetWidth - 12))}px`, top: `${r.bottom + 6}px`});
    const now = e.target.querySelector('[aria-current=true]') ?? e.target.firstElementChild;
    now?.scrollIntoView({block: 'center'});
    now?.focus({preventScroll: true});
  });
  $('calendar').addEventListener('keydown', e => {
    const cards = [...e.currentTarget.children], i = cards.indexOf(document.activeElement);
    const to = {ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: cards.length - 1}[e.key];
    if (to === undefined) return;
    e.preventDefault();
    cards.at(to % cards.length).focus();
  });
  $('home').onclick = e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;  // the browser's new tab or window
    e.preventDefault();
    setView('analytics');
    scrollTo({top: 0});
    if (A.round && replayKind(A.year, race(A.round).date) !== 'results') activate('replay');
    showGlobe();  // the logo is home, and home is the globe
  };
  $('palbtn').onclick = () => openPalette(commands());
  setupPalette({commands, driving: () => capturing() && $('tab-replay').offsetParent});
  for (const b of document.querySelectorAll('.viewswitch button')) b.onclick = () => setView(b.dataset.view);
  $('livebtn').onclick = () => {
    setMode('watch', false);
    markRace(null);
    $('hero').replaceChildren(el('div', {class: 'herotext'},
      el('div', {class: 'eyebrow'}, 'LIVE TIMING'), el('h1', {}, $('livebtn').title)));
    activate('replay');
    onStage(R => R.showLive());
  };
  checkLive();
  setInterval(checkLive, 60000);
  setupGlass();
  nextSession();
  setupDownloads();
  // the circuit selector (circuitdeck.js): a simulation at that circuit's latest race, switching season if needed
  addEventListener('f1:circuit', ({detail: {year, round}}) => {
    setMode('sim', false);
    if (A.year === year) return selectRace(String(round), true);
    loadSeason(year, String(round), true);
  });
  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach((b, i) => {
    b.onclick = () => { A.bounced = false; activate(b.dataset.tab); };  // a tab picked by hand stays picked
    b.onkeydown = e => {
      const d = {ArrowRight: 1, ArrowLeft: -1}[e.key];
      if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); A.bounced = false; activate(n.dataset.tab); }
    };
  });
  boot();
}

// header button, only while a session is running: it opens F1's live timing. (Between sessions it used to offer the last
// session's final state, which is the race the page already shows.)
// Session start notices (off until asked for from the command palette): a browser notification when a session goes live
// while this tab is out of view. The status check is a cheap one, so with notices on it keeps running in a hidden tab.
const notices = () => { try { return localStorage.getItem('lo-notify') === '1' && globalThis.Notification?.permission === 'granted'; } catch (e) { return false; } };
async function setNotices(on) {
  if (on && (await globalThis.Notification?.requestPermission?.()) !== 'granted') return;  // refused, or no notifications here (the desktop app)
  try { localStorage.setItem('lo-notify', on ? '1' : '0'); } catch (e) { /* storage blocked: stays off */ }
}
let wasLive;  // undefined until the first check: a session already running when the page opens isn't news

async function checkLive() {
  if (document.hidden && !notices()) return;
  try {
    const res = await fetch('/api/live/status');  // not /api/live, which opens F1's feed and holds it open for an idle tab
    if (!res.ok) return;
    const {live, title} = await res.json(), btn = $('livebtn');
    btn.hidden = !live;
    btn.classList.toggle('on', live);
    btn.textContent = '● LIVE';
    btn.title = title ?? '';
    if (live && wasLive === false && document.hidden && notices()) new Notification('Live now', {body: title ?? '', tag: 'lo-live'});
    wasLive = live;
  } catch (e) { /* live timing unreachable: keep the button hidden */ }
}

init();
