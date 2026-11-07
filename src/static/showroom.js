// The car showroom's 3D view: a studio scene drawn by the race's renderer onto its own CanvasTarget, from scene3d.js's
// master loop. It shares that renderer's device and PMREM generator, and the cars' era templates and materials, so opening
// it compiles only what its lights change. Three lighting rigs, callout pins anchored on the car, and an illustrative
// airflow overlay.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {SkyMesh} from 'three/addons/objects/SkyMesh.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {attribute, float, fract, mix, smoothstep, time, vec3} from 'three/tsl';
import {el} from './util.js';
import {ready, setDeck, shared} from './scene3d.js';
import {buildCar} from './cars3d.js';

// env: which image-based light (built once each, on first use); key: [colour, intensity, position, shadow]; extra lights
// are rim or fill. Exposure-free: the renderer's AgX exposure stays the race's, so a colour looks the same in both views.
const RIGS = [
  {name: 'Pit Garage Overhead', env: 'room', envI: 0.5, bg: 0x15171b, floor: 0x1c1e22, floorR: 0.42,
   key: [0xf4f7ff, 2.2, [0.4, 7, 0.2]], extra: [[0xcfdcff, 0.5, [-5, 2.5, 4]], [0xcfdcff, 0.5, [5, 2.5, -4]]]},
  {name: 'Sunset Golden Hour', env: 'sunset', envI: 0.8, bg: 0x2a1a18, floor: 0x3a2c28, floorR: 0.3,
   key: [0xffa861, 3.4, [-6, 1.8, 3]], extra: [[0x7f94c9, 0.5, [5, 3, -4]]]},
  {name: 'Dark Wind-Tunnel Rim Light', env: 'room', envI: 0.12, bg: 0x030405, floor: 0x08090b, floorR: 0.6,
   key: [0x9fd8ff, 4.5, [-3, 3, -6]], extra: [[0xeaf6ff, 3.5, [3.5, 2.5, 6]], [0x4aa8ff, 1.2, [0, 0.4, 7]]]},
];

// Facts for the callouts by era. at(car): the anchor in the car's own frame (metres; +x forward, y up).
const PINS = [
  {id: 'aero', title: 'Active aero: Z mode and X mode', from: 2026,
   at: c => [-c.len / 2 + 0.2, 1.0, 0],
   text: 'Front and rear wings move on demand. Z mode is the cornering setting, wings closed for downforce. X mode opens them on the straights to shed drag. It replaces DRS, and every driver can use it on any straight.'},
  {id: 'ers', title: year => (year >= 2026 ? '350 kW MGU-K: the 50/50 split' : 'MGU-K energy recovery'), from: 2009,
   at: c => [-0.15, 0.55, c.width * 0.3],
   text: year => (year >= 2026
     ? 'The MGU-K triples to 350 kW, about half the car\'s peak power against roughly 400 kW from the V6. The MGU-H is gone, so the rear brakes do the charging: up to 8.5 MJ a lap. Deployment tapers off above 290 km/h unless the driver spends Overtake.'
     : 'A motor on the crankshaft: it harvests under braking and gives the energy back on demand. 60 kW from 2009, 120 kW from 2014.')},
  {id: 'floor', title: 'Venturi ground-effect floor', from: 2022,
   at: c => [-0.4, 0.06, c.width * 0.42],
   text: 'Tunnels under the car speed the air up where they narrow, dropping its pressure and pulling the car down. The downforce costs little drag and leaves cleaner air behind, so cars can follow closely. The 2026 floors are flatter and make less of it.'},
];

let S = null;

// Streamlines over a box-shaped body, by hand: air comes straight down the car, lifts over it with a smooth bump, spreads
// round it and rises over the rear wing. A picture of where the air goes, not a simulation of it (the UI says so).
function flowGeometry(car) {
  const ribbons = [], L = car.len, W = car.width, N = 72, half = 0.012;
  for (let k = 0; k < 44; k++) {
    const z0 = (k % 11 - 5) / 5 * W * 0.8, y0 = 0.08 + Math.floor(k / 11) * 0.28, pos = [], s = [], speed = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, x = (0.85 - 1.8 * f) * L;
      const near = Math.exp(-((x / (L * 0.45)) ** 4)), inside = Math.exp(-((z0 / (W * 0.55)) ** 2));
      const wing = Math.exp(-(((x + L * 0.42) / 0.5) ** 2));  // the rear wing throws the top layers upwards
      const y = y0 + near * inside * (0.5 - y0 * 0.3) + wing * inside * 0.45 * y0;
      const z = z0 * (1 + near * 0.28);
      for (const side of [-1, 1]) pos.push(x, y + side * half, z);
      s.push(f, f);
      const v = 0.45 + near * inside * 0.55;  // faster where the path squeezes over the body
      speed.push(v, v);
      if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(s, 1));
    g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speed, 1));
    g.setIndex(idx);
    ribbons.push(g);
  }
  const merged = mergeGeometries(ribbons);
  ribbons.forEach(g => g.dispose());
  return merged;
}

