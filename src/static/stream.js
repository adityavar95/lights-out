// Stream: F1 TV as a browse page. A billboard (the session on air, else the latest weekend's race), the coming
// weekends' schedule, then one row of videos per race weekend, newest first; a card plays in the multiviewer.
// The season's rows all load, three weekends at a time: one season is ~24 F1 TV searches, while a few hundred in
// minutes get the IP 403'd. (Loading rows as they scroll near missed rows: IntersectionObserver never fires in a
// browser that isn't painting, e.g. the desktop app's hidden pane.)
import {get, el, flag, tvHeaders, count} from './util.js';
import {openViewer, loadShaka, connectPanel, watched} from './multiviewer.js';
import {icon} from './tvcontrols.js';

const $ = id => document.getElementById(id);
const S = {year: null, races: [], linked: false};
// Jolpica's race row: each session's start as `<Name>.date` + `<Name>.time`; the race's own are `date` + `time`
const SESSIONS = [['FirstPractice', 'Practice 1'], ['SecondPractice', 'Practice 2'], ['ThirdPractice', 'Practice 3'],
  ['SprintQualifying', 'Sprint quali'], ['Sprint', 'Sprint'], ['Qualifying', 'Qualifying'], ['', 'Race']];
const at = (r, k) => { const d = r[k ? `${k}.date` : 'date']; return d ? new Date(`${d}T${r[k ? `${k}.time` : 'time'] || '00:00:00Z'}`) : null; };
const weekendStart = r => at(r, 'FirstPractice') ?? at(r, '');
const pic = (v, w) => v.img && `${v.img}?w=${w}&h=${Math.round(w * 9 / 16)}&q=HI&o=L`;
const when = d => d.toLocaleString(undefined, {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const dur = s => s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m` : `${Math.ceil(s / 60)} min`;
export const until = d => { const s = (d - Date.now()) / 1000, h = Math.floor(s / 3600); return h >= 24 ? `in ${Math.floor(h / 24)}d ${h % 24}h` : h ? `in ${h}h ${Math.floor(s / 60) % 60}m` : `in ${Math.ceil(s / 60)} min`; };
// the sessions still to come in the next two race weekends, in order (the Coming up row; the header counts down to the first)
export const upcoming = (races, now = new Date()) => races.filter(r => at(r, '') > now).slice(0, 2)
  .flatMap(r => SESSIONS.map(([k, name]) => ({r, name, d: at(r, k)})).filter(s => s.d && s.d > now));
// shortcut: live = within the scheduled session times + 30 min for overruns; F1 TV's own state field reads "Pre-Live" long after
const live = v => v.start && v.start <= Date.now() && Date.now() <= v.end + 1800e3;

// what an F1 TV video is, in plain words: F1 TV files every session and the studio shows round it as REPLAY
function tvLabel(v) {
  const t = v.title.toLowerCase();
  if (v.kind === 'REPLAY') return /show|warm-up/.test(t) ? 'Show' : /sprint (qualifying|shootout)/.test(t) ? 'Sprint quali'
    : /sprint/.test(t) ? 'Sprint' : /qualifying/.test(t) ? 'Qualifying' : /practice|\bfp\d/.test(t) ? 'Practice' : 'Race';
  return {'PRESS CONFERENCE': 'Interview', 'RACE HIGHLIGHTS': 'Highlights', 'EXTENDED HIGHLIGHTS': 'Highlights'}[v.kind]
    ?? v.kind[0] + v.kind.slice(1).toLowerCase();
}
// F1 TV's image resizer drops some of a season's ~500 thumbnails when they're asked for at once; they load on a retry
const retry = ({target: i}) => {
  const n = +(i.dataset.tries ?? 0);
  if (n < 3) setTimeout(() => { i.dataset.tries = n + 1; i.src = `${i.src.replace(/&try=\d+$/, '')}&try=${n + 1}`; }, 2000 * (n + 1));
};
// a caption line's parts with quiet dots between them
const dots = parts => parts.filter(Boolean).flatMap((x, i) => i ? [el('i', {class: 'sdot', 'aria-hidden': 'true'}), x] : [x]);
const day = d => d.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
const weekday = d => d.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
// a video's name inside its weekend's row, which already says which grand prix: the session ("Practice 2", "Race"),
// else F1 TV's title without the year
const LONG = {FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3', 'Sprint quali': 'Sprint Qualifying'};
const named = v => sessionsOf([v]).length ? LONG[short(v)] ?? short(v) : v.title.replace(/^\d{4}\s+/, '');
// a weekend's dates: "30 Oct – 1 Nov"
const span = r => { const a = weekendStart(r), b = at(r, ''); return a && b && day(a) !== day(b) ? `${day(a)} – ${day(b)}` : b ? day(b) : ''; };
// playing here needs this tab connected to an F1 TV subscription; until then a video opens on F1 TV's own site, which
// works for anyone signed in there (the in-app player could only say "Not connected")
// a replay you've started (the viewer keeps where you are: multiviewer.js remember) resumes there, like a TV app
const saved = v => watched().find(e => e.id === v.id);
const resumable = e => e && e.pos >= 30 && e.pos < e.len * .95;
const watch = (v, r) => {
  count(S.linked ? 'video_here' : 'video_f1tv');
  const e = saved(v);
  return S.linked ? openViewer({...v, label: tvLabel(v), year: v.year ?? S.year, round: v.round ?? r.round, resumeAt: resumable(e) ? e.pos : undefined})
    : open(v.url, '_blank', 'noopener');
};

// a video: its artwork with nothing on it but LIVE (and, until this tab is connected, that it opens on F1 TV); on hover
// it lifts and shows a play button. What it is, when and how long go in the caption.
// resume: a Continue watching card, titled with its grand prix and saying how long is left instead of when it was
function card(v, r, resume = false) {
  const e = resume ? v : saved(v);
  return el('button', {class: 'scard', 'data-id': v.id, title: `${S.linked ? 'Watch here' : 'Opens on F1 TV'}: ${v.title}`, onclick: () => watch(v, r)},
    el('div', {class: 'sthumb'}, v.img && el('img', {src: pic(v, 480), alt: '', decoding: 'async', loading: 'lazy', onerror: retry}),
      live(v) && el('span', {class: 'slive'}, 'LIVE'),
      el('span', {class: 'sext', title: 'Opens on F1 TV'}, icon('ext')),
      el('span', {class: 'splay', 'aria-hidden': 'true'}, icon('play')),
      bar(e)),
    el('b', {}, resume ? v.title.replace(/^\d{4}\s+/, '') : named(v)),
    el('small', {}, ...dots(resume ? [named(v), `${dur(v.len - v.pos)} left`]
      : [v.start && weekday(new Date(v.start)), v.duration > 0 && dur(v.duration)])));
}

// how much of it you've watched: a thin line along the bottom of the artwork
const bar = e => el('span', {class: 'sprog', hidden: !(e?.len > 0)}, el('i', {style: `width: ${e?.len ? Math.min(100, e.pos / e.len * 100) : 0}%`}));

// Continue watching: replays started and not finished, the latest first, above everything else
function continueRow() {
  const list = watched().filter(resumable).slice(0, 12), old = $('srow-continue');
  if (!list.length) return old?.remove();
  const rowEl = row(['Continue watching'], 'srow-continue', list.map(e => card(e, {round: e.round}, true)));
  old ? old.replaceWith(rowEl) : $('srows').prepend(rowEl);
}

// back from the viewer: where you got to, on this page too (registered by showStream)
function refreshWatched() {
  if (!S.year) return;
  continueRow();
  for (const c of document.querySelectorAll('.scard[data-id]:not(#srow-continue .scard)')) c.querySelector('.sprog')?.replaceWith(bar(saved({id: +c.dataset.id})));
}

// a row: its heading (and a quiet line beside it), then cards that scroll sideways; round arrows page through them
function row(title, id, cards, sub = '') {
  const track = el('div', {class: 'strack'}, ...cards);
  const page = d => track.scrollBy({left: d * track.clientWidth * .9, behavior: 'smooth'});
  return el('section', {class: 'srow', id},
    el('header', {class: 'srowhead'}, el('h3', {}, ...title), sub && el('span', {}, sub),
      el('span', {class: 'spages'},
        el('button', {class: 'spage', 'aria-label': 'Scroll left', onclick: () => page(-1)}, icon('left')),
        el('button', {class: 'spage', 'aria-label': 'Scroll right', onclick: () => page(1)}, icon('right')))),
    track);
}

// the billboard: the session on air (else the latest weekend's race) as a premiere: its artwork full-bleed under a deep
// vignette, a kicker (LIVE, pulsing; else the round), the title, what it is, and a white Play beside a glass F1 TV link
// the weekend's sessions (practice, sprint, qualifying, race), oldest first, each as a short name: FP1, Qualifying…
export const short = v => { const m = v.title.match(/practice\s*(\d)/i); return m ? `FP${m[1]}` : /sprint (qualifying|shootout)/i.test(v.title) ? 'Sprint quali'
  : /sprint/i.test(v.title) ? 'Sprint' : /qualifying/i.test(v.title) ? 'Qualifying' : 'Race'; };
export const sessionsOf = videos => videos.filter(v => ['Practice', 'Sprint quali', 'Sprint', 'Qualifying', 'Race', 'Live'].includes(tvLabel(v))
  && /\bGP\b|grand prix/i.test(v.title) && !/highlights|show|warm-up|press|kids/i.test(v.title)).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

function billboard(v, r, videos = []) {
  const bill = $('sbill'), weekend = sessionsOf(videos);
  bill.style.setProperty('--art', v.img ? `url("${pic(v, 1920)}")` : 'none');
  bill.classList.remove('swap');
  void bill.offsetWidth;  // restart the artwork's fade-in for the session picked
  bill.classList.add('swap');
  bill.replaceChildren(el('div', {class: 'sbilltext'},
    live(v) ? el('span', {class: 'skicker live'}, 'Live now') : el('span', {class: 'skicker'}, `Round ${r.round}`),
    el('h1', {}, r.raceName),
    el('p', {}, ...dots([named(v), v.start && when(new Date(v.start)), v.duration > 0 && dur(v.duration)])),
    // not connected: the main button connects (watching here), not a trip to F1 TV's site that rarely comes back; the
    // F1 TV link is only for then
    el('div', {class: 'sbillbtns'},
      S.linked ? el('button', {class: 'sprimary', onclick: () => watch(v, r)}, icon('play'), 'Play')
        : el('button', {class: 'sprimary', popovertarget: 'sconnectpanel'}, icon('play'), 'Watch here'),
      !S.linked && el('a', {class: 'sghost', href: v.url, target: '_blank', rel: 'noopener', onclick: () => count('video_f1tv')}, 'Open on F1 TV', icon('ext'))),
    // the weekend at a glance: a chip per session puts it on the billboard
    weekend.length > 1 && el('div', {class: 'sweek', role: 'group', 'aria-label': 'This weekend'},
      ...weekend.map(x => el('button', {class: 'swchip', 'aria-pressed': String(x === v), onclick: () => billboard(x, r, videos)},
        live(x) && el('i', {class: 'swlive', 'aria-hidden': 'true'}), short(x))))));
}

// the weekend's videos; the newest weekend also fills the billboard
async function fill(rowEl, r, first) {
  try {
    const videos = await get(`/api/f1tv/${S.year}/${r.round}`);
    if (!rowEl.isConnected) return;
    if (!videos.length) return rowEl.remove();
    // the sessions only, the latest first, so a weekend's row leads with its race; F1 TV's shows, interviews and
    // highlights stay on F1 TV (a weekend it has no sessions for shows whatever it has)
    const sessions = sessionsOf(videos).reverse();
    rowEl.querySelector('.strack').replaceChildren(...(sessions.length ? sessions : videos).map(v => card(v, r)));
    if (first) billboard(videos.find(live) ?? videos.find(v => tvLabel(v) === 'Race') ?? videos[0], r, videos);
  } catch (e) {
    if (rowEl.isConnected) rowEl.querySelector('.strack').replaceChildren(el('p', {class: 'empty err'}, e.message));
  }
}

function build(year, races) {
  Object.assign(S, {year, races});
  const now = new Date();
  // Coming up: a schedule card per session, the grand prix and flag above, the session large, then when and how long until
  const sched = upcoming(races, now).map(({r, name, d}) => el('div', {class: 'sched'},
    el('div', {class: 'schedtop'}, flag(r['Circuit.Location.country'], 40), el('span', {}, r.raceName.replace(/ Grand Prix$/, ' GP'))),
    el('b', {}, name),
    el('div', {class: 'schedbot'}, el('span', {}, when(d)), el('span', {class: 'scount'}, until(d)))));
  const weekends = races.filter(r => weekendStart(r) <= now).reverse();
  const rows = weekends.map(r => row([flag(r['Circuit.Location.country'], 40), r.raceName], `srow-${r.round}`,
    Array.from({length: 5}, () => el('div', {class: 'scard skel'}, el('div', {class: 'sthumb'}), el('b', {}), el('small', {}))), `Round ${r.round} · ${span(r)}`));
  const queue = rows.map((x, i) => [x, weekends[i]]);
  const next = () => { const [x, r] = queue.shift() ?? []; return x?.isConnected && fill(x, r, x === rows[0]).then(next); };  // stops once the season changes
  $('sbill').style.setProperty('--art', 'none');
  $('sbill').replaceChildren(el('div', {class: 'sbilltext'}, el('span', {class: 'skicker'}, `${year} season`),
    el('h1', {}, weekends.length ? 'Loading F1 TV…' : 'No race weekends yet')));
  $('srows').replaceChildren(...(sched.length ? [row(['Coming up'], 'srow-next', sched)] : []), ...rows);
  continueRow();
  for (let i = 0; i < 3; i++) next();
}

// Is this tab connected to F1 TV? (/api/f1tv/account checks the token's expiry; the token never leaves the tab otherwise.)
// Not connected: a bar at the top says videos open on F1 TV, and how to connect to watch them here instead.
async function connection() {
  const a = await fetch('/api/f1tv/account', {headers: tvHeaders()}).then(r => r.json()).catch(() => ({}));
  S.linked = !!a.linked;
  $('stream').classList.toggle('linked', S.linked);
  S.bar ??= $('sbill').insertAdjacentElement('afterend', el('div', {class: 'sconnect', role: 'note'}));
  S.bar.hidden = S.linked;
  S.bar.replaceChildren(el('span', {class: 'sconnecticon'}, icon('link')),
    el('p', {}, el('b', {}, a.error ? `${a.error}. ` : 'Videos open on F1 TV. '),
      'Connect your F1 TV subscription to watch here instead: every onboard camera, several streams side by side, live data over the picture.'),
    el('button', {class: 'sprimary small', popovertarget: 'sconnectpanel'}, 'Connect F1 TV'), connectPanel('sconnectpanel', connection));
}

// open the Stream page on a season; round: scroll to that weekend's row (or the schedule, for one still to come)
export async function showStream(year, races, round = null) {
  loadShaka().catch(() => {});  // the video player downloads while you browse, not after the click
  if (!S.listening) { S.listening = true; addEventListener('f1:watched', refreshWatched); }
  await connection();  // before the cards: they open here or on F1 TV by it
  if (S.year !== year || S.races !== races) build(year, races);
  if (round) ($(`srow-${round}`) ?? $('srow-next'))?.scrollIntoView({block: 'center'});
  else scrollTo(0, 0);
}
