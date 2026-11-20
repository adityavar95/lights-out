// The stage's settings as plain data, pure: presets, defaults and what a stored value may be. settings.js is the panel, scene3d.js applies them.

const QUALITY = {res: 1, msaa: true, smaa: true, traa: false, ao: true, dof: true, blur: true, bloom: true, lens: true, shadows: 2048, shadowRange: 1, farEvery: false,
  mirrors: true, haze: true, particles: true, trees: true, trackside: true, carDetail: 1};
// Each drops what costs most for what it gives. G cycles them
export const PRESETS = [
  {name: 'Ultra', ...QUALITY, res: 'auto'},
  {name: 'High', ...QUALITY},
  {name: 'Medium', ...QUALITY, ao: false, dof: false, lens: false},
  {name: 'Low', ...QUALITY, msaa: false, smaa: false, ao: false, dof: false, blur: false, lens: false, shadows: 1024, shadowRange: 0.5, mirrors: false, haze: false, carDetail: 0.5},
];
const qualityKeys = Object.keys(QUALITY);

// The device's tier: 'desktop' gets the best of everything (Ultra, 4k photo sets and sky), 'mobile' a light version (Low,
// 1k sets and sky), 'software' (no GPU) no supersampling. ?tier=desktop|mobile|software in the URL forces one, for testing.
// gpu: the WebGL renderer string (scene3d.js probeGpu), '' before it is known
export function deviceTier(gpu = '', env = globalThis) {
  const forced = new URLSearchParams(env.location?.search).get('tier');
  if (['desktop', 'mobile', 'software'].includes(forced)) return forced;
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return 'software';
  const nav = env.navigator ?? {}, smallTouch = env.matchMedia?.('(pointer: coarse)').matches && Math.min(env.screen?.width, env.screen?.height) < 768;
  return nav.userAgentData?.mobile || smallTouch || nav.deviceMemory <= 4 ? 'mobile' : 'desktop';
}

export const DEFAULTS = {...PRESETS[0], fps: 0, sky: 'auto', exposure: 1.05, contrast: 1.35, saturation: 1.4,
  tags: true, corners: true, tower: true, panels: true, pitwall: true, showFps: false};
delete DEFAULTS.name;
// what a fresh device starts on (users can still raise it): Low on a phone
export const defaultsFor = tier => tier === 'mobile' ? (({name, ...low}) => ({...DEFAULTS, ...low}))(PRESETS.at(-1)) : DEFAULTS;

const CHOICES = {res: ['auto', 0.5, 0.75, 1, 1.5, 2], fps: [0, 120, 60, 30], shadows: [0, 1024, 2048, 4096], shadowRange: [0.5, 1, 1.5], carDetail: [0.5, 1, 2], sky: ['auto', 0, 1, 2, 3]};
export const RANGES = {exposure: [0.5, 2], contrast: [0.8, 2], saturation: [0, 2]};

// a preset's name, or Custom once any quality setting differs from all of them
export const presetOf = o => PRESETS.find(p => qualityKeys.every(k => p[k] === o[k]))?.name ?? 'Custom';

export function nextPreset(o) {
  const at = PRESETS.findIndex(p => p.name === presetOf(o));
  const {name, ...next} = PRESETS[(at + 1) % PRESETS.length];
  return next;
}

// localStorage can hold anything (an older version's keys, a hand edit): keep only what's valid
export function clean(stored, base = DEFAULTS) {
  const out = {...base};
  for (const k of Object.keys(DEFAULTS)) {
    const v = stored?.[k];
    if (RANGES[k]) { if (Number.isFinite(v)) out[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], v)); }
    else if (CHOICES[k] ? CHOICES[k].includes(v) : typeof v === 'boolean') out[k] = v;
  }
  return out;
}

const KEY = 'lo-graphics';
export function loadGraphics(store = globalThis.localStorage, base = DEFAULTS) {
  try { return clean(JSON.parse(store.getItem(KEY)), base); } catch { return {...base}; }
}
export function saveGraphics(o, store = globalThis.localStorage) {
  try { store.setItem(KEY, JSON.stringify(o)); } catch { /* private mode or full: the settings last this visit */ }
}
