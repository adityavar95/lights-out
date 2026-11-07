// Stream: F1 TV as a browse page. A billboard (the session on air, else the next session to come, else the latest race), the coming
// weekends' schedule, then one row of videos per race weekend, newest first; a card plays in the multiviewer.
// The season's rows all load, three weekends at a time: one season is ~24 F1 TV searches, while a few hundred in
// minutes get the IP 403'd. (Loading rows as they scroll near missed rows: IntersectionObserver never fires in a
// browser that isn't painting, e.g. the desktop app's hidden pane.)
import {get, el, flag, tvHeaders, count, failed, plain, skeleton} from './util.js';
import {openViewer, loadShaka, connectPanel, watched} from './multiviewer.js';
import {icon} from './tvcontrols.js';
import {fetchTile} from './satellite.js';

const $ = id => document.getElementById(id);
const S = {year: null, races: [], linked: false};
// Jolpica's race row: each session's start as `<Name>.date` + `<Name>.time`; the race's own are `date` + `time`
const SESSIONS = [['FirstPractice', 'Practice 1'], ['SecondPractice', 'Practice 2'], ['ThirdPractice', 'Practice 3'],
  ['SprintQualifying', 'Sprint quali'], ['Sprint', 'Sprint'], ['Qualifying', 'Qualifying'], ['', 'Race']];
