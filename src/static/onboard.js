// Camera deck (neumorphic switches with status LEDs) and the cockpit steering wheel overlay.
import {el, led, dropUp} from './util.js';
import {LEDS, TYRE, FLAG, ledsLit, drawDash} from './dash.js';

let w;  // DOM handles

// camera modes, as scene3d.js names them, with their deck labels
const CAMERAS = [['follow', 'Chase'], ['tcam', 'T-Cam'], ['onboard', 'Cockpit'], ['chase', 'TV Chase'], ['heli', 'Helicopter'], ['overview', 'Free Orbit']];

// handlers: {mode(m), parts({halo, body, wheel})}. Returns the deck's camera control: one button naming the camera,
// opening a menu of the cameras and, in the cockpit, the halo / car / wheel toggles. (C, or the pad's camera button
// while driving, steps through them: nextCamera.)
export function setupOnboard(wrap, handlers) {
  const modeBtn = ([m, text]) => el('button', {class: 'neu', 'data-mode': m, 'aria-pressed': m === 'overview', onclick: () => {
    handlers.mode(m);
    if (w.menu.matches(':popover-open')) w.menu.hidePopover();
  }}, led(), text);
  const toggle = (key, text) => el('button', {class: 'neu', 'aria-pressed': true, onclick: e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on);
    handlers.parts({[key]: on});
  }}, led(), text);
  w = {
    modes: el('div', {class: 'neugroup', role: 'group', 'aria-label': 'Camera'}, CAMERAS.map(modeBtn)),
    parts: el('div', {class: 'neugroup', role: 'group', 'aria-label': 'Show in cockpit view', hidden: true},
      toggle('halo', 'Halo'), toggle('body', 'Car'), toggle('wheel', 'Wheel')),
    speed: el('b'), gear: el('b', {class: 'gear'}), lap: el('b'), pos: el('b'), gap: el('b'),
    tyre: el('b', {class: 'wtyre'}), drs: el('b', {class: 'drs'}, 'DRS'), src: el('span', {class: 'wsrc'}),
    thr: el('i'), brk: el('i'), leds: Array.from({length: LEDS}, (_, i) => el('i', {class: i < 5 ? 'g' : i < 10 ? 'r' : 'b'})),
    flags: [el('i', {class: 'wflag'}), el('i', {class: 'wflag'})],
    name: el('span', {}, CAMERAS.at(-1)[1]),
  };
  w.button = el('button', {class: 'neu', popovertarget: 'cammenu', 'aria-haspopup': 'true', 'aria-expanded': false, title: 'Camera (C)',
    'aria-keyshortcuts': 'C'}, el('span', {class: 'neuicon', 'aria-hidden': 'true'}, '◉'), w.name, ' ▾');
  w.menu = el('div', {class: 'deckmenu', id: 'cammenu', popover: 'auto', 'aria-label': 'Camera'}, w.modes, w.parts);
  dropUp(w.button, w.menu);
  w.wheel = el('div', {class: 'wheel', hidden: true, 'aria-label': 'Steering wheel display'},
    wheelSvg(),
    el('div', {class: 'leds'}, w.leds),
    el('div', {class: 'wscreen'},
      el('div', {class: 'bar brk'}, w.brk),
      el('div', {class: 'cell'}, w.speed, el('small', {}, 'KM/H')),
      el('div', {class: 'cell mid'}, w.gear, w.src),
      el('div', {class: 'cell'}, w.lap, w.pos),
      el('div', {class: 'cell'}, w.gap, el('small', {}, 'GAP')),
      el('div', {class: 'cell mid'}, w.drs),
      el('div', {class: 'cell'}, w.tyre, el('small', {}, 'TYRE')),
      el('div', {class: 'bar thr'}, w.thr)),
    w.flags[0], w.flags[1]);
  wrap.append(w.wheel);
  return el('div', {class: 'deckgroup'}, w.button, w.menu);
}

// the next camera in the menu's order, as if clicked
export function nextCamera() {
  const cams = [...w.modes.children], i = cams.findIndex(b => b.getAttribute('aria-pressed') === 'true');
  cams[(i + 1) % cams.length].click();
}

