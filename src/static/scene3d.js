// 3D circuit and cars (three.js). Takes the replay's 2D map coordinates (x right, y down) as the ground plane.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CSS2DRenderer, CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {Sky} from 'three/addons/objects/Sky.js';
import {CSM} from 'three/addons/csm/CSM.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {buildCar} from './cars3d.js';
import {loadRB22, rb22Ready, STEERING_RATIO} from './rb22.js';
import {makeMirror} from './mirror.js';
import {createPost} from './post.js';
import {createVfx, haze} from './vfx.js';
import {textures} from './textures3d.js';
import {buildCircuit} from './circuit3d.js';
import {createCrews} from './pit3d.js';
import {covered} from './util.js';

const SIZE = 1000;                  // the circuit is scaled to this many scene units across
const UP = new THREE.Vector3(0, 1, 0);
const SUN = new THREE.Vector3(0.45, 0.62, 0.3).normalize();  // direction towards the sun; re-aimed at the HDRI's sun
// photographed HDR sky (CC0, Poly Haven); the procedural sky stays if it can't be fetched
const HDRI = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr';

let container, renderer, labels, scene, camera, controls, world, csm, post, vfx, hemi, cars = {}, map = null, tex = null;
let carsToken = 0, mode = 'overview', chased = null, glide = 1, trackMat = null, simRate = 0, lastUpdate = 0, wettable = [], circuit = null, fly = null;
// the circuit before this one, disposed after the new one has drawn: its materials hold the compiled shaders the new
// one reuses (disposing first deleted them, and every race switch recompiled them all: ~0.3 s)
let stale = null;
let drawnAt = 0, resized = true;
const drawnView = new THREE.Matrix4(), drawnProj = new THREE.Matrix4();
const sky0 = {env: 0.35, hemi: 0.5, fog: new THREE.Color(0xc4d3e2)};  // clear-sky lighting, for the weather to dim
const RAIN_GREY = new THREE.Color(0.3, 0.32, 0.35);
const RIGGED = new Set(['onboard', 'tcam', 'heli']);  // camera placed by code each frame, so no orbit controls
// depth of field: lens f-number per camera, focused on the camera's target (the car, or 15 m ahead of it on board); the
// overview and the helicopter have none
const APERTURE = {chase: 2, tcam: 2.8, onboard: 2.8};
const parts = {halo: true, body: true};
const crews = createCrews();  // pit crews, for cars that stop in the pit lane

const rnd = (a, b) => a + Math.random() * (b - a);

