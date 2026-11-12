// The 2026+ car up close: "2026 Redbull RB22" by Tyler_Dave (CC BY 4.0, see models/CREDITS.md). Loading, the per-corner
// wheel split, the steering wheel, the repaint and the texel-projected race number are adapted from
// github.com/AgentiLoop/F1 (src/rb22.mjs); its sponsor labels are left out. cars3d.js makes it the near level of each
// 2026+ car's THREE.LOD, with our procedural 2026 car as the far level. Car space as in cars3d.js: metres, +x forward,
// +z right, tyres on y = 0, length centred on the origin.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {seatDriver} from './driver.js';
import {stage, stageDone, progressOf} from './loadstage.js';
import {brakeMat} from './cars3d.js';
import {dash, dashCanvas} from './dash.js';

const MODEL = new URL('./models/rb22.glb', import.meta.url).href;
// Model space (as baked below): metres, nose +z, left +x, up +y.
// All four wheels of each of these materials are one mesh: split per corner at load.
const WHEEL_MATERIAL = /^(discs|redbull_wheel_hub|sidewall)/;
// Parts wholly inside this box make up the steering wheel.
const STEERING_BOX = new THREE.Box3(new THREE.Vector3(-0.14, 0.48, 0.63), new THREE.Vector3(0.14, 0.69, 0.81));
// A flat 4 cm plate on the bodywork left of the cockpit: its magenta-and-white texture flashes in the cockpit view.
const NOSE_PLATE = new THREE.Box3(new THREE.Vector3(0.07, 0.69, 1.11), new THREE.Vector3(0.125, 0.712, 1.165));
const TAIL_Z = -1.8;  // behind the rear axle (z ~ -1.7)
const CORNERS = ['front-left', 'front-right', 'rear-left', 'rear-right'];
const MIRRORS = ['mirror-left', 'mirror-right'];
export const STEERING_RATIO = 5;  // steering-wheel turn per radian of road-wheel steer

let template = null, loading = null, texels = null;
export const rb22Ready = () => !!template;

// Fetches and bakes the model once. Rejects if it can't be loaded; the procedural car then stays at every distance.
export function loadRB22() {
  if (loading) return loading;
  stage('rb22', 'Car model');
  return loading = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(MODEL, e => stage('rb22', 'Car model', progressOf(e))).then(gltf => {
    template = bake(gltf.scene);
    stageDone('rb22');
  }, e => {
    stageDone('rb22', 'offline: procedural car');
    throw e;
  });
}

// Every mesh baked into model space; the merged wheel meshes split per corner, the mirror glass per side.
function bake(scene) {
  scene.updateMatrixWorld(true);
  const meshes = []; scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const out = new THREE.Group(), wheels = CORNERS.map(name => Object.assign(new THREE.Group(), {name}));
  const steering = Object.assign(new THREE.Group(), {name: 'steering'});
  for (const m of meshes) {
    const geometry = toFloat(m.geometry).applyMatrix4(m.matrixWorld);
    // no metallicFactor in the file, so glTF's default 1 made these dark grey parts chrome
    if (m.material.name.startsWith('redbull_detail')) m.material.metalness = 0;
    if (m.material.name.startsWith('redbull_detail')) dropTriangles(geometry, c => NOSE_PLATE.containsPoint(c));
    if (m.material.name.startsWith('rear_light')) {  // one mesh along the car: the tail's part is the rain light
      const tail = dropTriangles(geometry.clone(), c => c.z > TAIL_Z);
      out.add(Object.assign(new THREE.Mesh(tail, m.material), {name: 'rain-light'}));
      dropTriangles(geometry, c => c.z <= TAIL_Z);
    }
    geometry.computeBoundingBox();
    if (WHEEL_MATERIAL.test(m.material.name)) {
      splitCorners(geometry).forEach((g, i) => g && wheels[i].add(new THREE.Mesh(g, m.material)));
      continue;
    }
    if (m.material.name.startsWith('redbull_mirror')) {  // both mirrors' glass is one mesh: each reflects its own view
      splitCorners(geometry).slice(0, 2).forEach((g, i) => out.add(Object.assign(new THREE.Mesh(g, m.material), {name: MIRRORS[i]})));
      continue;
    }
    const onWheel = STEERING_BOX.containsBox(geometry.boundingBox);
    if (onWheel && m.material.name.startsWith('kers_blue')) continue;  // a fixed bar across the screen
    if (onWheel && m.material.name.startsWith('gp21_LCD')) screenUv(geometry);
    const mesh = new THREE.Mesh(geometry, m.material);
    (onWheel ? steering : out).add(mesh);
  }
  out.add(steering, ...wheels);
  return out;
}

