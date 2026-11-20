// Drivers tab: everyone who raced in the header's season (1950 on), with Wikipedia's portrait and the season's numbers
// worked out from its race results; a click opens the driver's whole career, season by season (/api/driver).
import {get, rows, el, teamColor, th, skeleton} from './util.js';
import {modal} from './palette.js';
import {teammates, qualiRounds, h2hLine, fmtGap, headToHead} from './season.js';
import {favourite, setFavourite} from './favourite.js';

const id = r => r['Driver.driverId'] ?? r.Driver?.driverId;  // season tables come flattened, /api/driver rows nested
const team = r => [r['Constructor.constructorId'] ?? r.Constructor?.constructorId, r['Constructor.name'] ?? r.Constructor?.name];
const group = (rows, key) => rows.reduce((m, r) => m.set(key(r), [...(m.get(key(r)) ?? []), r]), new Map());
const uniq = xs => [...new Set(xs)];
// a championship is decided once the calendar's last race date has passed; until then P1 is only the leader
export const decided = (races, today = new Date().toISOString().slice(0, 10)) => races.at(-1)?.date < today;

// one driver's numbers over some race results. Poles = started P1 (grid penalties aside); W / F = withdrew, didn't qualify.
// A shared drive (the 1950s) gives a driver two rows in one race: one start, and a DNF only if neither car was classified
export function tally(results) {
  const t = {starts: 0, wins: 0, podiums: 0, poles: 0, fastest: 0, dnfs: 0, points: 0, laps: 0, best: null};
  for (const r of results) {
    const p = +r.position || 0;
    if (p === 1) t.wins++;
    if (p && p <= 3) t.podiums++;
    if (r.grid === '1') t.poles++;
    if ((r['FastestLap.rank'] ?? r.FastestLap?.rank) === '1') t.fastest++;  // Jolpica ranks fastest laps from 2004
    t.points += +r.points || 0;
    t.laps += +r.laps || 0;
    if (p && (!t.best || p < t.best)) t.best = p;
  }
  for (const race of group(results, r => `${r.season}/${r.round}`).values()) {
    if (race.some(r => !['W', 'F'].includes(r.positionText))) t.starts++;
    if (race.some(r => r.positionText === 'R') && !race.some(r => /^\d+$/.test(r.positionText))) t.dnfs++;
  }
  return t;
}

// the season table's rows don't say which race they're from, but come race by race, classified in order (a shared car's drivers tie): a position that
// drops starts the next race
export function numbered(results) {
  let round = 1, last = 0;
  return results.map(r => {
    if (+r.position < last) round++;
    last = +r.position;
    return {...r, round};
  });
}

// portraits: the lead image of each driver's Wikipedia article (Jolpica links it), 50 titles per request; pilicense
// 'any' because the default, free images only, leaves out many (Mike Hawthorn's is fair use)
const PHOTOS = new Map();  // driverId -> image url, '' when the article has none
const wikiTitle = u => decodeURIComponent(u?.split('/wiki/')[1]?.split('#')[0] ?? '').replace(/_/g, ' ');
async function portraits(drivers) {
  const todo = drivers.filter(d => !PHOTOS.has(d.id) && wikiTitle(d.url));
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const q = new URLSearchParams({action: 'query', format: 'json', formatversion: 2, origin: '*', prop: 'pageimages', piprop: 'thumbnail',
      pithumbsize: 320, pilimit: 50, pilicense: 'any', redirects: 1, titles: batch.map(d => wikiTitle(d.url)).join('|')});
    const {query} = await fetch(`https://en.wikipedia.org/w/api.php?${q}`).then(r => r.json()).catch(() => ({}));
    if (!query) continue;  // offline / blocked: initials stay, the next draw tries again
    const moves = [...(query.normalized ?? []), ...(query.redirects ?? [])];  // in order: spelling first, then redirects
    const final = t => moves.reduce((t, m) => (m.from === t ? m.to : t), t);
    const src = new Map((query.pages ?? []).map(p => [p.title, p.thumbnail?.source ?? '']));
    for (const d of batch) PHOTOS.set(d.id, src.get(final(wikiTitle(d.url))) ?? '');
  }
}
function photo(d, cls = 'dphoto') {
  const box = el('div', {class: cls}, el('span', {}, `${d.given[0] ?? ''}${d.family[0] ?? ''}`));
  // has-photo once the picture has loaded: a driver card shows no photo area until then (style.css)
  const put = () => PHOTOS.get(d.id) && box.replaceChildren(el('img', {src: PHOTOS.get(d.id), alt: `${d.given} ${d.family}`, onload: () => [box, box.parentElement].forEach(e => e?.classList.add('has-photo'))}));
  put();
  return Object.assign(box, {put});
}
// results rows -> a round portrait each (the Results podium), filled in when Wikipedia answers
export function faces(results) {
  const ds = results.map(r => ({id: id(r), given: r['Driver.givenName'] ?? '', family: r['Driver.familyName'] ?? '', url: r['Driver.url']}));
  // no photo (yet): the driver's code on their team's colour, not a bare disc
  const boxes = ds.map((d, i) => Object.assign(photo(d, 'dphoto face'), {style: `--team:${teamColor(results[i]['Constructor.constructorId'], results[i]['Constructor.name'])}`}));
  boxes.forEach((b, i) => results[i]['Driver.code'] && b.querySelector('span') && (b.querySelector('span').textContent = results[i]['Driver.code']));
  portraits(ds).then(() => boxes.forEach(b => b.put()));
  return boxes;
}