export function init3d(el) {
  container = el;
  // no canvas MSAA: the post-processing target is multisampled instead; high-performance asks for the discrete GPU on
  // dual-GPU laptops (Windows can still override it per browser in Settings > Display > Graphics)
  renderer = new THREE.WebGLRenderer({antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance'});  // throws without WebGL
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // Khronos PBR Neutral: keeps livery hues and saturation (ACES pushed kerb red to neon, blues to purple); x - 0.04 at mid-grey
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  labels = new CSS2DRenderer();
  labels.domElement.className = 'labels3d';
  container.append(renderer.domElement, labels.domElement);
  scene = new THREE.Scene();
  // every render() and the label pass would walk all ~2,000 objects again: the loop updates the matrices once per frame
  scene.matrixWorldAutoUpdate = false;
  tex = textures();
  scene.fog = new THREE.Fog(0xc4d3e2, SIZE * 1.3, SIZE * 4);
  const sky = new Sky(), u = sky.material.uniforms, envScene = new THREE.Scene(), pmrem = new THREE.PMREMGenerator(renderer);
  u.turbidity.value = 4;
  u.rayleigh.value = 1.3;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(SUN);
  sky.scale.setScalar(50);
  envScene.add(sky);
  scene.environment = pmrem.fromScene(envScene).texture;  // the same sky in paint reflections
  scene.environmentIntensity = 0.35;  // the raw sky is HDR-bright and washes colours out
  sky.scale.setScalar(SIZE * 20);
  scene.add(sky);
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 30000);
  camera.layers.enable(1);  // layer 1: effects and contact shadows (drawn, but left out of the motion-vector pass)
  controls = new OrbitControls(camera, labels.domElement);  // the label layer sits on top, so it gets the mouse
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;  // stay above the ground
  controls.maxDistance = SIZE * 1.6;        // the whole circuit, well inside the fog; minDistance is set per circuit
  controls.zoomToCursor = true;             // the scroll wheel zooms towards what's under the pointer
  controls.screenSpacePanning = false;      // right-drag pans over the ground, not up into the sky
  hemi = new THREE.HemisphereLight(0xdbe9ff, 0x5d7a45, 0.5);
  scene.add(hemi);
  // Cascaded shadow maps: the view frustum is cut at near * (far / near)^(i / 4) = ~0.7, 10, 140, 2000 units, each slice with
  // its own 2048² sun shadow map, so texel size grows with distance like screen pixels do (centimetres on the car in front
  // of a chase camera, metres across the circuit); fade cross-fades neighbouring cascades so the seams don't show.
  csm = new CSM({camera, parent: scene, cascades: 4, mode: 'logarithmic', maxFar: SIZE * 2, shadowMapSize: 2048,
                 lightDirection: SUN.clone().negate(), lightIntensity: 2.6, lightFar: SIZE * 6, lightMargin: SIZE * 0.5});
  csm.fade = true;
  for (const l of csm.lights) l.color.set(0xfff1dc);
  world = new THREE.Group();
  scene.add(world);
  post = createPost(renderer, scene, camera);
  vfx = createVfx(scene);
  loadSky(pmrem, sky);
  const fit = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;  // hidden: zero-size render targets would only warn
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));  // it changes with browser zoom or another monitor
    renderer.setSize(w, h);
    labels.setSize(w, h);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    csm.updateFrustums();
    resized = true;  // setSize cleared the canvas
  };
  new ResizeObserver(fit).observe(container);
  // a monitor with another DPR changes no CSS size, so the observer misses it
  const watchDpr = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { fit(); watchDpr(); }, {once: true});
  watchDpr();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    // tab hidden, no size yet, or under the F1 TV viewer (it drew ~1,800 calls a frame there, beside 4K video decoding)
    if (!container.offsetParent || !container.clientWidth || !container.clientHeight || covered()) return;
    if (fly) {  // after a circuit switch: ease from the old view to the new overview over 1.5 s
      fly.t = Math.min(1, fly.t + dt / 1.5);
      const e = THREE.MathUtils.smootherstep(fly.t, 0, 1);
      camera.position.lerpVectors(fly.from, fly.to, e);
      controls.target.lerpVectors(fly.target, fly.aim, e);
      if (fly.t === 1 || mode !== 'overview') fly = null;
    }
    if (!RIGGED.has(mode)) {
      controls.update();  // update() would turn a rigged camera back to the orbit target
      keepInBounds();
    }
    camera.updateMatrixWorld();
    // Nothing moving (paused, camera at rest): redraw 4 times a second instead of every display refresh, for what
    // changes without moving (sky, weather, a new circuit). Shadows, blur and bloom cost the same on a still frame.
    const now = performance.now(), still = !resized && !fly && now - lastUpdate > 500 && !vfx.busy()
      && camera.matrixWorld.equals(drawnView) && camera.projectionMatrix.equals(drawnProj)
      && !Object.values(cars).some(c => c.group.visible && c.haze.visible);  // the heat haze shimmers
    if (still && now - drawnAt < 250) return;
    if (now - drawnAt > 100) post.reset();  // no motion blur across the gap
    drawnAt = now;
    resized = false;
    drawnView.copy(camera.matrixWorld);
    drawnProj.copy(camera.projectionMatrix);
    csm.update();
    for (const l of csm.lights) l.shadow.normalBias = (l.shadow.camera.right - l.shadow.camera.left) / 2048;  // ~1 texel
    vfx.update(dt, camera, SUN, renderer.domElement.height);
    scene.updateMatrixWorld();
    const moving = performance.now() - lastUpdate < 200;  // the replay is still moving the cars
    post.focus(chased === null ? 0 : camera.position.distanceTo(controls.target), APERTURE[mode]);
    post.render(dt, 1 / Math.max(1, moving ? simRate : 1));  // a 10x replay blurs like real time, not 10x as long
    stale?.dispose();
    stale = null;
    labels.render(scene, camera);
  });
}

