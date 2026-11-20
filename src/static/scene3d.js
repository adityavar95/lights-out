// 3D circuit and cars (three.js). Takes the replay's 2D map coordinates (x right, y down) as the ground plane.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CSS2DRenderer, CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {SkyMesh} from 'three/addons/objects/SkyMesh.js';
import {CSMShadowNode} from 'three/addons/csm/CSMShadowNode.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {float, reference, renderGroup, texture, vec2, vec4, mrt} from 'three/tsl';
import {buildCar, SHADOW_LAYER} from './cars3d.js';
import {brakeStep, brakeGlow} from './telemetry.js';
import {loadRB22, rb22Ready, STEERING_RATIO} from './rb22.js';
import {makeMirror, renderMirrors, warmFor, warmMirrors} from './mirror.js';
import {createPost} from './post.js';
import {loadGraphics, saveGraphics, nextPreset, presetOf, deviceTier, defaultsFor} from './graphics.js';
import {createVfx, haze} from './vfx.js';
import {textures} from './textures3d.js';
import {buildCircuit} from './circuit3d.js';
import {createCrews} from './pit3d.js';
import {covered} from './util.js';
import {setupLoadStage, stage, stageDone, progressOf, announce} from './loadstage.js';
import {sunElevation, skyFor} from './weather.js';

const SIZE = 1000;                  // the circuit is scaled to this many scene units across
const UP = new THREE.Vector3(0, 1, 0);
const SUN = new THREE.Vector3(0.45, 0.62, 0.3).normalize();  // direction towards the sun; re-aimed at the HDRI's sun
// photographed HDR sky (CC0, Poly Haven): 4k once downloaded (assets.py), until then the 1k streams (1.4 MB, not 21); a phone streams 1k first
const hdri = name => `/static/assets/hdri/${name}_4k.hdr`;
const streamed = url => `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${url.split('/').pop().replace('_4k', '_1k')}`;
// L cycles them. sun: direct light, env: image-based light, hemi: fill; lamps: the floodlights' glow
const SKIES = [
  {name: 'Midday', url: hdri('kloofendal_48d_partly_cloudy_puresky'), sun: 3.2, color: 0xfff8ed, env: 0.7, hemi: 0.15, lamps: 0},
  {name: 'Golden hour', url: hdri('belfast_sunset_puresky'), sun: 2.6, color: 0xffc896, env: 0.8, hemi: 0.1, lamps: 0.5},
  {name: 'Overcast', url: hdri('kloofendal_overcast_puresky'), sun: 0.7, color: 0xe9eef5, env: 1, hemi: 0.2, lamps: 0},
  {name: 'Night', url: hdri('rogland_clear_night'), sun: 0.4, color: 0xbcd0ff, env: 1.8, hemi: 0.12, lamps: 8},
];

// One renderer for the race and the showroom, each with its own CanvasTarget: two WebGPU devices couldn't share pipelines,
// textures or the PMREM environment, and every shader the showroom needs would compile twice.
let container, renderer, mainSurface, pmrem, labels, scene, camera, controls, world, sun, csm, post, vfx, hemi, deck = null, cars = {}, map = null, tex = null;
let cloudShadow = null, carsToken = 0, mode = 'overview', chased = null, glide = 1, trackMat = null, simRate = 0, lastUpdate = 0, wettable = [], circuit = null, fly = null;
// the circuit before this one, disposed after the new one has drawn: its materials hold the compiled shaders the new
// one reuses (disposing first deleted them, and every race switch recompiled them all: ~0.3 s)
let stale = null;
let drawnAt = 0, resized = true, stageW = 0, stageH = 0;  // the stage's CSS size, kept by fit()
let gfx = loadGraphics(undefined, defaultsFor(deviceTier())), framesShown = 0, lastFrameAt = 0;
export let tier = deviceTier();  // graphics.js deviceTier; init3d adds the GPU's name
let shadowFrame = 0, high = false, autoScale = 1, frameTime = 0, calm = 0, calmNeed = 120, upAt = 0;  // GPU quality tier (init3d) and dynamic resolution (the render loop)

// Canvas pixels per CSS pixel: the high tier renders up to 2x (supersampling on a 1-1.25x display), within a 4K frame's
// pixel budget, so a big window on a 4K monitor isn't rendered at 8K
const MIN_AUTO = 0.75;  // Auto never goes under 75 % of the display's own pixels: below that the picture is soft, and a slow CPU isn't helped
const budgetOf = (w, h) => Math.max(Math.min(devicePixelRatio, 2), Math.min(2, Math.sqrt(3840 * 2160 / (w * h))));
// Auto: autoScale is a factor on the display's own pixels, from 1x (where it starts) up to the budget
function pixelRatio(w = innerWidth, h = innerHeight) {
  const dpr = Math.min(devicePixelRatio, 2), budget = budgetOf(w, h);
  if (gfx.res !== 'auto') return gfx.res > 1 ? Math.min(dpr * gfx.res, budget) : dpr * gfx.res;
  return high ? THREE.MathUtils.clamp(dpr * autoScale, dpr * MIN_AUTO, budget) : dpr;
}
const drawnView = new THREE.Matrix4(), drawnProj = new THREE.Matrix4();
// CSS2DRenderer hides what's behind the camera by NDC z in [-1, 1]; with reversed depth (and WebGPU's [0, 1]) a point
// behind it lands near z = 0 and passed, so cars behind the camera drew their tags mirrored across the screen
const labelCam = new THREE.PerspectiveCamera();
const sky0 = {sun: 3.2, env: 0.35, hemi: 0.5, lamps: 0, fog: new THREE.Color(0xc4d3e2)};
let skyAt = 0, autoSky = 0, skyToken = 0, weather = null, skyTargets = [];  // clear-sky lighting, for the weather to dim
// Settings' Auto follows the session's sun (setDaylight), and takes the Overcast sky over a wet or rainy daytime track
const skyIndex = () => gfx.sky !== 'auto' ? gfx.sky : weather?.cloud > 0.5 && autoSky !== 3 ? 2 : autoSky;
const RAIN_GREY = new THREE.Color(0.3, 0.32, 0.35);
const RIGGED = new Set(['onboard', 'tcam', 'heli', 'follow']);  // camera placed by code each frame, so no orbit controls
// depth of field: lens f-number per camera, focused on the camera's target (the car, or 15 m ahead of it on board); the
// overview and the helicopter have none
const APERTURE = {chase: 2, tcam: 2.8, onboard: 2.8};
// the wheel on a camera that follows a car: a factor on its range (chase, TV chase) or its lens (cockpit, T-cam, helicopter), eased
const ZOOM = {follow: [0.6, 4], chase: [0.25, 4], onboard: [0.5, 1.2], tcam: [0.5, 1.2], heli: [0.35, 1.6]};
let zoomAim = 1, zoomNow = 1, lastCars = null;
const parts = {halo: true, body: true, wheel: true};
let mirrorsWarm = false;
const crews = createCrews();  // pit crews, for cars that stop in the pit lane

const rnd = (a, b) => a + Math.random() * (b - a);

// The GPU's name, for the tier. WebGPU only offers that asynchronously and vaguely, and init3d has to answer now
// (replay.js shows its "no 3D" message from a throw), so a throwaway WebGL2 context asks, then gives its slot back.
function probeGpu() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl && !navigator.gpu) throw new Error('neither WebGPU nor WebGL2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info'), gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return gpu;
}

// Resolves when the GPU device exists; the showroom and anything else needing the renderer waits on it
export let ready = null;
export const shared = () => ({renderer, pmrem, scene});
// the showroom's frame: called from the master loop while open; null closes it
export const setDeck = d => { deck = d; };
// three's compileAsync puts back the target it was called with after every item it builds, so a warm-up (warmCockpit) leaves its
// target and MRT on the renderer between frames: anything drawn outside the warm-up clears them first
const clearWarmTarget = () => { renderer.setRenderTarget(null); renderer.setMRT(null); };