const stat = (label, v, title) => el('div', {title}, el('b', {}, v ?? '–'), el('small', {}, label));
const chip = ([tid, name]) => el('span', {class: 'chip', style: `background:${teamColor(tid, name)}`});

// quali: a promise of the season's qualifying table, which the cards' teammate lines fill in from when it lands;
// open: a driverId whose career opens at once (a link, share.js career)
export function renderDrivers(root, year, standings, results, drivers, over, quali = Promise.resolve([]), open = null) {
  const info = new Map(drivers.map(r => [r.driverId, {id: r.driverId, given: r.givenName ?? '', family: r.familyName ?? '', dob: r.dateOfBirth,
    nat: r.nationality, num: r.permanentNumber, code: r.code, url: r.url}]));
  const raced = numbered(results), byDriver = group(raced, id), place = new Map(standings.map(s => [s['Driver.driverId'], s]));
  const family = x => info.get(x)?.family ?? x;
  const h2h = quali.catch(() => []).then(q => teammates(raced, qualiRounds(q)));
  // championship order, then anyone who entered without scoring a place (a DNQ, the Indy 500 in the 1950s)
  const ids = uniq([...standings.map(s => s['Driver.driverId']), ...info.keys(), ...byDriver.keys()]).filter(x => info.has(x));
  if (!ids.length) return root.replaceChildren(el('p', {class: 'empty'}, `No drivers for ${year} yet.`));
  const cards = ids.map(x => {
    const d = info.get(x), s = place.get(x), res = byDriver.get(x) ?? [], t = tally(res);
    const teams = uniq(res.map(r => team(r)[1])).map(n => team(res.find(r => team(r)[1] === n)));
    if (!teams.length && s?.Constructors?.length) teams.push(...s.Constructors.map(c => [c.constructorId, c.name]));
    const age = d.dob ? year - +d.dob.slice(0, 4) : null, pts = s ? +s.points : t.points, pic = photo(d), line = el('div', {class: 'dh2h'});
    h2h.then(m => { line.title = h2hLine(m.get(x), family); line.replaceChildren(...line.title.split(' · ').flatMap((part, i) => [i ? ' · ' : '', el('span', {}, part)])); });  // wraps between facts, never inside '11-8'
    const card = el('button', {class: 'dcard', onclick: () => career(d, h2h, year, family, others)},
      pic, s?.position && el('span', {class: `dpos ${over && s.position === '1' ? 'champ' : ''}`}, `P${s.position}`),
      el('div', {class: 'dname'}, el('small', {}, d.given), el('b', {}, d.family)),
      el('div', {class: 'dmeta'}, [d.num && `#${d.num}`, d.code, d.nat, age && `age ${age}`].filter(Boolean).join(' · ')),
      el('div', {class: 'dteam'}, el('span', {}, teams.map(tm => [chip(tm), tm[1]]).flatMap((x, i) => i ? [' / ', ...x] : x)), el('span', {class: 'dstarts'}, `${t.starts} ${t.starts === 1 ? 'start' : 'starts'}`)),
      el('div', {class: 'dstats'}, stat('PTS', pts), stat('WINS', t.wins), stat('PODIUMS', t.podiums), stat('POLES', t.poles, 'Started from P1'),
        stat('FASTEST', year >= 2004 ? t.fastest : null, 'Fastest laps (Jolpica has them from 2004)'), stat('DNF', t.dnfs, 'Retired')), line);
    const text = `${d.given} ${d.family} ${d.code ?? ''} ${d.nat ?? ''} ${teams.map(x => x[1]).join(' ')}`.toLowerCase();
    return {id: x, card, pic, text, reserve: !t.starts && !pts, k: {champ: +s?.position || 999, wins: -t.wins, podiums: -t.podiums, poles: -t.poles, points: -pts, starts: -t.starts,
      age: age ?? 999, name: d.family}};
  });
  const others = ids.map(x => info.get(x));  // the career dialog's head-to-head picks from the season's field
  const grid = el('div', {class: 'dgrid'});
  let showAll = false;
  const search = el('input', {type: 'search', placeholder: 'Find a driver, team or nationality', 'aria-label': 'Find a driver'});
  const sort = el('select', {'aria-label': 'Sort drivers'}, [['champ', 'Championship'], ['points', 'Points'], ['wins', 'Wins'], ['podiums', 'Podiums'],
    ['poles', 'Poles'], ['starts', 'Starts'], ['age', 'Youngest'], ['name', 'Name']].map(([v, l]) => new Option(l, v)));
  const show = () => {
    const q = search.value.trim().toLowerCase(), k = sort.value, fav = favourite()?.id;
    const found = cards.filter(c => (q ? c.text.includes(q) : !c.reserve || showAll))
      .sort((a, b) => (b.id === fav) - (a.id === fav) || (k === 'name' ? a.k.name.localeCompare(b.k.name) : a.k[k] - b.k[k]) || a.k.champ - b.k.champ).map(c => c.card);
    grid.replaceChildren(...(found.length ? found : [el('p', {class: 'empty'}, `No drivers match “${search.value.trim()}”.`)]));
  };
  search.oninput = sort.onchange = show;
  const reserves = cards.filter(c => c.reserve).length, ran = ids.length - reserves;
  showAll = !ran;  // before a season's first race, the entry list is all there is
  const moreText = () => `${showAll ? 'Hide' : 'Show'} ${reserves} entered without a start`;
  const more = el('button', {class: 'pill dmore', hidden: !reserves || !ran, onclick: () => { showAll = !showAll; show(); more.textContent = moreText(); }}, moreText());
  show();
  const champ = ids.find(x => place.get(x)?.position === '1');
  root.replaceChildren(el('div', {class: 'dhead'},
    el('h2', {}, `${year} · ${ran || ids.length} drivers`, champ && el('span', {class: 'muted'}, ` · ${over ? 'Champion' : 'Leader'}: ${info.get(champ).given} ${info.get(champ).family}`)),
    search, sort), grid, more);
  portraits([...info.values()]).then(() => cards.forEach(c => c.pic.put()));
  if (info.has(open)) career(info.get(open), h2h, year, family, others);
}

