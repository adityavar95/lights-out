// Driver Control & Assist Deck (simulation only, under the timing tower): take over the selected car or hand it back,
// driver assists, AI pace and aggression, and the input status. Each frame it feeds the player's input into the
// simulation and draws the racing-line ribbon.
import {el, led} from './util.js';
import {nextCamera} from './onboard.js';
import {setRibbon} from './scene3d.js';
import {enableInput, pollInput, input, rumble} from './input.js';
import {rumbleFor} from './player.js';
import {trackWetness} from './weather.js';

const SWITCHES = [
  ['steer', 'STEERING', [['ASSIST', 'ASSIST'], ['RAW', 'RAW']]],  // RAW: you catch the slides
  ['tc', 'TRACTION', [['OFF', 'OFF'], ['MED', 'MED'], ['FULL', 'FULL']]],
  ['abs', 'ABS', [[false, 'OFF'], [true, 'ON']]],
  ['gearbox', 'GEARBOX', [['AUTO', 'AUTO'], ['MANUAL', 'MANUAL']]],
  ['clutch', 'CLUTCH', [['AUTO', 'AUTO'], ['MANUAL', 'MANUAL']]],  // H-pattern eras: clutch to shift, blip to downshift
  ['rules', 'AIDS', [['OPEN', 'ANY'], ['ERA', 'ERA-LEGAL']]],         // TC / launch / ABS only where that season allowed them
  ['brakeAssist', 'BRAKE ASSIST', [['OFF', 'OFF'], ['LOW', 'LOW'], ['HIGH', 'HIGH']]],
  ['line', 'RACING LINE', [['ON', 'ON'], ['CORNERS', 'CORNERS'], ['OFF', 'OFF']]],
];
export const KEYHELP = 'W/S throttle·brake · A/D steer · E/Q gears · X clutch · R/Space DRS · F overtake · P pit · C camera · Esc pause';

let D, getS, lastFrame = performance.now();

export function setupDriverDeck(dock, getState) {
  getS = getState;
  const sim = () => getS()?.sim;
  D = {
    master: el('button', {class: 'neu master', onclick: () => {
      const S = getS(), R = S?.sim;
      if (R && S.selected) drive(R, R.player === S.selected ? null : S.selected);
    }}, led(), el('span')),
    rows: SWITCHES.map(([key, label, opts]) => {
      const btns = opts.map(([value, text]) => el('button', {class: 'neu', onclick: () => { if (sim()) sim().assists[key] = value; }}, text));
      return {key, opts, btns, row: el('div', {class: 'assist'}, el('small', {}, label), el('div', {class: 'neugroup', role: 'group', 'aria-label': label}, btns))};
    }),
    pace: el('input', {type: 'range', min: 80, max: 110, value: 100, 'aria-label': 'AI pace', oninput: e => { if (sim()) sim().ai.pace = +e.target.value / 100; }}),
    aggr: el('input', {type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'AI aggression', oninput: e => { if (sim()) sim().ai.aggression = +e.target.value / 100; }}),
    paceVal: el('b'), aggrVal: el('b'), status: el('div', {class: 'ddstatus'}),
    badge: el('div', {class: 'inputbadge'}, el('span', {class: 'kb'}, 'KEYBOARD'), el('span', {class: 'pad'}), el('p', {}, KEYHELP)),
  };
  D.toggle = el('button', {class: 'neu', 'aria-expanded': false, title: 'Drive the selected car, assists and AI', onclick: () => {
    const collapsed = D.panel.classList.toggle('collapsed');
    D.toggle.setAttribute('aria-expanded', !collapsed);
  }}, led(), 'DRIVER');
  D.panel = el('section', {class: 'drivedeck collapsed', hidden: true},  // starts collapsed: the tower keeps its height
    el('header', {class: 'pwhead'}, D.toggle, D.status),
    el('div', {class: 'pwwrap'}, el('div', {class: 'ddbody'},
      D.master, ...D.rows.map(r => r.row),
      el('label', {class: 'aislider'}, el('small', {}, 'AI PACE '), D.paceVal, D.pace),
      el('label', {class: 'aislider'}, el('small', {}, 'AI AGGRESSION '), D.aggrVal, D.aggr),
      D.badge)));
  dock.append(D.panel);
}

