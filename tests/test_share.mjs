// Shareable state: the hash format, old links, and what a link may not carry
import assert from 'node:assert/strict';
import {parseHash, formatHash, held} from '../src/static/share.js';

// round trip
const full = '#2026/19/replay?t=1234.5&focus=VER&session=Qualifying&cmp=VER:12,NOR:15';
assert.equal(formatHash(parseHash(full)), full);
const s = parseHash(full);
assert.equal(s.year, '2026');
assert.equal(s.round, '19');
assert.equal(s.tab, 'replay');
assert.equal(s.t, 1234.5);
assert.equal(s.focus, 'VER');
assert.equal(s.session, 'Qualifying');
assert.deepEqual(s.cmp, [{driver: 'VER', lap: 12}, {driver: 'NOR', lap: 15}]);
assert.equal(parseHash(formatHash({year: 2026, round: 1, tab: 'replay', session: 'Practice 1'})).session, 'Practice 1');  // a space survives
assert.equal(formatHash({year: 2026, round: 1, tab: 'replay', t: 12.3456}), '#2026/1/replay?t=12.3');
assert.equal(parseHash('#2026/1/replay?t=0').t, 0);

// old links
for (const h of ['#2026/18/results', '#2026/18/sim', '#2026/18/replay', '#2026/18/explorer']) {
  assert.equal(formatHash(parseHash(h)), h);
  assert.equal(parseHash(h).t, undefined);
}
assert.equal(parseHash('#2026/18/qualifying').tab, 'qualifying');
assert.equal(formatHash(parseHash('#2026')), '#2026');
assert.equal(parseHash('#stream').stream, true);
assert.equal(formatHash(parseHash('#stream')), '#stream');
for (const h of ['', '#', '#intro']) {
  assert.equal(parseHash(h).year, undefined);
  assert.equal(formatHash(parseHash(h)), '');
}

// a token never gets through, wherever it's put
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret';
for (const h of [`#f1tv=${TOKEN}`, `#2026/18/replay?f1tv=${TOKEN}`, `#2026/18/replay?t=5&f1tv=${TOKEN}`, `#2026/18/f1tv=${TOKEN}`,
  `#2026/18/replay?focus=f1tv=${TOKEN}`, `#2026/18/replay?session=${TOKEN}`, `#2026/18/replay?cmp=${TOKEN}:1,${TOKEN}:2`, `#stream?f1tv=${TOKEN}`]) {
  const out = formatHash(parseHash(h));
  assert(!out.includes('f1tv') && !out.includes('secret'), `${h} -> ${out}`);
  assert(!JSON.stringify(parseHash(h)).includes('f1tv'), h);
}
assert.equal(formatHash(parseHash(`#2026/18/replay?t=5&f1tv=${TOKEN}`)), '#2026/18/replay?t=5');
assert.equal(formatHash({year: 2026, round: 18, tab: 'replay', f1tv: TOKEN, token: TOKEN}), '#2026/18/replay');  // only the known names are written
assert.equal(formatHash(parseHash(`#stream?f1tv=${TOKEN}`)), '#stream');

// malformed values: dropped alone, the rest of the link still works
for (const t of ['abc', '', '-5', '1e3', '0x10', 'Infinity', 'NaN', '86401', '5;alert(1)', '1,5']) {
  const p = parseHash(`#2026/18/replay?t=${t}&focus=VER`);
  assert.equal(p.t, undefined, t);
  assert.equal(p.focus, 'VER', t);
}
assert.equal(parseHash('#2026/18/nonsense').tab, undefined);
assert.equal(parseHash('#2026/18/__proto__').tab, undefined);
assert.equal(parseHash('#2026/18/replay').round, '18');
for (const y of ['1949', '2101', '20x6', '20266', '-2026']) assert.equal(parseHash(`#${y}/1/replay`).year, undefined, y);
for (const r of ['0', '100', 'x', '1.5', '-1', '01']) assert.equal(parseHash(`#2026/${r}/replay`).round, undefined, r);
for (const v of ['<img>', 'a b', 'x'.repeat(25), '../x']) assert.equal(parseHash(`#2026/1/replay?focus=${encodeURIComponent(v)}`).focus, undefined, v);
assert.equal(parseHash('#2026/1/replay?session=Warmup').session, undefined);
for (const c of ['VER:12', 'VER:12,NOR:15,LEC:1', 'VER:x,NOR:1', 'VER:0,NOR:1', 'VER:201,NOR:1', ':1,NOR:1', 'VER,NOR', '']) {
  assert.equal(parseHash(`#2026/1/replay?cmp=${c}`).cmp, undefined, c);
}
assert.equal(formatHash({year: 2026, round: 1, tab: 'replay', t: -1}), '#2026/1/replay');  // writing checks too
assert.equal(formatHash({year: 2026, round: 1, tab: 'replay', t: NaN, cmp: [{driver: 'VER', lap: 1}]}), '#2026/1/replay');
assert.equal(formatHash({year: 'x', round: 1}), '');

// a link's moment stays in the address while the replay is still on it
assert(held(s, {session: 'Qualifying'}));  // still loading: no time yet
assert(held(s, {session: 'Qualifying', t: 1234.9}));  // paused on it
assert(!held(s, {session: 'Qualifying', t: 1240}));  // played or seeked
assert(!held(s, {t: 1234.5}));  // another session (the race)
assert(held(parseHash('#2026/1/replay?t=50'), {t: 50.4}));  // no session = the race
assert(held(parseHash('#2026/1/replay?focus=VER'), {t: 900}));  // no time in the link: nothing to move off

console.log('test_share: ok');
