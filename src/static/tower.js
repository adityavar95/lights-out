// Broadcast timing tower: position, team colour, driver code, a switchable timing column (gap to leader / interval
// to the car ahead / last lap), tyre compound and live 3-segment sector bars. Rows slide to their new position.
import {el, fmtLap, lastBefore, setAttr, setText} from './util.js';

export const ROW_H = 30;
export const TYRES = {SOFT: ['S', '#ff2d2d'], MEDIUM: ['M', '#ffd400'], HARD: ['H', '#f2f2f2'], INTERMEDIATE: ['I', '#3ec455'], WET: ['W', '#2b8cff']};
export const COLUMNS = [['gap', 'GAP'], ['int', 'INTERVAL'], ['last', 'LAST LAP'], ['trap', 'SPEED TRAP'], ['champ', 'AS IT STANDS']];  // trap, champ: live only

// the row (index down the shown order) a key moves focus to; undefined for any other key
export const rowAfter = (key, i, n) => ({ArrowDown: Math.min(i + 1, n - 1), ArrowUp: Math.max(i - 1, 0), Home: 0, End: n - 1}[key]);

// list: the <ol>; returns {driver id: row}. One tab stop for the whole tower: the arrows walk it in the order on screen.
export function buildTower(list, drivers, onSelect) {
  const rows = {};
  list.replaceChildren();
  const onkey = (e, d, row) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const order = [...list.children].sort((a, b) => a.dataset.i - b.dataset.i), next = rowAfter(e.key, order.indexOf(row), order.length);
    if (e.key !== 'Enter' && e.key !== ' ' && next === undefined) return;
    e.preventDefault();
    e.stopPropagation();  // Space here selects; it mustn't play or pause the replay as well
    if (next === undefined) onSelect(d.id);
    else order[next].focus();
  };
  for (const [i, d] of drivers.entries()) {
    const row = el('li', {class: 'trow', role: 'button', tabindex: i ? -1 : 0, 'data-i': i, 'aria-pressed': 'false', 'aria-label': d.name ?? d.code, onclick: () => onSelect(d.id),
                          onkeydown: e => onkey(e, d, row),
                          onfocus: () => { for (const r of list.children) r.tabIndex = r === row ? 0 : -1; }},
      el('span', {class: 'pos'}), el('span', {class: 'bar', style: `background:${d.color}`}),
      el('span', {class: 'code'}, el('span', {}, d.code, el('small', {class: 'chg'})), el('span', {class: 'secs', 'aria-hidden': 'true'}, el('i'), el('i'), el('i'))),
      el('span', {class: 'gap'}), el('span', {class: 'tyre'}), el('span', {class: 'badge'}),
      el('button', {class: 'trcmp', tabindex: -1, title: `Compare ${d.code}'s telemetry`, 'aria-label': `Compare ${d.code}'s telemetry trace`,
                    onclick: e => { e.stopPropagation(); dispatchEvent(new CustomEvent('f1:trace', {detail: d.id})); },
                    onkeydown: e => e.stopPropagation()}, '⌁'));  // opens tracemodal.js
    list.append(row);
    rows[d.id] = row;
  }
  list.style.height = `calc(${drivers.length} * var(--row-h, ${ROW_H}px))`;
  // the whole field without scrolling where the panel allows it: rows give way down to 22 px
  list.fit ??= new ResizeObserver(() => {
    const room = list.parentElement.clientHeight, n = list.children.length;
    list.style.setProperty('--row-h', `${n ? Math.max(22, Math.min(ROW_H, Math.floor(room / n * 10) / 10)) : ROW_H}px`);
  });
  list.fit.observe(list.parentElement);
  return rows;
}

const num = v => (typeof v === 'number' ? v : null);
const plus = v => `+${v.toFixed(3)}`;