export const at = (r, k) => { const d = r[k ? `${k}.date` : 'date']; return d ? new Date(`${d}T${r[k ? `${k}.time` : 'time'] || '00:00:00Z'}`) : null; };
const weekendStart = r => at(r, 'FirstPractice') ?? at(r, '');
const pic = (v, w) => v.img && `${v.img}?w=${w}&h=${Math.round(w * 9 / 16)}&q=HI&o=L`;
export const when = d => d.toLocaleString(undefined, {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const dur = s => s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m` : `${Math.ceil(s / 60)} min`;
export const until = d => { const s = (d - Date.now()) / 1000, h = Math.floor(s / 3600); return h >= 24 ? `in ${Math.floor(h / 24)}d ${h % 24}h` : h ? `in ${h}h ${Math.floor(s / 60) % 60}m` : `in ${Math.ceil(s / 60)} min`; };
// the sessions still to come in the next two race weekends, in order (the Coming up row; the header counts down to the first)
export const upcoming = (races, now = new Date()) => races.filter(r => at(r, '') > now).slice(0, 2)
  .flatMap(r => SESSIONS.map(([k, name]) => ({r, name, d: at(r, k)})).filter(s => s.d && s.d > now));
// shortcut: live = within the scheduled session times + 30 min for overruns; F1 TV's own state field reads "Pre-Live" long after
// (F1 TV's shows can carry a placeholder end decades ahead, e.g. a 2025 Cooldown Room ending in 2061: no session runs 12 h)
export const live = v => v.start && v.start <= Date.now() && Date.now() <= v.end + 1800e3 && v.end - v.start < 12 * 3600e3;

// what an F1 TV video is, in plain words: F1 TV files every session and the studio shows round it as REPLAY
export function tvLabel(v) {
  const t = v.title.toLowerCase();
  if (v.kind === 'REPLAY') return /show|warm-up/.test(t) ? 'Show' : /sprint (qualifying|shootout)/.test(t) ? 'Sprint quali'
    : /sprint/.test(t) ? 'Sprint' : /qualifying/.test(t) ? 'Qualifying' : /practice|\bfp\d/.test(t) ? 'Practice' : 'Race';
  return {'PRESS CONFERENCE': 'Interview', 'RACE HIGHLIGHTS': 'Highlights', 'EXTENDED HIGHLIGHTS': 'Highlights'}[v.kind]
    ?? v.kind[0] + v.kind.slice(1).toLowerCase();
}
// F1 TV's image resizer drops some of a season's ~500 thumbnails when they're asked for at once; they load on a retry
const retry = ({target: i}) => {
  const n = +(i.dataset.tries ?? 0);
  if (n < 3) setTimeout(() => { i.removeAttribute('srcset'); i.dataset.tries = n + 1; i.src = `${i.src.replace(/&try=\d+$/, '')}&try=${n + 1}`; }, 2000 * (n + 1));
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
const watch = (v, r, fresh = false) => {
  count(S.linked ? 'video_here' : 'video_f1tv');
  const e = saved(v);
  return S.linked ? openViewer({...v, label: tvLabel(v), year: v.year ?? S.year, round: v.round ?? r.round, resumeAt: !fresh && resumable(e) ? e.pos : undefined})
    : open(v.url, '_blank', 'noopener');
};

// a video: its artwork with nothing on it but LIVE (and, until this tab is connected, that it opens on F1 TV); on hover
// it lifts and shows a play button. What it is, when and how long go in the caption.
// resume: a Continue watching card, titled with its grand prix and saying how long is left instead of when it was
function card(v, r, resume = false) {
  const e = resume ? v : saved(v);
  const gp = v.title.replace(/^\d{4}\s+/, '').replace(/\s+-\s.*$/, '');  // F1 TV's "United States GP - Qualifying": the session has its own line
  const name = resume ? [gp, named(v), `${dur(v.len - v.pos)} left`]
    : [r.raceName, named(v), v.start && new Date(v.start).toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long'}), v.duration > 0 && dur(v.duration)];
  return el('button', {class: 'scard', 'data-id': v.id, 'aria-label': name.filter(Boolean).join(', '), title: `${S.linked ? 'Watch here' : 'Opens on F1 TV'}: ${v.title}`, onclick: () => watch(v, r)},
    el('div', {class: 'sthumb'}, v.img && el('img', {src: pic(v, 480), srcset: `${pic(v, 480)} 480w, ${pic(v, 960)} 960w`, sizes: '(max-width: 520px) 80vw, 25vw', alt: '', decoding: 'async', loading: 'lazy', onerror: retry}),
      live(v) && el('span', {class: 'slive'}, 'LIVE'),
      el('span', {class: 'sext', title: 'Opens on F1 TV'}, icon('ext')),
      el('span', {class: 'splay', 'aria-hidden': 'true'}, icon('play')),
      bar(e)),
    el('b', {}, resume ? gp : named(v)),
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
  if (S.bill) billboard(...S.bill);  // its button is Play or Resume by this
  for (const c of document.querySelectorAll('.scard[data-id]:not(#srow-continue .scard)')) c.querySelector('.sprog')?.replaceWith(bar(saved({id: +c.dataset.id})));
}

// a row: its heading (and a quiet line beside it), then cards that scroll sideways; round arrows page through them
function row(title, id, cards, sub = '') {
  const track = el('div', {class: 'strack'}, ...cards);
  const page = d => track.scrollBy({left: d * track.clientWidth * .9, behavior: 'smooth'});
  return el('section', {class: 'srow', id},
    el('header', {class: 'srowhead'}, el('h2', {}, ...title), sub && el('span', {}, sub),
      el('span', {class: 'spages'},
        el('button', {class: 'spage', 'aria-label': 'Scroll left', onclick: () => page(-1)}, icon('left')),
        el('button', {class: 'spage', 'aria-label': 'Scroll right', onclick: () => page(1)}, icon('right')))),
    track);
}

// What the billboard leads with, as billboard()'s arguments: the session on air; else the next one to come; else (a finished
// season) the race of the newest weekend with videos, once every newer one has answered.
export function lead(answers, weekends, next, nextVideos = []) {
  const on = nextVideos.find(live);
  if (on) return [on, next.r, nextVideos];
  const k = answers.findIndex(a => a?.videos.some(live));
  if (k >= 0) return [answers[k].videos.find(live), weekends[k], answers[k].videos];
  if (next) return [null, next.r, nextVideos, next];
  for (let i = 0; answers[i]; i++) {
    const v = answers[i].videos;
    if (v.length) return [v.find(x => tvLabel(x) === 'Race') ?? v[0], weekends[i], v];
  }
  return null;
}
// An aerial photo of the circuit (the imagery the 3D ground uses) for a weekend F1 TV has no artwork for yet: the tiles
// round it stitched, since Esri's own export of one big picture takes 2-23 s and a tile ~0.3 s. Tile x, y and where to draw it.
const TILE = 256, ART = [1920, 1080];
export const ZOOM = 16;
export function aerialTiles(lat, long, [w, h] = ART) {
  const n = 2 ** ZOOM, fx = (long + 180) / 360 * n, fy = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n, out = [];
  for (let y = Math.floor(fy - h / 2 / TILE); y < fy + h / 2 / TILE; y++) for (let x = Math.floor(fx - w / 2 / TILE); x < fx + w / 2 / TILE; x++)
    out.push({x, y, dx: Math.round(w / 2 + (x - fx) * TILE), dy: Math.round(h / 2 + (y - fy) * TILE)});
  return out;
}
const aerials = new Map();  // round -> Promise of a picture's url, or null
function aerial(r) {
  const lat = +r['Circuit.Location.lat'], long = +r['Circuit.Location.long'], key = `${lat},${long}`;
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return Promise.resolve(null);
  if (!aerials.has(key)) aerials.set(key, (async () => {
    const canvas = Object.assign(document.createElement('canvas'), {width: ART[0], height: ART[1]}), ctx = canvas.getContext('2d');
    await Promise.all(aerialTiles(lat, long).map(async ({x, y, dx, dy}) => {
      const tile = await fetchTile(ZOOM, y, x);
      if (tile.ok) ctx.drawImage(await createImageBitmap(await tile.blob()), dx, dy);
    }));
    const blob = await new Promise(done => canvas.toBlob(done, 'image/jpeg', .85));
    return blob && URL.createObjectURL(blob);
  })().catch(() => null));
  return aerials.get(key);
}

// the billboard: the session on air (else the next to come) as a premiere: its artwork full-bleed under a deep
// vignette, a kicker (LIVE, pulsing; else the round), the title, what it is, and a white Play beside a glass F1 TV link
// the weekend's sessions (practice, sprint, qualifying, race), oldest first, each as a short name: FP1, Qualifying…
export const short = v => { const m = v.title.match(/practice\s*(\d)/i); return m ? `FP${m[1]}` : /sprint (qualifying|shootout)/i.test(v.title) ? 'Sprint quali'
  : /sprint/i.test(v.title) ? 'Sprint' : /qualifying/i.test(v.title) ? 'Qualifying' : 'Race'; };
export const sessionsOf = videos => videos.filter(v => ['Practice', 'Sprint quali', 'Sprint', 'Qualifying', 'Race', 'Live'].includes(tvLabel(v))
  && /\bGP\b|grand prix/i.test(v.title) && !/highlights|show|warm-up|press|kids/i.test(v.title)).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

// the billboard's art layer (style.css: its parallax)
const artLayer = () => el('div', {class: 'sbillart', 'aria-hidden': 'true'}, el('i'));

function billboard(v, r, videos = [], next = null) {
  S.bill = [v, r, videos, next];
  const bill = $('sbill'), weekend = sessionsOf(videos), e = v && saved(v), back = resumable(e);
  // a session to come has no artwork of its own: the weekend's if F1 TV has any, else the circuit from the air
  const art = v ?? [...weekend].reverse().find(x => x.img) ?? videos.find(x => x.kind === 'REPLAY' && x.img);
  const setArt = url => $('stream').style.setProperty('--art', url ? `url("${url}")` : 'none');
  setArt(art?.img && pic(art, Math.min(3840, Math.max(1920, Math.ceil(innerWidth * devicePixelRatio)))));
  if (!art?.img && !v) aerial(r).then(url => { if (url && S.bill?.[1] === r && !S.bill[0]) setArt(url); });
  const coming = upcoming(S.races).find(s => s.r === r);  // the chip back to it, after picking a session that has run
  bill.replaceChildren(artLayer(), el('div', {class: 'sbilltext'},
    v && live(v) ? el('span', {class: 'skicker live'}, 'Live now') : el('span', {class: 'skicker'}, next ? `Next up · Round ${r.round}` : `Round ${r.round}`),
    el('h1', {}, r.raceName),
    next ? el('p', {}, ...dots([next.name, when(next.d), el('span', {class: 'sbillcount', 'data-at': +next.d}, until(next.d))]))
      : el('p', {}, ...dots([named(v), v.start && when(new Date(v.start)), back ? `${dur(e.len - e.pos)} left` : v.duration > 0 && dur(v.duration)])),
    // not connected: the main button connects (watching here), not a trip to F1 TV's site that rarely comes back; the
    // F1 TV link is only for then
    el('div', {class: 'sbillbtns'},
      v && S.linked && el('button', {class: 'sprimary', onclick: () => watch(v, r)}, icon('play'), back ? 'Resume' : 'Play'),
      !S.linked && el('button', {class: 'sprimary', popovertarget: 'sconnectpanel'}, icon('link'), 'Connect to watch'),
      v && S.linked && back && el('button', {class: 'sghost', onclick: () => watch(v, r, true)}, 'Start over'),
      v && !S.linked && el('a', {class: 'sghost', href: v.url, target: '_blank', rel: 'noopener', onclick: () => count('video_f1tv')}, 'Open on F1 TV', icon('ext'))),
    // the weekend at a glance: a chip per session puts it on the billboard
    weekend.length + (coming ? 1 : 0) > 1 && el('div', {class: 'sweek', role: 'group', 'aria-label': 'This weekend'},
      ...weekend.map(x => el('button', {class: 'swchip', 'aria-pressed': String(x === v), onclick: () => { S.picked = true; billboard(x, r, videos); }},
        live(x) && el('i', {class: 'swlive', 'aria-hidden': 'true'}), short(x))),
      coming && el('button', {class: 'swchip', 'aria-pressed': String(!v), onclick: () => { S.picked = false; billboard(null, r, videos, coming); }}, coming.name))));
}

// puts what should lead on the billboard, unless a chip chose something else or it's already there
function refreshLead() {
  if (S.picked) return;
  const b = lead(S.answers, S.weekends, upcoming(S.races)[0], S.nextVideos);
  if (!b) return;
  const key = v => v && `${v[0]?.id}|${+v[3]?.d}|${v[2].length}`;
  if (key(b) !== key(S.bill)) billboard(...b);
}
// the coming weekend's videos, for its artwork and to notice a session going on air (the server refreshes them every 5 min)
async function loadNext(year) {
  const next = upcoming(S.races)[0];
  if (!next) return;
  const videos = await fetch(`/api/f1tv/${year}/${next.r.round}`).then(r => r.ok ? r.json() : []).catch(() => []);
  if (S.year === year) { S.nextVideos = videos; refreshLead(); }
}

// the billboard with a message for a headline (no artwork, no session)
function headline(year, ...body) {
  S.bill = null;
  $('stream').style.setProperty('--art', 'none');
  $('sbill').replaceChildren(artLayer(), el('div', {class: 'sbilltext'}, year && el('span', {class: 'skicker'}, `${year} season`), ...body));
}
// no season to browse (its calendar didn't load, or is empty); the next showStream builds afresh
export function noStream(year, message) {
  Object.assign(S, {year: null, races: []});
  $('srows').replaceChildren();
  headline(year, message);
}

// the weekend's videos, then tell settle(videos, error); a row with none goes (the failures share one message: see build)
async function fill(rowEl, r, settle) {
  try {
    const videos = await get(`/api/f1tv/${S.year}/${r.round}`);
    if (!rowEl.isConnected) return;
    if (!videos.length) { rowEl.remove(); return settle([]); }
    // the sessions only, the latest first, so a weekend's row leads with its race; F1 TV's shows, interviews and
    // highlights stay on F1 TV (a weekend it has no sessions for shows whatever it has)
    const sessions = sessionsOf(videos).reverse();
    rowEl.querySelector('.strack').replaceChildren(...(sessions.length ? sessions : videos).map(v => card(v, r)));
    settle(videos);
  } catch (e) {
    if (!rowEl.isConnected) return;
    rowEl.remove();
    settle([], e);
  }
}

function build(year, races) {
  Object.assign(S, {year, races, bill: null, picked: false, answers: [], weekends: [], nextVideos: []});
  const now = new Date();
  // Coming up: a schedule card per session, the grand prix and flag above, the session large, then when and how long until
  const sched = upcoming(races, now).map(({r, name, d}) => el('div', {class: 'sched'},
    el('div', {class: 'schedtop'}, flag(r['Circuit.Location.country'], 40), el('span', {}, r.raceName.replace(/ Grand Prix$/, ' GP'))),
    el('b', {}, name),
    el('div', {class: 'schedbot'}, el('span', {}, when(d)), el('span', {class: 'scount', 'data-at': +d}, until(d)))));
  const weekends = races.filter(r => weekendStart(r) <= now).reverse();
  const rows = weekends.map(r => row([flag(r['Circuit.Location.country'], 40), r.raceName], `srow-${r.round}`,
    Array.from({length: 5}, () => el('div', {class: 'scard skel'}, el('div', {class: 'sthumb'}), el('b', {}), el('small', {}))), `Round ${r.round} · ${span(r)}`));
  const queue = rows.map((x, i) => [x, weekends[i]]);
  const answers = S.answers, again = () => build(year, races);
  S.weekends = weekends;
  // a season without any videos says so. However many rows fail, one message: on the billboard when nothing loaded, else above the rows
  const settle = (i, videos, err) => {
    answers[i] = {videos, err};
    refreshLead();
    const errs = answers.filter(a => a?.err), over = answers.filter(Boolean).length === rows.length;
    $('sfail')?.remove();
    if (S.bill) { if (errs.length) $('srows').prepend(el('div', {id: 'sfail'}, failed(`${errs.length} of ${rows.length} weekends didn't load. ${plain(errs[0].err)}`, again))); }
    else if (over && errs.length) headline(year, el('h1', {}, "F1 TV isn't answering"), failed(errs[0].err, again));
    else if (over) headline(year, el('h1', {}, `No F1 TV videos for ${year} yet`));
  };
  const next = () => { const [x, r] = queue.shift() ?? []; return x?.isConnected && fill(x, r, (v, e) => settle(rows.indexOf(x), v, e)).then(next); };  // stops once the season changes
  headline(year, weekends.length ? skeleton(3) : el('h1', {}, 'No race weekends yet'));
  $('srows').replaceChildren(...(sched.length ? [row(['Coming up'], 'srow-next', sched)] : []), ...rows);
  continueRow();
  refreshLead();  // a session to come leads at once, without waiting for F1 TV
  loadNext(year);
  for (let i = 0; i < 3; i++) next();
}