// three's PCF turns 5 taps by per-pixel noise, which shows as grain on a sun shadow; a fixed 3x3 tent of hardware-filtered taps doesn't
const softShadow = ({depthTexture, shadowCoord, shadow}) => {
  const size = reference('mapSize', 'vec2', shadow).setGroup(renderGroup);
  let lit = float(0);
  for (const y of [-1, 0, 1]) for (const x of [-1, 0, 1]) {
    const at = shadowCoord.xy.add(vec2(x, y).div(size));
    lit = lit.add(texture(depthTexture, at).compare(shadowCoord.z).mul((2 - Math.abs(x)) * (2 - Math.abs(y)) / 16));
  }
  return lit;
};

export function init3d(el) {
  container = el;
  // software rendering or a phone can't carry supersampling, 4k photos or the sharper satellite ground
  tier = deviceTier(probeGpu());
  high = tier === 'desktop';
  // Reversed depth instead of the old logarithmic buffer: same range from a car's wing to the far hills, without writing
  // frag depth from every fragment, which disabled early-z across the whole scene.
  renderer = new THREE.WebGPURenderer({antialias: true, powerPreference: 'high-performance', forceWebGL: false, reversedDepthBuffer: true, trackTimestamp: true});
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  mainSurface = new THREE.CanvasTarget(canvas);
  mainSurface.setPixelRatio(pixelRatio());
  renderer.setCanvasTarget(mainSurface);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = gfx.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  labels = new CSS2DRenderer();
  labels.domElement.className = 'labels3d';
  container.append(canvas, labels.domElement);
  setupLoadStage(container);
  // a lost device takes every resource with it, so start afresh; not under the F1 TV viewer, whose video would stop: the loop waits for it to close
  renderer.onDeviceLost = info => { if (info?.reason === 'destroyed') return; console.warn('3D: GPU device lost', info?.message); contextRestored = true; };  // 'destroyed': just this page unloading
  scene = new THREE.Scene();
  // every render() and the label pass would walk all ~2,000 objects again: the loop updates the matrices once per frame
  scene.matrixWorldAutoUpdate = false;
  tex = textures();
  scene.fog = new THREE.Fog(0xc4d3e2, SIZE * 1.3, SIZE * 4);
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 30000);
  camera.layers.enable(1);  // layer 1: effects and contact shadows (drawn, but left out of the motion-vector pass)
  camera.layers.enable(2);  // layer 2: what only this camera's pass can draw (vfx.js sparks)
  controls = new OrbitControls(camera, labels.domElement);  // the label layer sits on top, so it gets the mouse
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;  // stay above the ground
  controls.maxDistance = SIZE * 1.6;        // the whole circuit, well inside the fog; minDistance is set per circuit
  controls.zoomToCursor = true;             // the scroll wheel zooms towards what's under the pointer
  controls.screenSpacePanning = false;      // right-drag pans over the ground, not up into the sky
  // Capture, ahead of OrbitControls: Free Orbit keeps its zoom to the cursor, which would pull a followed car off centre.
  // Without this the rigged cameras ignored the wheel and it scrolled the page behind the stage.
  labels.domElement.addEventListener('wheel', e => {
    const r = ZOOM[mode];
    if (!r) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    zoomAim = THREE.MathUtils.clamp(zoomAim * Math.exp(e.deltaY * (e.deltaMode ? 33 : 1) * 0.0012), r[0], r[1]);
  }, {capture: true, passive: false});
  hemi = new THREE.HemisphereLight(0xdbe9ff, 0x5d7a45, 0.5);
  scene.add(hemi);
  // Cascaded shadow maps: 4 slices of the view frustum (practical split: between uniform and logarithmic), each with its
  // own sun shadow map, so texels grow with distance like screen pixels do; fade cross-fades the seams. CSMShadowNode lives
  // on the light rather than patching every material, which is what the old csmSync walked the scene for.
  sun = new THREE.DirectionalLight(SKIES[0].color, sky0.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(gfx.shadows || 1024);
  sun.shadow.intensity = gfx.shadows ? 1 : 0;
  // Bias is a fraction of the shadow camera's depth range: over 2000 units this is 0.04 of one (CSMShadowNode scales it per
  // cascade). A car stands about 0.5 units tall here, so at the 0.00015 this started from no car cast a shadow at all.
  sun.shadow.bias = -0.00002;
  sun.shadow.normalBias = 0.02;
  // CSMShadowNode clones this per cascade, and a clone doesn't carry filterNode
  sun.shadow.clone = function () { return Object.assign(Object.getPrototypeOf(this).clone.call(this), {filterNode: softShadow}); };
  Object.assign(sun.shadow.camera, {near: 1, far: SIZE * 2});
  sun.shadow.camera.layers.enable(1);  // layer 1 also holds the alpha cut-out tree crowns and fences (circuit3d.js), which do cast shadows
  sun.shadow.camera.layers.enable(SHADOW_LAYER);  // the cars' merged shadow casters, which no other camera draws
  aimSun();
  scene.add(sun, sun.target);
  csm = new CSMShadowNode(sun, {cascades: 4, maxFar: 2200 * gfx.shadowRange, mode: 'practical', lightMargin: 180});
  csm.fade = true;
  sun.shadow.shadowNode = csm;
  world = new THREE.Group();
  scene.add(world);
  post = createPost(renderer, scene, camera, gfx);
  vfx = createVfx(scene);
  const fit = () => {
    const w = stageW = container.clientWidth, h = stageH = container.clientHeight;
    if (!w || !h) return;  // hidden: zero-size render targets would only warn
    const pr = pixelRatio(w, h);  // it changes with browser zoom or another monitor
    mainSurface.setPixelRatio(pr);
    mainSurface.setSize(w, h, false);
    labels.setSize(w, h);
    post.setSize(w, h, pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (csm.camera) csm.updateFrustums();  // null until the first frame builds it
    resized = true;  // setSize cleared the canvas
  };
  new ResizeObserver(fit).observe(container);
  // a monitor with another DPR changes no CSS size, so the observer misses it
  const watchDpr = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { fit(); watchDpr(); }, {once: true});
  watchDpr();
  refit = fit;
  const timer = new THREE.Timer();
  timer.connect(document);  // no huge first delta after the tab was hidden
  const frame = time => {
    if (gfx.fps && time - lastFrameAt < 1000 / gfx.fps - 2) return;  // 2 ms: a 60 limit on a 60 Hz display mustn't skip every other frame
    lastFrameAt = time;
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.1);
    clearWarmTarget();
    if (deck) {  // the showroom draws whatever the race view is doing: its own panel may be covering that
      renderer.setCanvasTarget(deck.surface);
      deck.draw(dt);
      renderer.setCanvasTarget(mainSurface);  // left on the main canvas between frames, so it hears window resizes
    }
    if (contextRestored && !covered()) { contextRestored = false; restartOrGiveUp(); }
    // tab hidden, no size yet, or under the F1 TV viewer (it drew ~1,800 calls a frame there, beside 4K video decoding)
    // (the size is the ResizeObserver's, 0 while hidden: reading the layout here, after the replay has written to the page, forced a second layout every frame)
    if (!stageW || !stageH || covered()) return;
    if (circuit) loadPhotos();  // the stage is seen: not while the globe covers it (the race under it, ~150 MB of photos)
    // Dynamic resolution holds 60 fps: Auto starts at 1x (starting supersampled, 2x on a laptop's 2560x1440 panel is a 4K frame
    // with 4x MSAA, 39 fps on an RTX 4080, and a window behind another app never measured its way down), steps up to the
    // budget while the GPU's passes take under 4 ms, and down while they take over 8 ms a frame, by as much as the overshoot asks
    // for (their time goes with the pixel count), and back up once they take under 4. (At 9 ms, 2-4 % of frames missed
    // 16.7 ms; at 4 ms, 0.3 %: the browser's own compositing comes on top.) Without timestamp queries it goes by the
    // frame rate: down under ~55 fps unless the main thread itself fills the frame (fewer pixels don't help that), up only
    // with half the frame to spare, which a 60 Hz display never shows. Measured only while the cars move and frames are
    // drawn back to back; hitches (a circuit loading, shaders compiling) don't count, or loading the page alone tripped it.
    if (high && (gpuMs || !gfx.fps) && gfx.res === 'auto' && performance.now() - lastUpdate < 200 && performance.now() - drawnAt < 40 && dt < 0.1) {
      frameTime += (dt - frameTime) * 0.02;  // ~50-frame average
      const pr = mainSurface.getPixelRatio(), dpr = Math.min(devicePixelRatio, 2), floor = dpr * MIN_AUTO;
      const busy = Object.values(stats).reduce((a, b) => a + b, 0) / 1000;  // the main thread's share of the frame, s
      const over = gpuMs ? gpuMs > 8 : frameTime > 1 / 55 && busy < 0.8 * frameTime, under = gpuMs ? gpuMs < 4 : frameTime > 0 && frameTime < 1 / 90;
      calm = under ? calm + 1 : 0;
      const k = over && pr > floor ? THREE.MathUtils.clamp(Math.sqrt(gpuMs ? 6 / gpuMs : 1 / 60 / frameTime), 0.7, 0.95) : pr < budgetOf(stageW, stageH) - 0.01 && calm > (gpuMs && gpuMs < 2 ? 30 : calmNeed) ? 1.15 : 1;
      if (k !== 1) {
        autoScale = pr / dpr * k;  // from what's drawn: a resize may have clamped it
        fit();
        const now = mainSurface.getPixelRatio();
        gpuMs *= (now / pr) ** 2;  // what the new size should cost, until the average catches up
        frameTime = k < 1 ? 0 : 1 / 60;  // the average climbs again from nothing: ~1 s before the next step down
        calm = 0;
        // a step up undone within 3 s doubles the wait before trying up again (it see-sawed every few seconds); one that held resets it
        if (k < 1) calmNeed = performance.now() - upAt < 3000 ? Math.min(calmNeed * 2, 7200) : 120;
        else upAt = performance.now();
        console.info(`3D: resolution ${pr.toFixed(2)}x -> ${now.toFixed(2)}x`);
      }
    }
    if (lastCars && zoomNow !== zoomAim && performance.now() - lastUpdate > 100) updateCars(...lastCars);  // paused: nothing else moves the camera
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
    else frameMs += (now - drawnAt - frameMs) * 0.05;  // drawn back to back: the frame-to-frame time, for frameStats' rest
    drawnAt = now;
    resized = false;
    drawnView.copy(camera.matrixWorld);
    drawnProj.copy(camera.projectionMatrix);
    // normal bias ~1 texel per cascade: a fixed one left acne on the far cascades, whose texels are metres wide
    for (const l of csm.lights) l.shadow.normalBias = Math.max(0.02, (l.shadow.camera.right - l.shadow.camera.left) / l.shadow.mapSize.x);
    let t0 = performance.now();
    vfx.update(dt, camera, SUN, stageH);
    for (const c of Object.values(cars)) for (const l of c.lods) l.update(camera);
    if (ghost) for (const l of ghost.lods) l.update(camera);
    scene.updateMatrixWorld();
    timed('scene', t0);
    t0 = performance.now();
    if (gfx.mirrors) renderMirrors(renderer, scene, camera, on => { for (const l of csm.lights) l.shadow.autoUpdate = on; });
    // Each cascade redraws the scene on the main thread. The far two hold what moves least on screen: every 2nd and 4th frame, on different frames
    shadowFrame++;
    csm.lights.forEach((l, i) => {
      l.shadow.autoUpdate = false;
      l.shadow.needsUpdate = gfx.shadows > 0 && (i < 2 || gfx.farEvery || (i === 2 ? shadowFrame % 2 === 0 : shadowFrame % 4 === 1));
    });
    const moving = performance.now() - lastUpdate < 200;  // the replay is still moving the cars
    post.focus(chased === null ? 0 : camera.position.distanceTo(controls.target), APERTURE[mode]);
    framesShown++;
    post.render(dt, 1 / Math.max(1, moving ? simRate : 1));  // a 10x replay blurs like real time, not 10x as long
    timed('draw', t0);
    // the GPU's own time for the frame's passes (timestamp queries; undefined where the browser has none)
    renderer.resolveTimestampsAsync().then(ms => { if (ms > 0) gpuMs += (ms - gpuMs) * 0.05; }, () => {});
    stale?.dispose();
    stale = null;
    t0 = performance.now();
    labelCam.copy(camera, false);
    labelCam.coordinateSystem = THREE.WebGLCoordinateSystem;
    labelCam.updateProjectionMatrix();
    labels.render(scene, labelCam);
    timed('tags', t0);
  };
  ready = renderer.init().then(() => {
    // the environment and background need a live device; PMREM is shared with the showroom
    pmrem = new THREE.PMREMGenerator(renderer);
    const sky = new SkyMesh(), envScene = new THREE.Scene();
    sky.turbidity.value = 2.5;
    sky.rayleigh.value = 1.2;
    sky.mieCoefficient.value = 0.004;
    sky.mieDirectionalG.value = 0.82;
    sky.sunPosition.value.copy(SUN);
    sky.scale.setScalar(50);
    envScene.add(sky);
    clearWarmTarget();
    skyTargets = [pmrem.fromScene(envScene)];
    scene.environment = skyTargets[0].texture;  // the same sky in paint reflections
    scene.environmentIntensity = 0.35;  // the raw sky is HDR-bright and washes colours out
    sky.geometry.dispose();
    sky.material.dispose();
    // until the photographed sky lands, the fog's colour: drawn, the raw Preetham sky is so bright that its bloom whited out the whole view
    scene.background = scene.fog.color.clone();
    skyAt = skyIndex();
    loadSky(SKIES[skyAt]);
    renderer.setAnimationLoop(frame);
  }).catch(e => {
    console.error('3D: no GPU device', e);
    container.append(Object.assign(document.createElement('p'), {className: 'empty', textContent: '3D view needs WebGPU or WebGL2, which is turned off in this browser.'}));
  });
}

