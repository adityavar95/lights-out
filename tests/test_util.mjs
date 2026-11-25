// get()'s cache (current-season TTL, past seasons kept, failures dropped, live URLs not piling up) and plain error words
import assert from 'node:assert/strict';
import {get, plain, signed, cellOrder, rcIndex, bannerKind, forgetReplays, median, fmtLap, isJwt} from '../src/static/util.js';

assert.equal(fmtLap(119.9996), '2:00.000');
assert.equal(fmtLap(83.4), '1:23.400');
assert.equal(fmtLap(null), '');
assert.ok(Number.isNaN(median([])));
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([1, 2, 3, 10]), 2.5);

const year = new Date().getFullYear(), calls = {};
let answer = () => ({ok: true, json: async () => ({rows: 1})});
globalThis.fetch = async url => { calls[url] = (calls[url] ?? 0) + 1; return answer(url); };
const realNow = Date.now;
const later = ms => { const t = realNow() + ms; Date.now = () => t; };

const thisSeason = `/api/jolpica/${year}/results`, past = `/api/jolpica/${year - 3}/results`;
await get(thisSeason); await get(past); await get(thisSeason);
assert.equal(calls[thisSeason], 1);  // cached within the TTL
later(6 * 60e3);
await get(thisSeason); await get(past);
assert.equal(calls[thisSeason], 2);  // past the TTL: asked again
assert.equal(calls[past], 1);        // a past season stays for the tab's life
Date.now = realNow;

// a failed fetch isn't cached, and a list-shaped detail (FastAPI's 422) doesn't print as [object Object]
answer = () => ({ok: false, status: 422, statusText: 'Unprocessable', json: async () => ({detail: [{msg: 'bad'}]})});
await assert.rejects(get('/api/x'), /^Error: 422 Unprocessable$/);
await new Promise(r => setTimeout(r));
answer = () => ({ok: true, json: async () => ({})});
await get('/api/x');
assert.equal(calls['/api/x'], 2);

// at most 200 answers are kept: the oldest goes, and is fetched again when asked for
for (let i = 0; i < 201; i++) await get(`/api/old/${i}`);
await get('/api/old/200'); await get('/api/old/0');
assert.equal(calls['/api/old/200'], 1);
assert.equal(calls['/api/old/0'], 2);

// across New Year, the new season's list is fetched again once it is over 5 minutes old
const RealDate = Date;
let clock = new RealDate(year, 11, 31, 23, 59).getTime();  // local time, as getFullYear reads it
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [clock])); }
  static now() { return clock; }
};
const nextYear = `/api/jolpica/${year + 1}/races`;
await get(nextYear);
clock += 6 * 60e3;  // now 6 minutes later, and into the new year
await get(nextYear);
assert.equal(calls[nextYear], 2);
globalThis.Date = RealDate;
Date.now = realNow;

// a new race's replay aborts the one still downloading; the same race's lap and GPS replays don't abort each other
const pending = {}, aborted = new Set();
globalThis.fetch = (url, {signal} = {}) => new Promise((ok, no) => {
  pending[url] = () => ok({ok: true, json: async () => ({url})});
  signal?.addEventListener('abort', () => { aborted.add(url); no(new DOMException('Aborted', 'AbortError')); });
});
const rA = '/api/replay/2024/1?session=Race', rB = '/api/replay/2024/2?session=Race';
const a = get(rA), aLaps = get(`${rA}&laps=1`);
assert.equal(aborted.size, 0);
const b = get(rB), bLaps = get(`${rB}&laps=1`);
await assert.rejects(a, {name: 'AbortError'});
await assert.rejects(aLaps, {name: 'AbortError'});
pending[rB](); pending[`${rB}&laps=1`]();
assert.deepEqual([(await b).url, (await bLaps).url], [rB, `${rB}&laps=1`]);
assert.deepEqual([...aborted], [rA, `${rA}&laps=1`]);
const tele = get('/api/telemetry/x');  // other URLs aren't touched
get('/api/replay/2024/3?session=Race').catch(() => {});  // aborted by a later test's replay
assert.ok(!aborted.has('/api/telemetry/x')); pending['/api/telemetry/x'](); await tele;

// audit 2.2: after an F1 TV sign-in (or Disconnect) a replay is asked again, built from the other source
globalThis.fetch = async url => { calls[url] = (calls[url] ?? 0) + 1; return {ok: true, json: async () => ({})}; };
const r21 = '/api/replay/2021/1?session=Race';
await get(r21); await get(r21);
assert.equal(calls[r21], 1);
await get('/api/season/2001');
forgetReplays();
await get(r21); await get('/api/season/2001');
assert.equal(calls[r21], 2);
assert.equal(calls['/api/season/2001'], 1);  // other answers stay cached

