// Repeated trackside furniture as instanced meshes: catch-fence stanchions, Tecpro corner blocks, braking boards, floodlight
// towers and grandstands. A circuit has thousands of these; instancing makes each kind one draw call. Everything is placed
// from the road frames (circuit3d.js frames: P centre, T along, N left, B up), in scene units through m().
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {normalGeometry, positionGeometry, step, vec3, mix} from 'three/tsl';
import {noise} from './track3d.js';

const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1), basis = new THREE.Matrix4();

// count instances of geometry at items [{p: Vector3, f: road frame (the object faces along it), color?}]
function instanced(geometry, material, items, {shadow = true} = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  items.forEach(({p, f, color}, i) => {
    // the object's +z points back along the road, towards the traffic coming at it, its +y up the road's normal
    basis.makeBasis(f.N, f.B, f.T.clone().negate());
    quat.setFromRotationMatrix(basis);
    mesh.setMatrixAt(i, mtx.compose(p, quat, scale));
    if (color) mesh.setColorAt(i, color);
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();  // or the renderer culls by the geometry alone, at the world's origin
  return mesh;
}

function boardTexture(text) {
  const c = Object.assign(document.createElement('canvas'), {width: 128, height: 128}), g = c.getContext('2d');
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111';
  g.font = '700 58px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  return Object.assign(new THREE.CanvasTexture(c), {colorSpace: THREE.SRGBColorSpace, anisotropy: 8});
}

// F: road frames; runs: corner runs (arrays of frames); half: half width; wall: barrier distance from the kerb, scene units
export function buildTrackside({F, runs, half, wall, m, armco}) {
  const made = [], n = F.length;
  const dist = new Float32Array(n);
  for (let i = 1; i < n; i++) dist[i] = dist[i - 1] + F[i].P.distanceTo(F[i - 1].P);
  // off the road: a tower on the inside of one straight may stand on the track of another
  const every = Math.max(1, Math.floor(m(40) / (dist[n - 1] / n)));
  const clear = (p, margin) => {
    for (let i = 0; i < n; i += every) if (Math.hypot(F[i].P.x - p.x, F[i].P.z - p.z) < half + margin) return false;
    return true;
  };
  const at = (f, lateral, up = 0) => f.P.clone().addScaledVector(f.N, lateral).addScaledVector(f.B, up);
  const steel = new THREE.MeshStandardNodeMaterial({color: 0x8d9299, metalness: 0.75, roughness: 0.4});

  // Tecpro: foam blocks in the run-off's firing line, on the outside of each corner, red and white in turn
  if (!armco) {
    const tecpro = new THREE.MeshStandardNodeMaterial({color: 0xffffff, roughness: 0.75});
    const red = new THREE.Color(0xb3202a), white = new THREE.Color(0xe8e8e8), items = [];
    for (const run of runs) {
      if (run.length < 4) continue;
      // the corner's outside: away from where the run's middle bends to
      const a = run[0], mid = run[run.length >> 1], side = Math.sign(mid.P.clone().sub(a.P).dot(a.N)) || 1;
      let last = -Infinity, k = 0;
      for (const f of run) {
        const d = dist[F.indexOf(f)];
        if (d - last < m(1.6)) continue;
        last = d;
        items.push({p: at(f, -side * (half + wall - m(0.7)), m(0.5)), f, color: k++ % 2 ? red : white});
      }
    }
    if (items.length) made.push(instanced(new THREE.BoxGeometry(m(0.9), m(1), m(1.5)), tecpro, items));
  }

  // braking boards 150, 100 and 50 m before every corner reached by a straight long enough to need them
  const boardMats = [];
  for (const metres of [150, 100, 50]) {
    const items = [];
    for (let r = 0; r < runs.length; r++) {
      const start = F.indexOf(runs[r][0]), prevEnd = F.indexOf(runs[(r - 1 + runs.length) % runs.length].at(-1));
      const straight = (dist[start] - dist[prevEnd] + dist[n - 1]) % dist[n - 1];
      if (straight < m(220)) continue;
      let i = start;
      for (let guard = 0; guard < n; guard++) {
        const j = (i - 1 + n) % n;
        if ((dist[start] - dist[j] + dist[n - 1]) % dist[n - 1] >= m(metres)) { i = j; break; }
        i = j;
      }
      const f = F[i], lat = half + m(2.5), p = at(f, lat, m(1.4));
      if (clear(p, m(1))) items.push({p, f});
    }
    if (!items.length) continue;
    const mat = new THREE.MeshStandardNodeMaterial({map: boardTexture(String(metres)), roughness: 0.6});
    boardMats.push(mat);
    made.push(instanced(new THREE.BoxGeometry(m(1.3), m(1.3), m(0.08)), mat, items));
  }
  const poles = [];
  for (let d = 0, i = 0; i < n; i++) if (dist[i] >= d) { poles.push(i); d += m(420); }

  // floodlight towers beside the track; their lamps stay off until a night sky turns them on
  const lamp = new THREE.MeshStandardNodeMaterial({color: 0x20242c, emissive: 0xfff2d8, emissiveIntensity: 0});
  const towers = poles.map((i, k) => ({p: at(F[i], (k % 2 ? 1 : -1) * (half + wall + m(14)), 0), f: F[i]})).filter(t => clear(t.p, m(8)));
  if (towers.length) {
    made.push(instanced(new THREE.CylinderGeometry(m(0.22), m(0.35), m(26), 8).translate(0, m(13), 0), steel, towers));
    made.push(instanced(new THREE.BoxGeometry(m(5), m(1.6), m(0.5)).translate(0, m(26), 0), lamp, towers, {shadow: false}));
  }

  // grandstands on the outside of the corners with the longest approach, and along the start straight: stepped tiers, the
  // crowd a coloured noise on them (each spectator is under a pixel from anywhere a camera goes)
  const stands = [];
  const tiers = Array.from({length: 7}, (_, k) => new THREE.BoxGeometry(m(44), m(1.2 + k * 1.5), m(2.6)).translate(0, m((1.2 + k * 1.5) / 2 - 1), -m(k * 2.4)));
  const standGeo = mergeGeometries(tiers);
  tiers.forEach(t => t.dispose());
  const crowd = new THREE.MeshStandardNodeMaterial({roughness: 0.9});
  {
    // treads (normal up) are people in bright clothes on team-coloured seats, risers and ends are concrete
    // blocks of a few seats, hard-edged: a single spectator is under a pixel, and fine noise averaged out to flat beige
    const c = positionGeometry.div(m(1.4)), pick = (n, at) => step(at, noise(c.xz.mul(n).add(n * 7)));
    const people = mix(mix(vec3(0.04, 0.06, 0.12), vec3(0.6, 0.05, 0.05), pick(1, 0.5)), mix(vec3(0.72, 0.7, 0.62), vec3(0.8, 0.5, 0.05), pick(0.6, 0.5)), pick(1.3, 0.6));
    crowd.colorNode = mix(vec3(0.19, 0.2, 0.21), people, step(0.5, normalGeometry.y));
  }
  // the roof, on columns along the back: a white canopy reads from the air as a grandstand, not a block
  const roofParts = [new THREE.BoxGeometry(m(46), m(0.35), m(20)).rotateX(0.06).translate(0, m(15.5), -m(7))];
  for (let k = -2; k <= 2; k++) roofParts.push(new THREE.BoxGeometry(m(0.5), m(16), m(0.5)).translate(k * m(10.5), m(7.5), -m(16.2)));
  const roofGeo = mergeGeometries(roofParts);
  roofParts.forEach(t => t.dispose());
  const roofMat = new THREE.MeshStandardNodeMaterial({color: 0xc9ced4, metalness: 0.3, roughness: 0.55});
  const addStand = (f, side) => {
    const p = at(f, side * (half + wall + m(30)), m(0.2)), rotated = {N: f.T.clone().multiplyScalar(side), B: f.B, T: f.N.clone().multiplyScalar(-side)};
    if (clear(p, m(26))) stands.push({p, f: rotated});
  };
  addStand(F[Math.floor(n * 0.01)], 1);
  addStand(F[Math.floor(n * 0.985)], 1);
  runs.forEach((run, r) => { if (r % 3 === 0 && run.length > 3) addStand(run[run.length >> 1], -Math.sign(run[run.length >> 1].P.clone().sub(run[0].P).dot(run[0].N)) || 1); });
  if (stands.length) made.push(instanced(standGeo, crowd, stands), instanced(roofGeo, roofMat, stands));

  const stanchionGeo = new THREE.CylinderGeometry(m(0.05), m(0.05), m(4.1), 6).translate(0, m(2.05), 0);
  let posts = null;
  return {
    meshes: made,
    // offs: barrier offset per frame per side, null where it opens; pitLane moves them, so the posts follow
    stanchions(world, offs) {
      if (posts) { world.remove(posts); posts.dispose(); }
      const items = [];
      for (const o of offs) {
        let last = -Infinity;
        for (let i = 0; i < n; i++) {
          if (o[i] === null || dist[i] - last < m(8)) continue;
          last = dist[i];
          items.push({p: at(F[i], o[i]), f: F[i]});
        }
      }
      posts = instanced(stanchionGeo, steel, items);
      posts.layers.set(1);  // with the fence they carry
      world.add(posts);
    },
    night: v => { lamp.emissiveIntensity = v; },
    dispose(world) {
      if (posts) { world.remove(posts); posts.dispose(); }
      stanchionGeo.dispose();
      standGeo.dispose();
      roofGeo.dispose();
      roofMat.dispose();
      for (const o of made) { world.remove(o); o.geometry.dispose(); o.dispose(); }
      for (const mat of boardMats) { mat.map.dispose(); mat.dispose(); }
      steel.dispose(); lamp.dispose(); crowd.dispose();
    },
  };
}
