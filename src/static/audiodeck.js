// Audio deck: the HUD mixer (sound on/off unlocks Web Audio on the first click; engine / effects / radio levels), the
// per-frame car states the synthesis needs, and the race engineer's team radio (speech + squelch + banner).
import * as THREE from 'three';
import {el, led} from './util.js';
import {audioScene} from './scene3d.js';
import {startAudio, audioReady, updateAudio, squelch, duck, levels} from './audio.js';
import {gearbox, engine} from './telemetry.js';

const VOICES = 6, RANGE = 800;  // engines heard: the focused car and the nearest others within 800 m
const PLURAL = {SOFT: 'softs', MEDIUM: 'mediums', HARD: 'hards', INTERMEDIATE: 'inters', WET: 'wets'};

let A, getS, lastS = null, lastT = 0, lastCam = null, camVel = new THREE.Vector3(), prev = {}, said = {}, rcSeen = 0;
let radioBusy = false, queue = [], checkedAt = 0;


export function setupAudioDeck(deck, stage, getState) {
  getS = getState;
  const slider = (key, label) => el('label', {class: 'mixslider', title: `${label} volume`}, el('small', {}, label),
    el('input', {type: 'range', min: 0, max: 100, value: Math.round(levels[key] * 100), 'aria-label': `${label} volume`,
                 oninput: e => { levels[key] = +e.target.value / 100; }}));
  A = {
    toggle: el('button', {class: 'neu', 'aria-pressed': false, title: 'Sound on / off', onclick: async () => {
      if (!audioReady()) await startAudio();  // the first click is the user gesture browsers require for audio
      else levels.muted = !levels.muted;
      A.toggle.setAttribute('aria-pressed', !levels.muted);
      A.toggle.lastChild.textContent = levels.muted ? 'Sound off' : 'Sound';
      A.mix.classList.toggle('on', !levels.muted);  // the level sliders only show with the sound on
    }}, led(), 'Sound off'),
    wave: el('div', {class: 'trwave', 'aria-hidden': 'true'}, Array.from({length: 14}, () => el('i'))),
    who: el('b'), text: el('p'),
  };
  A.radio = el('section', {class: 'glass teamradio', hidden: true, role: 'status', 'aria-live': 'polite'},
    el('header', {}, el('span', {class: 'trdot'}), 'TEAM RADIO', A.who), A.wave, A.text);
  A.mix = el('div', {class: 'deckgroup audiomix', role: 'group', 'aria-label': 'Audio'},
    A.toggle, slider('engine', 'ENG'), slider('fx', 'FX'), slider('radio', 'RADIO'));
  deck.append(A.mix);
  stage.append(A.radio);
}

// ---------- per frame ----------

// focus: the focused car's HUD readings (focus.js), used for its engine in replays
export function updateAudioDeck(S, st, focus) {
  if (!audioReady() || !S?.data) return;
  if (S !== lastS) { lastS = S; prev = {}; said = {}; rcSeen = (S.data.race_control || []).length; queue = []; }
  const sc = audioScene();
  if (!sc) return;
  // physical time step: the race clock's advance (replay speed and pauses included), so speeds and Doppler shifts are
  // the cars' real ones whatever the playback rate
  const dt = S.t - lastT, on = dt > 0 && dt < 5;
  lastT = S.t;
  // Replay positions are interpolated linearly between 0.5 s samples, so differenced velocities step every half
  // second, and with them the estimated revs and the Doppler pitch. A ~0.2 s low-pass turns the steps into glides.
  // Anything faster than 120 m/s is a camera cut or a data jump, not motion.
  const k = on ? 1 - Math.exp(-dt / 0.2) : 0, fast = u => u.lengthSq() > 120 * 120;
  if (on && lastCam) { const u = sc.cam.clone().sub(lastCam).divideScalar(dt); camVel.lerp(fast(u) ? u.set(0, 0, 0) : u, k); }
  lastCam = sc.cam.clone();
  const cars = [], {cyl, turbo, rpmMax} = engine(S.year ?? new Date().getFullYear());  // the era's engine voice
  for (const [id, pos] of Object.entries(sc.cars)) {
    const p = prev[id], raw = p && on ? pos.clone().sub(p.pos).divideScalar(dt) : null;
    const vel = p ? p.vel.clone().lerp(raw && !fast(raw) ? raw : p.vel, k) : new THREE.Vector3();
    const speed = vel.length(), accel = p && on ? (speed - p.speed) / dt : 0;
    prev[id] = {pos, vel, speed};
    cars.push({id, pos, vel, speed, dist: pos.distanceTo(sc.cam), accel, cyl, turbo, ...carState(S, id, focus, speed, accel, rpmMax)});
  }
  cars.sort((a, b) => (b.id === S.selected) - (a.id === S.selected) || a.dist - b.dist);
  const heard = cars.filter((c, i) => i < VOICES && (c.id === S.selected || c.dist < RANGE));
  updateAudio({pos: sc.cam, fwd: sc.fwd, up: sc.up, vel: camVel}, sc.mode, heard, on, sc.tunnel);
  if (on) radioEvents(S, focus);
}

