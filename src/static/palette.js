// @ts-check
// Keyboard layer: ? the shortcut sheet, / the Drivers search (else the palette), Ctrl/Cmd+K the command palette, plus the
// usage counts view. app.js registers the commands; the sheet lists the keys other modules really handle.
import {el, count, failed, fmtDate, th, skeleton, toast} from './util.js';

/** @type {[string, [string, string][]][]} */
const SHORTCUTS = [
  ['Anywhere', [['?', 'This sheet'], ['/', 'Find a driver on the Drivers tab, else the command palette'], ['Ctrl K', 'Command palette (⌘ K on a Mac)'],
    ['Esc', 'Close a dialog or panel']]],
  ['Race replay', [['Space', 'Play or pause'], ['← →', 'Back or forward 10 s, further at high speed (not in a simulation)'], ['- +', 'Slower or faster'],
    ['1 2 3 4 5', 'Overview, Chase, Cockpit, T-Cam, Helicopter'], ['[ ]', 'Previous or next driver'], [', .', 'Previous or next key moment'], ['H', 'Race highlights'], ['C', 'Car showroom'], ['T', 'Telemetry drawer'],
    ['Shift T', 'Telemetry trace'], ['L', 'Next time of day'], ['G', 'Next graphics quality']]],
  ['Tabs and timing tower, when focused', [['← →', 'Previous or next tab'], ['↑ ↓', 'Move between drivers'], ['Home End', 'First or last driver'],
    ['Enter', 'Select the driver']]],
  ['Driving a simulated car', [['W ↑', 'Throttle'], ['S ↓', 'Brake'], ['A D ← →', 'Steer'], ['E Shift', 'Gear up'], ['Q Ctrl', 'Gear down'], ['X', 'Clutch'],
    ['R Space', 'DRS'], ['F', 'Overtake'], ['P', 'Pit'], ['C', 'Next camera']]],
  ['F1 TV, on the focused stream', [['K Space', 'Play or pause'], ['← →', 'Back or forward 10 s'], ['M', 'Mute'], ['F', 'Fullscreen']]],
];

// how well text matches what was typed; 0 = not at all. A substring beats a subsequence, and among substrings the start of
// the text, then the start of a word, then the earliest; among subsequences, the fewest letters skipped
export function score(query, text) {
  const q = query.trim().toLowerCase(), t = text.toLowerCase();
  if (!q) return 1;
  const i = t.indexOf(q);
  if (i >= 0) return 1000 + (i === 0 ? 200 : /\W/.test(t[i - 1]) ? 100 : 0) - i - t.length / 100;
  let at = -1, skipped = 0;
  for (const c of q) {
    const n = t.indexOf(c, at + 1);
    if (n < 0) return 0;
    if (at >= 0) skipped += n - at - 1;
    at = n;
  }
  return skipped > 2 * q.length ? 0 : 500 - skipped;  // letters scattered over a long text aren't a match
}

// the commands that match, best first; ties (every one, for an empty query) keep the list's order
export const rank = (query, commands) => commands.map(c => [score(query, c.text ?? c.label), c]).filter(([s]) => s > 0)
  .sort((a, b) => b[0] - a[0]).map(([, c]) => c);

// text is going in here, so the keys are the field's. Not a range (the scrub bar), a checkbox, or a select
const NOT_TEXT = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'];
export const typing = t => (t.tagName === 'INPUT' && !NOT_TEXT.includes(t.type)) || t.tagName === 'TEXTAREA' || !!t.isContentEditable;

// which shortcut a keydown means, or null. modal: a dialog is open (the F1 TV viewer, a career), where only ? applies
export function action(e, {isTyping = false, driving = false, modal = false} = {}) {
  const cmdK = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key?.toLowerCase() === 'k';
  if (e.repeat || isTyping || driving || ((e.ctrlKey || e.metaKey || e.altKey) && !cmdK)) return null;
  if (e.key === '?') return 'sheet';
  if (modal) return null;
  return cmdK ? 'palette' : e.key === '/' ? 'slash' : null;
}

// /api/counts' {day: {event: n}} as a table: days newest first, events most counted first
export function countsTable(data) {
  const days = Object.keys(data).sort().reverse();
  const events = [...new Set(days.flatMap(d => Object.keys(data[d])))];
  const rows = events.map(event => {
    const per = days.map(d => data[d][event] ?? 0);
    return {event, per, total: per.reduce((a, b) => a + b, 0)};
  }).sort((a, b) => b.total - a.total || a.event.localeCompare(b.event));
  const totals = days.map((_, i) => rows.reduce((a, r) => a + r.per[i], 0));
  return {days, rows, totals, total: totals.reduce((a, b) => a + b, 0)};
}

