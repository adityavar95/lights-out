// The stage's Settings button (top right) and its panel: every graphics, picture, display and sound setting. Changes apply at once and persist.
import {el} from './util.js';
import {icon} from './tvcontrols.js';
import {setGraphics, graphics, framesDrawn, frameStats, tier} from './scene3d.js';
import {PRESETS, RANGES, presetOf, defaultsFor} from './graphics.js';
import {levels} from './audio.js';

// [setting, label, a list of [value, text] / 'range' / nothing for a switch, tooltip]
const SECTIONS = [
  ['Quality', [
    ['res', 'Resolution', [['auto', 'Auto'], [0.5, '50 %'], [0.75, '75 %'], [1, '100 %'], [1.5, '150 %'], [2, '200 %']], 'Biggest effect on the GPU. Auto supersamples, and lowers the resolution until the frame rate holds 60.'],
    ['fps', 'Frame rate limit', [[0, 'None'], [120, '120 fps'], [60, '60 fps'], [30, '30 fps']], 'A limit keeps frame times even and the laptop cooler'],
    ['shadows', 'Shadows', [[0, 'Off'], [1024, 'Low'], [2048, 'Medium'], [4096, 'High']], 'Shadow map size. Off also frees the most main-thread time.'],
    ['shadowRange', 'Shadow distance', [[0.5, 'Near'], [1, 'Normal'], [1.5, 'Far']], 'Nearer is sharper, since the same map covers less ground'],
    ['carDetail', 'Car detail distance', [[0.5, 'Near'], [1, 'Normal'], [2, 'Far']], 'How far away a car keeps its full model'],
  ]],
  ['Image', [
    ['msaa', 'Edge smoothing (MSAA)'], ['smaa', 'Shader smoothing (SMAA)'], ['ao', 'Ambient occlusion'], ['dof', 'Depth of field'],
    ['blur', 'Motion blur'], ['bloom', 'Bloom'], ['lens', 'Lens colour fringe'],
  ]],
  ['Scene', [
    ['farEvery', 'Far shadows every frame', null, 'Off redraws the far ones every 2nd and 4th frame, which is smoother'],
    ['trees', 'Trees'], ['trackside', 'Grandstands and boards'], ['particles', 'Smoke, sparks and spray'], ['haze', 'Exhaust heat haze'], ['mirrors', 'Mirrors in the cockpit'],
  ]],
  ['Picture', [
    ['sky', 'Sky', [['auto', 'Session time'], [0, 'Midday'], [1, 'Golden hour'], [2, 'Overcast'], [3, 'Night']], 'Session time: the sun as it stood over the circuit at the start'],
    ['exposure', 'Brightness', 'range'], ['contrast', 'Contrast', 'range'], ['saturation', 'Colour', 'range'],
  ]],
  ['On screen', [
    ['tower', 'Timing tower'], ['panels', 'Circuit and telemetry panels'], ['pitwall', 'Pit wall'], ['tags', 'Driver tags'], ['corners', 'Corner numbers'], ['showFps', 'Frame rate counter'],
  ]],
];
// the stage's class while a setting is off
const HIDES = {tower: 'no-tower', panels: 'no-panels', pitwall: 'no-pitwall', tags: 'no-tags', corners: 'no-corners'};
const AUDIO = 'lo-audio';

// returns the element the sound controls go in (audiodeck.js)
export function setupSettings(stage) {
  try { Object.assign(levels, JSON.parse(localStorage.getItem(AUDIO))); } catch { /* the defaults */ }
  const controls = {};
  const rowOf = ([key, label, kind, hint = '']) => {
    if (kind === 'range') {
      const [min, max] = RANGES[key], input = el('input', {type: 'range', min, max, step: 0.05, oninput: e => setGraphics({[key]: +e.target.value})});
      controls[key] = v => { input.value = v; };
      return el('label', {class: 'setrow'}, label, input);
    }
    if (kind) {
      const select = el('select', {onchange: e => setGraphics({[key]: kind[e.target.selectedIndex][0]})}, kind.map(([, text]) => el('option', {}, text)));
      controls[key] = v => { select.selectedIndex = kind.findIndex(([x]) => x === v); };
      return el('label', {class: 'setrow', title: hint}, label, select);
    }
    const b = el('button', {class: 'neu', role: 'switch', 'aria-label': label, onclick: () => setGraphics({[key]: !graphics()[key]})});
    controls[key] = v => { b.setAttribute('aria-checked', v); b.textContent = v ? 'On' : 'Off'; };
    return el('div', {class: 'setrow', title: hint}, el('span', {}, label), b);
  };
  const preset = el('select', {onchange: e => {
    const p = PRESETS.find(x => x.name === e.target.value);
    if (!p) return;  // Custom is what's left when a setting differs from every preset, not a choice
    const {name, ...quality} = p;
    setGraphics(quality);
  }}, [...PRESETS.map(p => p.name), 'Custom'].map(n => el('option', {}, n)));
  const saveLevels = () => {
    const {master, engine, fx, radio} = levels;
    try { localStorage.setItem(AUDIO, JSON.stringify({master, engine, fx, radio})); } catch { /* this visit only */ }
  };
  const audio = el('div', {class: 'setaudio', oninput: saveLevels});
  const menu = el('div', {class: 'deckmenu setpanel', id: 'setmenu', popover: 'auto', 'aria-label': 'Settings'},
    el('label', {class: 'setrow', title: 'G cycles the presets'}, 'Graphics preset', preset),
    ...SECTIONS.map(([title, rows]) => el('section', {'aria-label': title}, el('h4', {}, title), ...rows.map(rowOf))),
    el('section', {'aria-label': 'Sound'}, el('h4', {}, 'Sound'), audio),
    el('button', {class: 'neu', onclick: () => setGraphics(defaultsFor(tier))}, 'Reset graphics and display'));
  const button = el('button', {class: 'neu setbtn', popovertarget: 'setmenu', 'aria-haspopup': 'true', 'aria-expanded': false, title: 'Settings'}, icon('tune'), 'Settings');
  const rate = el('output', {class: 'setfps', hidden: true, 'aria-label': 'Frames per second'});
  menu.addEventListener('toggle', e => {
    button.setAttribute('aria-expanded', e.newState === 'open');
    if (e.newState !== 'open') return;
    const r = button.getBoundingClientRect();
    Object.assign(menu.style, {top: `${r.bottom + 8}px`, right: `${innerWidth - r.right}px`, maxHeight: `${innerHeight - r.bottom - 24}px`});
  });
  const sync = () => {
    const o = graphics();
    for (const k in controls) controls[k](o[k]);
    preset.value = presetOf(o);
    for (const k in HIDES) stage.classList.toggle(HIDES[k], !o[k]);
    rate.hidden = !o.showFps;
  };
  addEventListener('f1:graphics', sync);  // the G and sky keys change them too
  sync();
  let drawn = 0;
  setInterval(() => {
    const n = framesDrawn();
    // fps, then the main thread's milliseconds a frame by part (scene3d.js timed)
    if (!rate.hidden) rate.textContent = `${n - drawn} fps · ${Object.entries(frameStats()).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ')}`;
    drawn = n;
  }, 1000);
  stage.append(button, menu, rate);
  return audio;
}
