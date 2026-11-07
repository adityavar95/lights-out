// App shell: the Races / Simulate / Stream switch (Stream is the F1 TV browse page, stream.js), the Watch / Simulate switch, race dropdown, race header and tabs. Watch is the race browser (replays of
// real sessions, results, standings, live timing); Simulate drops the browser chrome for a full-window physics race
// on the chosen circuit (circuit and car pickers on the stage, season = the cars' era).
import {get, rows, el, flag, fmtDate, teamColor, count, failed, skeleton} from './util.js';
import {setupReplay, showRace, showLive, setSessions, intro, setCinematic, play, replayKind, REPLAY_KINDS, moment, openMoment, stageCommands} from './replay.js';
import {renderResults, renderLapChart, renderStandings} from './charts.js';
import {seasonTrends} from './seasonview.js';
import {setupExplorer} from './explorer.js';
import {renderStrategyLab} from './strategylab.js';
import {renderDrivers, decided} from './drivers.js';
import {showStream, noStream, upcoming, until, at, when} from './stream.js';
import {setupGlass} from './glass.js';
import {capturing} from './input.js';
import {setupPalette, openPalette, openSheet, openCounts, copyLink} from './palette.js';
import {parseHash, formatHash} from './share.js';
import {resultLedgers} from './ledgers.js';

const $ = id => document.getElementById(id);
const A = {year: null, round: null, races: [], mode: 'watch', section: 'analytics'};
const today = new Date().toISOString().slice(0, 10);
const ORDER = ['Practice 1', 'Practice 2', 'Practice 3', 'Sprint Qualifying', 'Sprint Shootout', 'Sprint', 'Qualifying', 'Race'];
const jol = (kind, round) => get(`/api/jolpica/${A.year}/${kind}${round ? `?round=${round}` : ''}`).then(rows);
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };  // 1st 2nd 3rd 4th 11th 21st
const race = round => A.races.find(x => x.round === String(round));
const hasRun = r => at(r, '') <= new Date();  // lights out has gone: a race later today hasn't
// the session list's names -> Jolpica's keys for their start times
const SESSION_KEY = {'Practice 1': 'FirstPractice', 'Practice 2': 'SecondPractice', 'Practice 3': 'ThirdPractice', 'Sprint Qualifying': 'SprintQualifying',
  'Sprint Shootout': 'SprintShootout', Sprint: 'Sprint', Qualifying: 'Qualifying', Race: ''};
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
    return () => { renderResults($('tab-results'), res, spr, q, A.resView, v => { A.resView = v; }); $('tab-results').append(...resultLedgers(A.year, r, res, jol)); };
  },
  lapchart: async r => {
    const [laps, res, pits] = await Promise.all([jol('laps', r), jol('results', r), jol('pitstops', r)]);
    const why = noLaps(r);
    return () => renderLapChart($('tab-lapchart'), laps, res, pits, why);
  },
  strategy: async r => {  // same three Jolpica tables as the lap chart, so switching between them is free
    const [laps, res, pits] = await Promise.all([jol('laps', r), jol('results', r), jol('pitstops', r)]);
    const year = A.year, why = noLaps(r);
    return () => renderStrategyLab($('tab-strategy'), laps, res, pits, year, why, r);
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
    return () => renderDrivers($('tab-drivers'), year, st, res, dr, over, jol('qualifying'));
  },
};
let active = 'replay', drawn = {};
// the address keeps the view (#stream, #2026/18/results, a Simulation #2026/18/sim), so a reload or a shared link lands on it
const address = () => (A.section === 'stream' ? '#stream' : A.round ? `#${A.year}/${A.round}/${A.mode === 'sim' ? 'sim' : active}` : null);
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
  const swap = () => {
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
let timer;
function countdown(r) {
  const start = at(r, ''), box = el('div', {class: 'countdown'});
  const tick = () => {
    const s = (start - Date.now()) / 1000;
    if (s <= 0) { clearInterval(timer); return box.replaceChildren(el('span', {class: 'muted'}, 'Race under way')); }
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    box.replaceChildren(el('small', {class: 'muted'}, 'LIGHTS OUT IN'), el('b', {}, `${d ? `${d}d ` : ''}${h}h ${String(m).padStart(2, '0')}m`), el('small', {class: 'muted'}, when(start)));
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
  body.append(...[...body.rows].sort((a, b) => dir * key(a).localeCompare(key(b), undefined, {numeric: true})));
}

async function drawTab(name) {
  if (!TABS[name] || drawn[name] || !A.round) return;
  drawn[name] = true;
  const panel = $(`tab-${name}`), key = `${A.year}/${A.round}`;
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
  if (section === 'analytics') return;
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
      el('button', {class: 'ighost', onclick: go('intro_simulate', () => setView('sim'))}, 'Simulate a race'),
      el('button', {class: 'ighost', onclick: go('intro_stream', () => setView('stream'))}, 'Watch on F1 TV')));
  $('intro').querySelector('.tvbtn').focus({preventScroll: true});
  document.querySelector('.topbar').addEventListener('click', endIntro, {once: true});
  addEventListener('keydown', e => e.key === 'Escape' && endIntro());
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) shown.then(() => A.round === r.round && intro());
}
const endIntro = () => {
  if (!document.body.classList.contains('intro')) return;  // Esc and the top bar's listeners outlive the card
  const held = $('intro').contains(document.activeElement);
  document.body.classList.remove('intro');
  if (held) document.querySelector('.hud-deck .deckgroup button')?.focus({preventScroll: true});  // the card is going: the keyboard lands on ▶, where Space still plays
  setCinematic(false);  // past the card: the tower and panels the intro kept out of the way
};