// any two drivers, career and the header season (fan roadmap A5): one more /api/driver request for the other one
function compare(d, mine, others, year) {
  const pick = el('select', {'aria-label': 'Compare with'}, new Option('Pick a driver', ''),
    ...others.filter(o => o.id !== d.id).map(o => new Option(`${o.given} ${o.family}`, o.id)));
  const out = el('div', {});
  pick.onchange = async () => {
    const o = others.find(x => x.id === pick.value);
    if (!o) return out.replaceChildren();
    out.replaceChildren(skeleton(2));
    let theirs;
    try { theirs = (await get(`/api/driver/${o.id}`)).results; } catch (e) { return out.replaceChildren(el('p', {class: 'empty err'}, e.message)); }
    if (pick.value !== o.id) return;
    const rec = (label, h) => el('tr', {}, el('td', {}, label), el('td', {class: 'num'}, h.races),
      el('td', {class: 'num'}, `${h.grid.wins}–${h.grid.losses}`), el('td', {class: 'num'}, `${h.race.wins}–${h.race.losses}`));
    const inYear = rs => rs.filter(r => r.season === String(year)), all = headToHead(mine, theirs), season = headToHead(inYear(mine), inYear(theirs));
    out.replaceChildren(all.races ? el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
      el('thead', {}, el('tr', {}, ['Races together', 'Races', 'Ahead on the grid', 'Ahead at the flag'].map(th))),
      el('tbody', {}, rec(`Career (${all.seasons[0]}${all.seasons.length > 1 ? `–${all.seasons.at(-1)}` : ''})`, all), season.races ? rec(String(year), season) : ''))) : '',
      el('p', {class: 'muted small'}, all.races ? `${d.family} first. Grid order counts penalties; the flag counts only races both finished classified.`
        : `${d.family} and ${o.family} never started a race together.`));
  };
  return [el('h3', {}, 'Head to head'), el('div', {class: 'controls'}, pick), out];
}