// A copy with float attributes (meshopt quantizes them, which a transform would clip).
function toFloat(geometry) {
  const out = new THREE.BufferGeometry(); out.setIndex(geometry.index);
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const n = attr.itemSize, dst = new Float32Array(attr.count * n), get = ['getX', 'getY', 'getZ', 'getW'];
    for (let i = 0; i < attr.count; i++) for (let j = 0; j < n; j++) dst[i * n + j] = attr[get[j]](i);
    out.setAttribute(name, new THREE.BufferAttribute(dst, n));
  }
  return out;
}

// Remove the triangles whose centroid c passes drop(c) (in place).
function dropTriangles(geometry, drop) {
  const pos = geometry.attributes.position, n = geometry.index ? geometry.index.count : pos.count;
  const at = i => geometry.index ? geometry.index.getX(i) : i, c = new THREE.Vector3(), v = new THREE.Vector3(), keep = [];
  for (let i = 0; i < n; i += 3) {
    c.set(0, 0, 0); for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, at(i + k)));
    if (!drop(c.divideScalar(3))) keep.push(at(i), at(i + 1), at(i + 2));
  }
  geometry.setIndex(keep);
  return geometry;
}

// Split a non-indexed copy of geometry into four by triangle centroid: +z front, +x left.
function splitCorners(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry, pos = g.attributes.position;
  const buckets = [[], [], [], []];
  for (let t = 0; t < pos.count; t += 3) {
    const x = pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2), z = pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2);
    buckets[(z > 0 ? 0 : 2) + (x > 0 ? 0 : 1)].push(t);
  }
  return buckets.map(tris => {
    if (!tris.length) return null;
    const out = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const n = attr.itemSize, src = attr.array, dst = new src.constructor(tris.length * 3 * n);
      tris.forEach((t, k) => dst.set(src.subarray(t * n, (t + 3) * n), k * 3 * n));
      out.setAttribute(name, new THREE.BufferAttribute(dst, n));
    }
    return out;
  });
}

// A corner's axle direction in car space (+z side): the area-weighted normal of its flat brake disc. Needs current
// world matrices.
function axleOf(corner) {
  const axis = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const disc = corner.children.find(m => m.material.name.startsWith('discs')), pos = disc.geometry.attributes.position;
  for (let t = 0; t < pos.count; t += 3) {
    [a, b, c].forEach((v, k) => v.fromBufferAttribute(pos, t + k).applyMatrix4(disc.matrixWorld));
    n.crossVectors(b.sub(a), c.sub(a)); axis.addScaledVector(n, Math.sign(n.z) || 1);
  }
  return axis.normalize();
}

// ---------- livery: the paint texture refilled in the team colour, the race number projected onto it ----------

// The nose-tip number slot (model space): centre c, facing n, reading along b, w x h metres. The number is drawn flat
// in that frame and copied onto every paint texel within `depth` of it whose surface faces n.
const NUMBER = {c: [0, 0.425, 2.38], n: new THREE.Vector3(0, 0.93, 0.36).normalize(), b: new THREE.Vector3(1, 0, 0), w: 0.26, h: 0.24, depth: 0.12};
const PAINT_SIZE = 1024;