// What a car's engine and tyres are doing: the simulation's physics, the focused car's telemetry in replays, otherwise
// gear and revs estimated from its speed (telemetry.js gearbox) with throttle from its acceleration.
function carState(S, id, focus, speed, accel, rpmMax) {
  const c = S.sim?.car(id);
  if (c) return {rpm: c.rpm, gear: c.gear, throttle: c.throttle, brake: c.brake, deploy: c.ers.deploying, harvest: c.ers.harvesting,
                 kerb: c.onKerb, sausage: c.sausage, util: c.util ?? 0, lock: c.smoke > 0, wet: c.wet, speed: c.v, tcCut: c.tcCut};
  // car data comes once per replay step (0.5 s): interpolate revs and throttle between samples, or the pitch stair-steps
  const tele = !S.live && typeof S.tele?.[id] === 'object' ? S.tele[id] : null, x = S.t / S.data.step, i = Math.floor(x);
  const lerp = f => (tele?.[f]?.[i] != null && tele[f][i + 1] != null ? tele[f][i] + (tele[f][i + 1] - tele[f][i]) * (x - i) : null);
  if (focus && id === S.selected)
    return {rpm: lerp('rpm') ?? focus.rpm, gear: focus.gear, throttle: (lerp('throttle') ?? focus.throttle ?? 0) / 100, brake: (focus.brake ?? 0) / 100,
            deploy: focus.ers?.mode === 'DEPLOY', harvest: focus.ers?.mode === 'HARVEST', kerb: false, util: 0, lock: false, wet: 0};
  const box = gearbox(speed * 3.6, rpmMax);
  return {rpm: box.rpm, gear: box.gear, throttle: Math.min(1, Math.max(0, 0.6 + accel / 6)), brake: accel < -8 ? 1 : 0,
          deploy: false, harvest: false, kerb: false, util: 0, lock: false, wet: 0};
}

// ---------- team radio ----------

// Engineer calls, at most once per trigger: race control's DRS / VSC / Safety Car messages (any session), and for the
// focused driver a box call, critical tyres (past 62 % wear, the 35 % cliff ahead) and a purple (fastest) lap.
function radioEvents(S, focus) {
  const now = performance.now();
  if (now - checkedAt < 250) return;
  checkedAt = now;
  const rc = S.data.race_control || [];
  for (; rcSeen < rc.length && rc[rcSeen][0] <= S.t; rcSeen++) {
    const m = (rc[rcSeen][3] || '').toUpperCase();
    if (/(DRS|OVERTAKE) ENABLED/.test(m)) transmit(null, /OVERTAKE/.test(m) ? 'Overtake enabled. Overtake enabled.' : 'DRS enabled. DRS enabled.');
    else if (/VIRTUAL SAFETY CAR DEPLOYED/.test(m)) transmit(null, 'Virtual Safety Car deployed. Maintain positive delta.');
    else if (/^SAFETY CAR DEPLOYED/.test(m)) transmit(null, 'Safety car, safety car. Keep the tyres warm, no overtaking.');
  }
  const id = S.selected, code = S.byId?.[id]?.code;
  if (!id) return;
  const once = (key, text) => { if (!said[key]) { said[key] = true; transmit(code, text); } };
  const car = S.sim?.car(id);
  if (car?.pit.box) once(`box-${id}-${car.pit.stops}`, `Box, box, box this lap. ${PLURAL[car.pit.box.compound] ?? ''}.`);
  const wear = focus?.tyres?.wear;
  if (wear && wear.reduce((a, b) => a + b) / 4 > 62) once(`tyres-${id}-${car?.stint ?? focus.b?.tyre}`, 'Tyres are critical. Watch the cliff.');
  if (car && car.damage > 0.2) once(`wing-${id}-${car.pit.stops}`, 'We have front wing damage. Box for repairs.');
  const col = S.cols?.[id];
  if (col?.lastCls === 'p' && col.last) once(`purple-${id}-${col.last}`, 'Purple lap. Fastest of the race.');
}

// One transmission at a time: open squelch, the engineer's voice (speech synthesis), close squelch; engines duck
// underneath and the TEAM RADIO banner animates. Later calls queue (newest three kept).
function transmit(code, text) {
  if (radioBusy) { queue.push([code, text]); queue = queue.slice(-3); return; }
  radioBusy = true;
  A.who.textContent = code ? ` · ${code}` : '';
  A.text.textContent = `“${text}”`;
  A.radio.hidden = false;
  A.radio.classList.add('live');
  duck(true);
  squelch(true);
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    squelch(false);
    duck(false);
    A.radio.classList.remove('live');
    setTimeout(() => {
      A.radio.hidden = true;
      radioBusy = false;
      if (queue.length) transmit(...queue.shift());
    }, 600);
  };
  setTimeout(() => {
    const synth = window.speechSynthesis;
    if (!synth || levels.muted) return setTimeout(done, 2500);
    const u = new SpeechSynthesisUtterance(text), voices = synth.getVoices();
    u.voice = voices.find(v => v.lang === 'en-GB') ?? voices.find(v => v.lang.startsWith('en')) ?? null;
    Object.assign(u, {rate: 1.08, pitch: 0.85, volume: levels.radio});
    u.onend = u.onerror = done;
    synth.speak(u);
    setTimeout(done, 9000);  // some engines never fire onend
  }, 380);  // after the opening squelch
}
