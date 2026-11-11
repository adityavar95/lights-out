// The stage's settings as plain data, pure: presets, defaults and what a stored value may be. settings.js is the panel, scene3d.js applies them.

const QUALITY = {res: 1, msaa: true, smaa: true, ao: true, dof: true, blur: true, bloom: true, lens: true, shadows: 2048, shadowRange: 1, farEvery: false,
  mirrors: true, haze: true, particles: true, trees: true, trackside: true, carDetail: 1};
// Each drops what costs most for what it gives. G cycles them
export const PRESETS = [
  {name: 'Ultra', ...QUALITY, res: 'auto'},
  {name: 'High', ...QUALITY},
  {name: 'Medium', ...QUALITY, ao: false, dof: false, lens: false},
  {name: 'Low', ...QUALITY, msaa: false, smaa: false, ao: false, dof: false, blur: false, lens: false, shadows: 1024, shadowRange: 0.5, mirrors: false, haze: false, carDetail: 0.5},
];
const qualityKeys = Object.keys(QUALITY);

export const DEFAULTS = {...PRESETS[0], fps: 0, sky: 'auto', exposure: 1.05, contrast: 1.35, saturation: 1.4,
  tags: true, corners: true, tower: true, panels: true, pitwall: true, showFps: false};
delete DEFAULTS.name;

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
export function clean(stored) {
  const out = {...DEFAULTS};
  for (const k of Object.keys(DEFAULTS)) {
    const v = stored?.[k];
    if (RANGES[k]) { if (Number.isFinite(v)) out[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], v)); }
    else if (CHOICES[k] ? CHOICES[k].includes(v) : typeof v === 'boolean') out[k] = v;
  }
  return out;
}

const KEY = 'lo-graphics';
export function loadGraphics(store = globalThis.localStorage) {
  try { return clean(JSON.parse(store.getItem(KEY))); } catch { return {...DEFAULTS}; }
}
export function saveGraphics(o, store = globalThis.localStorage) {
  try { store.setItem(KEY, JSON.stringify(o)); } catch { /* private mode or full: the settings last this visit */ }
}