// plain words for the browser's network errors and bare statuses; a server's own message stands
assert.match(plain(new TypeError('Failed to fetch')), /Can't reach the server/);
assert.match(plain('NetworkError when attempting to fetch resource.'), /Can't reach the server/);
assert.match(plain(new Error('502 Bad Gateway')), /server had a problem/);
assert.match(plain(new Error('429 Too Many Requests')), /Too many requests/);
assert.equal(plain(new Error('No round 99 in 2026')), 'No round 99 in 2026');
console.log('util ok');

// race control messages: sentence case, the chip's flag word not repeated, car codes and acronyms kept
import {rcText} from '../src/static/util.js';
assert.equal(rcText('CLEAR IN TRACK SECTOR 12', 'CLEAR'), 'In track sector 12');
assert.equal(rcText('GREEN LIGHT - PIT EXIT OPEN', 'GREEN'), 'Green light - pit exit open');
assert.equal(rcText('CAR 4 (NOR) TIME 1:12.345 DELETED', null), 'Car 4 (NOR) time 1:12.345 deleted');
assert.equal(rcText('DRS ENABLED'), 'DRS enabled');
assert.equal(rcText('RISK OF RAIN FOR THE F1 RACE IS 80%'), 'Risk of rain for the F1 race is 80%');
assert.equal(rcText(''), '');
console.log('rcText ok');

// inkOn: dark ink on light team colours, white on dark ones
import {inkOn} from '../src/static/util.js';
import {voiceIds} from '../src/static/util.js';
assert.equal(inkOn('#FFFFFF'), '#000');
assert.equal(inkOn('#27F4D2'), '#000', 'Mercedes teal');
assert.equal(inkOn('#FF8000'), '#000', 'McLaren orange');
assert.equal(inkOn('#3671C6'), '#fff', 'Red Bull blue');
assert.equal(inkOn('#15151e'), '#fff');

// signed: a typographic minus, and sortTable's order reads it (and the ASCII one) as a number
assert.equal(signed(-1.25, 1), '−1.3');
assert.equal(signed(0, 2, ''), '0.00');
assert.equal(signed(0.5, 3), '+0.500');
assert.equal(signed(4), '+4');
const sorted = l => [...l].sort(cellOrder);
assert.deepEqual(sorted(['+0.5 s', '−1.2 s', '+12.0 s', '-3 s', '±0.0 s']), ['-3 s', '−1.2 s', '±0.0 s', '+0.5 s', '+12.0 s']);
assert.deepEqual(sorted(['1:31.002', '1:29.990', '1:30.5']), ['1:29.990', '1:30.5', '1:31.002']);
assert.deepEqual(sorted(['10', '9', '−2.5 %']), ['−2.5 %', '9', '10']);

// race-control calls: the index of the next message to announce (audiodeck.js)
const rc = [[10, 'Drs', '', 'DRS ENABLED'], [20, '', '', 'A'], [30, '', '', 'B'], [40, '', '', 'C']];
assert.equal(rcIndex(rc, 0), 0);    // session start: nothing passed
assert.equal(rcIndex(rc, 25), 2);   // opened mid-session: the first two stay silent
assert.equal(rcIndex(rc, 10), 1);   // playing past a message moves the index past it
assert.equal(rcIndex(rc, 45), 4);   // seek forward over three
assert.equal(rcIndex(rc, 15), 1);   // seek back
assert.equal(rcIndex([], 99), 0);

assert.equal(bannerKind('CHEQUERED FLAG'), 'chequered');
assert.equal(bannerKind('RED FLAG'), 'red');
assert.equal(bannerKind('SAFETY CAR DEPLOYED'), 'yellow');
assert.equal(bannerKind('DRS ENABLED'), 'green');
assert.equal(bannerKind('DRS DISABLED'), 'grey');

// engine voices: the focused car never plays on two voices
assert.deepEqual(voiceIds(['a', 'b', 'c'], ['b', 'a', 'c']), ['b', 'a', 'c']);  // hero taken from an ambient voice, old hero gets the freed one
assert.deepEqual(voiceIds(['a', 'b', null], ['a', 'c', 'b']), ['a', 'b', 'c']);  // hero unchanged: cars keep their voices
assert.deepEqual(voiceIds(['a', 'b', 'c'], ['c', 'b']), ['c', 'b', null]);      // hero from voice 2, which is freed
assert.deepEqual(voiceIds(['a', 'b'], []), [null, null]);                        // hero gone: every voice free

// 7.2: only a JWT-shaped #f1tv= value is stored
assert.ok(isJwt('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-_DEF'));
for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', 'a.b.c<script>', 'a..c', 'a.b.c%20'])
  assert.ok(!isJwt(bad), bad);
