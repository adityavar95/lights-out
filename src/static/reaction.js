// Start reaction game: five red lights, one a second, a random hold, lights out; press as fast as you can. Opened from the palette.
import {el, count} from './util.js';

const KEY = 'reactionBest';
export const holdMs = r => 200 + r * 2800;  // r in [0, 1): the FIA hold is somewhere between 0.2 and 3 s
export const better = (best, ms) => (best == null || ms < best ? ms : best);
export const verdict = ms => ms < 100 ? 'Anticipated: under 0.1 s counts as a jump start' : ms < 200 ? 'F1 sharp: drivers usually react in about 0.2 s'
  : ms < 300 ? 'Race-ready' : 'Still on the grid';
const fmt = ms => `${(ms / 1000).toFixed(3)} s`;
const stored = () => { const v = Number(localStorage.getItem(KEY)); return v > 0 ? v : null; };

export function openReaction() {
  count('reaction_open');
  const lights = Array.from({length: 5}, () => el('i', {class: 'rlight'}));
  const out = el('p', {class: 'rout', 'aria-live': 'polite'}, 'Click, or press Space, to start. Press again when the lights go out.');
  const bestEl = el('p', {class: 'muted rbest'});
  const showBest = () => { const b = stored(); bestEl.textContent = b ? `Personal best ${fmt(b)}` : 'No personal best yet'; };
  let state = 'idle', timers = [], t0 = 0;
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const start = () => {
    clear();
    lights.forEach(l => l.classList.remove('on'));
    state = 'lights';
    out.textContent = '';
    lights.forEach((l, i) => timers.push(setTimeout(() => l.classList.add('on'), 1000 * (i + 1))));
    timers.push(setTimeout(() => {
      state = 'hold';
      timers.push(setTimeout(() => requestAnimationFrame(t => {  // t0 = the frame the lights go dark on, same clock as event.timeStamp
        if (state !== 'hold') return;
        lights.forEach(l => l.classList.remove('on'));
        state = 'out'; t0 = t;
      }), holdMs(Math.random())));
    }, 5000));
  };
  const press = e => {
    if (state === 'idle' || state === 'done') return start();
    if (state !== 'out') {
      clear(); state = 'done';
      lights.forEach(l => l.classList.remove('on'));
      out.textContent = 'Jump start! Wait for the lights to go out. Press again to retry.';
      return;
    }
    const ms = Math.max(0, e.timeStamp - t0);
    state = 'done';
    if (ms < 100) { out.textContent = `${fmt(ms)}: ${verdict(ms)}. Press again to retry.`; return; }
    const prev = stored(), best = better(prev, ms);
    if (best !== prev) localStorage.setItem(KEY, String(Math.round(best)));
    out.textContent = `${fmt(ms)}${best === ms && prev != null ? ' · new personal best' : ''}. ${verdict(ms)}. Press again to go.`;
    showBest();
  };
  const dlg = el('dialog', {class: 'dcareer pdlg rgame', 'aria-label': 'Start reaction game',
    onclose: () => { clear(); dlg.remove(); },
    onpointerdown: e => { if (e.target === dlg) return dlg.close(); if (!e.target.closest('button')) press(e); },
    onkeydown: e => {
      e.stopPropagation();
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) press(e); }
    }},
  el('button', {class: 'dclose', 'aria-label': 'Close', onclick: () => dlg.close()}, '✕'),
  el('h2', {}, 'Lights out'), el('div', {class: 'rlights', 'aria-hidden': 'true'}, lights), out, bestEl);
  showBest();
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