// Play's Start: the player takes car id; open: the panel expanded, so its key help is seen
export function drive(R, id, open = false) {
  R.setPlayer(id);
  enableInput(!!R.player);
  if (open && D.panel.classList.contains('collapsed')) D.toggle.click();
}

// a compound for a pit request from the cockpit: wets / inters for the weather, else a different dry one
function pitCompound(R, car) {
  const w = trackWetness(R.W);
  if (w > 0.6) return 'WET';
  if (w > 0.2) return 'INTERMEDIATE';
  return car.tyre.compound === 'MEDIUM' ? 'HARD' : 'MEDIUM';
}

export function updateDriverDeck(S) {
  const now = performance.now(), dt = Math.min((now - lastFrame) / 1000, 0.1), R = S?.sim;
  lastFrame = now;
  D.panel.hidden = !R;
  if (!R) { enableInput(false); setRibbon(null); return; }
  const car = R.player && R.car(R.player), sel = S.selected && S.byId[S.selected];
  // master switch: what clicking it would do / is doing for the selected car
  const driving = !!car && R.player === S.selected;
  D.master.setAttribute('aria-pressed', driving);
  D.master.disabled = !sel;
  D.master.lastChild.textContent = !sel ? 'SELECT A CAR TO DRIVE' : driving ? `MANUAL DRIVE (PLAYER) · ${sel.code}` : `AI AUTOPILOT (SPECTATE) · ${sel.code}`;
  for (const r of D.rows) r.btns.forEach((b, i) => b.setAttribute('aria-pressed', R.assists[r.key] === r.opts[i][0]));
  D.paceVal.textContent = `${Math.round(R.ai.pace * 100)}%`;
  if (document.activeElement !== D.pace) D.pace.value = Math.round(R.ai.pace * 100);  // Play's difficulty sets it too
  D.aggrVal.textContent = R.ai.aggression < 0.25 ? 'conservative' : R.ai.aggression > 0.75 ? 'max attack' : 'balanced';
  D.badge.querySelector('.pad').textContent = input.pad ? `GAMEPAD · ${input.pad.split('(')[0].trim().slice(0, 24)}` : 'NO GAMEPAD';
  D.badge.classList.toggle('active', !!car);

  if (!car) { setRibbon(null); D.status.replaceChildren(el('span', {}, 'AI driving')); return; }  // "every car" overran the tower's width
  // the player's input this frame, and its one-shot actions
  const inp = pollInput(dt);
  Object.assign(R.input, {throttle: inp.throttle, brake: inp.brake, steer: inp.steer, clutch: inp.clutch});
  rumble(rumbleFor(car));
  if (inp.actions.has('up')) R.input.up = true;
  if (inp.actions.has('down')) R.input.down = true;
  if (inp.actions.has('drs')) R.input.drs = true;
  if (inp.actions.has('ers')) R.setErsMode(car.id, car.ers.user === 'PUSH' ? null : 'PUSH');
  if (inp.actions.has('pit')) R.box(car.id, car.pit.box ? null : pitCompound(R, car));
  if (inp.actions.has('camera')) nextCamera();
  D.status.replaceChildren(
    el('span', {class: car.tcCut ? 'on' : ''}, 'TC'), el('span', {class: car.absOn ? 'on' : ''}, 'ABS'),
    el('span', {class: car.overRev > 0 || car.grind > 0 ? 'warn' : ''}, car.overRev > 0 ? 'OVER-REV' : car.grind > 0 ? 'CLUTCH!' : `G${car.gear}`),
    el('span', {class: car.ers.user === 'PUSH' ? 'on' : ''}, 'OVERTAKE'), el('span', {class: car.pit.box ? 'on' : ''}, 'PIT'));
  if (car.overRev > 0) car.overRev -= dt;
  if (car.grind > 0) car.grind -= dt;
  // racing-line ribbon ahead of the player: ON everywhere, CORNERS only where it matters (corners, lift, braking)
  const rib = R.assists.line !== 'OFF' && R.ribbon(car.id);
  setRibbon(rib ? rib.map(p => (R.assists.line === 'CORNERS' && !p.corner && p.state === 0 ? null : p)) : null);
}