// Per-driver timing columns at time t. Sector colours follow F1 convention: purple = fastest of the session so far,
// green = the driver's personal best, yellow = completed but slower. The bars show the sectors done on the current lap
// (the last finished lap once a driver stops). Lap-timing replays have no sector times, so their bars stay empty.
export function timing(S, board, t) {
  const out = {};
  if (S.live) {
    board.forEach(b => {
      out[b.d.id] = {gap: b.gapText, int: b.pos === 1 ? b.gapText : b.interval || b.gapText, last: b.last || '', lastCls: '',
                     trap: b.trap ? `${b.trap} km/h` : '', trapCls: b.trapBest ? 'p' : '',
                     champ: b.champ ? `P${b.champ.rank} · ${b.champ.points}` : '', champCls: b.champ?.rank < b.champ?.was ? 'g' : '',
                     sectors: b.sectors || [], intNum: parseFloat(b.interval) || null};
    });
    return out;
  }
  // completed laps up to t per driver: [lap end time, duration, sector times or null]
  const done = {};
  if (S.lapsBy) {  // GPS replays and simulations carry timed laps with sectors
    for (const [id, laps] of Object.entries(S.lapsBy))
      done[id] = laps.filter(l => l[2] && l[0] + l[2] <= t).map(l => [l[0] + l[2], l[2], l.slice(3, 6)]);
  } else {
    for (const b of board) {
      const c = S.data.cum[b.d.id], laps = [];
      for (let k = 0; k < c.length && c[k] <= t; k++) laps.push([c[k], c[k] - (k ? c[k - 1] : 0), null]);
      done[b.d.id] = laps;
    }
  }
  // session bests so far: fastest lap and fastest time in each sector (a sector counts once it has been completed)
  let bestLap = Infinity;
  const bestSec = [Infinity, Infinity, Infinity], pbSec = {}, pbLap = {};
  for (const [id, laps] of Object.entries(done)) {
    pbSec[id] = [Infinity, Infinity, Infinity];
    pbLap[id] = Infinity;
    for (const [, dur, secs] of laps) {
      bestLap = Math.min(bestLap, dur);
      pbLap[id] = Math.min(pbLap[id], dur);
      secs?.forEach((s, i) => { if (s) { bestSec[i] = Math.min(bestSec[i], s); pbSec[id][i] = Math.min(pbSec[id][i], s); } });
    }
  }
  const color = (v, i, id) => (!v ? '' : v <= bestSec[i] ? 'p' : v <= pbSec[id][i] ? 'g' : 'y');
  let prev = null;
  board.forEach(b => {
    const id = b.d.id, laps = done[id] || [], last = laps.at(-1);
    let sectors = [];
    if (S.lapsBy) {
      const cur = S.lapsBy[id]?.[lastBefore(S.lapsBy[id], t)];  // lap in progress (or the last one started)
      if (cur && cur[3]) {
        let end = cur[0];
        sectors = cur.slice(3, 6).map((s, i) => { end += s || Infinity; return end <= t ? color(s, i, id) : ''; });
      }
      if (!sectors.some(Boolean) && last?.[2]) sectors = last[2].map((s, i) => color(s, i, id));
    }
    const gapNum = num(b.gap) ?? b.gapNum ?? null;
    // position and gap feeds update at different moments, so the car ahead can briefly show the larger gap
    const intNum = b.pos === 1 || gapNum === null || prev === null ? null : Math.max(0, gapNum - prev);
    out[id] = {
      gap: b.gapText,
      int: b.pos === 1 ? b.gapText : intNum !== null ? plus(intNum) : b.gapText,
      last: last ? fmtLap(last[1]) : '',
      lastCls: !last ? '' : last[1] <= bestLap ? 'p' : last[1] <= pbLap[id] ? 'g' : '',
      sectors, intNum,
    };
    prev = gapNum;
  });
  return out;
}

// The order the tower shows: the board's once it has held for 3 updates (~0.4 s), or the newest after 1 s at the
// latest. Cars running side by side swap places in the board every frame, and rows chasing a target that flips faster
// than they can slide ended up stacked half-way across each other. state: {} kept between calls; force: take the
// board's order now (a scrub). Positions are renumbered down the shown order, so they always read 1, 2, 3...
export function stableOrder(state, board, now, force = false) {
  const ids = board.map(b => b.d.id), key = ids.join(), same = state.ids?.length === ids.length && ids.every(id => state.ids.includes(id));
  if (force || !same) Object.assign(state, {ids, key, pend: null, n: 0, since: now});
  else if (key === state.key) Object.assign(state, {pend: null, n: 0, since: now});  // in step with the board again
  else {
    if (key === state.pend) state.n++;
    else Object.assign(state, {pend: key, n: 1});
    if (state.n >= 3 || now - state.since > 1000) Object.assign(state, {ids, key, pend: null, n: 0, since: now});
  }
  const by = Object.fromEntries(board.map(b => [b.d.id, b]));
  return state.ids.map((id, i) => ({...by[id], pos: by[id].out ? by[id].pos : i + 1}));
}

export function renderTower(rows, board, cols, column, selected, onTyre) {
  const inside = board.length && rows[board[0].d.id].parentNode.matches(':focus-within');
  board.forEach((b, i) => {
    const row = rows[b.d.id], [pos, , code, gap, tyre, badge] = row.children, c = cols[b.d.id];
    row.style.transform = `translateY(calc(${i} * var(--row-h, ${ROW_H}px)))`;
    row.classList.toggle('out', b.out);
    row.classList.toggle('sel', selected === b.d.id);
    setAttr(row, 'data-i', i);
    if (!inside) setAttr(row, 'tabindex', i ? -1 : 0);  // Tab lands on the leader
    setAttr(row, 'aria-pressed', selected === b.d.id);
    setAttr(row, 'aria-label', `${b.out ? 'Out' : `P${b.pos}`}, ${b.d.name ?? b.d.code}`);
    setText(pos, b.out ? '–' : b.pos);
    // places gained or lost since the first order shown (the grid, unless a link opened the replay mid-race)
    row.dataset.start ??= b.pos;
    const gained = row.dataset.start - b.pos, chg = code.firstChild.lastChild;
    setText(chg, b.out || !gained ? '' : `${gained > 0 ? '▲' : '▼'}${Math.abs(gained)}`);
    setAttr(chg, 'data-up', gained > 0);
    setText(gap, c[column] || '');
    setAttr(gap, 'data-c', column === 'last' ? c.lastCls : column === 'trap' ? c.trapCls : column === 'champ' ? c.champCls : '');
    [...code.lastChild.children].forEach((bar, k) => setAttr(bar, 'data-s', c.sectors[k] || ''));
    const ty = TYRES[b.tyre];
    setText(tyre, ty ? ty[0] : '');
    tyre.style.borderColor = ty ? ty[1] : 'transparent';
    setAttr(tyre, 'title', b.tyre ? `${b.tyre}${b.age ? `, ${b.age} laps old` : ''}${b.stops ? `, ${b.stops} stop${b.stops > 1 ? 's' : ''}` : ''}` : '');
    onTyre(b.d.id, ty?.[1]);
    setText(badge, b.pit ? 'PIT' : b.stops ? `${b.stops}` : '');
    setAttr(badge, 'data-k', b.pit ? 'pit' : 'stops');
    setAttr(badge, 'title', b.stops ? `${b.stops} pit stop${b.stops > 1 ? 's' : ''}` : '');
  });
}