// Rasterises the paint mesh's UVs (they wrap) and keeps the texels under the slot as {idx, s, t}: texel index and
// local metres along b and up. Texels the UV layout shares between two places (mirrored panels) are left out, or the
// number would show twice.
function slotTexels(paint, slot, size = PAINT_SIZE) {
  const n = slot.n, b = slot.b, u = n.clone().cross(b), c = new THREE.Vector3(...slot.c), w = slot.w / 2, h = slot.h / 2;
  const first = new Float32Array(size * size * 3), seen = new Uint8Array(size * size), shared = new Uint8Array(size * size), hits = [];
  const g = paint.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, I = g.index;
  const p = new THREE.Vector3(), nrm = new THREE.Vector3(), d = new THREE.Vector3(), vi = [0, 0, 0], ux = [0, 0, 0], uy = [0, 0, 0];
  for (let i = 0; i < (I ? I.count : P.count); i += 3) {
    for (let k = 0; k < 3; k++) { vi[k] = I ? I.getX(i + k) : i + k; ux[k] = UV.getX(vi[k]) * size; uy[k] = UV.getY(vi[k]) * size; }
    const det = (uy[1] - uy[2]) * (ux[0] - ux[2]) + (ux[2] - ux[1]) * (uy[0] - uy[2]);
    if (!det) continue;
    for (let y = Math.floor(Math.min(...uy)); y < Math.ceil(Math.max(...uy)); y++)
      for (let x = Math.floor(Math.min(...ux)); x < Math.ceil(Math.max(...ux)); x++) {
        const a = ((uy[1] - uy[2]) * (x + 0.5 - ux[2]) + (ux[2] - ux[1]) * (y + 0.5 - uy[2])) / det;
        const bb = ((uy[2] - uy[0]) * (x + 0.5 - ux[2]) + (ux[0] - ux[2]) * (y + 0.5 - uy[2])) / det, cc = 1 - a - bb;
        if (a < 0 || bb < 0 || cc < 0) continue;
        p.set(0, 0, 0); nrm.set(0, 0, 0);
        [a, bb, cc].forEach((wt, k) => { p.x += wt * P.getX(vi[k]); p.y += wt * P.getY(vi[k]); p.z += wt * P.getZ(vi[k]);
          nrm.x += wt * N.getX(vi[k]); nrm.y += wt * N.getY(vi[k]); nrm.z += wt * N.getZ(vi[k]); });
        const t = ((y % size) + size) % size * size + ((x % size) + size) % size;
        if (!seen[t]) { seen[t] = 1; p.toArray(first, t * 3); }
        else if (Math.hypot(p.x - first[t * 3], p.y - first[t * 3 + 1], p.z - first[t * 3 + 2]) > 0.05) { shared[t] = 1; continue; }
        d.subVectors(p, c);
        const s = d.dot(b), up = d.dot(u);
        if (Math.abs(s) < w && Math.abs(up) < h && Math.abs(d.dot(n)) < slot.depth && nrm.normalize().dot(n) > 0.5) hits.push(t, s, up);
      }
  }
  const keep = []; for (let k = 0; k < hits.length; k += 3) if (!shared[hits[k]]) keep.push(k);
  return {idx: Int32Array.from(keep, k => hits[k]), s: Float32Array.from(keep, k => hits[k + 1]), t: Float32Array.from(keep, k => hits[k + 2])};
}

const css = c => `#${new THREE.Color(c).getHexString()}`;
// light text on dark paint and dark on light
export const inkFor = paint => { const c = new THREE.Color(paint); return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 0.45 ? 0x111418 : 0xf4f4f4; };

// The car's paint texture: transparent (the paint shader draws the livery, cars3d.js), with the race number (if any) baked
// into the slot's texels in `ink`, its alpha marking where.
function paintTexture(ink, num, size = PAINT_SIZE) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), accent = ink;
  if (num !== null && num !== undefined) {
    const PX = 800, lw = Math.ceil(NUMBER.w * PX), lh = Math.ceil(NUMBER.h * PX), label = document.createElement('canvas');
    label.width = lw; label.height = lh;
    const l = label.getContext('2d'), font = px => `900 italic ${px}px "Titillium Web", system-ui, sans-serif`;
    let px = lh * 0.8; l.font = font(px);
    px = Math.min(px, px * lw * 0.94 / l.measureText(String(num)).width); l.font = font(px);
    l.fillStyle = css(accent); l.textAlign = 'center'; l.textBaseline = 'middle'; l.fillText(String(num), lw / 2, lh / 2);
    const src = l.getImageData(0, 0, lw, lh).data, image = ctx.getImageData(0, 0, size, size), out = image.data, {idx, s, t} = texels;
    for (let i = 0; i < idx.length; i++) {
      const x = Math.min(lw - 1, Math.floor((s[i] / NUMBER.w + 0.5) * lw)), y = Math.min(lh - 1, Math.floor((0.5 - t[i] / NUMBER.h) * lh));
      const q = (y * lw + x) * 4, o = idx[i] * 4;
      for (let k = 0; k < 4; k++) out[o + k] = src[q + k];  // ink, and its coverage as alpha
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  Object.assign(texture, {colorSpace: THREE.SRGBColorSpace, flipY: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: 16});
  // uploaded once, never redrawn: the canvas (4 MB a car, 88 MB for a 2026 grid) can go once it's on the GPU
  texture.onUpdate = () => { canvas.width = canvas.height = 0; };
  return texture;
}

// The LCD's own uv picks a photo out of an atlas: stretch the whole canvas over it instead, as the driver sees it
function screenUv(geometry) {
  const {min, max} = geometry.boundingBox, P = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < P.count; i++) uv.setXY(i, (max.x - P.getX(i)) / (max.x - min.x), (P.getY(i) - min.y) / (max.y - min.y));
  uv.needsUpdate = true;
}