export function modal(cls, label, onkey, ...body) {
  const dlg = el('dialog', {class: `dcareer ${cls}`, 'aria-label': label, onclose: () => dlg.remove(), onclick: e => e.target === dlg && dlg.close(),
    // nothing behind it reacts to its keys: a panel's or the intro's Esc, T for the trace
    onkeydown: e => { e.stopPropagation(); onkey?.(e, dlg); }}, body);
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
const closer = () => el('button', {class: 'dclose', 'aria-label': 'Close', onclick: e => e.target.closest('dialog').close()}, '✕');

export function openSheet() {
  count('shortcuts_open');
  modal('pdlg psheet', 'Keyboard shortcuts', (e, dlg) => e.key === '?' && dlg.close(), closer(), el('h2', {}, 'Keyboard shortcuts'),
    el('div', {class: 'pkeys'}, SHORTCUTS.map(([group, keys]) => el('section', {}, el('h3', {}, group),
      el('dl', {}, keys.flatMap(([k, what]) => [el('dt', {}, k.split(' ').map(x => el('kbd', {}, x))), el('dd', {}, what)]))))));
}

export function openCounts() {
  const box = el('div', {}, skeleton(5));
  modal('pdlg pcounts', 'Usage counts', null, closer(), el('h2', {}, 'Usage counts'), box,
    el('p', {class: 'muted'}, 'Counted: how many times each of these happened, per day, kept on this app’s own server. Each count is only the event’s name. ',
      'Not kept: any id, cookie, IP address or page address, and nothing goes to a third party. Nothing is sent at all when your browser asks not to be tracked (Do Not Track or Global Privacy Control).'));
  const load = async () => {
    try {
      const res = await fetch('/api/counts');  // not util.get: its cache would freeze the numbers
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const {days, rows, totals, total} = countsTable(await res.json());
      box.className = '';
      box.replaceChildren(days.length ? el('div', {class: 'tablewrap'}, el('table', {class: 'data'},
        el('thead', {}, el('tr', {}, ['Event', 'Total', ...days.map(fmtDate)].map(th))),
        el('tbody', {}, rows.map(r => el('tr', {}, el('th', {scope: 'row'}, r.event.replaceAll('_', ' ')), el('td', {}, r.total), r.per.map(n => el('td', {}, n))))),
        el('tfoot', {}, el('tr', {}, el('th', {scope: 'row'}, 'Total'), el('td', {}, total), totals.map(n => el('td', {}, n))))))
        : el('p', {class: 'empty'}, 'Nothing counted yet.'));
    } catch (e) {
      box.className = '';
      box.replaceChildren(failed(e, load));
    }
  };
  load();
}

// url: what to copy (share.js, built by app.js: never the raw address, which could hold what isn't for sharing)
export function copyLink(url) {
  const say = text => toast([el('span', {}, text)]);
  // no navigator.clipboard over plain http on the LAN: the address is shown instead
  Promise.resolve().then(() => navigator.clipboard.writeText(url)).then(() => say('Link copied'), () => say(`Copy this address: ${url}`));
}

// the command palette. Commands: {label, hint?, text? (what's searched, default the label), run}
const KEY = /^(Shift |Ctrl )?[A-Z?]$/;  // H, T, Shift T, ?
export function openPalette(commands) {
  count('palette_open');
  let shown = [], at = 0;
  const go = c => { dlg.close(); c.run(); };  // closed first: focus is back on the page for whatever the command opens
  const input = el('input', {type: 'text', role: 'combobox', placeholder: 'Go to a race, tab or tool', 'aria-label': 'Command', 'aria-expanded': 'true',
    'aria-controls': 'palettelist', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false', oninput: () => draw()});
  const list = el('ul', {id: 'palettelist', role: 'listbox', 'aria-label': 'Commands'});
  const mark = () => {
    list.querySelectorAll('[role=option]').forEach((li, i) => li.setAttribute('aria-selected', i === at));
    input.setAttribute('aria-activedescendant', shown.length ? `palette${at}` : '');
    if (shown.length) list.querySelector(`#palette${at}`).scrollIntoView({block: 'nearest'});
  };
  // with nothing typed, the list in sections (Linear's and Raycast's menus), each in the order its first command comes;
  // a hint that is a key reads as a key
  const draw = () => {
    shown = rank(input.value, commands);
    const grouped = !input.value.trim(), group = c => c.group ?? 'Actions', items = [];
    if (grouped) { const order = [...new Set(shown.map(group))]; shown = shown.toSorted((a, b) => order.indexOf(group(a)) - order.indexOf(group(b))); }
    at = 0;
    shown.forEach((c, i) => {
      if (grouped && group(c) !== group(shown[i - 1] ?? {group: null})) items.push(el('li', {class: 'pgroup', role: 'presentation'}, group(c)));
      items.push(el('li', {role: 'option', id: `palette${i}`, onclick: () => go(c)}, el('span', {}, c.label),
        c.hint && (KEY.test(c.hint) ? el('kbd', {}, c.hint) : el('small', {class: 'muted'}, c.hint))));
    });
    list.replaceChildren(...(shown.length ? items : [el('li', {class: 'muted'}, 'No match')]));
    mark();
  };
  const dlg = modal('pdlg ppal', 'Command palette', e => {
    if (e.isComposing) return;
    const step = {ArrowDown: 1, ArrowUp: -1}[e.key];
    if (step && shown.length) { e.preventDefault(); at = (at + step + shown.length) % shown.length; mark(); }
    if (e.key === 'Enter' && shown[at]) { e.preventDefault(); go(shown[at]); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dlg.close(); }
  }, input, list);
  draw();
}

// commands: () => the list, read when the palette opens; driving: () => the sim's driving keys are being captured (input.js)
export function setupPalette({commands, driving}) {
  document.addEventListener('keydown', e => {
    const modal = [...document.getElementsByTagName('dialog')].some(d => d.matches(':modal'));
    const what = action(e, {isTyping: typing(e.target), driving: driving(), modal});
    if (!what) return;
    e.preventDefault();  // Ctrl+K's address bar, Firefox's quick find on /
    const search = /** @type {HTMLInputElement | null} */ (document.querySelector('#tab-drivers input[type=search]'));
    if (what === 'sheet') openSheet();
    else if (what === 'slash' && search?.offsetParent) search.select();
    else openPalette(commands());
  });
}
