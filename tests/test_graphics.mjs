// Stage settings (src/static/graphics.js): presets, what a stored value may be.
import assert from 'node:assert';
import {PRESETS, DEFAULTS, presetOf, nextPreset, clean, loadGraphics, saveGraphics} from '../src/static/graphics.js';

assert.equal(presetOf(DEFAULTS), 'Ultra');
for (const p of PRESETS) assert.equal(presetOf({...DEFAULTS, ...p}), p.name);
assert.equal(presetOf({...DEFAULTS, ao: false}), 'Custom');
assert.equal(presetOf({...DEFAULTS, exposure: 1.5, sky: 3, tags: false}), 'Ultra', 'picture and display settings are no part of a preset');

// G goes round every preset, and from Custom to the first
let o = {...DEFAULTS};
for (const p of [...PRESETS.slice(1), PRESETS[0]]) { o = {...o, ...nextPreset(o)}; assert.equal(presetOf(o), p.name); }
assert.equal(presetOf({...o, ...nextPreset({...o, ao: false})}), 'Ultra');
assert.ok(!('name' in nextPreset(o)) && !('name' in DEFAULTS), 'a name would be stored and spread into the settings');

assert.deepEqual(clean(null), DEFAULTS);
assert.deepEqual(clean({res: 7, shadows: '2048', ao: 'yes', sky: 99, exposure: 'x', nonsense: 1}), DEFAULTS);
assert.equal(clean({exposure: 99}).exposure, 2);
assert.equal(clean({exposure: -1}).exposure, 0.5);
const good = clean({res: 'auto', shadows: 0, ao: false, sky: 2, fps: 30});
assert.deepEqual([good.res, good.shadows, good.ao, good.sky, good.fps], ['auto', 0, false, 2, 30]);

const box = {}, store = {getItem: k => box[k] ?? null, setItem: (k, v) => { box[k] = v; }};
assert.deepEqual(loadGraphics(store), DEFAULTS);
saveGraphics({...DEFAULTS, ao: false}, store);
assert.equal(loadGraphics(store).ao, false);
box['lo-graphics'] = '{broken';
assert.deepEqual(loadGraphics(store), DEFAULTS);
assert.deepEqual(loadGraphics({getItem() { throw new Error('denied'); }}), DEFAULTS);
console.log('graphics ok');
