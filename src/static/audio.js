// Procedural spatial audio (Web Audio API, no sample files): V6 turbo-hybrid engines with shift cuts, blips and
// overrun crackle, Doppler fly-bys through HRTF panners, camera acoustics, kerb rumble, tyre screech, wind, spray, and
// the team-radio squelch. The mix is fed every frame with car states in metres and metres per second (physical time).

import {voiceIds} from './util.js';

const C = 343;          // speed of sound, m/s
const VOICES = 6;       // engines heard at once: the focused car plus the nearest five
const MOUNTED = new Set(['onboard', 'tcam']);

let ctx = null, bus, noiseBuf, pinkBuf, voices = [], profile = null, radioDuck = 1;
export const levels = {master: 0.8, engine: 0.8, fx: 0.7, radio: 0.9, muted: false};
export const audioReady = () => !!ctx;

// ---------- shared sources ----------

// 2 s of white noise, and pink noise (equal energy per octave, so it sounds like air rather than hiss) from Paul
// Kellet's filter: white noise through a bank of leaky integrators with poles spread across the spectrum.
function noiseBuffers() {
  const n = ctx.sampleRate * 2, white = ctx.createBuffer(1, n, ctx.sampleRate), pink = ctx.createBuffer(1, n, ctx.sampleRate);
  const w = white.getChannelData(0), p = pink.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
  }
  return [white, pink];
}

const loop = buf => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(); return s; };
const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
const filter = (type, f, Q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; };
const chain = (...nodes) => { nodes.reduce((a, b) => (a.connect(b), b)); return nodes.at(-1); };
const ramp = (param, v, tc = 0.03) => param.setTargetAtTime(v, ctx.currentTime, tc);  // first-order glide, no zipper noise
// drop later automation but keep the value the param has now (cancelScheduledValues alone can snap it: a click)
const hold = (param, t) => param.cancelAndHoldAtTime ? param.cancelAndHoldAtTime(t) : param.cancelScheduledValues(t);

// Soft clipper: y = tanh(k x) / tanh(k). The drive gain before it sets how hard the signal hits the curve, so more
// throttle means more saturation (odd harmonics, the rasp of a loaded engine) without rebuilding the curve.
function softClip(k = 2) {
  const ws = ctx.createWaveShaper(), n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  ws.curve = curve;
  ws.oversample = '4x';  // the clipped pulse wave is rich in harmonics: fold-back aliasing is what sounds digital
  return ws;
}

// The engine-order spectrum of a cyl-cylinder four-stroke as one band-limited PeriodicWave, played at the cycle
// frequency fc = rpm / 120 (one cycle = two crank turns). Harmonic k is engine order k / 2. Every cyl-th harmonic is a
// firing order (cosine phase: together they are the exhaust pulse train, the rasp); every (cyl/2)-th in between is one
// bank's pulse; the rest are small, randomly phased leftovers of cylinder-to-cylinder differences (no two cylinders burn
// alike), which turn a buzzer into an engine. Each voice draws its own, so no two cars sound identical.
function engineWave(cyl) {
  const N = 160, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let k = 1; k <= N; k++) {
    const n = k / cyl, roll = n < 1 ? 1 : n ** -1.1;
    const a = roll * (k % cyl === 0 ? 1 : k % (cyl / 2) === 0 ? 0.45 : 0.06 + Math.random() * 0.08);
    const ph = k % cyl === 0 ? 0 : Math.random() * 2 * Math.PI;
    re[k] = a * Math.cos(ph);
    im[k] = a * Math.sin(ph);
  }
  return ctx.createPeriodicWave(re, im);
}

// Reverb impulse response, made procedurally: stereo noise with an exponential decay (RT60 ~1.8 s), the statistical
// shape of a diffuse sound field bouncing off grandstands and barriers. A one-pole low-pass that closes over the tail
// darkens it the way air and soft surfaces soak up high frequencies first (a full-band tail sounds metallic).
function reverbIR(seconds = 1.8) {
  const n = Math.floor(ctx.sampleRate * seconds), ir = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < n; i++) {
      y += ((Math.random() * 2 - 1) * Math.exp(-6.9 * i / n) - y) * (1 - 0.92 * i / n);  // -60 dB at the end
      d[i] = y;
    }
  }
  return ir;
}