// Orbit target: over the circuit (panning stops at its edge) and, in the overview, on the ground, so panning over a
// hill carries the camera up with it; the camera stays 2 m above the terrain.
function keepInBounds() {
  if (!circuit) return;
  const t = controls.target, lim = SIZE * 0.7, shift = new THREE.Vector3(
    THREE.MathUtils.clamp(t.x, -lim, lim) - t.x, 0, THREE.MathUtils.clamp(t.z, -lim, lim) - t.z);
  if (mode === 'overview' && !fly) shift.y = circuit.groundAt(t.x + shift.x, t.z + shift.z) - t.y;
  t.add(shift);
  camera.position.add(shift);
  camera.position.y = Math.max(camera.position.y, circuit.groundAt(camera.position.x, camera.position.z) + m(2));
}

// The HDR panorama becomes the background and, PMREM-prefiltered (a mip per roughness level), the image-based light for
// diffuse ambient and reflections. The sun light is aimed at its brightest texel so shadows agree with the sky: texel
// (x, y) with row 0 at the top is longitude 2 pi (u - 0.5), latitude pi (0.5 - v), as three samples equirect maps.
function loadSky(pmrem, sky) {
  new RGBELoader().load(HDRI, hdr => {
    const {data, width: w, height: h} = hdr.image, half = THREE.DataUtils.fromHalfFloat;
    let best = 0, at = 0;
    for (let i = 0; i < w * h / 2; i += 2) {  // upper half: the sun is above the horizon
      const l = half(data[i * 4]) + half(data[i * 4 + 1]) + half(data[i * 4 + 2]);
      if (l > best) { best = l; at = i; }
    }
    const phi = ((at % w + 0.5) / w - 0.5) * 2 * Math.PI;
    const lat = Math.max((0.5 - (Math.floor(at / w) + 0.5) / h) * Math.PI, 0.25);  // >= 14 degrees: no endless shadows
    SUN.set(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
    csm.lightDirection.copy(SUN).negate();
    // fog fades to the horizon's mean radiance (linear HDR; fog is mixed before tone mapping) so the ground meets the sky
    const fog = [0, 0, 0], row = Math.floor(h * 0.49) * w;
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) fog[c] += half(data[(row + x) * 4 + c]) / w;
    scene.fog.color.setRGB(...fog);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.environmentIntensity = sky0.env = 0.7;
    sky0.fog.copy(scene.fog.color);
    scene.background = hdr;
    scene.remove(sky);
    hemi.intensity = sky0.hemi = 0.15;  // the HDRI now supplies the ambient light
  }, undefined, () => {});
}

// Every lit material needs CSM's shader patch: unpatched, the cascade lights don't light it at all. A material's own
// onBeforeCompile (paint, asphalt) runs after CSM's.
function csmSync() {
  const live = new Set();
  scene.traverse(o => { if (o.material?.isMeshStandardMaterial) live.add(o.material); });
  for (const mat of csm.shaders.keys()) if (!live.has(mat)) csm.shaders.delete(mat);
  for (const mat of live) {
    if (csm.shaders.has(mat)) continue;
    const own = Object.hasOwn(mat, 'onBeforeCompile') && mat.onBeforeCompile;
    csm.setupMaterial(mat);
    const patch = mat.onBeforeCompile;
    if (own) mat.onBeforeCompile = (sh, r) => { patch(sh); own(sh, r); };
  }
}

// ---------- circuit (circuit3d.js builds it) ----------

const label = (cls, ...children) => {
  const div = document.createElement('div');
  div.className = cls;
  div.append(...children);
  return new CSS2DObject(div);
};

// 2D map point -> scene position, h above the road surface there (searched near outline index `hint`)
const toScene = ([x, y], h = 0, hint) => {
  const s = circuit?.surface([x, y], hint);
  return new THREE.Vector3((x - map.cx) * map.k, (s?.y ?? 0) + h, (y - map.cy) * map.k);
};
const m = metres => metres / map.mps;  // metres -> scene units