const flowMaterial = (() => {
  let m = null;
  return () => {
    if (m) return m;
    m = new THREE.MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false});
    const along = attribute('aS', 'float'), v = attribute('aSpeed', 'float');
    const dash = smoothstep(0, 0.35, fract(along.mul(9).sub(time.mul(1.1))));  // dashes running down the ribbon
    const ends = smoothstep(0, 0.1, along).mul(smoothstep(1, 0.85, along));
    m.colorNode = mix(vec3(0.1, 0.5, 1), vec3(1, 0.32, 0.12), smoothstep(0.5, 1, v)).mul(float(1.6));
    m.opacityNode = dash.mul(ends).mul(0.55);
    return m;
  };
})();

function environment(pmrem, kind) {
  S.envs[kind] ??= (() => {
    // shortcut: every rig bakes this sky, since a RoomEnvironment bake fails to compile on WebGPU (empty output struct, cause not found) and blacked out whole frames
    const sky = new SkyMesh(), envScene = new THREE.Scene();
    sky.scale.setScalar(50);
    sky.turbidity.value = 6;
    sky.rayleigh.value = 2.2;
    sky.mieDirectionalG.value = 0.82;
    sky.sunPosition.value.set(-0.85, 0.09, 0.4);
    envScene.add(sky);
    const texture = pmrem.fromScene(envScene).texture;
    sky.geometry.dispose();
    sky.material.dispose();
    return texture;
  })();
  return S.envs[kind];
}

function setRig(i) {
  S.rig = i;
  const r = RIGS[i], {pmrem} = shared();
  S.lights.forEach(l => { S.scene.remove(l, l.target); l.shadow?.map?.dispose(); l.dispose(); });
  const make = ([color, intensity, at], shadow) => {
    const l = new THREE.DirectionalLight(color, intensity);
    l.position.set(...at);
    if (shadow) {
      l.castShadow = true;
      l.shadow.mapSize.setScalar(2048);
      Object.assign(l.shadow.camera, {left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20});
      l.shadow.bias = -0.0003;
    }
    S.scene.add(l, l.target);
    return l;
  };
  S.lights = [make(r.key, true), ...r.extra.map(e => make(e, false))];
  S.scene.environment = environment(pmrem, r.env);
  S.scene.environmentIntensity = r.envI;
  S.scene.background = new THREE.Color(r.bg);
  S.scene.fog = new THREE.Fog(r.bg, 14, 28);  // no hard line where the floor ends
  S.floor.material.color.set(r.floor);
  S.floor.material.roughness = r.floorR;
  S.ui.rig.textContent = r.name;
}

function buildPins() {
  S.ui.pins.replaceChildren();
  S.pins = [];
  if (!S.car) return;
  for (const p of PINS) {
    if (S.year < p.from || (p.id === 'floor' && S.year < 2022)) continue;
    const say = v => (typeof v === 'function' ? v(S.year) : v);
    const btn = el('button', {class: 'cspin', 'aria-label': say(p.title), 'aria-pressed': false, onclick: e => {
      e.stopPropagation();
      const open = S.ui.note.dataset.pin !== p.id;
      S.ui.note.hidden = !open;
      S.ui.note.dataset.pin = open ? p.id : '';
      S.ui.note.replaceChildren(...(open ? [el('b', {}, say(p.title)), el('p', {}, say(p.text))] : []));
      for (const x of S.pins) x.btn.setAttribute('aria-pressed', open && x.p === p);
    }}, '+');
    S.ui.pins.append(btn);
    S.pins.push({p, btn, at: new THREE.Vector3(...p.at(S.car))});
  }
  S.ui.note.hidden = true;
  S.ui.note.dataset.pin = '';
}