// One screen for every car: only the focused car's is ever close enough to read, and that's whose readings it draws
let screen = null;
function screenMaterial() {
  if (screen) return screen;
  const map = new THREE.CanvasTexture(dashCanvas());
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  dash.drawn = () => { map.needsUpdate = true; };
  return screen = new THREE.MeshBasicNodeMaterial({name: 'wheel-screen', map, fog: false});
}

// The steering wheel's decal texture without its two ORACLE logos, as [x0, y0, x1, y1] fractions of the image.
const WHEEL_LOGOS = [[250 / 1024, 934 / 1024, 770 / 1024, 1008 / 1024], [976 / 1024, 704 / 1024, 1010 / 1024, 890 / 1024]];
const WHEEL_DECALS = new WeakMap();  // source texture -> cleaned copy, shared by every car
function wheelDecals(map) {
  if (!map?.image) return map;
  if (!WHEEL_DECALS.has(map)) {
    const {width: w, height: h} = map.image, canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.drawImage(map.image, 0, 0);
    for (const [x0, y0, x1, y1] of WHEEL_LOGOS) ctx.clearRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
    const texture = new THREE.CanvasTexture(canvas);
    for (const k of ['colorSpace', 'flipY', 'wrapS', 'wrapT', 'anisotropy', 'channel']) texture[k] = map[k];
    WHEEL_DECALS.set(map, texture);
  }
  return WHEEL_DECALS.get(map);
}

// ---------- one car ----------