function wheelSvg() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 520 300');
  s.setAttribute('class', 'wheelbody');
  s.innerHTML = `
    <rect x="8" y="38" width="112" height="250" rx="46" fill="#1b1b1f" stroke="#2c2c33" stroke-width="3"/>
    <rect x="400" y="38" width="112" height="250" rx="46" fill="#1b1b1f" stroke="#2c2c33" stroke-width="3"/>
    <path d="M86 26 Q260 6 434 26 L446 210 Q440 252 380 280 L140 280 Q80 252 74 210 Z" fill="#26262c" stroke="#3a3a44" stroke-width="3"/>
    <circle cx="112" cy="140" r="11" fill="#e10600"/><circle cx="112" cy="176" r="11" fill="#2b8cff"/>
    <circle cx="112" cy="212" r="11" fill="#ffd400"/><circle cx="408" cy="140" r="11" fill="#2fd06f"/>
    <circle cx="408" cy="176" r="11" fill="#f2f2f2"/><circle cx="408" cy="212" r="11" fill="#ff8000"/>
    <circle cx="190" cy="248" r="17" fill="#3a3a44" stroke="#55555f" stroke-width="3"/><line x1="190" y1="248" x2="190" y2="233" stroke="#ddd" stroke-width="3"/>
    <circle cx="330" cy="248" r="17" fill="#3a3a44" stroke="#55555f" stroke-width="3"/><line x1="330" y1="248" x2="342" y2="238" stroke="#ddd" stroke-width="3"/>
    <circle cx="260" cy="256" r="12" fill="#55555f"/>`;
  return s;
}

// the overlay is for cars without a wheel of their own (before 2026, or while the RB22 model hasn't loaded)
const overlay = {mode: 'overview', show: true, modelled: false};
const placeWheel = () => { w.wheel.hidden = overlay.mode !== 'onboard' || !overlay.show || overlay.modelled; };

export function setCameraUi(mode, showWheel) {
  for (const b of w.modes.children) b.setAttribute('aria-pressed', b.dataset.mode === mode);
  w.name.textContent = CAMERAS.find(c => c[0] === mode)?.[1] ?? '';
  w.parts.hidden = mode !== 'onboard';
  Object.assign(overlay, {mode, show: showWheel});
  placeWheel();
}

export function setWheelAngle(deg, modelled) {
  if (modelled !== overlay.modelled) { overlay.modelled = modelled; placeWheel(); }
  w.wheel.style.transform = `translateX(-50%) rotate(${-deg}deg)`;  // + = left turn = anticlockwise
}

// d: {speed, gear, rpm, throttle, brake, drs, lap, total, pos, gap, tyre, status, estimated}
export function updateWheel(d) {
  drawDash(d);
  if (w.wheel.hidden) return;
  const dash = v => (v === null || v === undefined ? '–' : v);
  w.speed.textContent = dash(d.speed === null ? null : Math.round(d.speed));
  w.gear.textContent = d.gear === 0 ? 'N' : dash(d.gear);
  w.src.textContent = d.estimated ? 'EST' : '';
  w.lap.textContent = d.lap ? `L${d.lap}${d.total ? '/' + d.total : ''}` : '–';
  w.pos.textContent = d.pos && d.pos < 99 ? `P${d.pos}` : '';
  w.gap.textContent = d.gap || '–';
  const ty = TYRE[d.tyre];
  w.tyre.textContent = ty ? ty[0] : '–';
  w.tyre.style.color = ty ? ty[1] : '';
  w.drs.className = `drs ${d.drs >= 10 ? 'open' : d.drs === 8 ? 'armed' : ''}`;  // OpenF1: 10/12/14 open, 8 eligible
  w.thr.style.height = `${d.throttle ?? 0}%`;
  w.brk.style.height = `${d.brake ? 100 : 0}%`;
  const lit = ledsLit(d.rpm);
  w.leds.forEach((led, i) => led.classList.toggle('on', i < lit));
  for (const f of w.flags) f.style.background = FLAG[d.status] || 'transparent';
}
