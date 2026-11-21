// Player input: keyboard and gamepad, turned into smooth 0..1 pedals, a -1..1 steering request and one-shot actions.
// Only active while the player drives a car (enableInput); keys are then captured before the replay's own shortcuts.

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  up: ['KeyE', 'ShiftLeft', 'ShiftRight'], down: ['KeyQ', 'ControlLeft', 'ControlRight'], drs: ['KeyR', 'Space'],
  ers: ['KeyF'], pit: ['KeyP'], camera: ['KeyC'], clutch: ['KeyX'],
};
const ACTIONS = ['up', 'down', 'drs', 'ers', 'pit', 'camera'];
// standard gamepad mapping: A 0, B 1, X 2, Y 3, LB 4, RB 5, LT 6, RT 7
const PAD = {drs: 0, ers: 1, pit: 2, camera: 3, down: 4, up: 5};

const held = new Set(), fired = new Set(), padWas = {};
let activePad = null, rumbledAt = 0;
export const input = {throttle: 0, brake: 0, steer: 0, clutch: 0, pad: null, deadzone: 0.08};
let enabled = false;
const key = {throttle: 0, brake: 0, steer: 0};  // the keyboard's own ramps, kept apart so a pad never resets them

const owns = code => Object.values(KEYS).some(list => list.includes(code));
const typing = e => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);

// capture phase on window: runs before the replay's document listener, which then never sees driving keys
addEventListener('keydown', e => {
  if (!enabled || typing(e) || !owns(e.code)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) for (const a of ACTIONS) if (KEYS[a].includes(e.code)) fired.add(a);
  held.add(e.code);
}, true);
addEventListener('keyup', e => { held.delete(e.code); }, true);
addEventListener('blur', () => held.clear());  // keys released while the tab was in the background

export const capturing = () => enabled;

export function enableInput(on) {
  enabled = on;
  if (!on) held.clear();
}

const down = name => KEYS[name].some(k => held.has(k));
const toward = (x, target, rate, dt) => x + Math.max(-rate * dt, Math.min(rate * dt, target - x));

// Radial deadzone with rescaling: inside the deadzone nothing, outside it the stick's travel is stretched back to 0..1,
// so there is no jump at the edge of the deadzone: s = sign(x) (|x| - dz) / (1 - dz).
const dead = (x, dz) => (Math.abs(x) < dz ? 0 : Math.sign(x) * (Math.abs(x) - dz) / (1 - dz));

// Per frame. Keyboard keys are digital, so they become progressive: throttle rises at 6/s (full in ~0.17 s), brake at
// 10/s, both fall at 8/s; steering moves at 5/s towards full lock, recentres at 6/s on release and swings through
// centre at 8/s when the opposite key is pressed (counter-steer). An active gamepad's analogue values replace them.
// Returns {throttle, brake, steer, actions: Set of one-shot names}.
export function pollInput(dt) {
  key.throttle = toward(key.throttle, down('throttle') ? 1 : 0, down('throttle') ? 6 : 8, dt);
  key.brake = toward(key.brake, down('brake') ? 1 : 0, down('brake') ? 10 : 8, dt);
  input.clutch = toward(input.clutch, down('clutch') ? 1 : 0, 10, dt);
  const want = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
  const rate = want === 0 ? 6 : Math.sign(want) !== Math.sign(key.steer) && key.steer !== 0 ? 8 : 5;
  key.steer = toward(key.steer, want, rate, dt);
  Object.assign(input, key);
  // only the W3C standard layout: a wheel or pad with its own layout would read the wrong axes and buttons
  const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p?.connected && p.mapping === 'standard');
  input.pad = pad ? pad.id : null;
  activePad = pad ?? null;
  if (pad) {
    // keyboard and pad together: the larger pedal wins, a held steering key beats the stick. Triggers get the deadzone
    // too (a worn trigger resting at 3 % used to take over from the keyboard); the stick a 1.5 power curve, finer near centre
    const stick = dead(pad.axes[0] ?? 0, input.deadzone);
    input.throttle = Math.max(key.throttle, dead(pad.buttons[7]?.value ?? 0, input.deadzone));
    input.brake = Math.max(key.brake, dead(pad.buttons[6]?.value ?? 0, input.deadzone));
    if (key.steer === 0) input.steer = Math.sign(stick) * Math.abs(stick) ** 1.5;
    if (pad.buttons[10]?.pressed) input.clutch = 1;  // L3: the clutch
    for (const [name, b] of Object.entries(PAD)) {
      const now = !!pad.buttons[b]?.pressed;
      if (now && !padWas[name]) fired.add(name);
      padWas[name] = now;
    }
  }
  const actions = new Set(fired);
  fired.clear();
  return {throttle: input.throttle, brake: input.brake, steer: input.steer, clutch: input.clutch, actions};
}

// Force feedback: a 100 ms dual-rumble effect, renewed at most every 80 ms (so a steady kerb or slide is continuous and
// silence needs nothing sent). {strong, weak, left, right} 0..1 from player.js rumbleFor; left/right are the impulse triggers. A keyboard, or a pad with no actuator, does nothing.
export function rumble({strong, weak, left = 0, right = 0}, now = performance.now()) {
  const a = activePad?.vibrationActuator;
  if (!a || now - rumbledAt < 80 || Math.max(strong, weak, left, right) < 0.02) return;
  rumbledAt = now;
  const fx = {startDelay: 0, duration: 100, strongMagnitude: strong, weakMagnitude: weak};
  if (a.effects?.includes('trigger-rumble')) a.playEffect('trigger-rumble', {...fx, leftTrigger: left, rightTrigger: right}).catch(() => {});
  else a.playEffect('dual-rumble', fx).catch(() => {});
}