// Is this tab connected to F1 TV? (/api/f1tv/account checks the token's expiry; the token never leaves the tab otherwise.)
// Not connected: a bar at the top says videos open on F1 TV, and how to connect to watch them here instead.
async function connection() {
  const a = await fetch('/api/f1tv/account', {headers: tvHeaders()}).then(r => r.json()).catch(() => ({}));
  const was = S.linked;
  S.linked = !!a.linked;
  $('stream').classList.toggle('linked', S.linked);
  S.bar ??= $('sbill').insertAdjacentElement('afterend', el('div', {class: 'sconnect', role: 'note'}));
  S.bar.hidden = S.linked;
  S.bar.replaceChildren(el('span', {class: 'sconnecticon'}, icon('link')),
    el('p', {}, el('b', {}, a.error ? `${a.error}. ` : 'Videos open on F1 TV. '),
      'Connect your F1 TV subscription to watch here instead: every onboard camera, several streams side by side, live data over the picture.'),
    el('button', {class: 'sprimary small', popovertarget: 'sconnectpanel'}, 'Connect F1 TV'), S.panel ??= connectPanel('sconnectpanel', connection));
  if (S.linked !== was && S.bill) billboard(...S.bill);  // its button is Connect or Play by this
}

// open the Stream page on a season; round: scroll to that weekend's row (or the schedule, for one still to come)
export async function showStream(year, races, round = null) {
  loadShaka().catch(() => {});  // the video player downloads while you browse, not after the click
  if (!S.listening) {
    S.listening = true;
    addEventListener('f1:watched', refreshWatched);
    setInterval(() => {  // Coming up stays true however long the page is open
      for (const c of document.querySelectorAll('.scount[data-at]')) +c.dataset.at > Date.now() ? c.textContent = until(+c.dataset.at) : c.closest('.sched').remove();
      for (const c of document.querySelectorAll('.sbillcount[data-at]')) if (+c.dataset.at > Date.now()) c.textContent = until(+c.dataset.at);
      if (S.year) refreshLead();  // a session started or ended
    }, 30e3);
    setInterval(() => { if (S.year) loadNext(S.year); }, 300e3);
  }
  await connection();  // before the cards: they open here or on F1 TV by it
  if (S.year !== year || S.races !== races) build(year, races);
  if (round) ($(`srow-${round}`) ?? $('srow-next'))?.scrollIntoView({block: 'center'});
  else scrollTo(0, 0);
}
