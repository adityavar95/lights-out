// Command palette matching, the shortcut guard and the usage counts table
import assert from 'node:assert';
import {score, rank, action, typing, countsTable} from '../src/static/palette.js';

// a substring beats a subsequence; the start of the text beats a word start beats the middle
assert(score('mon', 'Monaco Grand Prix') > score('mon', 'Italian Grand Prix Monza'));
assert(score('mon', 'Italian Grand Prix Monza') > score('mon', 'Lemon Grand Prix'));
assert(score('mon', 'Lemon Grand Prix') > score('mco', 'Monaco Grand Prix'));
assert(score('mco', 'Monaco Grand Prix') > 0);
assert.equal(score('mgp', 'Monaco Grand Prix'), 0);  // scattered over the text: no match
// tighter subsequence wins, case and padding don't matter, no match is 0
assert(score('cnt', 'count') > score('cnt', 'c n a t'));
assert.equal(score('  MONACO ', 'monaco'), score('monaco', 'monaco'));
assert.equal(score('zzz', 'Monaco'), 0);
assert.equal(score('oc', 'co'), 0);  // order counts

const cmds = [{label: 'Races'}, {label: 'Results'}, {label: 'Italian Grand Prix', text: 'Italian Grand Prix Monza'}, {label: 'Monaco Grand Prix'}];
assert.deepEqual(rank('', cmds), cmds);  // nothing typed: every command, in order
assert.deepEqual(rank('mon', cmds).map(c => c.label), ['Monaco Grand Prix', 'Italian Grand Prix']);  // text is what's searched
assert.deepEqual(rank('qqq', cmds), []);

const free = {isTyping: false, driving: false, modal: false};
const key = (k, mods = {}) => ({key: k, ...mods});
assert.equal(action(key('?', {shiftKey: true}), free), 'sheet');
assert.equal(action(key('/'), free), 'slash');
assert.equal(action(key('k', {ctrlKey: true}), free), 'palette');
assert.equal(action(key('K', {metaKey: true}), free), 'palette');  // caps lock
assert.equal(action(key('a'), free), null);
assert.equal(action(key('k'), free), null);  // k alone is a viewer tile's play key
// under other modifiers nothing fires
for (const m of [{ctrlKey: true}, {metaKey: true}, {altKey: true}]) for (const k of ['?', '/']) assert.equal(action(key(k, m), free), null);
assert.equal(action(key('k', {ctrlKey: true, altKey: true}), free), null);
assert.equal(action(key('k', {ctrlKey: true, shiftKey: true}), free), null);
// typing and driving stop them all
for (const state of [{...free, isTyping: true}, {...free, driving: true}]) {
  for (const e of [key('?'), key('/'), key('k', {ctrlKey: true})]) assert.equal(action(e, state), null);
}
// inside a dialog (the F1 TV viewer) only ? applies
assert.equal(action(key('?'), {...free, modal: true}), 'sheet');
assert.equal(action(key('/'), {...free, modal: true}), null);
assert.equal(action(key('k', {ctrlKey: true}), {...free, modal: true}), null);
assert.equal(action(key('?', {repeat: true}), free), null);  // a held key doesn't flicker the sheet
assert.equal(action({}, free), null);  // autofill's keydown has no key

for (const t of [{tagName: 'INPUT', type: 'text'}, {tagName: 'INPUT', type: 'search'}, {tagName: 'INPUT', type: 'number'}, {tagName: 'TEXTAREA'}]) assert(typing(t));
assert(typing({tagName: 'DIV', isContentEditable: true}));
assert(!typing({tagName: 'BUTTON'}));
// the scrub bar and its like take no text, so Ctrl+K works right after using them
for (const t of [{tagName: 'INPUT', type: 'range'}, {tagName: 'INPUT', type: 'checkbox'}, {tagName: 'SELECT'}]) {
  assert(!typing(t));
  assert.equal(action(key('k', {ctrlKey: true}), {...free, isTyping: typing(t)}), 'palette');
}

const t = countsTable({'2026-11-04': {visit: 2, first_play: 1}, '2026-11-05': {visit: 3, stream_open: 4}});
assert.deepEqual(t.days, ['2026-11-05', '2026-11-04']);
assert.deepEqual(t.rows, [
  {event: 'visit', per: [3, 2], total: 5},
  {event: 'stream_open', per: [4, 0], total: 4},
  {event: 'first_play', per: [0, 1], total: 1},
]);
assert.deepEqual(t.totals, [7, 3]);
assert.equal(t.total, 10);
assert.deepEqual(countsTable({}), {days: [], rows: [], totals: [], total: 0});

console.log('test_palette: ok');