// one-shot: a decaying burst of filtered noise (pops, crackles, thuds, static)
function burst(dest, {type = 'bandpass', f = 800, Q = 4, level = 0.5, decay = 0.04, at = ctx.currentTime}) {
  const src = ctx.createBufferSource(), g = gain(0), b = filter(type, f, Q);
  src.buffer = noiseBuf;
  chain(src, b, g, dest);
  g.gain.setValueAtTime(level, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.start(at, Math.random() * 1.5, decay + 0.05);
}

// one-shot sine tone with a short attack/release (the radio squelch, exhaust thumps)
function tone(dest, f, at, dur, level, endF = f) {
  const o = ctx.createOscillator(), g = gain(0);
  o.frequency.setValueAtTime(f, at);
  o.frequency.exponentialRampToValueAtTime(endF, at + dur);
  chain(o, g, dest);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.005);
  g.gain.setValueAtTime(level, at + dur - 0.01);
  g.gain.linearRampToValueAtTime(0, at + dur);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// ---------- graph ----------
//
//  voices: engine -> air absorption -> HRTF panner ---\                     /-> reverb (convolver) --\
//          engine -----------------> direct (mounted cams) --> engine bus --> camera EQ (low/high shelf) --> master -> limiter -> out
//  hero extras (kerb, screech, wind, spray) -> own panner / direct --> fx bus --/
//  radio squelch ------------------------------------------------------------------------------------> master
function build() {
  ctx = new AudioContext({latencyHint: 'interactive'});
  [noiseBuf, pinkBuf] = noiseBuffers();
  const limiter = ctx.createDynamicsCompressor();  // glue and protection: 20 engines at full throttle stay below clipping
  limiter.threshold.value = -10;
  limiter.ratio.value = 8;
  bus = {master: gain(levels.master), engine: gain(levels.engine), fx: gain(levels.fx), radio: gain(levels.radio),
         low: filter('lowshelf', 180), high: filter('highshelf', 3500), reverb: ctx.createConvolver(), wet: gain(0.15)};
  bus.reverb.buffer = reverbIR();
  bus.engine.connect(bus.low);
  bus.fx.connect(bus.low);
  chain(bus.low, bus.high, bus.master);
  chain(bus.high, bus.reverb, bus.wet, bus.master);
  chain(bus.radio, bus.master);
  chain(bus.master, limiter, ctx.destination);
  voices = Array.from({length: VOICES}, (_, i) => makeVoice(i === 0));
}

function panner() {
  const p = ctx.createPanner();
  // HRTF: head-related transfer functions filter each ear's signal the way a head and pinnae do, so direction is
  // heard in front/behind/above, not just left-right. Inverse distance rolloff: gain = ref / (ref + rolloff (d - ref)),
  // the 1/r spreading of a point source (-6 dB per doubling of distance) beyond 8 m.
  Object.assign(p, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 8, maxDistance: 3000, rolloffFactor: 1});
  return p;
}