// pts: 2D map outline; corners: [[x, y, number]]; startKnown: pts[0] is the line; mpu: metres per map unit; width: metres;
// ann: circuits.js annotate() (heights, banking, kerbs, tunnel, barriers), flat without it. Frees the previous circuit
// and cars, and flies the camera to the new overview instead of cutting.
export function setTrack(pts, span, corners, startKnown, mpu, width = 13, ann = null) {
  stale?.dispose();  // a second switch before a frame was drawn
  stale = circuit;
  circuit = null;
  disposeCars();
  world.clear();
  if (!pts.length) return;
  const X = pts.map(p => p[0]), Y = pts.map(p => p[1]);
  map = {k: SIZE / span, cx: (Math.min(...X) + Math.max(...X)) / 2, cy: (Math.min(...Y) + Math.max(...Y)) / 2, mps: mpu * span / SIZE};
  const n = pts.length;
  ann ??= {h: new Array(n).fill(0), bank: new Array(n).fill(0), kerb: new Array(n).fill(''), tunnel: null, wall: 10, preset: null};
  circuit = buildCircuit(world, {pts, map, tex, width, startKnown, ann, corners, SIZE});
  trackMat = circuit.trackMat;
  wettable = circuit.wettable;  // scenery that turns darker and glossier in the rain
  vfx.mps = map.mps;
  post.setMps(map.mps);
  controls.minDistance = m(4);  // close enough to read a car's livery, never inside it
  csmSync();
  const from = camera.position.clone(), target = controls.target.clone();
  resetView();
  if (mode === 'overview') fly = {from, target, to: camera.position.clone(), aim: controls.target.clone(), t: 0};
}

export function resetView() {
  chased = null;
  controls.target.set(0, 0, 0);
  camera.position.set(0, SIZE * 0.72, SIZE * 0.78);
  post.reset();
}

// ---------- cars ----------

// drivers: [{id, num, code, color}]; year picks the era's car design
export function setCars(drivers, onSelect, year) {
  disposeCars();
  const token = ++carsToken;
  // 2026+ cars use the RB22 model up close; until it has loaded they are procedural, then the grid is rebuilt once
  if (year >= 2026 && !rb22Ready()) loadRB22().then(() => token === carsToken && setCars(drivers, onSelect, year), e => console.warn('RB22 model', e));
  for (const d of drivers) {
    const car = buildCar(d.color, d.num, year, tex.blob, map ? m(50) : Infinity);
    const num = document.createElement('b');
    num.textContent = d.num ?? '';
    num.style.background = d.color;
    const code = document.createElement('span');
    code.textContent = d.code;
    const tag = label('carlabel3d', num, code);
    tag.element.onclick = () => onSelect(d.id);
    tag.position.set(0, 1.5, 0);  // metres above the car
    tag.center.set(0.5, 1);  // the tag stands above that point on its stem, leaving the true-size car in view
    car.group.add(tag);
    const heat = haze(car.exhaust);
    car.group.add(heat);
    world.add(car.group);
    cars[d.id] = {...car, tag, haze: heat, color: d.color, yaw: 0, steer: 0, last: null, v: 0, acc: 0};
  }
  world.add(crews.group);  // setTrack clears the world
  csmSync();
}

// the cars' own geometry and materials (era templates are shared and kept)
function disposeCars() {
  for (const c of Object.values(cars)) {
    world.remove(c.group);
    c.tag.element.remove();  // CSS2DObject only drops its DOM element when removed itself, not with its parent group
    c.dispose();
    c.haze.geometry?.dispose();
    c.haze.material?.dispose();
  }
  cars = {};
  crews.clear();
}

// mode: overview (free orbit) | chase (TV) | onboard (cockpit, driver's eye) | tcam (on the airbox) | heli (helicopter)
export function setView(m) {
  mode = m;
  chased = null;
  controls.enabled = !RIGGED.has(m);
  camera.fov = {overview: 42, chase: 50, onboard: 72, tcam: 64, heli: 30}[m];
  camera.updateProjectionMatrix();
  csm.updateFrustums();  // the cascades are slices of the view frustum
  post.reset();
  if (m === 'overview') resetView();
}

export const setParts = p => Object.assign(parts, p);

