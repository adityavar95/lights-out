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
export const input = {throttle: 0, brake: 0, steer: 0, clutch: 0, pad: null, deadzone: 0.08};
let enabled = false;

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
  input.throttle = toward(input.throttle, down('throttle') ? 1 : 0, down('throttle') ? 6 : 8, dt);
  input.brake = toward(input.brake, down('brake') ? 1 : 0, down('brake') ? 10 : 8, dt);
  input.clutch = toward(input.clutch, down('clutch') ? 1 : 0, 10, dt);
  const want = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
  const rate = want === 0 ? 6 : Math.sign(want) !== Math.sign(input.steer) && input.steer !== 0 ? 8 : 5;
  input.steer = toward(input.steer, want, rate, dt);
  const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p?.connected);
  input.pad = pad ? pad.id : null;
  if (pad) {
    const rt = pad.buttons[7]?.value ?? 0, lt = pad.buttons[6]?.value ?? 0, stick = dead(pad.axes[0] ?? 0, input.deadzone);
    if (rt > 0.02 || lt > 0.02 || stick !== 0) {  // the pad is being used: analogue values win
      input.throttle = rt;
      input.brake = lt;
      input.steer = stick;
    }
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