// One car's engine. A V6 four-stroke fires 3 times per crank revolution (6 cylinders / 2 revolutions per cycle), so the
// firing frequency is f0 = rpm / 60 * 3: 200 Hz at 4,000 rpm, 750 Hz at 15,000. Other eras use their cylinder count
// (c.cyl): a V10 at 19,000 rpm fires at rpm / 60 * 5 = 1,583 Hz. One ConstantSource carries f0 and drives a single
// oscillator playing the whole engine-order spectrum (engineWave) at f0 / cyl, so every order stays phase-locked as
// the revs change. What makes it breathe rather than buzz:
// - cycle-to-cycle variation: no two combustions are alike, so low-passed noise (~180 Hz wide) modulates the level by
//   ~12 % RMS (roughness sidebands round every order) and slower noise (~12 Hz) wanders the pitch by a few cents;
// - combustion noise: broadband noise multiplied by the engine wave itself, so it comes in bursts with each firing
//   pulse, more of it under load;
// - fixed resonances (exhaust pipe ~320 Hz, airbox ~1.3 kHz) that the orders sweep through as the revs climb, the
//   vowel-like change of a real engine (a resonant filter that tracks the revs is what made it sound like a synth).
function makeVoice(hero) {
  const v = {id: null, gear: 0, throttle: 0, popT: 0, kerb: false, hero, cyl: 0, dop: 1};
  const t0 = ctx.currentTime + 0.05;
  v.f0 = ctx.createConstantSource();
  v.f0.offset.value = 200;
  v.blip = gain(1);  // throttle-blip pitch spike on downshifts
  v.ratio = gain(1 / 6);
  v.out = gain(0);   // the engine's level, faded in when a car is assigned
  v.am = gain(1);
  v.drive = gain(1);
  v.formant = filter('lowpass', 1200, 0.7);  // exhaust formant: opens with throttle
  v.cut = gain(1);   // ignition cut on upshifts
  v.osc = ctx.createOscillator();
  v.osc.frequency.value = 0;  // all of its frequency comes from f0 / cyl
  chain(v.f0, v.blip, v.ratio, v.osc.frequency);
  const pipe = filter('peaking', 320, 1.2), airbox = filter('peaking', 1300, 2);
  pipe.gain.value = 5;
  airbox.gain.value = 4;
  chain(v.osc, v.am, v.drive, softClip(), pipe, airbox, v.formant, v.cut, v.out);
  const noise = loop(noiseBuf);
  chain(noise, filter('lowpass', 180, 0.7), gain(2.2), v.am.gain);
  const wander = chain(noise, filter('lowpass', 12, 0.7));
  chain(wander, gain(300), v.osc.detune);
  v.rasp = gain(0);
  v.osc.connect(v.rasp.gain);  // noise x engine wave: bursts in step with the firing pulses
  v.raspG = gain(0);
  chain(noise, filter('bandpass', 2500, 0.5), v.rasp, v.raspG, v.drive);
  v.osc.start(t0);
  v.f0.start(t0);
  // turbo: the compressor wheel's whistle, rising with boost (2.2-5.5 kHz) and wandering with the shaft speed, and
  // wastegate / blow-off hiss when the driver lifts: narrow-band noise that decays as the boost bleeds off
  v.turbo = ctx.createOscillator();
  v.turbo.type = 'sine';
  v.turboG = gain(0);
  chain(v.turbo, v.turboG, v.out);
  chain(wander, gain(1500), v.turbo.detune);
  v.turbo.start(t0);
  v.hiss = gain(0);
  chain(noise, filter('bandpass', 4200, 9), v.hiss, v.out);
  // MGU-K: the motor-generator on the crankshaft, an electric machine whose inverter whines at a pitch proportional to
  // its speed (here ~rpm x 0.32 Hz, ~4 kHz at 12,000 rpm), loud when deploying, a touch lower and softer when harvesting
  v.mguk = ctx.createOscillator();
  v.mguk.type = 'triangle';
  v.mgukG = gain(0);
  chain(v.mguk, v.mgukG, v.out);
  v.mguk.start(t0);
  // spatial path (air absorption: high frequencies die faster with distance) and a direct path for mounted cameras.
  // The asphalt reflects too: a delayed copy (the extra path length of the ground bounce) combs the spectrum, and as
  // a car passes the delay shrinks and the notches sweep: the phasing of a real fly-by.
  v.air = filter('lowpass', 18000, 0.7);
  v.echo = ctx.createDelay(0.05);
  v.pan = panner();
  v.spatial = gain(1);
  v.direct = gain(0);
  chain(v.out, v.echo, gain(0.45), v.air);
  chain(v.out, v.air, v.pan, v.spatial, bus.engine);
  chain(v.out, v.direct, bus.engine);
  if (hero) makeHeroExtras(v);
  return v;
}