// colour band on the tyre sidewalls for the current compound
// Weather look, from the simulation's weather (or a replay's rain flag). cloud / rain 0..1; wetLine / wetOff: water
// depth on and off the racing line. Overcast cuts the direct sun by up to 85 % and the sky light by half and greys the
// fog; rain pulls the fog in; the track shader gets its water depths, and other surfaces lose roughness as they wet.
export function setWeather({cloud, rain, wetLine, wetOff}) {
  if (!scene) return;
  const overcast = Math.max(0, cloud - 0.1) / 0.9, wet = (wetLine + wetOff) / 2;
  for (const l of csm.lights) l.intensity = 2.6 * (1 - 0.85 * overcast);
  scene.environmentIntensity = sky0.env * (1 - 0.5 * overcast);
  scene.backgroundIntensity = 1 - 0.6 * overcast;
  hemi.intensity = sky0.hemi * (1 + 0.5 * overcast);  // flat, diffuse light under cloud
  scene.fog.color.copy(sky0.fog).lerp(RAIN_GREY, 0.7 * overcast);
  scene.fog.near = SIZE * 1.3 * (1 - 0.9 * rain);
  scene.fog.far = SIZE * 4 * (1 - 0.8 * rain);
  if (trackMat) {
    trackMat.userData.wetLine.value = wetLine;
    trackMat.userData.wetOff.value = wetOff;
    trackMat.normalScale.setScalar(1 - 0.8 * wet);  // the water film smooths over the aggregate
  }
  for (const m of wettable) m.roughness = 0.9 - 0.6 * wet;
  vfx.rain = rain;
}

// Satellite imagery as the ground round the circuit (satellite.js): the outline is fitted to the circuit's real shape,
// the imagery 500 m round the track is fetched, and the terrain shader drapes it through an affine scene (x, z) -> uv
// (Mercator is conformal, so over a few km the map is affine to well under a metre). Trees stay only where the image
// shows vegetation. Anything failing (no real outline, a poor fit, tiles unreachable) leaves the procedural grass.
export async function setGround(year, round) {
  const c = circuit;
  if (!c) return;
  const xs = c.pts.map(p => (p[0] - map.cx) * map.k), zs = c.pts.map(p => (p[1] - map.cy) * map.k), pad = m(500);
  const g = await new Promise(done => {  // the fit, the imagery and its vegetation: groundwork.js, on a worker thread
    const w = new Worker(new URL('./groundwork.js', import.meta.url), {type: 'module'});
    w.onmessage = e => { w.terminate(); done(e.data); };
    w.onerror = e => { w.terminate(); done({error: e.message || 'worker failed'}); };
    w.postMessage({url: `/api/geo/${year}/${round}`, pts: c.pts, map: {k: map.k, cx: map.cx, cy: map.cy}, L: SIZE / 2,
      box: [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad],
      maxPx: Math.min(4096, renderer.capabilities.maxTextureSize)});
  });
  if (circuit !== c || !g?.image) {  // another circuit since, or no ground to show
    g?.image?.close();
    if (g?.error) console.warn('satellite ground', g.error);
    else if (g?.rms > 15) console.warn(`satellite ground: outline fit off by ${g.rms.toFixed(0)} m`);
    return;
  }
  const texture = Object.assign(new THREE.Texture(g.image), {colorSpace: THREE.SRGBColorSpace, flipY: false, anisotropy: 8, needsUpdate: true});
  texture.addEventListener('dispose', () => g.image.close());
  const [a, b, u0, d, e, v0] = g.m, {w, h, data} = g.mask;
  const green = (X, Z) => {  // vegetation under scene (x, z), through the affine map the shader drapes the image with
    const u = a * X + b * Z + u0, v = d * X + e * Z + v0;
    return u < 0 || u >= 1 || v < 0 || v >= 1 || data[Math.floor(v * h) * w + Math.floor(u * w)] === 1;
  };
  c.satellite(texture, new THREE.Matrix3().set(...g.m, 0, 0, 1), green, new THREE.Color().setRGB(...g.mean, THREE.SRGBColorSpace));
}

// Pit lane (map points of its centre line): the simulation's, entry road to exit road, or a replay's real one from GPS.
// boxes: the simulation's team garages [{at, color}] (circuit3d.js pitLane).
export function setPitLane(pts, boxes = null) {
  if (!circuit || pts.length < 2) return;
  circuit.pitLane(pts, boxes);
  csmSync();
}

// What the audio hears from: the camera's pose and every visible car's position, in metres (scene units x mps).
export function audioScene() {
  if (!map) return null;
  const k = map.mps, at = {};
  for (const [id, c] of Object.entries(cars)) if (c.group.visible) at[id] = c.group.position.clone().multiplyScalar(k);
  return {mode, cars: at, cam: camera.position.clone().multiplyScalar(k), fwd: camera.getWorldDirection(new THREE.Vector3()),
          up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), tunnel: !!circuit?.inTunnel(camera.position)};
}

