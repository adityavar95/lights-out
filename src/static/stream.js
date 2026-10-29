// Stream: F1 TV as a browse page. A billboard (the session on air, else the latest weekend's race), the coming
// weekends' schedule, then one row of videos per race weekend, newest first; a card plays in the multiviewer.
// The season's rows all load, three weekends at a time: one season is ~24 F1 TV searches, while a few hundred in
// minutes get the IP 403'd. (Loading rows as they scroll near missed rows: IntersectionObserver never fires in a
// browser that isn't painting, e.g. the desktop app's hidden pane.)
import {get, el, flag} from './util.js';
import {openViewer, loadShaka} from './multiviewer.js';

const $ = id => document.getElementById(id);
const S = {year: null, races: []};
// Jolpica's race row: each session's start as `<Name>.date` + `<Name>.time`; the race's own are `date` + `time`
const SESSIONS = [['FirstPractice', 'Practice 1'], ['SecondPractice', 'Practice 2'], ['ThirdPractice', 'Practice 3'],
  ['SprintQualifying', 'Sprint quali'], ['Sprint', 'Sprint'], ['Qualifying', 'Qualifying'], ['', 'Race']];
const at = (r, k) => { const d = r[k ? `${k}.date` : 'date']; return d ? new Date(`${d}T${r[k ? `${k}.time` : 'time'] || '00:00:00Z'}`) : null; };
const weekendStart = r => at(r, 'FirstPractice') ?? at(r, '');
const pic = (v, w) => v.img && `${v.img}?w=${w}&h=${Math.round(w * 9 / 16)}&q=HI&o=L`;
const when = d => d.toLocaleString(undefined, {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const dur = s => s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m` : `${Math.ceil(s / 60)} min`;
const until = d => { const s = (d - Date.now()) / 1000, h = Math.floor(s / 3600); return h >= 24 ? `in ${Math.floor(h / 24)}d ${h % 24}h` : h ? `in ${h}h ${Math.floor(s / 60) % 60}m` : `in ${Math.ceil(s / 60)} min`; };
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
const kind = label => el('span', {class: `tvkind k-${label.split(' ')[0].toLowerCase()}`}, label);
const watch = (v, r) => openViewer({...v, label: tvLabel(v), year: S.year, round: r.round});

function card(v, r) {
  const label = tvLabel(v);
  return el('button', {class: 'scard', title: `Watch here: ${v.title}`, onclick: () => watch(v, r)},
    el('div', {class: 'sthumb'}, v.img && el('img', {src: pic(v, 400), alt: '', decoding: 'async', onerror: retry}), kind(label),
      live(v) && el('span', {class: 'slive'}, '● LIVE'), v.duration > 0 && el('span', {class: 'sdur'}, dur(v.duration))),
    el('b', {}, v.title),
    el('small', {}, [v.start && when(new Date(v.start)), v.tier && `F1 TV ${v.tier}`].filter(Boolean).join(' · ')));
}

// a Netflix row: title, then cards that scroll sideways (‹ › page through them with a mouse)
function row(title, id, cards) {
  const track = el('div', {class: 'strack'}, ...cards);
  const page = d => track.scrollBy({left: d * track.clientWidth * .9, behavior: 'smooth'});
  return el('section', {class: 'srow', id},
    el('h3', {}, ...title),
    el('button', {class: 'spage prev', 'aria-label': 'Scroll left', onclick: () => page(-1)}, '‹'), track,
    el('button', {class: 'spage next', 'aria-label': 'Scroll right', onclick: () => page(1)}, '›'));
}

function billboard(v, r) {
  $('sbill').style.backgroundImage = v.img ? `url("${pic(v, 1600)}")` : '';
  $('sbill').replaceChildren(el('div', {class: 'sbilltext'},
    el('div', {class: 'eyebrow'}, live(v) ? '● LIVE NOW' : `ROUND ${r.round} · ${r.raceName.toUpperCase()}`),
    el('h1', {}, v.title),
    el('p', {}, [kind(tvLabel(v)), v.start && when(new Date(v.start)), v.duration > 0 && dur(v.duration)].filter(Boolean).flatMap((x, i) => i ? [' · ', x] : [x])),
    el('div', {class: 'sbillbtns'},
      el('button', {class: 'tvbtn', onclick: () => watch(v, r)}, '▶ Play'),
      el('a', {class: 'sghost', href: v.url, target: '_blank', rel: 'noopener'}, 'Open on F1 TV ↗'))));
}

// the weekend's videos; the newest weekend also fills the billboard
async function fill(rowEl, r, first) {
  try {
    const videos = await get(`/api/f1tv/${S.year}/${r.round}`);
    if (!rowEl.isConnected) return;
    if (!videos.length) return rowEl.remove();
    rowEl.querySelector('.strack').replaceChildren(...videos.map(v => card(v, r)));
    if (first) billboard(videos.find(live) ?? videos.find(v => tvLabel(v) === 'Race') ?? videos[0], r);
  } catch (e) {
    if (rowEl.isConnected) rowEl.querySelector('.strack').replaceChildren(el('p', {class: 'empty err'}, e.message));
  }
}

function build(year, races) {
  Object.assign(S, {year, races});
  const now = new Date();
  const soon = races.filter(r => at(r, '') > now).slice(0, 2).flatMap(r => SESSIONS
    .map(([k, name]) => ({r, name, d: at(r, k)})).filter(s => s.d && s.d > now));
  const sched = soon.map(({r, name, d}) => el('div', {class: 'scard sched'},
    el('div', {class: 'sthumb'}, flag(r['Circuit.Location.country'], 160), el('span', {class: 'sdur'}, until(d))),
    el('b', {}, `${name} · ${r.raceName}`), el('small', {}, when(d))));
  const weekends = races.filter(r => weekendStart(r) <= now).reverse();
  const rows = weekends.map(r => row([flag(r['Circuit.Location.country'], 40), `Round ${r.round} · ${r.raceName}`], `srow-${r.round}`,
    Array.from({length: 5}, () => el('div', {class: 'scard skel'}, el('div', {class: 'sthumb'})))));
  const queue = rows.map((x, i) => [x, weekends[i]]);
  const next = () => { const [x, r] = queue.shift() ?? []; return x?.isConnected && fill(x, r, x === rows[0]).then(next); };  // stops once the season changes
  $('sbill').style.backgroundImage = '';
  $('sbill').replaceChildren(el('div', {class: 'sbilltext'}, el('div', {class: 'eyebrow'}, `${year} SEASON`),
    el('h1', {}, weekends.length ? 'Loading F1 TV…' : 'No race weekends yet')));
  $('srows').replaceChildren(...(sched.length ? [row(['Coming up'], 'srow-next', sched)] : []), ...rows);
  for (let i = 0; i < 3; i++) next();
}

// open the Stream page on a season; round: scroll to that weekend's row (or the schedule, for one still to come)
export function showStream(year, races, round = null) {
  loadShaka().catch(() => {});  // the video player downloads while you browse, not after the click
  if (S.year !== year || S.races !== races) build(year, races);
  if (round) ($(`srow-${round}`) ?? $('srow-next'))?.scrollIntoView({block: 'center'});
  else scrollTo(0, 0);
}
