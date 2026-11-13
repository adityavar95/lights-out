// get()'s cache (current-season TTL, past seasons kept, failures dropped, live URLs not piling up) and plain error words
import assert from 'node:assert/strict';
import {get, plain} from '../src/static/util.js';

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
