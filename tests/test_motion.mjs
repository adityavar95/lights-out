// motion.js: reduced motion ends animations at once; stagger and countUp end on the page's own state, even when anime.js fails
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countUp, flightSheet, play, spring, stagger, useCore, useLib} from '../src/static/motion.js';

let reduced = false;
globalThis.matchMedia = () => ({matches: reduced});
const calls = [];
useLib({
  animate: (targets, params) => { calls.push({targets, params}); if (params.onUpdate) { targets.f = 0.5; params.onUpdate(); } return {then: r => r()}; },
  cubicBezier: (...c) => c.join(','),
  stagger: ms => `s${ms}`,
});
assert.equal(await spring(), '0.22,1,0.36,1');

await play('.card', {opacity: [0, 1], duration: 300, delay: 50});
assert.deepEqual(calls[0].params, {opacity: [0, 1], duration: 300, delay: 50});  // motion on: the params pass through

reduced = true;
await play('.card', {opacity: [0, 1], duration: 300, delay: 50});
assert.equal(calls[1].params.duration, 0);  // reduced motion: duration 0 ...
assert.equal(calls[1].params.delay, 0);     // ... and no delay
assert.deepEqual(calls[1].params.opacity, [0, 1]);

// stagger: the first 16 in list order, 35 ms apart, hidden until they play; reduced motion plays nothing
reduced = false;
const rows = Array.from({length: 20}, (_, i) => ({id: i, style: {}}));
await stagger(rows);
assert.deepEqual(calls.at(-1).targets.map(r => r.id), rows.slice(0, 16).map(r => r.id));
assert.equal(calls.at(-1).params.delay, 's35');
assert.equal(rows[0].style.opacity, '0');  // hidden before anime.js runs; anime.js owns it from there
reduced = true;
let n = calls.length;
await stagger(rows.slice(0, 3).map(r => ({...r, style: {}})));
assert.equal(calls.length, n);  // reduced motion: nothing to play, the rows are simply there
// countUp: 0 -> its own text, halfway at f = .5, decimals kept, non-numbers left alone
reduced = false;
const figs = [{textContent: '25'}, {textContent: '12.5'}, {textContent: ''}], seen = [];
useLib({animate: (at, p) => { at.f = 0.5; p.onUpdate(); seen.push(figs.map(f => f.textContent)); return {then: r => r()}; }, cubicBezier: () => 'e'});
await countUp(figs);
assert.deepEqual(seen[0], ['13', '6.3', '']);  // halfway: 12.5 shown as 13, 6.25 as 6.3
assert.deepEqual(figs.map(f => f.textContent), ['25', '12.5', '']);
// anime.js fails to load: staggered rows show again instead of staying at opacity 0
useLib(null);  // node can't resolve 'animejs', as a page whose asset failed can't
const lost = [{style: {}}];
await stagger(lost);
assert.equal(lost[0].style.opacity, '');
// the globe's flight sheet: the state file has the three smoothstep curves (globemath.js timing), and the sampler reads them at f
const state = JSON.parse(readFileSync(new URL('../src/static/flight.theatre.json', import.meta.url), 'utf8'));
const tracks = state.sheetsById.flight.sequence.tracksByObject.fly.trackData;
const smooth = [1 / 3, 0, 2 / 3, 1];  // cubic-bezier of t * t * (3 - 2t)
for (const [name, [from, to]] of Object.entries({turn: [0, 0.4], climb: [0, 0.15], drop: [0.3, 1]})) {
  const [a, b] = tracks[name].keyframes;
  assert.deepEqual([a.position, a.value, b.position, b.value], [from, 0, to, 1], name);
  assert.deepEqual([...a.handles.slice(2), ...b.handles.slice(0, 2)], smooth, name);
}
let at = 0;
const sheetFake = {
  sequence: {set position(p) { at = p; }},
  object: (key, props) => { assert.equal(key, 'fly'); assert.deepEqual(Object.keys(props), ['turn', 'climb', 'drop']); return {get value() { return {turn: at, climb: at / 2, drop: at / 3}; }}; },
};
globalThis.fetch = async url => { assert.equal(url, '/static/flight.theatre.json'); return {json: async () => state}; };
useCore({types: {number: d => d}, getProject: (id, conf) => { assert.equal(conf.state, state); return {ready: Promise.resolve(), sheet: name => { assert.equal(name, 'flight'); return sheetFake; }}; }});
const sample = await flightSheet();
assert.deepEqual(sample(0.6), {turn: 0.6, climb: 0.6 / 2, drop: 0.6 / 3});
console.log('test_motion ok');
