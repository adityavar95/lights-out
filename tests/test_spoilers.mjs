// node tests/test_spoilers.mjs: spoiler-free mode (which races hide their result, and until when)
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
const {spoilerFree, setSpoilerFree, recent, hides, reveal} = await import('../src/static/spoilers.js');

assert.ok(recent('2026-11-08', '2026-11-12') && recent('2026-11-12', '2026-11-12'));
assert.ok(!recent('2026-11-22', '2026-11-12'), 'not run yet');
assert.ok(!recent('2026-10-01', '2026-11-12'), 'over 30 days old');

assert.ok(!spoilerFree() && !hides(2026, '20', '2026-11-08', '2026-11-12'), 'off by default');
setSpoilerFree(true);
assert.ok(hides(2026, '20', '2026-11-08', '2026-11-12'));
assert.ok(!hides(2024, '5', '2024-05-05', '2026-11-12'), 'history is not a spoiler');
reveal(2026, '20');
assert.ok(!hides(2026, 20, '2026-11-08', '2026-11-12') && hides(2026, '19', '2026-11-01', '2026-11-12'));
for (let i = 0; i < 80; i++) reveal(1990, i);
assert.equal(JSON.parse(store.get('lo-revealed')).length, 60);
store.set('lo-revealed', 'not json');
assert.ok(hides(2026, '20', '2026-11-08', '2026-11-12'), 'a broken list hides again, it does not throw');
console.log('spoilers ok');