const v = new THREE.Vector3();
function placePins() {
  const {camera, ui: {pins}} = S, w = pins.clientWidth, h = pins.clientHeight;
  for (const {at, btn} of S.pins) {
    v.copy(at).project(camera);
    btn.style.translate = `${((v.x + 1) / 2 * w).toFixed(1)}px ${((1 - v.y) / 2 * h).toFixed(1)}px`;
    btn.style.opacity = v.z < 1 ? 1 : 0;
  }
}

function setFlow(on) {
  S.ui.flow.setAttribute('aria-pressed', on);
  S.ui.flow.title = 'Illustrative airflow, not a simulation';
  S.flowOn = on;
  if (S.flow) S.flow.visible = on;
}

// host: the element to fill. Returns once the view exists; call again after the device is up to reuse it.
async function create(host) {
  await ready;
  const canvas = el('canvas', {style: 'display:block;width:100%;height:100%'});
  const surface = new THREE.CanvasTarget(canvas);
  surface.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(5.5, 2.2, 5.5);
  camera.layers.enable(1);  // the cars' contact shadows
  const pins = el('div', {class: 'cspins'}), note = el('aside', {class: 'csnote glass', hidden: true});
  const rig = el('span'), flow = el('button', {class: 'neu', 'aria-pressed': false, onclick: () => setFlow(!S.flowOn)}, 'Airflow');
  const bar = el('div', {class: 'csbar'}, el('button', {class: 'neu', title: 'Next lighting rig', onclick: () => setRig((S.rig + 1) % RIGS.length)}, rig), flow);
  host.append(canvas, pins, note, bar);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {enableDamping: true, dampingFactor: 0.06, autoRotate: true, autoRotateSpeed: 1.2, enablePan: false, minDistance: 3, maxDistance: 14,
                           maxPolarAngle: Math.PI * 0.49});
  controls.target.set(0, 0.45, 0);
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; });  // it's yours now
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({metalness: 0.1}));
  floor.position.y = -0.005;
  floor.receiveShadow = true;
  scene.add(floor);
  // soft shadow under the car (the car's own contact-shadow planes use it too)
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  S = {surface, scene, camera, controls, floor, envs: {}, lights: [], rig: 0, car: null, flow: null, flowOn: false, pins: [], year: 0, blob: new THREE.CanvasTexture(c),
       ui: {pins, note, rig, flow}, token: 0, open: false};
  new ResizeObserver(() => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    S.size = [w, h];
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // the whole car in frame until it's been moved: ~6.6 m across, seen from anywhere, at this fov and aspect
    if (controls.autoRotate) camera.position.sub(controls.target).setLength(Math.max(8, 6.6 / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect))).add(controls.target);
  }).observe(host);
  setRig(0);
}

// No MRT here: the canvas's frame buffer texture isn't named 'output', so mrt({output}) matches nothing and every material
// compiles to an empty output struct, which WebGPU refuses (no car, no airflow).
const draw = () => {
  // A renderer only hears the resize of its current target, and that's this one only here: resized from the observer its
  // depth buffer stayed the old size, and WebGPU refused every frame.
  if (S.size) { S.surface.setSize(...S.size, false); S.size = null; }
  S.controls.update();
  placePins();
  const {renderer} = shared();
  renderer.render(S.scene, S.camera);
};

export async function openShowroom(host) {
  if (!S) await create(host);
  S.open = true;
  setDeck({surface: S.surface, draw});
}

export function closeShowroom() {
  if (!S) return;
  S.open = false;
  setDeck(null);
}

export const nextRig = () => S && setRig((S.rig + 1) % RIGS.length);

export async function showCar(color, year, team, load) {
  const token = ++S.token;
  await load?.();
  if (token !== S.token) return;
  if (S.car) {
    S.scene.remove(S.car.group);
    S.car.dispose();
    S.flow?.geometry.dispose();
    S.scene.remove(S.flow);
  }
  S.car = buildCar(color, null, year, S.blob, Infinity, team);
  S.year = year;
  S.scene.add(S.car.group);
  S.flow = new THREE.Mesh(flowGeometry(S.car), flowMaterial());
  S.flow.visible = S.flowOn;
  S.flow.frustumCulled = false;
  S.scene.add(S.flow);
  buildPins();
}