// Cycles the graphics tier (G key); returns its name. The graph rebuilds, so a stall of a frame or two is expected.
export function nextTier() {
  setGraphics(nextPreset(gfx));
  return presetOf(gfx);
}

export const graphics = () => gfx;
export const framesDrawn = () => framesShown;

// Where a frame's main-thread time goes, ms, smoothed over ~20 frames: the frame-rate counter shows it (settings.js)
const stats = {};
let gpuMs = 0, frameMs = 0;
export const timed = (k, t0) => { const d = performance.now() - t0; stats[k] = (stats[k] ?? d) + (d - (stats[k] ?? d)) * 0.05; };
// rest: frame-to-frame time not in the timed parts (the page's layout, style and paint, waiting on the GPU or vsync)
export const frameStats = () => ({...stats, ...(gpuMs && {gpu: gpuMs}), ...(frameMs && {rest: Math.max(0, frameMs - Object.values(stats).reduce((a, b) => a + b, 0))})});

// Applies graphics.js's settings, stores them and tells the panel (settings.js)
export function setGraphics(patch) {
  const was = gfx;
  gfx = {...gfx, ...patch};
  saveGraphics(gfx);
  dispatchEvent(new Event('f1:graphics'));
  if (!post) return;  // init3d reads them
  if (gfx.msaa !== was.msaa) {  // the pass's targets and every pipeline have the sample count built in
    post.dispose();
    post = createPost(renderer, scene, camera, gfx);
    if (map) post.setMps(map.mps);
    refit?.();
  }
  post.setOptions(gfx);
  renderer.toneMappingExposure = gfx.exposure;
  if (gfx.res !== was.res) {
    autoScale = 1;
    calmNeed = 120;
    frameTime = 0;
    refit?.();
  }
  if (gfx.shadows !== was.shadows) {
    for (const s of [sun.shadow, ...csm.lights.map(l => l.shadow)]) {
      s.mapSize.setScalar(gfx.shadows || 1024);
      s.intensity = gfx.shadows ? 1 : 0;
    }
  }
  if (gfx.shadowRange !== was.shadowRange) onCameraModeChanged(mode);
  if (gfx.sky !== was.sky && skyIndex() !== skyAt) loadSky(SKIES[skyAt = skyIndex()]);
  applyDetail();
  drawnView.identity();  // a still frame redraws at once, not at its next quarter second
}

