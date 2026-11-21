// Street circuits' city: instanced blocks of flats, offices and towers behind the barriers, where a park circuit has
// trees. One draw call for the lot. The facade is a shader over world position (metres), so a block of any size gets
// storeys every 3.4 m and window bays every 1.8 m without stretching; roofs are plain concrete. A night sky lights a share
// of the windows (night()).
import * as THREE from 'three';
import {Fn, uniform, attribute, positionWorld, normalWorld, vec2, vec3, float, floor, fract, abs, step, mix} from 'three/tsl';
import {noise} from './track3d.js';

// facade tones: render, stone, brick, concrete, glass curtain walls (tone > 0.8 reads as all glass)
const TONES = [[0.62, 0.58, 0.52], [0.7, 0.69, 0.66], [0.5, 0.4, 0.32], [0.44, 0.45, 0.47], [0.56, 0.53, 0.47]];

// p3: the road's centre points (scene); far(x, z, r): true when a footprint of radius r there keeps clear of the track;
// groundAt(x, z): terrain height; tall: allow towers (100-190 m). Returns {mesh, night(v), clearOf(blocked(x, z, r))}.
export function buildCity({p3, far, groundAt, m, mps, rand, tall, count = 320}) {
  const items = [], mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  for (let tries = 0; tries < count * 6 && items.length < count; tries++) {
    const i = Math.floor(rand() * p3.length), p = p3[i], nb = p3[(i + 1) % p3.length];
    const side = rand() < 0.5 ? -1 : 1, dist = m(22 + rand() ** 1.6 * 260);
    const tx = nb.x - p.x, tz = nb.z - p.z, tl = Math.hypot(tx, tz) || 1;
    const x = p.x - side * tz / tl * dist, z = p.z + side * tx / tl * dist;
    const w = m(14 + rand() * 26), d = m(12 + rand() * 22), r = Math.hypot(w, d) / 2;
    if (!far(x, z, r) || items.some(b => (b.x - x) ** 2 + (b.z - z) ** 2 < (b.r + r + m(4)) ** 2)) continue;
    // low near the road, higher behind it; a few towers further back where the city has them
    const h = tall && dist > m(90) && rand() < 0.18 ? m(100 + rand() * 90) : m(10 + rand() * (dist > m(60) ? 45 : 18));
    // square to the road it lines, as a city block is
    items.push({x, z, r, w, d, h, a: Math.atan2(tx, tz), tone: rand()});
  }
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  geo.setAttribute('tone', new THREE.InstancedBufferAttribute(Float32Array.from(items, b => b.tone), 1));
  const lit = uniform(0), mat = new THREE.MeshStandardNodeMaterial({roughness: 0.85});
  const tone = attribute('tone', 'float'), wm = positionWorld.mul(mps), nw = normalWorld;
  const wall = step(abs(nw.y), 0.5), across = mix(wm.x, wm.z, step(0.5, abs(nw.x)));
  const cell = vec2(across.div(1.8), wm.y.div(3.4)), f = fract(cell), id = floor(cell);
  const glassy = step(0.8, tone);  // curtain wall: nearly all glass, thin mullions
  const win = mix(step(0.12, f.x).mul(step(f.x, 0.88)).mul(step(0.3, f.y)).mul(step(f.y, 0.9)),
                  step(0.06, f.x).mul(step(0.08, f.y)), glassy).mul(wall);
  const pick = i => vec3(...TONES[i]);
  const facade = mix(mix(mix(pick(0), pick(1), step(0.2, tone)), mix(pick(2), pick(3), step(0.5, tone)), step(0.35, tone)), pick(4), step(0.65, tone));
  // roofs: concrete
  const glass = mix(vec3(0.05, 0.07, 0.09), vec3(0.09, 0.13, 0.17), noise(id.mul(0.37).add(tone.mul(91))));
  mat.colorNode = Fn(() => mix(mix(vec3(0.32, 0.32, 0.31), facade, wall), glass, win))();
  mat.roughnessNode = mix(float(0.85), float(0.12), win);
  mat.metalnessNode = win.mul(0.6);
  // at night about a quarter of the windows lit, warm or cool, each its own
  const on = step(0.7, noise(id.add(tone.mul(173)).mul(1.37)));
  mat.emissiveNode = mix(vec3(1, 0.78, 0.5), vec3(0.75, 0.85, 1), step(0.5, noise(id.mul(2.1).add(5)))).mul(win).mul(on).mul(lit).mul(0.9);
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  items.forEach((b, k) => {
    q.setFromAxisAngle(UP, b.a);
    mesh.setMatrixAt(k, mtx.compose(new THREE.Vector3(b.x, groundAt(b.x, b.z) - m(2), b.z), q, new THREE.Vector3(b.w, b.h + m(2), b.d)));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return {
    mesh,
    inside: (x, z) => items.some(b => (b.x - x) ** 2 + (b.z - z) ** 2 < b.r * b.r),
    night: v => { lit.value = Math.min(1, v / 8); },  // scene3d's lamps: 8 under the night sky, 0 by day
    // blocks standing where blocked(x, z, r) says go (a pit lane, its garages) are removed (zero-scale instances)
    clearOf(blocked) {
      const none = new THREE.Matrix4().makeScale(0, 0, 0);
      items.forEach((b, k) => { if (blocked(b.x, b.z, b.r)) mesh.setMatrixAt(k, none); });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