// racing-line ribbon for the player: [{pos: [x, y] map, state 0 green / 1 amber / 2 red} | null], or null to hide it
export function setRibbon(pts) {
  let hint;  // consecutive points: each search starts where the last one ended
  if (vfx && map) vfx.ribbon(pts && pts.map(p => p && {p: toScene(p.pos, m(0.12), hint = circuit?.surface(p.pos, hint).i), state: p.state}), m(0.6));
}

export function setTyre(id, color) {
  cars[id]?.stripe.color.set(color || 0xd8d8d8);
}

// Sparks (plank strikes) and tyre smoke (lock-ups): fx {sparks, smoke} 0..1 from the race simulation, else guessed from
// motion: hard braking (past ~2.5 g) locks the fronts, above ~270 km/h the plank strikes, worst as braking dips the nose.
// simDt: replay seconds since the last update, dt: real seconds.
function effects(c, at, next, simDt, dt, fx) {
  const vel = next.clone().sub(at).divideScalar(0.5), v = vel.length() * map.mps;  // m/s over the next half second
  const acc = (v - c.v) / simDt;
  c.v = v;
  if (Math.abs(acc) > 80) return;  // scrubbing or a data jump, not driving
  c.acc += (acc - c.acc) * Math.min(1, simDt * 4);  // ~0.25 s low-pass: GPS positions are noisy
  // carbon brakes: past ~2.5 g of braking the discs heat towards a ~1000 °C glow in ~0.3 s, and cool over ~2 s
  const hot = THREE.MathUtils.smoothstep(-c.acc, 25, 45);
  c.heat = (c.heat ?? 0) + (hot - (c.heat ?? 0)) * (1 - Math.exp(-simDt * (hot > (c.heat ?? 0) ? 3 : 0.5)));
  for (const d of c.discs) d.emissiveIntensity = 3 * c.heat * c.heat;
  const brake = fx ? Math.sqrt(fx.smoke) : THREE.MathUtils.smoothstep(-c.acc, 18, 35);
  const count = perSecond => Math.floor(perSecond * dt + Math.random());  // whole particles this frame, right on average
  const sparks = fx ? fx.sparks : THREE.MathUtils.smoothstep(v, 70, 85) * (0.2 + brake) * (Math.random() < 0.4);  // bursts, as over bumps
  const nSparks = count(900 * sparks), nSmoke = c.fronts.map(() => count(45 * brake * brake)), nSpray = count(260 * (fx?.spray ?? 0));
  if (!nSparks && !nSpray && !nSmoke.some(Boolean)) return;
  c.group.updateMatrixWorld();  // only when spawning: it's a full matrix walk of the car
  for (let i = nSparks; i--;)
    vfx.sparks(c.group.localToWorld(new THREE.Vector3(rnd(...c.plank), 0.01, rnd(-0.15, 0.15))), vel);
  c.fronts.forEach((f, k) => { for (let i = nSmoke[k]; i--;) vfx.smoke(c.group.localToWorld(f.clone()), vel); });
  for (let i = nSpray; i--;)  // rooster tail off the diffuser and rear tyres
    vfx.spray(c.group.localToWorld(new THREE.Vector3(c.exhaust.x - 0.2, 0.15, rnd(-0.7, 0.7))), vel);
}

