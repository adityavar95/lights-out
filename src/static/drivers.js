// Drivers tab: everyone who raced in the header's season (1950 on), with Wikipedia's portrait and the season's numbers
// worked out from its race results; a click opens the driver's whole career, season by season (/api/driver).
import {get, el, teamColor} from './util.js';

const id = r => r['Driver.driverId'] ?? r.Driver?.driverId;  // season tables come flattened, /api/driver rows nested
const team = r => [r['Constructor.constructorId'] ?? r.Constructor?.constructorId, r['Constructor.name'] ?? r.Constructor?.name];
const group = (rows, key) => rows.reduce((m, r) => m.set(key(r), [...(m.get(key(r)) ?? []), r]), new Map());
const uniq = xs => [...new Set(xs)];

// one driver's numbers over some race results. Poles = started P1 (grid penalties aside); W / F = withdrew, didn't qualify
export function tally(results) {
  const t = {starts: 0, wins: 0, podiums: 0, poles: 0, fastest: 0, dnfs: 0, points: 0, laps: 0, best: null};
  for (const r of results) {
    const p = +r.position || 0;
    if (!['W', 'F'].includes(r.positionText)) t.starts++;
    if (p === 1) t.wins++;
    if (p && p <= 3) t.podiums++;
    if (r.grid === '1') t.poles++;
    if ((r['FastestLap.rank'] ?? r.FastestLap?.rank) === '1') t.fastest++;  // Jolpica ranks fastest laps from 2004
    if (r.positionText === 'R') t.dnfs++;
    t.points += +r.points || 0;
    t.laps += +r.laps || 0;
    if (p && (!t.best || p < t.best)) t.best = p;
  }
  return t;
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
  const put = () => PHOTOS.get(d.id) && box.replaceChildren(el('img', {src: PHOTOS.get(d.id), alt: `${d.given} ${d.family}`}));
  put();
  return Object.assign(box, {put});
}

const stat = (label, v, title) => el('div', {title}, el('b', {}, v ?? '–'), el('small', {}, label));
const chip = ([tid, name]) => el('span', {class: 'chip', style: `background:${teamColor(tid, name)}`});

export function renderDrivers(root, year, standings, results, drivers) {
  const info = new Map(drivers.map(r => [r.driverId, {id: r.driverId, given: r.givenName ?? '', family: r.familyName ?? '', dob: r.dateOfBirth,
    nat: r.nationality, num: r.permanentNumber, code: r.code, url: r.url}]));
  const byDriver = group(results, id), place = new Map(standings.map(s => [s['Driver.driverId'], s]));
  // championship order, then anyone who entered without scoring a place (a DNQ, the Indy 500 in the 1950s)
  const ids = uniq([...standings.map(s => s['Driver.driverId']), ...info.keys(), ...byDriver.keys()]).filter(x => info.has(x));
  if (!ids.length) return root.replaceChildren(el('p', {class: 'empty'}, `No drivers for ${year} yet.`));
  const cards = ids.map(x => {
    const d = info.get(x), s = place.get(x), res = byDriver.get(x) ?? [], t = tally(res);
    const teams = uniq(res.map(r => team(r)[1])).map(n => team(res.find(r => team(r)[1] === n)));
    if (!teams.length && s?.Constructors?.length) teams.push(...s.Constructors.map(c => [c.constructorId, c.name]));
    const age = d.dob ? year - +d.dob.slice(0, 4) : null, pts = s ? +s.points : t.points, pic = photo(d);
    const card = el('button', {class: 'dcard', onclick: () => career(d)},
      pic, s?.position && el('span', {class: `dpos ${s.position === '1' ? 'champ' : ''}`}, `P${s.position}`),
      el('div', {class: 'dname'}, el('small', {}, d.given), el('b', {}, d.family)),
      el('div', {class: 'dmeta'}, [d.num && `#${d.num}`, d.code, d.nat, age && `age ${age}`].filter(Boolean).join(' · ')),
      el('div', {class: 'dteam'}, teams.map(tm => [chip(tm), tm[1]]).flatMap((x, i) => i ? [' / ', ...x] : x)),
      el('div', {class: 'dstats'}, stat('PTS', pts), stat('WINS', t.wins), stat('PODIUMS', t.podiums), stat('POLES', t.poles, 'Started from P1'),
        stat('FASTEST', year >= 2004 ? t.fastest : null, 'Fastest laps (Jolpica has them from 2004)'), stat('DNF', t.dnfs, 'Retired'), stat('STARTS', t.starts)));
    const text = `${d.given} ${d.family} ${d.code ?? ''} ${d.nat ?? ''} ${teams.map(x => x[1]).join(' ')}`.toLowerCase();
    return {card, pic, text, k: {champ: +s?.position || 999, wins: -t.wins, podiums: -t.podiums, poles: -t.poles, points: -pts, starts: -t.starts,
      age: age ?? 999, name: d.family}};
  });
  const grid = el('div', {class: 'dgrid'}, cards.map(c => c.card));
  const search = el('input', {type: 'search', placeholder: 'Find a driver, team or nationality', 'aria-label': 'Find a driver'});
  const sort = el('select', {'aria-label': 'Sort drivers'}, [['champ', 'Championship'], ['points', 'Points'], ['wins', 'Wins'], ['podiums', 'Podiums'],
    ['poles', 'Poles'], ['starts', 'Starts'], ['age', 'Youngest'], ['name', 'Name']].map(([v, l]) => new Option(l, v)));
  const show = () => {
    const q = search.value.trim().toLowerCase(), k = sort.value;
    grid.replaceChildren(...cards.filter(c => !q || c.text.includes(q))
      .sort((a, b) => (k === 'name' ? a.k.name.localeCompare(b.k.name) : a.k[k] - b.k[k]) || a.k.champ - b.k.champ).map(c => c.card));
  };
  search.oninput = sort.onchange = show;
  const champ = ids.find(x => place.get(x)?.position === '1');
  root.replaceChildren(el('div', {class: 'dhead'},
    el('h3', {}, `${year} · ${ids.length} drivers`, champ && el('span', {class: 'muted'}, ` · ${year < new Date().getFullYear() ? 'Champion' : 'Leader'}: ${info.get(champ).given} ${info.get(champ).family}`)),
    search, sort), grid);
  portraits([...info.values()]).then(() => cards.forEach(c => c.pic.put()));
}