// The focused car's surface and air sounds (fx bus).
function makeHeroExtras(v) {
  const fx = gain(1);
  // kerb rumble: the wheels hammering over the kerb's ridges, a sawtooth at speed / ridge spacing (50-110 Hz) through a
  // low-pass, plus a suspension thud when the car first hits it
  v.kerbOsc = ctx.createOscillator();
  v.kerbOsc.type = 'sawtooth';
  v.kerbG = gain(0);
  chain(v.kerbOsc, filter('lowpass', 260, 2), v.kerbG, fx);
  v.kerbOsc.start();
  // tyre screech: the contact patch stick-slipping at the limit, two resonant noise bands (900 Hz scrub, 2.4 kHz squeal)
  const tyreNoise = loop(noiseBuf);
  v.scrub = gain(0);
  v.squeal = gain(0);
  chain(tyreNoise, filter('bandpass', 900, 6), v.scrub, fx);
  chain(tyreNoise, filter('bandpass', 2400, 12), v.squeal, fx);
  // wind: pink noise through a low-pass whose cutoff and level grow with v^2, the dynamic pressure of the airflow
  v.windF = filter('lowpass', 400, 0.5);
  v.wind = gain(0);
  chain(loop(pinkBuf), v.windF, v.wind, fx);
  // gear whine: straight-cut gears meshing, a tone at the tooth-mesh rate of the final drive, ~wheel revs x 4 (final
  // ratio) x 20 teeth: ~3 kHz at 290 km/h; loudest under load, heard most from the cockpit
  v.whine = ctx.createOscillator();
  v.whine.type = 'triangle';
  v.whineG = gain(0);
  chain(v.whine, filter('bandpass', 3000, 1.5), v.whineG, fx);
  v.whine.start();
  // spray: water torn off the tyres, a hard high-passed hiss
  v.spray = gain(0);
  chain(loop(noiseBuf), filter('highpass', 4500, 0.7), v.spray, fx);
  v.fx = fx;
  v.fxPan = panner();
  v.fxSpatial = gain(1);
  v.fxDirect = gain(0);
  chain(fx, v.fxPan, v.fxSpatial, bus.fx);
  chain(fx, v.fxDirect, bus.fx);
}

// ---------- events ----------

// Upshift: a seamless-shift box only interrupts torque for a few tens of ms: the ignition cut dips the level (smooth
// exponential edges, no click) and a low exhaust thump (low-passed noise, not a tone) lands as the revs drop.
function upshift(v, at) {
  const g = v.cut.gain;
  hold(g, at);
  g.setTargetAtTime(0.3, at, 0.004);
  g.setTargetAtTime(1, at + 0.03, 0.008);
  burst(v.out, {type: 'lowpass', f: 160, Q: 0.8, level: 0.6, decay: 0.08, at: at + 0.025});
}

// Downshift under braking: the ECU blips the throttle to match revs (a quick pitch spike), and unburnt fuel ignites
// in the hot exhaust: a handful of overrun pops, bandpassed impulse noise (400-1200 Hz) with fast exponential decay.
function downshift(v, at) {
  hold(v.blip.gain, at);
  v.blip.gain.setTargetAtTime(1.12, at, 0.01);
  v.blip.gain.setTargetAtTime(1, at + 0.035, 0.06);
  for (let i = 2 + Math.floor(Math.random() * 4); i--;) pop(v, at + 0.04 + Math.random() * 0.3);
}

const pop = (v, at) => burst(v.out, {f: 400 + Math.random() * 800, Q: 3, level: 0.5 + Math.random() * 0.6, decay: 0.02 + Math.random() * 0.05, at});

// ---------- per frame ----------

