// What the 3D stage is still fetching, with live percentages, since the photographed sky, the car model and the satellite
// ground arrive long after the page looks ready. A stage that fails says what's standing in, not just that it failed.
import {el} from './util.js';

const STAGES = new Map();
let box = null, hide = 0;

export const setupLoadStage = parent => {
  box = el('div', {class: 'loadstage glass', role: 'status', hidden: true});
  parent.append(box);
  setTimeout(reveal, 8000);  // a stage that never answers mustn't leave the view dark
};

// before the photographed sky and the ground arrive the 3D view is a white fog: style.css keeps it dark until then
const reveal = () => box?.parentElement.classList.add('stage-ready');

function draw() {
  if (!box) return;
  clearTimeout(hide);
  const all = [...STAGES.values()];
  box.hidden = !all.length;
  box.replaceChildren(...all.map(s => el('div', {class: 'lsrow', 'data-state': s.state},
    el('span', {}, s.label), el('i', {}, el('b', {style: `width:${Math.round(s.frac * 100)}%`})),
    el('small', {}, s.state === 'offline' ? s.note : s.state === 'done' ? 'ready' : `${Math.round(s.frac * 100)}%`))));
  if (all.length && all.every(s => s.state !== 'loading')) {
    reveal();
    hide = setTimeout(() => { STAGES.clear(); box.hidden = true; }, 1600);
  }
}

export function stage(key, label, frac = 0) {
  STAGES.set(key, {label, frac: Math.max(0, Math.min(1, frac)), state: 'loading'});
  draw();
}

// fraction of bytes from a fetch progress event, when the server said how many
export const progressOf = e => (e.total ? e.loaded / e.total : 0);

export function stageDone(key, note) {
  const s = STAGES.get(key);
  if (!s) return;
  Object.assign(s, note ? {state: 'offline', note} : {state: 'done', frac: 1});
  draw();
}

// one short line for a key's effect: the graphics tier, the sky
export function announce(label) {
  stage('say', label, 1);
  stageDone('say');
}