// a driver's whole career in a dialog: totals, teams, then every season
async function career(d) {
  const body = el('div', {class: 'loading'}, el('div', {class: 'spinner'}), 'Loading career…');
  const dlg = el('dialog', {class: 'dcareer', onclose: () => dlg.remove(), onclick: e => e.target === dlg && dlg.close()},
    el('button', {class: 'dclose', 'aria-label': 'Close', onclick: () => dlg.close()}, '✕'), body);
  document.body.append(dlg);
  dlg.showModal();
  dispatchEvent(new CustomEvent('f1:panel', {detail: dlg}));  // the circuits / cars / trace panels close
  const bio = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle(d.url).replace(/ /g, '_'))}`)
    .then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  let c;
  try { c = await get(`/api/driver/${d.id}`); } catch (e) { return body.replaceChildren(el('p', {class: 'empty err'}, e.message)); }
  const {results, standings} = c, t = tally(results), w = await bio;
  const seasons = [...group(results, r => r.season)].map(([y, res]) => ({y, res, s: standings.find(s => s.season === y), t: tally(res)}));
  const champs = standings.filter(s => s.position === '1').map(s => s.season);
  const bestChamp = Math.min(...standings.map(s => +s.position || 999));
  const race = r => r && `${r.season} ${r.raceName}`;
  const stints = results.reduce((a, r) => {  // consecutive seasons with one team: "Ferrari 2010–2014"
    const [tid, name] = team(r), last = a.at(-1);
    if (last?.name === name) last.to = r.season; else a.push({tid, name, from: r.season, to: r.season});
    return a;
  }, []);
  const pic = w.thumbnail?.source ? el('div', {class: 'dphoto big'}, el('img', {src: w.originalimage?.source ?? w.thumbnail.source, alt: ''})) : photo(d, 'dphoto big');
  body.className = '';
  body.replaceChildren(
    el('div', {class: 'chead'}, pic, el('div', {},
      el('div', {class: 'eyebrow'}, [d.nat, d.num && `#${d.num}`, d.code].filter(Boolean).join(' · ').toUpperCase()),
      el('h2', {}, `${d.given} ${d.family}`),
      el('p', {class: 'muted'}, [d.dob && `Born ${new Date(d.dob + 'T00:00:00').toLocaleDateString(undefined, {day: 'numeric', month: 'long', year: 'numeric'})}`,
        `${seasons.length} season${seasons.length === 1 ? '' : 's'} · ${seasons[0]?.y}–${seasons.at(-1)?.y}`].filter(Boolean).join(' · ')),
      champs.length > 0 && el('p', {class: 'ctitles'}, `🏆 World Champion ${champs.join(', ')}`),
      w.extract && el('p', {class: 'cbio'}, w.extract),
      d.url && el('a', {href: d.url, target: '_blank', rel: 'noopener'}, 'Wikipedia ↗'))),
    el('div', {class: 'dstats big'}, stat('TITLES', champs.length), stat('BEST CHAMP.', bestChamp < 999 ? `P${bestChamp}` : null), stat('STARTS', t.starts),
      stat('WINS', t.wins), stat('PODIUMS', t.podiums), stat('POLES', t.poles, 'Started from P1'), stat('FASTEST', t.fastest, 'Fastest laps (from 2004)'),
      stat('POINTS', +standings.reduce((s, x) => s + +x.points, 0).toFixed(1)), stat('DNF', t.dnfs, 'Retired'), stat('LAPS', t.laps),
      stat('WIN RATE', t.starts ? `${Math.round(t.wins / t.starts * 100)}%` : null), stat('BEST FINISH', t.best && `P${t.best}`)),
    el('dl', {class: 'cfacts'},
      ...[['First race', race(results[0])], ['First win', race(results.find(r => r.position === '1'))], ['Last race', race(results.at(-1))]]
        .flatMap(([k, v]) => v ? [el('dt', {}, k), el('dd', {}, v)] : []),
      el('dt', {}, 'Teams'), el('dd', {}, stints.map(s => el('span', {class: 'cteam'}, chip([s.tid, s.name]), `${s.name} ${s.from === s.to ? s.from : `${s.from}–${s.to}`}`)))),
    el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
      el('thead', {}, el('tr', {}, ['Season', 'Team', 'Champ.', 'Points', 'Starts', 'Wins', 'Podiums', 'Poles', 'Fastest', 'DNF', 'Best'].map(h => el('th', {}, h)))),
      el('tbody', {}, seasons.map(({y, res, s, t: st}) => el('tr', {class: s?.position === '1' ? 'champ' : ''},
        el('td', {}, y), el('td', {}, uniq(res.map(r => team(r)[1])).join(' / ')), el('td', {}, s?.position ? `P${s.position}` : '–'),
        el('td', {}, s?.points ?? st.points), ...[st.starts, st.wins, st.podiums, st.poles, +y >= 2004 ? st.fastest : '–', st.dnfs, st.best ? `P${st.best}` : '–']
          .map(v => el('td', {}, v))))))));
}