// what lives on a circuit or a car, so setTrack and setCars call it too
function applyDetail() {
  circuit?.show(gfx);
  for (const c of Object.values(cars)) c.group.traverse(o => {
    if (o.isLOD) for (const l of o.levels) l.distance = (l.fullDistance ??= l.distance) * gfx.carDetail;
  });
}

// The direction the shadows and the sky agree on: a directional light points from its position to its target
function aimSun() {
  sun.position.copy(SUN).multiplyScalar(SIZE * 3);
  sun.target.position.set(0, 0, 0);
}

// Tight cascades on a camera in the traffic (sharp shadows on the car in front), wide ones for a whole-circuit view
function onCameraModeChanged(m) {
  csm.maxFar = (['onboard', 'tcam', 'chase', 'follow'].includes(m) ? 550 : 2200) * gfx.shadowRange;
  if (csm.camera) csm.updateFrustums();
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

// L: the next time of day. The old sky stays up until the new one has loaded.
export function nextSky() {
  setGraphics({sky: (skyAt + 1) % SKIES.length});
  return SKIES[skyAt].name;
}

// The session's own light: the sun's height over the circuit (lat, lon) at its start, when Settings' sky is Auto.
// Singapore and Las Vegas race at night, Abu Dhabi into dusk. No time known: midday.
export function setDaylight(lat, lon, at) {
  autoSky = isFinite(lat) && isFinite(lon) && at && !isNaN(+at) ? skyFor(sunElevation(lat, lon, at)) : 0;
  if (scene && skyIndex() !== skyAt) loadSky(SKIES[skyAt = skyIndex()]);
}


// The HDR panorama becomes the background and, PMREM-prefiltered (a mip per roughness level), the image-based light for
// diffuse ambient and reflections. The sun light is aimed at its brightest texel so shadows agree with the sky: texel
// (x, y) with row 0 at the top is longitude 2 pi (u - 0.5), latitude pi (0.5 - v), as three samples equirect maps.
function loadSky(preset) {
  const token = ++skyToken;
  stage('sky', `Sky: ${preset.name}`);
  const load = (url, next) => new HDRLoader().load(url, hdr => {
    if (token !== skyToken) { hdr.dispose(); return; }  // pressed L again meanwhile
    const {data, width: w, height: h} = hdr.image, half = THREE.DataUtils.fromHalfFloat;
    let best = 0, at = 0;
    for (let i = 0; i < w * h / 2; i += 2) {  // upper half: the sun is above the horizon
      const l = half(data[i * 4]) + half(data[i * 4 + 1]) + half(data[i * 4 + 2]);
      if (l > best) { best = l; at = i; }
    }
    const phi = ((at % w + 0.5) / w - 0.5) * 2 * Math.PI;
    const lat = Math.max((0.5 - (Math.floor(at / w) + 0.5) / h) * Math.PI, 0.25);  // >= 14 degrees: no endless shadows
    SUN.set(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
    aimSun();
    // fog fades to the horizon's mean radiance (linear HDR; fog is mixed before tone mapping) so the ground meets the sky
    const fog = [0, 0, 0], row = Math.floor(h * 0.49) * w;
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) fog[c] += half(data[(row + x) * 4 + c]) / w;
    scene.fog.color.setRGB(...fog);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    // the render targets, not their textures: three frees a target's texture only with the target (texture.dispose() is a
    // no-op on one), so each change of sky left ~70 MB of cube map and its PMREM on the GPU
    const old = skyTargets;
    clearWarmTarget();
    skyTargets = [pmrem.fromEquirectangular(hdr), new THREE.CubeRenderTarget(h / 2).fromEquirectangularTexture(renderer, hdr)];
    scene.environment = skyTargets[0].texture;
    scene.environmentIntensity = sky0.env = preset.env;
    sky0.fog.copy(scene.fog.color);
    // the background as a GPU cube map (the size three picks itself), so the panorama's pixels (64 MB at 4k) can go:
    // kept as scene.background they stayed in the JS heap for the page's life
    scene.background = skyTargets[1].texture;
    hdr.dispose();
    for (const t of old) t.dispose();
    hemi.intensity = sky0.hemi = preset.hemi;  // the HDRI now supplies the ambient light
    sky0.sun = preset.sun;
    sky0.lamps = preset.lamps;
    sky0.name = preset.name;
    sun.color.set(preset.color);
    circuit?.night(sky0.lamps);
    if (weather) setWeather(weather);
    else sun.intensity = sky0.sun;
    resized = true;  // a still frame should show it now
    stageDone('sky');
  }, e => stage('sky', `Sky: ${preset.name}`, progressOf(e)), e => {
    if (next) return load(next);
    console.warn('3D: the sky could not be loaded', e);
    stageDone('sky', 'offline: keeping this sky');
  });
  if (tier === 'mobile') load(streamed(preset.url), preset.url);
  else load(preset.url, streamed(preset.url));
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
// cancelGround: stops the ground worker still fetching, and closes its loading row and setGround's wait, which only its own answer did
let contextRestored = false, cancelGround = null, refit = null;
// a device lost again on every start would reload for ever: after two reloads inside a minute, stop and say so
function restartOrGiveUp() {
  let times = [];
  try { times = JSON.parse(sessionStorage.getItem('gpuReloads') || '[]').filter(t => Date.now() - t < 60e3); } catch {}  // blocked storage: reload as before
  if (times.length < 2) {
    try { sessionStorage.setItem('gpuReloads', JSON.stringify([...times, Date.now()])); } catch {}
    location.reload();
    return;
  }
  renderer.setAnimationLoop(null);
  container.append(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'The graphics device keeps failing. Reload the page to try again.'}));
}
export function setTrack(pts, span, corners, startKnown, mpu, width = 13, ann = null) {
  vfx.clearSkids();
  cancelGround?.();  // its imagery is for the circuit going away (up to 256 MB)
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
  cloudShadow = circuit.cloud;
  if (weather) cloudShadow.value = 0.6 * Math.max(0, weather.cloud - 0.1) / 0.9 + 0.2;
  circuit.night(sky0.lamps);
  applyDetail();
  wettable = circuit.wettable;  // scenery that turns darker and glossier in the rain
  if (weather) circuit.wetDark.value = 1 - 0.25 * (weather.wetLine + weather.wetOff) / 2;
  vfx.mps = map.mps;
  post.setMps(map.mps);
  controls.minDistance = m(4);  // close enough to read a car's livery, never inside it
  const from = camera.position.clone(), target = controls.target.clone();
  resetView();
  if (mode === 'overview') fly = {from, target, to: camera.position.clone(), aim: controls.target.clone(), t: 0};
}

