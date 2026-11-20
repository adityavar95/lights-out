// Stage settings (src/static/graphics.js): presets, what a stored value may be.
import assert from 'node:assert';
import {PRESETS, DEFAULTS, presetOf, nextPreset, clean, loadGraphics, saveGraphics, deviceTier, defaultsFor} from '../src/static/graphics.js';

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
// device tiers: a fake navigator, screen and pointer
const dev = ({mobile, memory = 8, coarse = false, w = 2560, h = 1440, search = ''} = {}) =>
  ({location: {search}, navigator: {userAgentData: {mobile}, deviceMemory: memory}, screen: {width: w, height: h}, matchMedia: () => ({matches: coarse})});
assert.equal(deviceTier('NVIDIA GeForce RTX 4080', dev()), 'desktop');
assert.equal(deviceTier('', dev({mobile: true})), 'mobile');
assert.equal(deviceTier('', dev({coarse: true, w: 412, h: 915})), 'mobile', 'a phone without userAgentData');
assert.equal(deviceTier('', dev({coarse: true})), 'desktop', 'a touch laptop is no phone');
assert.equal(deviceTier('', dev({memory: 4})), 'mobile');
assert.equal(deviceTier('Google SwiftShader', dev()), 'software');
assert.equal(deviceTier('', dev({search: '?tier=mobile'})), 'mobile');
assert.equal(deviceTier('', dev({mobile: true, search: '?tier=desktop'})), 'desktop');
assert.equal(deviceTier('', dev({search: '?tier=bogus'})), 'desktop');
assert.equal(deviceTier('', {}), 'desktop', 'no navigator (node)');
assert.equal(defaultsFor('desktop'), DEFAULTS);
assert.equal(presetOf(defaultsFor('mobile')), 'Low');
assert.ok(!('name' in defaultsFor('mobile')));
assert.equal(loadGraphics({getItem: () => null}, defaultsFor('mobile')).mirrors, false, 'a phone starts on Low');
assert.equal(loadGraphics({getItem: () => '{"ao":true}'}, defaultsFor('mobile')).ao, true, 'and can raise it');
console.log('graphics ok');