// A return visit after a race that wasn't run at the last visit: a notice with a button that plays it. The first visit
// only remembers the latest race (the intro covers that visit).
function newRace() {
  const r = A.races.filter(x => x.date < today).at(-1), year = A.year;  // run by now, not just today
  if (!r) return;
  let seen;
  try { seen = localStorage.getItem('f1latest'); localStorage.setItem('f1latest', `${A.year}/${r.round}`); } catch (e) { return; }
  if (!seen || seen === `${A.year}/${r.round}`) return;
  const box = el('div', {class: 'notice', role: 'status'},
    el('span', {class: 'eyebrow'}, 'NEW'), el('span', {}, `${r.raceName} replay`),
    el('button', {class: 'tvbtn', onclick: async () => {
      count('new_race_watch');
      box.remove();
      setView('analytics');
      if (A.year !== year) await loadSeason(year, r.round);  // the reader has moved to another season since
      else if (A.round !== r.round) selectRace(r.round);
      activate('replay');
      A.shown.then(play);
    }}, '▶ Watch'),
    el('button', {class: 'noticex', 'aria-label': 'Dismiss', onclick: () => box.remove()}, '✕'));
  document.body.append(box);
}

// Header: the current season's next session, ticking; a click opens Stream on the Coming up row
async function nextSession() {
  const races = await get(`/api/jolpica/${today.slice(0, 4)}/races`).then(rows).catch(() => []), btn = $('nextbtn');
  const tick = () => {
    const s = upcoming(races)[0];
    btn.hidden = !s;  // shortcut: after the season's last race, nothing until next year's calendar is in this year's list
    if (!s) return;
    btn.replaceChildren(el('span', {class: 'muted'}, 'NEXT'), ` ${s.name}`, el('span', {class: 'nextwhere'}, ` · ${s.r['Circuit.Location.country']}`),
      ` · ${s.d.toLocaleString(undefined, {weekday: 'short', hour: '2-digit', minute: '2-digit'})} `, el('b', {}, until(s.d)));
    btn.title = `${s.r.raceName}, ${s.name}: ${s.d.toLocaleString(undefined, {weekday: 'long', hour: '2-digit', minute: '2-digit'})}`;
    btn.onclick = async () => {
      if (A.year !== +today.slice(0, 4)) await loadSeason(+today.slice(0, 4), s.r.round);
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
  if (A.shown) A.shown = showRace(A.year, null, []);  // stops and empties the stage (its track request just fails)
  document.title = 'Lights Out';
  $('hero').replaceChildren(el('div', {class: 'herotext'}, el('h1', {}, title)));
  $('racebtn').replaceChildren('Races ▾');
  document.querySelector('.tabs').style.display = 'none';  // .tabs sets display, so hidden wouldn't hide it
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
  const next = A.races.find(r => !hasRun(r));
  cal.replaceChildren(...A.races.map(r => el('button', {
    class: `racecard ${hasRun(r) ? '' : 'upcoming'}`, 'data-round': r.round,
    onclick: () => { cal.hidePopover(); selectRace(r.round); }},
    el('span', {class: 'rnd'}, ordinal(+r.round)), flag(r['Circuit.Location.country'], 40),
    el('span', {class: 'rc-name'}, el('b', {}, r['Circuit.Location.country']), el('small', {}, `${r.raceName} · ${fmtDate(r.date)}`)),
    el('span', {class: 'rc-tags'}, r === next && el('span', {class: 'next'}, 'NEXT'), kindTag(year, r)))));
  const last = A.races.filter(hasRun).at(-1) ?? A.races[0];
  if (!race(round)) round = null;  // e.g. a stale link
  if (round ?? last) selectRace(round ?? last.round, sim);
  else noRace(`${year} season`, () => el('p', {class: 'empty'}, `No races on the ${year} calendar yet.`));
  if (A.intro && A.round && !sim) startIntro(A.races.find(x => x.round === String(A.round)), A.shown);
  if (A.firstSeason && year === +today.slice(0, 4)) newRace();
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

async function selectRace(round, sim = A.mode === 'sim') {
  clearInterval(timer);
  $('norace')?.remove();
  document.querySelector('.tabs').style.display = '';
  A.round = round;
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
    el('div', {class: 'heroside'}, podium, el('button', {class: 'tvbtn', onclick: () => setSection('stream', round),
      title: 'Watch this race weekend live or replayed on F1 TV'}, '▶ F1 TV')));
  const fillPodium = res => {
    if (A.round !== round) return;
    podium.replaceChildren(...(res.length ? res.slice(0, 3).map(x =>
      el('div', {class: `pp p${x.position}`}, el('span', {class: 'pnum'}, `P${x.position}`),
        el('span', {class: 'chip', style: `background:${teamColor(x['Constructor.constructorId'], x['Constructor.name'])}`}),
        el('b', {}, x['Driver.code'] || x['Driver.familyName']))) : [r.date >= today ? countdown(r) : el('span', {class: 'muted'}, 'No results yet')]));
  };
  jol('results', round).then(fillPodium).catch(() => fillPodium([]));

  $('racebtn').replaceChildren(el('span', {class: 'rnd'}, ordinal(+r.round)), flag(r['Circuit.Location.country'], 40),
    el('b', {}, r['Circuit.Location.country']), el('span', {class: 'caret', 'aria-hidden': 'true'}, '▾'));
  A.shown = showRace(A.year, round, ['Race'], sim);
  // a results-only race opens on Results, not on a stage with nothing to play; the next replayable race goes back
  const kind = replayKind(A.year, r.date);
  if (!sim && kind === 'results' && active === 'replay') { A.bounced = true; activate('results'); }
  else if (A.bounced && active === 'results' && (sim || kind !== 'results')) { A.bounced = false; activate('replay'); }
  else activate(sim ? 'replay' : active);
  if (active !== 'results') A.bounced = false;
  // Load session choices after showing the race; only 2023+ (OpenF1) sessions can be replayed, and older seasons'
  // lists come from livef1, which takes ~40 s per season.
  const year = A.year;
  if (!sim && year >= 2023) get(`/api/season/${year}`).then(t => {
    if (A.year !== year || A.round !== round) return;
    const rank = s => (ORDER.indexOf(s['Session Name']) + 1) || 99;  // livef1's start dates aren't reliable enough to sort by
    // a session still to come has nothing to replay: not offered, so the default is the latest that has run
    const list = rows(t).filter(s => s.Round === String(round) && sessionStarted(r, s['Session Name'])).sort((a, b) => rank(a) - rank(b));
    if (list.length) setSessions(list.map(s => s['Session Name']));
  }).catch(() => {});
}

// the command palette's list (palette.js). Circuits and Cars live in Simulate; the trace and cinematic on the stage of the current mode
function commands() {
  const stage = () => { if (A.section !== 'analytics') setSection('analytics'); activate('replay'); };
  const open = panel => document.querySelector(`[aria-controls=${panel}]`).click();
  return [
    ...[['analytics', 'Races'], ['sim', 'Simulate'], ['stream', 'Stream']].map(([v, label]) => ({label, hint: 'View', run: () => setView(v)})),
    ...(A.round ? [...document.querySelectorAll('[role=tab]')].map(b => ({label: b.textContent, hint: 'Tab', run: () => {
      setView('analytics');
      A.bounced = false;
      activate(b.dataset.tab);
    }})) : []),
    {label: 'Circuits', hint: 'Simulate', run: () => { setView('sim'); open('circuitdeck'); }},
    {label: 'Cars', hint: 'Simulate', run: () => { setView('sim'); open('carsdeck'); }},
    ...(A.round ? [{label: 'Telemetry trace', hint: 'Shift T', run: () => { stage(); open('tracedeck'); }},
      {label: 'Race highlights', hint: 'H', run: () => { stage(); stageCommands.highlights(); }},
      {label: 'Telemetry drawer', hint: 'T', run: () => { stage(); stageCommands.drawer(); }},
      {label: 'Next time of day', hint: 'L', run: () => { stage(); stageCommands.sky(); }},
      {label: 'Next graphics quality', hint: 'G', run: () => { stage(); stageCommands.tier(); }},
      {label: 'Cinematic view', hint: 'Replay', run: () => { stage(); setCinematic(); }}] : []),
    {label: 'Switch theme', run: () => $('themebtn').click()},
    {label: 'Keyboard shortcuts', hint: '?', run: openSheet},
    {label: 'Usage counts', run: openCounts},
    {label: 'Copy link', run: copyView},
    ...A.races.map(r => ({label: r.raceName, hint: `Round ${r.round} · ${fmtDate(r.date)}`,
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
  // only checked values get past parseHash. The moment and any stray token leave the address when syncHash below tidies it
  const link = parseHash(location.hash), {stream, year, round, tab} = link;
  const wasSim = A.mode === 'sim', thisYear = today.slice(0, 4);
  A.routing = true;
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
    const shown = A.round;
    if (shown && !stream && A.mode === 'watch' && active === 'replay') A.shown.then(() => A.round === shown && openMoment(link));
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
  get(`/api/jolpica/${today.slice(0, 4)}/races`).catch(() => {});
  setupReplay($('tab-replay'), copyView);
  setupExplorer($('tab-explorer'), () => ({year: A.year, round: A.round}));
  const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const last = +stored('f1visit') || 0, now = Date.now();  // a return: another day than the last visit, within a week
  count('visit');
  if (last && new Date(last).toDateString() !== new Date(now).toDateString() && now - last < 7 * 864e5) count('return_7d');
  try { localStorage.setItem('f1visit', now); } catch (e) { /* storage blocked: no returns counted */ }
  setMode(stored('f1mode') === 'sim' ? 'sim' : 'watch', false);
  setTheme(stored('f1theme') ?? 'dark');
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
  A.intro = location.hash === '#intro' || (!location.hash && !stored('f1seen'));
  A.firstSeason = true;  // the first season loaded checks for a race new since the last visit
  addEventListener('hashchange', () => {
    takeToken();
    const open = [...document.querySelectorAll('dialog')].filter(d => d.matches(':modal'));
    if (!open.length) return route();
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
    showLive();
  };
  checkLive();
  setInterval(checkLive, 60000);
  setupGlass();
  nextSession();
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
async function checkLive() {
  try {
    const res = await fetch('/api/live/status');  // not /api/live, which opens F1's feed and holds it open for an idle tab
    if (!res.ok) return;
    const {live, title} = await res.json(), btn = $('livebtn');
    btn.hidden = !live;
    btn.classList.toggle('on', live);
    btn.textContent = '● LIVE';
    btn.title = title ?? '';
  } catch (e) { /* live timing unreachable: keep the button hidden */ }
}

init();