// cam: {pos, fwd, up, vel} (Vector3s, m and m/s); mode: camera mode; cars: [{id, pos, vel, rpm, gear, throttle (0-1),
// brake (0-1), deploy, harvest, kerb, util, lock, wet, speed}] with the focused car (if any) first; on: playback running.
// tunnel: the camera is inside a tunnel (Monaco)
export function updateAudio(cam, mode, cars, on, tunnel = false) {
  if (!ctx) return;
  const now = ctx.currentTime, L = ctx.listener;
  // the listener is the camera: position plus orientation (forward and up vectors)
  if (L.positionX) {
    for (const [p, val] of [['positionX', cam.pos.x], ['positionY', cam.pos.y], ['positionZ', cam.pos.z], ['forwardX', cam.fwd.x],
                            ['forwardY', cam.fwd.y], ['forwardZ', cam.fwd.z], ['upX', cam.up.x], ['upY', cam.up.y], ['upZ', cam.up.z]])
      L[p].setTargetAtTime(val, now, 0.02);
  } else {
    L.setPosition(cam.pos.x, cam.pos.y, cam.pos.z);
    L.setOrientation(cam.fwd.x, cam.fwd.y, cam.fwd.z, cam.up.x, cam.up.y, cam.up.z);
  }
  applyProfile(mode, tunnel);
  const mounted = MOUNTED.has(mode), mute = levels.muted || !on;
  ramp(bus.master.gain, mute ? 0 : levels.master, 0.08);
  ramp(bus.engine.gain, levels.engine * radioDuck);
  ramp(bus.fx.gain, levels.fx * radioDuck);
  ramp(bus.radio.gain, levels.muted ? 0 : levels.radio);

  // keep cars on the voices they already have, give free voices to new cars; voice 0 is always the hero
  const want = cars.slice(0, VOICES);
  const next = voiceIds(voices.map(v => v.id), want.map(c => c.id));
  voices.forEach((v, i) => {
    if (next[i] === v.id) return;
    if (next[i] === null) ramp(v.out.gain, 0, 0.05); else v.fresh = true;
    v.id = next[i];
  });
  for (const v of voices) {
    const c = v.id !== null && want.find(x => x.id === v.id);
    if (c) drive(v, c, cam, mounted && v.hero, now);
  }
}