export function resetView() {
  chased = null;
  controls.target.set(0, 0, 0);
  const fit = THREE.MathUtils.clamp(1.25 / camera.aspect, 1, 1.5);  // portrait stage: the circuit is limited by the width
  camera.position.set(0, SIZE * 0.72 * fit, SIZE * 0.78 * fit);
  post.reset();
}

// ---------- cars ----------

// A hidden LOD level needs no matrices: the RB22 level is 79 of a car's 116 objects, and walking all 22 cars' every frame
// was 16 % of the main thread. The loop picks the levels itself (frame), before the matrices, so a level that comes into
// view is placed in the same frame; three would pick during the render, a frame late for them.
function whenShown(force) { if (this.visible) THREE.Object3D.prototype.updateMatrixWorld.call(this, force); }
function ownLods(car) {
  car.lods = [];
  car.group.traverse(o => {
    if (!o.isLOD) return;
    o.autoUpdate = false;
    car.lods.push(o);
    for (const l of o.levels) l.object.updateMatrixWorld = whenShown;
  });
  return car;
}

// drivers: [{id, num, code, color}]; year picks the era's car design
export function setCars(drivers, onSelect, year) {
  disposeCars();
  const token = ++carsToken;
  // 2026+ cars use the RB22 model up close; until it has loaded they are procedural, then the grid is rebuilt once
  if (year >= 2026 && !rb22Ready()) loadRB22().then(() => token === carsToken && setCars(drivers, onSelect, year), e => console.warn('RB22 model', e));
  for (const d of drivers) {
    const car = ownLods(buildCar(d.color, d.num, year, tex.blob, map ? m(high ? 60 : 40) : Infinity, d.team));  // the detailed car is 57 draws: past 60 m it is under ~50 px wide (Settings' car detail doubles the range)
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
  applyDetail();
  warmCockpit(token);
}

// the ground photos, once: 4k on a desktop at any preset, else 1k
const loadPhotos = () => tex.load(high ? '4k' : '1k');

// one visible mesh per material in the scene: what a warm-up compiles
function warmable(seen = new Set()) {
  const meshes = [];
  scene.traverse(o => { if (o.isMesh && o.visible && !o.material.userData.readsViewport && !seen.has(o.material)) { seen.add(o.material); meshes.push(o); } });
  return meshes;
}

// The circuit's shaders, built in slices while the globe still covers the stage (globe.js waits on this before it fades):
// drawn cold, the first frames after the globe took 0.2-0.6 s each, compiling. The cars come later, with the race's data
// (0.3-15 s): warming theirs with the stage showing cost more than drawing them cold (docs/handover/phase-1.md).
export async function warmStage() {
  await ready?.catch(() => {});
  const at = circuit;
  if (!at || !post) return;
  await Promise.race([loadPhotos(), new Promise(r => setTimeout(r, 4000))]);  // the photos while the globe flies down
  try { await warmFor(renderer, scene, warmable(), post.scenePass.renderTarget, post.scenePass.getMRT(), () => circuit === at); }
  catch (e) { console.warn('stage shaders', e); }
}

// The shaders the close cameras need, built in the background once the cars are there: first the main view's (a far camera has
// drawn only the cars' far level), then the cockpit mirrors', which keep their modelled glass until then.
function warmCockpit(token) {
  mirrorsWarm = false;
  setTimeout(async () => {
    if (token !== carsToken) return;
    const seen = new Set(), meshes = warmable(seen);
    for (const c of Object.values(cars)) c.steeringWheel?.traverse(o => { if (o.isMesh && !seen.has(o.material)) { seen.add(o.material); meshes.push(o); } });
    const wanted = () => token === carsToken;
    try {
      await warmFor(renderer, scene, meshes, post.scenePass.renderTarget, post.scenePass.getMRT(), wanted);
      if (Object.values(cars).some(c => c.mirrors)) await warmMirrors(renderer, scene, meshes, wanted);
    } catch (e) { console.warn('close-up shaders', e); }
    if (token === carsToken) mirrorsWarm = true;
  }, 1000);  // after the first frames with the new grid
}

// Play's time-trial ghost: the best lap's car, see-through and unlit (so no csmSync), with no tag, sound or effects.
// p, ahead: map points now and 0.5 s on; null hides it. Built on first use, dropped with the cars (disposeCars).
let ghost = null;
// the tags show the race position, as the timing tower does (board: [{d: {id}, pos}]; 99 = not classified yet); the car number stays in the driver card
export function setTagPositions(board) {
  for (const b of board) {
    const n = cars[b.d.id]?.tag.element.firstChild, text = b.pos < 99 ? `P${b.pos}` : '';
    if (n && n.textContent !== text) n.textContent = text;
  }
}

export function setGhost(p, ahead, year) {
  if (!p || !map || !circuit) { if (ghost) ghost.group.visible = false; return; }
  if (!ghost) {
    const car = ownLods(buildCar('#ffffff', null, year, tex.blob)), mat = new THREE.MeshBasicNodeMaterial({color: 0xcfe8ff, transparent: true, opacity: 0.32, depthWrite: false});
    mat.mrtNode = mrt({velocity: vec4(0)});  // no motion vector of its own (post.js blur), like vfx.js's effects
    car.group.traverse(o => {
      if (!o.isMesh) return;
      if (o.layers.mask !== 1) o.visible = false;  // the contact-shadow planes (layer 1): a ghost casts none
      o.material = mat;
      o.castShadow = o.receiveShadow = false;
    });
    ghost = {...car, mat, hint: undefined};
    world.add(car.group);
  }
  const road = circuit.surface(p, ghost.hint), at = new THREE.Vector3((p[0] - map.cx) * map.k, road.y + 0.02, (p[1] - map.cy) * map.k);
  ghost.hint = road.i;
  const next = toScene(ahead, 0.02, ghost.hint);
  if (at.distanceTo(next) > 0.01) {  // a ghost parked at the line (its lap over) keeps its heading
    ghost.yaw = Math.atan2(-(next.z - at.z), next.x - at.x);
    ghost.pitch = Math.atan2(next.y - at.y, Math.hypot(next.x - at.x, next.z - at.z));
  }
  ghost.group.visible = true;
  ghost.group.position.copy(at);
  ghost.group.rotation.set(road.roll, ghost.yaw ?? 0, ghost.pitch ?? 0, 'YZX');
  ghost.group.scale.setScalar(1 / map.mps);
}

// does this car have a steering wheel of its own in the cockpit view?
export const hasCockpitWheel = id => !!cars[id]?.steeringWheel;

// the cars' own geometry and materials (era templates are shared and kept)
function disposeCars() {
  for (const c of Object.values(cars)) {
    world.remove(c.group);
    c.tag.element.remove();  // CSS2DObject only drops its DOM element when removed itself, not with its parent group
    c.dispose();
    c.haze.geometry?.dispose();  // not its material: vfx.js gives every car the one hazeMat, and disposing it recompiled it on each new grid
  }
  cars = {};
  crews.clear();
  if (ghost) { world.remove(ghost.group); ghost.dispose(); ghost.mat.dispose(); ghost = null; }
}

// mode: overview (free orbit) | chase (TV) | follow (game chase cam) | onboard (cockpit, driver's eye) | tcam (on the airbox) | heli (helicopter)
export function setView(m) {
  mode = m;
  zoomAim = zoomNow = 1;
  container.dataset.cam = m;  // style.css: corner numbers only in the overview, they show through walls from a low camera
  chased = null;
  fly = null;  // still easing to the overview, it'd pull a chase camera back out there for good: chase keeps its offset
  controls.enabled = !RIGGED.has(m);
  camera.fov = {overview: 42, chase: 50, onboard: 72, tcam: 64, heli: 30, follow: 62}[m];
  camera.updateProjectionMatrix();
  onCameraModeChanged(m);  // the cascades are slices of the view frustum
  post.reset();
  if (m === 'overview') resetView();
}

export const setParts = p => Object.assign(parts, p);
export {announce};

// the start gantry's red lamps: n of 5 lit (0: dark)
export const setStartLights = n => circuit?.lights(n);

// colour band on the tyre sidewalls for the current compound
// Weather look, from the simulation's weather (or a replay's rain flag). cloud / rain 0..1; wetLine / wetOff: water
// depth on and off the racing line. Overcast cuts the direct sun by up to 85 % and the sky light by half and greys the
// fog; rain pulls the fog in; the track shader gets its water depths, other surfaces lose roughness as they wet, and the
// verge and the ground darken (circuit3d.js wetDark).
export function setWeather({cloud, rain, wetLine, wetOff}) {
  if (!scene) return;
  weather = {cloud, rain, wetLine, wetOff};
  if (skyIndex() !== skyAt) loadSky(SKIES[skyAt = skyIndex()]);
  // the cloud dimming is sized for the sunny skies; the Overcast HDRI, once it is the one up, is already grey and sunless (sun 0.7, not 3.2)
  const overcast = Math.max(0, cloud - 0.1) / 0.9 * (sky0.name === 'Overcast' ? 0.3 : 1), wet = (wetLine + wetOff) / 2;
  sun.intensity = sky0.sun * (1 - 0.85 * overcast);
  scene.environmentIntensity = sky0.env * (1 - 0.5 * overcast);
  scene.backgroundIntensity = 1 - 0.6 * overcast;
  hemi.intensity = sky0.hemi * (1 + 0.5 * overcast);  // flat, diffuse light under cloud
  scene.fog.color.copy(sky0.fog).lerp(RAIN_GREY, 0.7 * overcast);
  scene.fog.near = SIZE * 1.3 * (1 - 0.9 * rain);
  scene.fog.far = SIZE * 4 * (1 - 0.8 * rain);
  if (trackMat) {
    trackMat.userData.wetLine.value = wetLine;
    trackMat.userData.wetOff.value = wetOff;
    trackMat.userData.normalScale.value = 1 - 0.8 * wet;  // the water film smooths over the aggregate
  }
  for (const m of wettable) m.roughness = 0.9 - 0.6 * wet;
  if (circuit) circuit.wetDark.value = 1 - 0.25 * wet;  // the verge and the ground under it
  if (cloudShadow) cloudShadow.value = 0.2 + 0.6 * Math.max(0, cloud - 0.1) / 0.9;  // darker under more cloud; the sky at 0 is a clear one
  vfx.rain = rain;
}

// Satellite imagery as the ground round the circuit (satellite.js): the outline is fitted to the circuit's real shape,
// the imagery 500 m round the track is fetched, and the terrain shader drapes it through an affine scene (x, z) -> uv
// (Mercator is conformal, so over a few km the map is affine to well under a metre). Trees stay only where the image
// shows vegetation. Anything failing (no real outline, a poor fit, tiles unreachable) leaves the procedural grass.
// Twice: ~36 tiles first, then the sharp image. On a cold browser cache its ~480 tiles take ~12 s, past the intro's lights out.
// the limit by backend: WebGPU reports it on the device, WebGL2 through its context
function maxTexture() {
  const b = renderer.backend;
  return b.device?.limits.maxTextureDimension2D ?? b.gl?.getParameter(b.gl.MAX_TEXTURE_SIZE) ?? 4096;
}

export async function setGround(year, round, maxPx = 2048) {
  cancelGround?.();
  const c = circuit, full = Math.min(high ? 8192 : 4096, maxTexture());  // high tier: one zoom level sharper (~0.5 m a pixel)
  if (!c) return;
  const xs = c.pts.map(p => (p[0] - map.cx) * map.k), zs = c.pts.map(p => (p[1] - map.cy) * map.k), pad = m(500);
  const g = await new Promise(done => {  // the fit, the imagery and its vegetation: groundwork.js, on a worker thread
    const w = new Worker(new URL('./groundwork.js', import.meta.url), {type: 'module'});
    const end = (answer, note) => { w.terminate(); cancelGround = null; stageDone('ground', note); done(answer); };
    cancelGround = () => end({}, 'cancelled');
    w.onmessage = e => {
      if (e.data?.progress !== undefined) return stage('ground', 'Satellite ground', e.data.progress);
      end(e.data, e.data?.image ? undefined : 'offline: procedural grass');
    };
    w.onerror = e => end({error: e.message || 'worker failed'}, 'offline: procedural grass');
    stage('ground', 'Satellite ground');
    w.postMessage({url: `/api/geo/${year}/${round}`, pts: c.pts, map: {k: map.k, cx: map.cx, cy: map.cy}, L: SIZE / 2,
      box: [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad],
      maxPx: Math.min(maxPx, full)});
  });
  if (circuit !== c || !g?.image) {  // another circuit since, or no ground to show
    g?.image?.close();
    if (g?.error) console.warn('satellite ground', g.error);
    else if (g?.rms > 15) console.warn(`satellite ground: outline fit off by ${g.rms.toFixed(0)} m`);
    return;
  }
  // anisotropy 16: the ground is seen at grazing angles; three clamps it to what the GPU supports
  const texture = Object.assign(new THREE.Texture(g.image), {colorSpace: THREE.SRGBColorSpace, flipY: false, anisotropy: 16, needsUpdate: true});
  // the bitmap (up to 8192² = 256 MB) is only needed for the one upload: kept, it held that RAM until the next circuit
  texture.onUpdate = () => g.image.close();
  texture.addEventListener('dispose', () => g.image.close());
  const [a, b, u0, d, e, v0] = g.m, {w, h, data} = g.mask;
  const green = (X, Z) => {  // vegetation under scene (x, z), through the affine map the shader drapes the image with
    const u = a * X + b * Z + u0, v = d * X + e * Z + v0;
    return u < 0 || u >= 1 || v < 0 || v >= 1 || data[Math.floor(v * h) * w + Math.floor(u * w)] === 1;
  };
  c.satellite(texture, new THREE.Matrix3().set(...g.m, 0, 0, 1), green, new THREE.Color().setRGB(...g.mean, THREE.SRGBColorSpace), g.mask);
  if (maxPx < full) setGround(year, round, full);
}

// Pit lane (map points of its centre line): the simulation's, entry road to exit road, or a replay's real one from GPS.
// boxes: the simulation's team garages [{at, color}] (circuit3d.js pitLane).
export function setPitLane(pts, boxes = null) {
  if (!circuit || pts.length < 2) return;
  circuit.pitLane(pts, boxes);
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
  // roll: the road's banking at each sample, so the ribbon's two edges follow it (a flat strip on a banked corner sinks one edge)
  if (vfx && map) vfx.ribbon(pts && pts.map(p => {
    if (!p) return p;
    const road = circuit?.surface(p.pos, hint);
    hint = road?.i;
    return {p: toScene(p.pos, m(0.12), hint), state: p.state, roll: road?.roll ?? 0};
  }), m(0.6));
}

export function setTyre(id, color) {
  cars[id]?.stripe.color.set(color || 0xd8d8d8);
}

// Sparks (plank strikes) and tyre smoke (lock-ups): fx {sparks, smoke} 0..1 from the race simulation, else guessed from
// motion: braking well past the normal 4-5 g locks the fronts, above ~270 km/h the plank strikes, worst as braking dips the nose.
// simDt: replay seconds since the last update, dt: real seconds.
function effects(c, at, next, simDt, dt, fx) {
  const vel = next.clone().sub(at).divideScalar(0.5), v = vel.length() * map.mps;  // m/s over the next half second
  const acc = (v - c.v) / simDt;
  c.v = v;
  if (Math.abs(acc) > 80) return;  // scrubbing or a data jump, not driving
  c.acc += (acc - c.acc) * Math.min(1, simDt * 4);  // ~0.25 s low-pass: GPS positions are noisy
  c.brakeC = brakeStep(c.brakeC ?? 150, -c.acc, v, simDt);  // carbon brakes: heated by the energy they take
  for (const d of c.discs) d.userData.brakeTemp.value = brakeGlow(c.brakeC);
  const brake = fx ? Math.sqrt(fx.smoke) : THREE.MathUtils.smoothstep(-c.acc, 48, 65);
  if (!gfx.particles) return;
  // tyre marks: each rear tyre that is locking or sliding lays a stretch of mark a frame, in the car's own frame
  if (brake > 0.1 && c.v > 5 && c.wheels) {
    const len = Math.min(c.v * dt, 1.5), [, tw] = c.tyre;  // metres this frame, the tyre's width
    c.group.updateMatrixWorld();
    for (const w of c.wheels) if (!w.front) {
      const local = new THREE.Matrix4().compose(new THREE.Vector3(w.pivot.position.x - len / 2, 0.004, w.pivot.position.z), new THREE.Quaternion(), new THREE.Vector3(len, 1, tw * 0.9));
      vfx.skid(local.premultiply(c.group.matrixWorld));
    }
  }
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

// Every car has separate wheels and a sprung body; from the car's motion: turn (rad) over moved (m) since the last frame.
// Wheels roll by distance / radius and the fronts steer to the path's curvature (the player's car: its real road-wheel
// angle); the body rolls with lateral g, pitches with longitudinal g (dive under braking, squat on throttle) and
// settles as downforce (~v^2) compresses the springs; the DRS flap opens with the simulation's DRS.
function chassis(c, turn, moved, f) {
  if (moved > 50) return;  // scrubbing jump
  const [r] = c.tyre, k = moved > 0.05 ? turn / moved : 0;  // path curvature 1/m, + = left
  // At speed (and on a 10x replay) a wheel turned up to thousands of degrees a frame: it strobed, stood still or ran
  // backwards, and its motion vectors smeared it into garbage. Past ~20 degrees a frame it turns at that cap, which the
  // motion blur draws as a spinning disc, the way a camera shutter sees a fast wheel.
  for (const w of c.wheels) w.spin.rotation.z -= Math.min(moved / r, 0.35);
  const delta = f?.cam ? -f.cam.steer : THREE.MathUtils.clamp(Math.atan(c.wb * k), -0.38, 0.38);  // road-wheel angle, + = left
  c.delta = (c.delta ?? 0) + (delta - (c.delta ?? 0)) * 0.25;
  for (const w of c.wheels) if (w.front) w.pivot.rotation.y = c.delta;
  if (c.steeringWheel) {  // the RB22's: procedural cars have no cockpit interior
    c.steeringWheel.rotation.x = -c.delta * STEERING_RATIO;
    c.pose();  // the driver's hands go with it
  }
  // The simulation's own forces when it drives the car (its gLat is + to the right, this file's + to the left), else
  // estimated from the car's motion
  const sim = f?.g, gLat = sim ? -sim.gLat : THREE.MathUtils.clamp(c.v * c.v * k / 9.81, -6, 6);
  c.gLat = (c.gLat ?? 0) + (gLat - (c.gLat ?? 0)) * 0.1;
  c.body.rotation.x = 0.004 * c.gLat;                                    // ~0.25 deg/g, outside of the corner down
  c.body.rotation.z = 0.003 * THREE.MathUtils.clamp(sim ? sim.gLong : c.acc / 9.81, -6, 3);  // nose down under braking
  // ride height: the simulation's heave (aero compression, bottoming, a 2022+ car's porpoising) and a jolt over the kerbs
  const heave = sim ? THREE.MathUtils.clamp(sim.z, -0.01, 0.06) : 0.02 * Math.min(1, (c.v / 90) ** 2);  // ~20 mm at 320 km/h
  c.body.position.y = -heave + (sim?.kerb ? sim.kerb * 0.35 * Math.sin(performance.now() * 0.06) : 0);
  if (c.head) {  // the driver's neck: into the corner (~2 deg/g, up to 10) and forward under braking (~1.5 deg/g), over ~0.1 s
    const hd = c.headFx ??= {r: 0, p: 0}, gRight = sim ? sim.gLat : -c.gLat, gLong = sim ? sim.gLong : c.acc / 9.81, deg = Math.PI / 180;
    hd.r += (THREE.MathUtils.clamp(2 * gRight, -10, 10) * deg - hd.r) * 0.15;
    hd.p += (THREE.MathUtils.clamp(1.5 * gLong, -8, 3) * deg - hd.p) * 0.15;
    c.head.rotation.set(hd.r, 0, hd.p);  // x: roll to the right, z: + noses up, so braking (gLong < 0) pitches it forward
  }
  c.halo.rotation.copy(c.body.rotation);
  c.halo.position.y = c.body.position.y;
}

// The focused car's rear-view mirrors reflect the scene in the cockpit view (its own rear wheels left out); built the
// first time they're needed, and back to the model's glass otherwise, so only one car pays for the extra renders.
function mirrors(c, on) {
  if (!c.mirrors || !mirrorsWarm) return;
  if (on && !c.mirrored) {
    c.mirrored = true;
    for (const glass of c.mirrors) makeMirror(glass, {hide: c.wheels.filter(w => !w.front).map(w => w.pivot)});
  }
  if (c.mirrored) for (const glass of c.mirrors) glass.userData.mirror(on);
}

// a lens change costs a projection and the cascades' frusta: not for a change nobody can see
function zoomTo(fov) {
  if (Math.abs(fov - camera.fov) < 0.2) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
  if (csm.camera) csm.updateFrustums();
}

// pos/ahead: {id: [x, y]} map coords now and 0.5 s later (gives the heading). rate: replay seconds per real second (0 when
// paused); progress: 0..1 through the session; fx: {id: {sparks, smoke, light}} from the simulation (light: the rear light
// flashes while harvesting or derating). Returns the focused car's steering angle in degrees (+ = left) from heading change.
export function updateCars(pos, ahead, focus, rate = 1, progress = 1, fx = null) {
  if (!map) return 0;
  const now = performance.now(), dt = Math.min((now - lastUpdate) / 1000, 0.25);
  lastUpdate = now;
  simRate = rate;
  lastCars = [pos, ahead, focus, 0, progress, fx];
  const zoomWas = zoomNow;
  zoomNow += (zoomAim - zoomNow) * (1 - Math.exp(-dt / 0.12));
  if (Math.abs(zoomAim - zoomNow) < 0.002) zoomNow = zoomAim;
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
    c.haze.visible = gfx.haze && away < m(60);  // transmission re-renders the scene: only when it shows
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
    if (c.steeringWheel) c.steeringWheel.visible = !own || parts.wheel;
    // a low camera sees the whole field's tags stacked on its horizon, through the walls
    c.tag.visible = !own && !(mode === 'tcam' && id === focus) && (id === focus || mode === 'overview' || mode === 'heli' || c.group.position.distanceTo(camera.position) < m(200));
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
      // The head pitches forward under braking (~0.7 deg/g), rolls into the corner, looks to the apex: from the simulation
      // while driving, else from the car's measured motion, so a replay feels the same.
      // (cam.gLat is + to the right; the replay's measured c.gLat is + to the left, hence the sign)
      const g = fx?.[id]?.cam ?? {gLat: -(c.gLat ?? 0), gLong: c.acc / 9.81, steer: -(c.delta ?? 0), v: c.v}, cf = c.camFx ??= {p: 0, r: 0, y: 0, x: 0, z: 0, kick: 0, shift: false};
      // the head moves as well as turns: ~1 cm/g towards the corner's inside, ~1.2 cm/g forward under braking; and each
      // gear change (drive cut, then back) nods it ~0.3 deg
      cf.x += (THREE.MathUtils.clamp(g.gLat, -6, 6) * 0.01 - cf.x) * 0.15;
      cf.z += (THREE.MathUtils.clamp(g.gLong, -6, 3) * 0.012 - cf.z) * 0.15;
      const shifting = !!fx?.[id]?.g?.shift;
      if (shifting && !cf.shift) cf.kick = -0.005;
      cf.shift = shifting;
      cf.kick *= Math.exp(-dt / 0.12);
      cf.p += (THREE.MathUtils.clamp(g.gLong * 0.012, -0.07, 0.03) - cf.p) * 0.15;
      cf.r += (THREE.MathUtils.clamp(-g.gLat * 0.01, -0.06, 0.06) - cf.r) * 0.15;
      cf.y += (THREE.MathUtils.clamp(-g.steer * 0.8, -0.2, 0.2) - cf.y) * 0.1;
      // engine vibration through the tub rises with revs (which go with speed), aero buffeting above 300 km/h, a jolt on a kerb
      const engine = g.v > 1 ? 0.0004 + 0.0005 * Math.min(1, g.v / 90) : 0.00015, aero = g.v > 83 ? 0.0015 * (g.v - 83) / 10 : 0;
      const onKerb = fx?.[id]?.g?.kerb ?? (Math.abs(road.lat) > circuit.half - m(0.4) ? 0.5 : 0);
      const jolt = fx?.[id]?.g ? (onKerb ? 0.004 + 0.06 * onKerb : 0) : 0.008 * onKerb;  // as hard as the follow camera's, from the simulation's kerb height
      const buzz = engine + aero + jolt;
      camera.translateX(m(cf.x));
      camera.translateZ(m(cf.z));  // local +z is backwards: braking (z < 0) moves the eye forward
      camera.rotateY(cf.y);
      camera.rotateX((mode === 'onboard' ? -0.07 : 0) + cf.p + cf.kick + (Math.random() - 0.5) * buzz);  // onboard: the road, not half a frame of sky
      camera.rotateZ(cf.r + (Math.random() - 0.5) * buzz);
      // the speed tunnel: 4 degrees wider at 340 km/h with the rear wing open, a little less with it shut
      const widen = 4 * Math.min(1, (c.v / 94.4) ** 2) * (fx?.[id]?.drs ? 1 : 0.65);
      zoomTo(((mode === 'tcam' ? 64 : 72) + widen) * zoomNow);
    } else if (mode === 'heli') {
      // 70 m back, 35 m out, 55 m up, eased in with a 0.7 s lag like a pilot tracking the car; the aim lags only 0.2 s
      const want = new THREE.Vector3(at.x - Math.cos(c.yaw) * m(70) + Math.sin(c.yaw) * m(35), at.y + m(55),
                                     at.z + Math.sin(c.yaw) * m(70) + Math.cos(c.yaw) * m(35));
      if (chased !== id || moved >= 200) { chased = id; post.reset(); camera.position.copy(want); controls.target.copy(at); }  // a scrub cuts, like every other camera
      // lags in replay time: in real time a 10x replay left the camera ~560 m behind, flying to catch up at ~800 m/s,
      // which the motion blur smeared over the whole frame
      const lag = dt * Math.max(1, rate);
      camera.position.lerp(want, 1 - Math.exp(-lag / 0.7));
      controls.target.lerp(at, 1 - Math.exp(-lag / 0.2));
      camera.lookAt(controls.target);
      // the lens tracks the range, so the car stays the same size as the pilot climbs and falls behind
      zoomTo(THREE.MathUtils.clamp(30 * camera.position.distanceTo(controls.target) / m(95.6), 20, 40) * zoomNow);
    } else if (mode === 'follow') {  // the racing-game chase cam: low behind the car, swinging round with it
      // weight (sim cars): it hangs back under power and closes in under braking, swings out and leans in corners,
      // and shakes over kerbs and at top speed; smoothed over ~0.15 s so it reads as the car's mass, not noise
      const g = fx?.[id]?.g, cf = c.chaseFx ??= {lon: 0, lat: 0};
      const ease = 1 - Math.exp(-dt / 0.15);
      cf.lon += ((g?.gLong ?? 0) - cf.lon) * ease;
      cf.lat += ((g?.gLat ?? 0) - cf.lat) * ease;
      const back = zoomNow * 1.6 * len * (1 + THREE.MathUtils.clamp(cf.lon, -5, 3) * 0.04), side = -cf.lat * 0.025 * len;
      const want = new THREE.Vector3(at.x - Math.cos(c.yaw) * back + Math.sin(c.yaw) * side, at.y + 0.42 * len * zoomNow,
                                     at.z + Math.sin(c.yaw) * back + Math.cos(c.yaw) * side);
      if (chased !== id) { chased = id; post.reset(); camera.position.copy(want); c.armAt = null; }
      // The camera rides with the car and the spring only takes up the swing: springing on the world position it trailed
      // by 2v/w, ~14 m at 330 km/h, so the car shrank to a third of its size on every straight and grew back in the corners.
      if (c.armAt) camera.position.add(at).sub(c.armAt);
      (c.armAt ??= new THREE.Vector3()).copy(at);
      // A critically damped spring on an arm: it settles as fast as a spring can without ever overshooting past the car.
      // Exact for any step, so a dropped frame doesn't kick it: x(h) = want + (d + (v + w d) h) e^(-w h). Replay time, as the heli's.
      const arm = c.arm ??= new THREE.Vector3(), h = dt * Math.max(1, rate), w = 13, e = Math.exp(-w * h);
      const d = camera.position.clone().sub(want), step = arm.clone().addScaledVector(d, w).multiplyScalar(h);
      arm.addScaledVector(step, -w).multiplyScalar(e);
      camera.position.copy(want).addScaledVector(d.add(step), e);
      controls.target.set(at.x + Math.cos(c.yaw) * len, at.y + 0.18 * len, at.z - Math.sin(c.yaw) * len);
      camera.lookAt(controls.target);
      const shake = (g?.kerb ? 0.004 + 0.06 * g.kerb : 0) + (c.v > 70 ? 0.0012 * (c.v - 70) / 10 : 0);
      camera.rotateZ(cf.lat * 0.008 + road.roll * 0.6 + (Math.random() - 0.5) * shake);  // banks with the road
      camera.rotateX((Math.random() - 0.5) * shake);
      zoomTo(62 + 10 * THREE.MathUtils.clamp(c.v / 90, 0, 1));  // widens with speed, 72 deg at ~320 km/h
    } else if (mode === 'chase' && chased === null) {  // drop in behind the car
      chased = id;
      post.reset();
      controls.target.copy(at);
      camera.position.set(at.x - Math.cos(c.yaw) * 5 * len, at.y + 2.4 * len, at.z + Math.sin(c.yaw) * 5 * len);
    } else if (mode === 'chase') {  // follow, turning with the car; the user can still orbit
      if (chased !== id) { chased = id; glide = 0; }  // another car picked: pan across to it instead of cutting
      glide = Math.min(1, glide + dt / 0.9);
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(UP, turn).multiplyScalar(zoomNow / zoomWas);
      controls.target.lerp(at, glide < 1 ? THREE.MathUtils.smootherstep(glide, 0, 1) : 1);
      camera.position.copy(controls.target).add(offset);
    }
  }
  return steer;
}