// RB22 cars (separate wheels and sprung body), from the car's motion: turn (rad) over moved (m) since the last frame.
// Wheels roll by distance / radius and the fronts steer to the path's curvature (the player's car: its real road-wheel
// angle); the body rolls with lateral g, pitches with longitudinal g (dive under braking, squat on throttle) and
// settles as downforce (~v^2) compresses the springs; the DRS flap opens with the simulation's DRS.
function chassis(c, turn, moved, f) {
  if (moved > 50) return;  // scrubbing jump
  const [r] = c.tyre, k = moved > 0.05 ? turn / moved : 0;  // path curvature 1/m, + = left
  for (const w of c.wheels) w.spin.rotation.z -= moved / r;
  const delta = f?.cam ? -f.cam.steer : THREE.MathUtils.clamp(Math.atan(c.wb * k), -0.38, 0.38);  // road-wheel angle, + = left
  c.delta = (c.delta ?? 0) + (delta - (c.delta ?? 0)) * 0.25;
  for (const w of c.wheels) if (w.front) w.pivot.rotation.y = c.delta;
  c.steeringWheel.rotation.x = -c.delta * STEERING_RATIO;
  const gLat = THREE.MathUtils.clamp(c.v * c.v * k / 9.81, -6, 6);
  c.gLat = (c.gLat ?? 0) + (gLat - (c.gLat ?? 0)) * 0.1;
  c.body.rotation.x = 0.004 * c.gLat;                                    // ~0.25 deg/g, outside of the corner down
  c.body.rotation.z = 0.003 * THREE.MathUtils.clamp(c.acc / 9.81, -6, 3);  // nose down under braking
  c.body.position.y = -0.02 * Math.min(1, (c.v / 90) ** 2);              // ~20 mm of aero compression at 320 km/h
}

// The focused car's rear-view mirrors reflect the scene in the cockpit view (its own rear wheels left out); built the
// first time they're needed, and back to the model's glass otherwise, so only one car pays for the extra renders.
function mirrors(c, on) {
  if (!c.mirrors) return;
  if (on && !c.mirrored) {
    c.mirrored = true;
    for (const glass of c.mirrors) makeMirror(glass, {hide: c.wheels.filter(w => !w.front).map(w => w.pivot)});
  }
  if (c.mirrored) for (const glass of c.mirrors) glass.userData.mirror(on);
}

