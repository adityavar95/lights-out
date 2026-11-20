// reaction.js: the hold's range, keeping the faster time, and the verdict bands
import assert from 'node:assert/strict';
import {holdMs, lightAt, better, verdict} from '../src/static/reaction.js';

assert.equal(holdMs(0), 200, 'shortest hold 0.2 s');
assert.ok(holdMs(0.9999) < 3000 && holdMs(0.9999) > 2990, 'longest hold just under 3 s');
assert.equal(lightAt(0), 1000, 'first light at 1 s');
assert.equal(lightAt(4), 5000, 'fifth light at 5 s, then the hold');
assert.equal(better(null, 250), 250, 'first time is the best');
assert.equal(better(250, 210), 210, 'a faster time replaces it');
assert.equal(better(210, 250), 210, 'a slower one does not');
assert.match(verdict(80), /jump start/);
assert.match(verdict(180), /F1 sharp/);
assert.match(verdict(250), /Race-ready/);
assert.match(verdict(400), /grid/);
console.log('ok reaction');
