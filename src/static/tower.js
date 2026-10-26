// Broadcast timing tower: position, team colour, driver code, a switchable timing column (gap to leader / interval
// to the car ahead / last lap), tyre compound and live 3-segment sector bars. Rows slide to their new position.
import {el, fmtLap, lastBefore} from './util.js';

export const ROW_H = 30;
export const TYRES = {SOFT: ['S', '#ff2d2d'], MEDIUM: ['M', '#ffd400'], HARD: ['H', '#f2f2f2'], INTERMEDIATE: ['I', '#3ec455'], WET: ['W', '#2b8cff']};
export const COLUMNS = [['gap', 'GAP'], ['int', 'INTERVAL'], ['last', 'LAST LAP'], ['trap', 'SPEED TRAP']];  // trap: live only

// list: the <ol>; returns {driver id: row}
export function buildTower(list, drivers, onSelect) {
  const rows = {};
  list.replaceChildren();
  for (const d of drivers) {
    const row = el('li', {class: 'trow', tabindex: 0, onclick: () => onSelect(d.id),
                          onkeydown: e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(d.id))},
      el('span', {class: 'pos'}), el('span', {class: 'bar', style: `background:${d.color}`}),
      el('span', {class: 'code'}, d.code, el('span', {class: 'secs', 'aria-hidden': 'true'}, el('i'), el('i'), el('i'))),
      el('span', {class: 'gap'}), el('span', {class: 'tyre'}), el('span', {class: 'badge'}),
      el('button', {class: 'trcmp', title: `Compare ${d.code}'s telemetry`, 'aria-label': `Compare ${d.code}'s telemetry trace`,
                    onclick: e => { e.stopPropagation(); dispatchEvent(new CustomEvent('f1:trace', {detail: d.id})); },
                    onkeydown: e => e.stopPropagation()}, '⌁'));  // opens tracemodal.js
    list.append(row);
    rows[d.id] = row;
  }
  list.style.height = `${drivers.length * ROW_H}px`;
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
  board.forEach((b, i) => {
    const row = rows[b.d.id], [pos, , code, gap, tyre, badge] = row.children, c = cols[b.d.id];
    row.style.transform = `translateY(${i * ROW_H}px)`;
    row.classList.toggle('out', b.out);
    row.classList.toggle('sel', selected === b.d.id);
    pos.textContent = b.out ? '–' : b.pos;
    gap.textContent = c[column] || '';
    gap.dataset.c = column === 'last' ? c.lastCls : column === 'trap' ? c.trapCls : '';
    [...code.lastChild.children].forEach((bar, k) => { bar.dataset.s = c.sectors[k] || ''; });
    const ty = TYRES[b.tyre];
    tyre.textContent = ty ? ty[0] : '';
    tyre.style.borderColor = ty ? ty[1] : 'transparent';
    tyre.title = b.tyre ? `${b.tyre}${b.age ? `, ${b.age} laps old` : ''}${b.stops ? `, ${b.stops} stop${b.stops > 1 ? 's' : ''}` : ''}` : '';
    onTyre(b.d.id, ty?.[1]);
    badge.textContent = b.pit ? 'PIT' : '';
  });
}