// paint: the car's own paint material (cars3d.js's livery paint; this adds the race number as its map);
// accent: the livery's accent (trim, helmet band); ink: the number's colour; helmet: colour; num: race number or null;
// stripe / light: materials shared with the far LOD level (tyre-compound rings, rear light). Call only once rb22Ready().
// Returns {group, body, halo, paintMesh, wheels: [{pivot, spin, front}], steeringWheel, mirrors, discs (brake-glow
// materials), tyre: [r, w], len, wb, width, eye, look, tcam, tcamLook, exhaust, plank, fronts, hubs, pose (the driver's
// arms to the steering wheel's angle), dispose}.
export function buildRB22({paint, accent, ink, helmet, num, stripe, light}) {
  const car = new THREE.Group(), root = template.clone(true), own = [];
  root.rotation.y = Math.PI / 2;  // model nose +z, left +x -> car nose +x, right +z
  car.add(root);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  let paintMesh; root.traverse(o => { if (o.isMesh && o.material.name.startsWith('redbull_paint')) paintMesh = o; });
  texels ??= slotTexels(paintMesh, NUMBER);
  Object.assign(paint, {map: paintTexture(ink, num), side: THREE.DoubleSide});
  own.push(paint, paint.map);
  const accentMats = new Map(), discMats = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    const name = o.material.name;
    if (name.startsWith('redbull_paint')) o.material = paint;
    else if (name.startsWith('redbull_decals') || name.startsWith('redbull_number')) o.visible = false;  // Red Bull's logos, #1
    else if (name.startsWith('redbull_color')) {  // the yellow trim takes the accent colour, matte like the paint
      if (!accentMats.has(o.material)) accentMats.set(o.material, Object.assign(o.material.clone(), {color: new THREE.Color(accent), metalness: 0, roughness: 0.45}));
      o.material = accentMats.get(o.material);
    } else if (name.startsWith('discs')) {  // the model's disc texture, glowing per car under braking
      if (!discMats.has(o.material)) discMats.set(o.material, brakeMat(o.material));
      o.material = discMats.get(o.material);
    } else if (o.name === 'rain-light') o.material = light;  // flashes with ERS harvesting and in the wet
    else if (name.startsWith('sw_decals')) own.push(o.material = Object.assign(o.material.clone(), {map: wheelDecals(o.material.map)}));
    else if (name.startsWith('gp21_LCD')) o.material = screenMaterial();
    if (o.name.startsWith('mirror-')) o.geometry = o.geometry.clone();  // the mirror stretches its glass per car
  });
  own.push(...accentMats.values(), ...discMats.values());

  // position: length centred on the origin, the bottoms of the tyres on y = 0
  const box = o => { car.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
  const all = box(root), ground = Math.min(...CORNERS.map(n => box(root.getObjectByName(n)).min.y));
  root.position.set(-(all.min.x + all.max.x) / 2, -ground, 0);

  // Wheels: the whole corner (tyre, rim, disc) spins about its hub on the wheel's own axle (the fronts are modelled
  // with camber); the front pivots steer about y. The compound ring sits on each sidewall, on the spinning part.
  const hubs = [];
  const wheels = CORNERS.map((name, i) => {
    const node = root.getObjectByName(name), b = box(node), hub = b.getCenter(new THREE.Vector3());
    const r = (b.max.y - b.min.y) / 2, w = b.max.z - b.min.z;
    hubs.push([hub.x, hub.z, r, w]);
    const pivot = new THREE.Group(); pivot.position.copy(hub); car.add(pivot);
    const axle = new THREE.Group(); axle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axleOf(node)); pivot.add(axle);
    const spin = new THREE.Group(); axle.add(spin); car.updateMatrixWorld(true);
    spin.attach(node);
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.075, 0.009, 6, 48), stripe);
      ring.position.z = side * (w / 2 - 0.004);
      spin.add(ring);
    }
    return {pivot, spin, front: i < 2};
  });

  // steering wheel turns about its column (rotation.x), brought 12 cm back toward the driver
  const steer = root.getObjectByName('steering'), sc = box(steer).getCenter(new THREE.Vector3());
  const steeringWheel = new THREE.Group(); steeringWheel.position.copy(sc); car.add(steeringWheel); car.updateMatrixWorld(true);
  steeringWheel.attach(steer);
  steeringWheel.position.x -= 0.12;

  // the model has no driver: ours sits behind the steering wheel, hands on its grips (driver.js)
  const head = new THREE.Vector3(sc.x - 0.62, 0.70 - ground, 0);  // in front of the roll hoop, chest under the model's belts
  const driver = seatDriver(car, steeringWheel, head, {helmet, accent, suit: paint.userData.uBase.value});
  own.push(...driver.materials);

  // the sprung body: everything but the wheels, so it can roll, pitch and heave over them
  const body = new THREE.Group(), pivots = new Set(wheels.map(w => w.pivot));
  car.children.filter(o => !pivots.has(o)).forEach(o => body.add(o));
  car.add(body);

  const fin = box(body), fx = hubs[0][0], rx = hubs[2][0];
  const eye = new THREE.Vector3(sc.x - 0.55, head.y + 0.07, 0);
  const tcam = new THREE.Vector3(sc.x - 1.1, fin.max.y + 0.06, 0);
  const lamp = box(root).min.x;  // the tail of the car, where the rain light sits
  // frees what this car owns (the template's baked geometry and materials are shared and kept); the stripe and light
  // materials belong to the far level
  const dispose = () => {
    for (const x of own) x.dispose();
    car.traverse(o => {
      o.userData.disposeMirror?.();
      if (o.isMesh && (o.name.startsWith('mirror-') || o.geometry.type !== 'BufferGeometry')) o.geometry.dispose();  // clones, rings
    });
  };
  return {group: car, body, halo: new THREE.Group(), paintMesh, wheels, steeringWheel, mirrors: MIRRORS.map(n => root.getObjectByName(n)), discs: [...discMats.values()],
          tyre: [hubs[0][2], hubs[0][3]], len: all.max.x - all.min.x, wb: fx - rx, width: all.max.z - all.min.z, hubs,
          eye, look: new THREE.Vector3(eye.x + 15, 0.55, 0), tcam, tcamLook: new THREE.Vector3(tcam.x + 15, 0.4, 0),
          exhaust: new THREE.Vector3(lamp + 0.1, 0.42, 0), plank: [rx + 0.2, fx - 1.0],
          fronts: hubs.slice(0, 2).map(([x, z]) => new THREE.Vector3(x, 0.05, z)), pose: driver.pose, head: driver.head, dispose};
}