// pos/ahead: {id: [x, y]} map coords now and 0.5 s later (gives the heading). rate: replay seconds per real second (0 when
// paused); progress: 0..1 through the session; fx: {id: {sparks, smoke, light}} from the simulation (light: the rear light
// flashes while harvesting or derating). Returns the focused car's steering angle in degrees (+ = left) from heading change.
export function updateCars(pos, ahead, focus, rate = 1, progress = 1, fx = null) {
  if (!map) return 0;
  const now = performance.now(), dt = Math.min((now - lastUpdate) / 1000, 0.25);
  lastUpdate = now;
  simRate = rate;
  trackMat.userData.rubber.value = 0.3 + 0.7 * progress;  // rubber builds up over the session
  const scale = 1 / map.mps;  // cars are modelled in metres, drawn true to scale
  let steer = 0;
  for (const [id, c] of Object.entries(cars)) {
    const p = pos[id];
    c.group.visible = !!p;
    if (!p) { c.last = null; continue; }
    const road = circuit.surface(p, c.hint), at = new THREE.Vector3((p[0] - map.cx) * map.k, road.y + 0.02, (p[1] - map.cy) * map.k);
    c.hint = road.i;
    const next = ahead[id] && toScene(ahead[id], 0.02, c.hint);
    let turn = 0;
    const moved = c.last ? at.distanceTo(c.last) * map.mps : 0;  // metres since the last frame
    if (next && at.distanceTo(next) > 0.01) {
      const yaw = Math.atan2(-(next.z - at.z), next.x - at.x);
      turn = Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw));  // shortest way round
      c.yaw = yaw;
      c.pitch = Math.atan2(next.y - at.y, Math.hypot(next.x - at.x, next.z - at.z));  // nose up climbing
    }
    if (id === focus) {
      if (moved > 0.05 && moved < 200) {  // ignore pauses and scrubbing jumps
        const curvature = turn / moved;     // 1/m; ~7:1 steering ratio
        const target = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.atan(c.wb * curvature)) * 7, -120, 120);
        c.steer += (target - c.steer) * 0.25;
      }
      steer = fx?.[id]?.cam ? -fx[id].cam.steer * 573 : c.steer;  // the player's real wheel: road-wheel angle x 10, deg
    }
    c.last = at;
    c.group.position.copy(at);
    // yaw, then pitch about the car's lateral axis, then roll about its own length: the road's banking (+ = right lower)
    c.group.rotation.set(road.roll, c.yaw, c.pitch ?? 0, 'YZX');
    c.group.scale.setScalar(scale);
    const away = camera.position.distanceTo(at);
    c.haze.visible = away < m(60);  // transmission re-renders the scene: only when it shows
    c.tag.element.classList.toggle('far', away > m(150));  // just the number: a full tag dwarfs a car this far off
    if (next && rate > 0 && dt > 0) effects(c, at, next, dt * rate, dt, fx?.[id]);
    // standing still off the track (in the pit lane): its crew comes out from the garage side, further from the track
    // than the car (car frame: +z is its right; lat > 0 is left of the centre line)
    if (rate > 0 && dt > 0) crews.track(id, c, c.v < 1.5 && Math.abs(road.lat) > circuit.half + m(3), road.lat > 0 ? -1 : 1, c.color, dt * rate);
    if (c.wheels) chassis(c, turn, moved, fx?.[id]);
    // 4 Hz flash while harvesting (or derating), and in the rain, as the FIA rain light
    c.light.emissiveIntensity = (fx?.[id]?.light || vfx.rain > 0.1) && now % 250 < 125 ? 0.15 : 2;
    const own = id === focus && mode === 'onboard';
    mirrors(c, own);
    c.body.visible = !own || parts.body;
    c.halo.visible = !own || parts.halo;
    c.tag.visible = !own;
    c.tag.element.classList.toggle('sel', id === focus);
    c.tag.element.classList.toggle('dim', !!focus && id !== focus);
    if (id !== focus) continue;
    const len = c.len * scale;
    if (mode === 'onboard' || mode === 'tcam') {  // mounted on the car
      if (chased !== id) { chased = id; post.reset(); }  // cut to another car
      c.group.updateMatrixWorld();
      camera.position.copy(c.group.localToWorld((mode === 'tcam' ? c.tcam : c.eye).clone()));
      controls.target.copy(c.group.localToWorld((mode === 'tcam' ? c.tcamLook : c.look).clone()));
      camera.lookAt(controls.target);
      const g = fx?.[id]?.cam, cf = c.camFx ??= {p: 0, r: 0, y: 0};
      if (g) {  // driving: the head pitches forward under braking (~0.7 deg/g), rolls into the corner, looks to the apex
        cf.p += (THREE.MathUtils.clamp(g.gLong * 0.012, -0.07, 0.03) - cf.p) * 0.15;
        cf.r += (THREE.MathUtils.clamp(-g.gLat * 0.01, -0.06, 0.06) - cf.r) * 0.15;
        cf.y += (THREE.MathUtils.clamp(-g.steer * 0.8, -0.2, 0.2) - cf.y) * 0.1;
        const buzz = g.v > 83 ? 0.0015 * (g.v - 83) / 10 : 0;  // aero buffeting above 300 km/h
        camera.rotateY(cf.y);
        camera.rotateX(cf.p + (Math.random() - 0.5) * buzz);
        camera.rotateZ(cf.r + (Math.random() - 0.5) * buzz);
      }
    } else if (mode === 'heli') {
      // 70 m back, 35 m out, 55 m up, eased in with a 0.7 s lag like a pilot tracking the car; the aim lags only 0.2 s
      const want = new THREE.Vector3(at.x - Math.cos(c.yaw) * m(70) + Math.sin(c.yaw) * m(35), at.y + m(55),
                                     at.z + Math.sin(c.yaw) * m(70) + Math.cos(c.yaw) * m(35));
      if (chased !== id) { chased = id; post.reset(); camera.position.copy(want); controls.target.copy(at); }
      camera.position.lerp(want, 1 - Math.exp(-dt / 0.7));
      controls.target.lerp(at, 1 - Math.exp(-dt / 0.2));
      camera.lookAt(controls.target);
    } else if (mode === 'chase' && chased === null) {  // drop in behind the car
      chased = id;
      post.reset();
      controls.target.copy(at);
      camera.position.set(at.x - Math.cos(c.yaw) * 5 * len, at.y + 2.4 * len, at.z + Math.sin(c.yaw) * 5 * len);
    } else if (mode === 'chase') {  // follow, turning with the car; the user can still orbit
      if (chased !== id) { chased = id; glide = 0; }  // another car picked: pan across to it instead of cutting
      glide = Math.min(1, glide + dt / 0.9);
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(UP, turn);
      controls.target.lerp(at, glide < 1 ? THREE.MathUtils.smootherstep(glide, 0, 1) : 1);
      camera.position.copy(controls.target).add(offset);
    }
  }
  return steer;
}