function drive(v, c, cam, inside, now) {
  // Doppler: with d the unit vector from listener to car, the car's speed away from the listener vs = v_car . d and the
  // listener's speed towards the car vl = v_cam . d give f' = f (c + vl) / (c + vs). A car passing at 300 km/h (83 m/s)
  // sweeps from ~1.32x to ~0.80x its true pitch: the classic fly-by "neeeow". Mounted cameras move with the car: no shift.
  const rel = c.pos.clone().sub(cam.pos), dist = Math.max(rel.length(), 0.5), flat = Math.hypot(rel.x, rel.z), d = rel.divideScalar(dist);
  const doppler = inside ? 1 : Math.min(2, Math.max(0.5, (C + cam.vel.dot(d)) / (C + c.vel.dot(d))));
  const cyl = c.cyl ?? 6;
  if (cyl !== v.cyl) { v.osc.setPeriodicWave(engineWave(cyl)); v.ratio.gain.value = 1 / cyl; v.cyl = cyl; }
  // the velocities are differenced positions, so the Doppler factor is low-passed (~80 ms) to keep the pitch from
  // stepping when the data does; a real pass still sweeps over half a second or more
  v.dop = v.fresh ? doppler : v.dop + (doppler - v.dop) * (1 - Math.exp(-(now - (v.at ?? now)) / 0.08));
  v.at = now;
  const th = c.throttle, f0 = Math.max(c.rpm, 3800) / 60 * cyl / 2 * v.dop;
  if (v.fresh) {  // newly assigned: jump straight to its state instead of gliding from the previous car's
    v.f0.offset.cancelScheduledValues(now);
    v.f0.offset.setValueAtTime(f0, now);
    v.gear = c.gear;
    v.fresh = false;
  }
  // ~30 ms glide: smooths the frame-rate steps (zipper) yet an upshift's rev drop still lands in ~0.1 s
  ramp(v.f0.offset, f0, 0.03);
  // traction control: each intervention is a ~12 ms ignition cut, a rapid stutter while it holds the wheelspin
  if (c.tcCut && now > (v.tcT ?? 0)) {
    hold(v.cut.gain, now);
    v.cut.gain.setTargetAtTime(0.3, now, 0.002);
    v.cut.gain.setTargetAtTime(1, now + 0.012, 0.004);
    v.tcT = now + 0.03 + Math.random() * 0.02;
  }
  if (c.gear > v.gear && v.gear > 0) upshift(v, now);
  else if (c.gear < v.gear && c.gear > 0 && c.brake > 0.2) downshift(v, now);
  v.gear = c.gear;
  // load: saturation, combustion noise and the exhaust formant open up with throttle; off throttle a softer burble.
  // ~60 ms glides: an engine's sound follows the pedal through the air in the intake, not instantly
  ramp(v.drive.gain, 1 + 2.5 * th, 0.06);
  ramp(v.raspG.gain, 0.35 + 0.9 * th, 0.06);
  ramp(v.formant.frequency, 1200 + 4500 * th + f0 * 1.5, 0.06);
  // the era's rev range: a 9,000 rpm 1950s straight-8 at its limit is as loud as a 19,000 rpm V10 at its
  const top = c.rpmMax ?? 15000;
  ramp(v.out.gain, (0.19 + 0.28 * th) * (0.6 + 0.4 * Math.min(1, c.rpm / (0.8 * top))) * (c.speed > 0.5 || c.rpm > 0 ? 1 : 0), 0.06);
  // turbo whistle with boost (the simulation's spooling turbo when it has one, else estimated from revs and throttle);
  // blow-off hiss when the boost dumps on a lift, a lighter chatter of wastegate while it bleeds at full boost
  const boost = c.boost ?? Math.min(1, Math.max(0, (c.rpm - 0.4 * top) / (0.6 * top))) * (0.4 + 0.6 * th);
  ramp(v.turbo.frequency, (2200 + 3300 * boost) * v.dop, 0.2);
  ramp(v.turboG.gain, c.turbo === false ? 0 : 0.008 + 0.022 * boost, 0.15);  // naturally aspirated eras: no whistle or hiss
  if (c.turbo !== false && c.wastegate && !v.bov) ramp(v.hiss.gain, 0.03, 0.05);
  const blowOff = c.bov !== undefined ? c.bov && !v.bov : v.throttle - th > 0.5 && c.rpm > 0.6 * top;
  v.bov = c.bov;
  if (c.turbo !== false && blowOff) {
    hold(v.hiss.gain, now);
    v.hiss.gain.setTargetAtTime(0.14, now, 0.006);
    v.hiss.gain.setTargetAtTime(0, now + 0.03, 0.12);
  }
  // overrun crackle: off throttle at high revs, unburnt fuel popping in the exhaust (close cars only)
  if (th < 0.05 && c.rpm > 0.57 * top && dist < 120 && now > v.popT) { pop(v, now); v.popT = now + 0.05 + Math.random() * 0.25; }
  v.throttle = th;
  ramp(v.mguk.frequency, c.rpm * (c.harvest ? 0.28 : 0.32) * v.dop);
  ramp(v.mgukG.gain, c.deploy ? 0.045 : c.harvest ? 0.03 : 0, 0.1);
  // space: air absorption cutoff falls with distance (~1/(1 + d/120 m)); onboard the engine is heard directly
  ramp(v.air.frequency, Math.max(1500, 18000 / (1 + dist / 120)), 0.05);
  // ground bounce from an image source 0.5 m below the asphalt: extra path = |to image| - |to source|
  const h = Math.max(0.6, cam.pos.y - c.pos.y);
  ramp(v.echo.delayTime, Math.min(0.05, (Math.hypot(flat, h + 0.5) - Math.hypot(flat, h - 0.5)) / C), 0.05);
  setPanner(v.pan, c, now);
  ramp(v.spatial.gain, inside ? 0 : 1, 0.05);
  ramp(v.direct.gain, inside ? 0.7 : 0, 0.05);
  if (!v.hero) return;

  const spd = c.speed, q = Math.min(1, (spd / 90) ** 2);  // dynamic pressure, normalised to ~325 km/h
  ramp(v.kerbOsc.frequency, 50 + 60 * Math.min(1, spd / 80));
  ramp(v.kerbG.gain, c.kerb && spd > 5 ? 0.35 : 0, c.kerb ? 0.01 : 0.06);
  if (c.kerb && !v.kerb) burst(v.fx, {type: 'lowpass', f: 140, Q: 1, level: 0.8, decay: 0.12});  // chassis thud
  v.kerb = c.kerb;
  // sausage kerb: a hump tall enough to slam the plank, a deep bang every hump crossed (~0.5 m apart)
  if (c.sausage && now > (v.humpT ?? 0)) {
    burst(v.fx, {type: 'lowpass', f: 85, Q: 1.5, level: 1.6, decay: 0.18});
    v.humpT = now + 0.09;
  }
  // tyres sliding: past ~85 % of the slip angle of their peak grip (the simulation's), else ~92 % of the friction
  // circle; locking a wheel under braking squeals hardest
  const over = c.scrub !== undefined ? (c.scrub - 0.85) / 0.3 : (c.util - 0.92) / 0.2;
  const slide = Math.min(1, Math.max(0, over)) * (spd > 8 ? 1 : 0), lock = c.lock ? 1 : 0;
  ramp(v.scrub.gain, 0.25 * slide + 0.2 * lock, 0.04);
  ramp(v.squeal.gain, 0.12 * slide + 0.3 * lock, 0.04);
  ramp(v.whine.frequency, Math.max(40, spd / (2 * Math.PI * 0.33) * 4 * 20));
  ramp(v.whineG.gain, (inside ? 0.05 : 0.012) * (0.3 + 0.7 * th) * Math.min(1, spd / 20), 0.05);
  ramp(v.windF.frequency, 300 + 7000 * q);
  ramp(v.wind.gain, (inside ? 0.35 : 0.12) * q, 0.1);
  ramp(v.spray.gain, 0.22 * c.wet * Math.min(1, spd / 70), 0.1);
  setPanner(v.fxPan, c, now);
  ramp(v.fxSpatial.gain, inside ? 0 : 1, 0.05);
  ramp(v.fxDirect.gain, inside ? 1 : 0, 0.05);
}