// the header season's teammates. Only that season: /api/driver holds this driver's rows, not their teammates', so a whole
// career would take a request per season
function h2hTable(records, year, family) {
  const known = records.filter(m => m.q.n || m.r.n);
  if (!known.length) return el('p', {class: 'muted small'}, `No teammate comparison for ${year}.`);
  return [el('h3', {}, `${year} teammates`),
    el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
      el('thead', {}, el('tr', {}, ['Teammate', 'Rounds', 'Qualifying', 'Median gap', 'Race'].map(th))),
      el('tbody', {}, known.map(m => el('tr', {}, el('td', {}, family(m.mate)), el('td', {class: 'num'}, m.rounds),
        el('td', {class: 'num'}, m.q.n ? `${m.q.wins}–${m.q.losses}` : '–'), el('td', {class: 'num'}, m.q.n ? fmtGap(m.q.gap) : '–'),
        el('td', {class: 'num'}, m.r.n ? `${m.r.wins}–${m.r.losses}` : '–')))))),
    el('p', {class: 'muted small'}, `${year} only: a whole career would take a request per season. Qualifying compares the last session both reached, negative gap = quicker; the race counts only rounds where both were classified.`)];
}

// a driver's whole career in a dialog: totals, teams, then every season. Open, it's in the address (share.js career).
async function career(d, h2h, year, family, others = []) {
  const body = el('div', {}, skeleton());
  const dlg = modal('', `${d.given} ${d.family}`, null, el('button', {class: 'dclose', 'aria-label': 'Close', onclick: () => dlg.close()}, '✕'), body);
  dispatchEvent(new CustomEvent('f1:panel', {detail: dlg}));  // the circuits / cars / trace panels close
  dispatchEvent(new CustomEvent('f1:address', {detail: {career: d.id}}));
  dlg.addEventListener('close', () => dispatchEvent(new CustomEvent('f1:address', {detail: {}})));
  const isFav = () => favourite()?.id === d.id;
  const star = el('button', {class: 'pill', 'aria-pressed': String(isFav()), title: 'Your favourite: picked out in replays, first in tables',
    onclick: () => { setFavourite(isFav() ? null : {id: d.id, code: d.code, name: `${d.given} ${d.family}`}); star.setAttribute('aria-pressed', String(isFav())); star.textContent = isFav() ? '★ Favourite' : '☆ Favourite'; }},
    isFav() ? '★ Favourite' : '☆ Favourite');
  const bio = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle(d.url).replace(/ /g, '_'))}`)
    .then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  let c;
  try { c = await get(`/api/driver/${d.id}`); } catch (e) { return body.replaceChildren(el('p', {class: 'empty err'}, e.message)); }
  const {results, standings} = c, t = tally(results), w = await bio, thisYear = new Date().getFullYear();
  const over = await get(`/api/jolpica/${thisYear}/races`).then(x => decided(rows(x))).catch(() => false);
  const final = s => +s.season < thisYear || over;  // a season still running has a leader, not a champion
  const seasons = [...group(results, r => r.season)].map(([y, res]) => ({y, res, s: standings.find(s => s.season === y), t: tally(res)}));
  const champs = standings.filter(s => s.position === '1' && final(s)).map(s => s.season);
  const bestChamp = Math.min(...standings.filter(final).map(s => +s.position || 999));
  const race = r => r && `${r.season} ${r.raceName}`;
  const stints = results.reduce((a, r) => {  // consecutive seasons with one team: "Ferrari 2010–2014"
    const [tid, name] = team(r), last = a.at(-1);
    if (last?.name === name) last.to = r.season; else a.push({tid, name, from: r.season, to: r.season});
    return a;
  }, []);
  const mates = el('div', {class: 'ch2h'});
  h2h.then(m => mates.replaceChildren(...[h2hTable(m.get(d.id) ?? [], year, family)].flat()));
  const pic = w.thumbnail?.source ? el('div', {class: 'dphoto big'}, el('img', {src: w.thumbnail.source, alt: ''})) : photo(d, 'dphoto big');
  body.className = '';
  body.replaceChildren(
    el('div', {class: 'chead'}, pic, el('div', {},
      el('div', {class: 'eyebrow'}, [d.nat, d.num && `#${d.num}`, d.code].filter(Boolean).join(' · ').toUpperCase()),
      el('h2', {id: 'dcareer-name'}, `${d.given} ${d.family}`),
      el('p', {class: 'muted'}, [d.dob && `Born ${new Date(d.dob + 'T00:00:00').toLocaleDateString(undefined, {day: 'numeric', month: 'long', year: 'numeric'})}`,
        seasons.length && `${seasons.length} season${seasons.length === 1 ? '' : 's'} · ${seasons[0].y}–${seasons.at(-1).y}`].filter(Boolean).join(' · ')),
      champs.length > 0 && el('p', {class: 'ctitles'}, `World Champion ${champs.join(', ')}`),
      w.extract && el('p', {class: 'cbio'}, w.extract),
      el('p', {}, star, ' ', d.url && el('a', {href: d.url, target: '_blank', rel: 'noopener'}, 'Wikipedia ↗')))),
    el('div', {class: 'dstats big'}, stat('TITLES', champs.length), stat('BEST CHAMP.', bestChamp < 999 ? `P${bestChamp}` : null), stat('STARTS', t.starts),
      stat('WINS', t.wins), stat('PODIUMS', t.podiums), stat('POLES', t.poles, 'Started from P1'), stat('FASTEST', t.fastest, 'Fastest laps (from 2004)'),
      stat('POINTS', +standings.reduce((s, x) => s + +x.points, 0).toFixed(1)), stat('DNF', t.dnfs, 'Retired'), stat('LAPS', t.laps),
      stat('WIN RATE', t.starts ? `${Math.round(t.wins / t.starts * 100)}%` : null), stat('BEST FINISH', t.best && `P${t.best}`)),
    el('dl', {class: 'cfacts'},
      ...[['First race', race(results[0])], ['First win', race(results.find(r => r.position === '1'))], ['Last race', race(results.at(-1))]]
        .flatMap(([k, v]) => v ? [el('dt', {}, k), el('dd', {}, v)] : []),
      el('dt', {}, 'Teams'), el('dd', {}, stints.map(s => el('span', {class: 'cteam'}, chip([s.tid, s.name]), `${s.name} ${s.from === s.to ? s.from : `${s.from}–${s.to}`}`)))),
    mates,
    ...(others.length > 1 ? compare(d, results, others, year) : []),
    el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
      el('thead', {}, el('tr', {}, ['Season', 'Team', 'Champ.', 'Points', 'Starts', 'Wins', 'Podiums', 'Poles', 'Fastest', 'DNF', 'Best'].map(th))),
      el('tbody', {}, seasons.map(({y, res, s, t: st}) => el('tr', {class: s?.position === '1' && final(s) ? 'champ' : ''},
        el('td', {}, y), el('td', {}, uniq(res.map(r => team(r)[1])).join(' / ')), el('td', {}, s?.position ? `P${s.position}` : '–'),
        el('td', {}, s?.points ?? st.points), ...[st.starts, st.wins, st.podiums, st.poles, +y >= 2004 ? st.fastest : '–', st.dnfs, st.best ? `P${st.best}` : '–']
          .map(v => el('td', {}, v))))))));
}