function setPanner(p, c, now) {
  if (p.positionX) {
    p.positionX.setTargetAtTime(c.pos.x, now, 0.02);
    p.positionY.setTargetAtTime(c.pos.y + 0.5, now, 0.02);
    p.positionZ.setTargetAtTime(c.pos.z, now, 0.02);
  } else p.setPosition(c.pos.x, c.pos.y + 0.5, c.pos.z);
}

// Camera acoustics. Mounted (T-cam / cockpit): close-miked, bright intake and ERS whine (+5 dB above 3.5 kHz), almost
// dry. Trackside (TV chase / helicopter / free orbit): air soaks up the top end (-7 dB), the body of the exhaust
// carries (+3 dB below 180 Hz), and the grandstands add reverb. In a tunnel the concrete bounces everything back:
// the reverb swells (wet x3), the bass builds up (+4 dB) and the cockpit hears the echo too.
function applyProfile(mode, tunnel) {
  const p = (MOUNTED.has(mode) ? 'mounted' : 'trackside') + (tunnel ? '-tunnel' : '');
  if (p === profile) return;
  profile = p;
  const [low, high, wet] = {mounted: [1, 5, 0.04], trackside: [3, -7, 0.22], 'mounted-tunnel': [5, 3, 0.3],
                            'trackside-tunnel': [7, -4, 0.65]}[p];
  ramp(bus.low.gain, low, 0.2);
  ramp(bus.high.gain, high, 0.2);
  ramp(bus.wet.gain, wet, 0.2);
}

// ---------- radio ----------

// The F1 pit-to-car squelch: a two-tone sine chirp (1,400 then 1,800 Hz opening, the reverse closing) and a short burst
// of band-limited static, as a digital radio keys up and drops out.
export function squelch(open) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.01, [a, b] = open ? [1400, 1800] : [1800, 1400];
  tone(bus.radio, a, t, 0.07, 0.25);
  tone(bus.radio, b, t + 0.08, 0.07, 0.25);
  burst(bus.radio, {f: 2200, Q: 0.8, level: 0.35, decay: 0.14, at: t + (open ? 0.16 : 0)});
}

// lower engines and effects while the engineer talks
export function duck(on) { radioDuck = on ? 0.45 : 1; }

// must run inside a user gesture: browsers only let audio start after one
export async function startAudio() {
  if (!ctx) build();
  await ctx.resume();
}
