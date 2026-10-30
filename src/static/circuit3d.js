// The circuit in 3D: asphalt, lines, kerbs, gravel, barriers, terrain, trees, start gantry and landmarks, extruded along
// the outline with its real elevation and banking (circuits.js annotate). Map coordinates (x right, y down) become the
// ground plane (scene x, z); heights become scene y. One instance per track; dispose() frees it on a circuit switch.
import * as THREE from 'three';
import {CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {asphalt, NOISE} from './track3d.js';
import {racingLine} from './sim.js';
import {garages} from './pit3d.js';

const UP = new THREE.Vector3(0, 1, 0);
let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;  // seeded so scenery doesn't move between loads

// Road frame at each outline point. T: unit tangent of the 3D centre line (so it includes the grade); N0: the
// horizontal lateral direction, normalise(UP x T), pointing left of travel; banking then rotates the cross-section about
// T by the roll angle phi (Rodrigues' rotation; N0 is perpendicular to T so the T(T.v) term vanishes):
//   N = N0 cos(phi) + (T x N0) sin(phi)        B = T x N  (the road surface's up)
// With phi > 0 the left side rises, i.e. the road falls towards the right: positive camber for a right-hander.
// Using N0 from the fixed world up rather than the curve's own Frenet normal keeps the frame from flipping on straights
// and twisting through S-bends: it is the rotation-minimising frame a road (whose sideways direction is set by gravity,
// not by curvature) actually has.
function frames(p3, bank) {
  const n = p3.length;
  return p3.map((P, i) => {
    const T = p3[(i + 1) % n].clone().sub(p3[(i - 1 + n) % n]).normalize();
    const N0 = new THREE.Vector3().crossVectors(UP, T).normalize(), TxN0 = new THREE.Vector3().crossVectors(T, N0);
    const N = N0.clone().multiplyScalar(Math.cos(bank[i])).addScaledVector(TxN0, Math.sin(bank[i]));
    return {P, T, N0, N, B: new THREE.Vector3().crossVectors(T, N)};
  });
}

// The outline densified to segments of at most STEP metres along a closed centripetal Catmull-Rom curve through its
// points, heights included (centripetal: no overshoot where the 1-20 m spacing is uneven). The outline's own points stay
// on it. A straight road between the original points changed grade abruptly at every one of them, jolting a car by up
// to ~5 cm in a frame over the sharpest crests; the curve's grade changes gradually. ann's per-point arrays follow:
// banking interpolated, kerb types from the nearer original point, the tunnel's range remapped. src[d] = [i, f]: dense
// point d lies a fraction f of the way from original point i to i + 1, for values computed per original point.
const STEP = 2.5;
function densify(P, ann, mps) {
  const n = P.length, curve = new THREE.CatmullRomCurve3(P, true, 'centripetal'), p3 = [], bank = [], kerb = [], src = [], at = [];
  for (let i = 0; i < n; i++) {
    const k = Math.max(1, Math.ceil(P[i].distanceTo(P[(i + 1) % n]) * mps / STEP));
    at.push(p3.length);
    for (let j = 0; j < k; j++) {
      p3.push(j ? curve.getPoint((i + j / k) / n) : P[i]);
      bank.push(ann.bank[i] + (ann.bank[(i + 1) % n] - ann.bank[i]) * j / k);
      kerb.push(ann.kerb[j / k < 0.5 ? i : (i + 1) % n]);
      src.push([i, j / k]);
    }
  }
  return {p3, src, ann: {...ann, bank, kerb, tunnel: ann.tunnel && ann.tunnel.map(i => at[i])}};
}

// strip between lateral offsets a and b (scene units, + = left) lying on the road surface, lifted y off it; or, with
// `height`, a vertical wall standing at offset a (a number, or one per point). Closed loops repeat the first point so
// the texture doesn't wrap back.
function strip(F, a, b, y, material, closed, tileM, mps, height = 0) {
  const count = closed ? F.length + 1 : F.length, pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i < count; i++) {
    const f = F[i % F.length];
    if (i) dist += f.P.distanceTo(F[(i - 1) % F.length].P);
    const v = dist * mps / tileM;
    const A = f.P.clone().addScaledVector(f.N, Array.isArray(a) ? a[i % F.length] : a).addScaledVector(f.B, y);
    if (height) {
      const top = A.clone().addScaledVector(UP, height);
      pos.push(A.x, A.y, A.z, top.x, top.y, top.z);
      uv.push(v, 0, v, 1);
    } else {
      const Bp = f.P.clone().addScaledVector(f.N, b).addScaledVector(f.B, y);
      pos.push(A.x, A.y, A.z, Bp.x, Bp.y, Bp.z);
      uv.push(0, v, Math.abs(b - a) * mps / tileM, v);
    }
    if (i < count - 1) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}

// runs of consecutive outline points that are part of a corner (radius under ~130 m), for kerbs and gravel traps
function cornerRuns(F, mps) {
  const n = F.length, hot = F.map((f, i) => {
    const a = F[(i - 1 + n) % n].P, b = f.P, c = F[(i + 1) % n].P;
    const d = Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x), turn = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    const seg = (a.distanceTo(b) + b.distanceTo(c)) / 2 * mps;
    return seg > 0 && turn / seg > 1 / 130;
  });
  const runs = [];
  let run = [];
  for (let i = 0; i < n; i++) {
    if (hot[i] || hot[(i + 1) % n] || hot[(i - 1 + n) % n]) run.push(F[i]);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.filter(r => r.length > 1);
}

// opts: {pts (map coords), map {k, cx, cy, mps}, tex, width (m), startKnown, ann (circuits.js annotate), corners:
// [[x, y, number]] label positions, SIZE}. Builds into `world`; returns the circuit's handles.
export function buildCircuit(world, {pts, map, tex, width, startKnown, ann, corners, SIZE}) {
  const m = metres => metres / map.mps, w = m(width), half = w / 2, wall = m(ann.wall);
  const flat = ([x, y]) => new THREE.Vector3((x - map.cx) * map.k, 0, (y - map.cy) * map.k);
  const dense = densify(pts.map((p, i) => flat(p).setY(m(ann.h[i]))), ann, map.mps), p3 = dense.p3;
  ann = dense.ann;
  const F = frames(p3, ann.bank), owned = [], wettable = [], every = Math.max(1, Math.round(F.length / pts.length));
  // maps: {map, normalMap, roughnessMap} or null
  const mat = (maps, color = 0xffffff, extra = {}) => {
    const x = new THREE.MeshStandardMaterial({...maps, color, roughness: 0.9, side: THREE.DoubleSide, ...extra});
    wettable.push(x);
    return x;
  };
  const add = obj => { world.add(obj); owned.push(obj); return obj; };

  // --- terrain: a grid whose height is the inverse-distance-weighted (w = 1 / d^2) height of the track, so the land
  // rises and falls with the circuit; taken from under the lowest edge of the banked cross-section (h - reach |sin
  // phi|) and 0.4 m lower again, so grass never pokes through a cambered road. Away from the track (150-600 m) it
  // turns into rolling countryside, up to ~25 m of low-frequency hills. ---
  const reach = half + wall + m(3), floor = F.map(f => [f.P.x, f.P.z, f.P.y - reach * Math.abs(f.N.y) - m(0.4)]);
  // x, z, h of every 4th point, flat: ~58,000 grid vertices x ~1,000 points, ~20x faster than destructuring [x, z, h]s
  const ref = Float64Array.from(floor.filter((_, i) => i % (4 * every) === 0).flat());
  const hills = (x, z) => m(25) * (0.5 * Math.sin(x / m(310) + 1.3) * Math.cos(z / m(270)) + 0.3 * Math.sin((x + z) / m(170))
                                   + 0.2 * Math.cos((x - 2 * z) / m(120)));
  const terrainH = (x, z) => {
    let sw = 0, sh = 0, near = Infinity;
    for (let k = 0; k < ref.length; k += 3) {
      const dx = ref[k] - x, dz = ref[k + 1] - z, d2 = dx * dx + dz * dz, q = 1 / (d2 + 1);
      sw += q; sh += q * ref[k + 2];
      if (d2 < near) near = d2;
    }
    return sh / sw + THREE.MathUtils.smoothstep(Math.sqrt(near), m(150), m(600)) * hills(x, z);
  };
  // S x S cells over +-3 SIZE: a uniform core of ~8-unit cells over the circuit (|x| < 0.7 SIZE), growing quadratically
  // out to the horizon. warp maps grid coordinate u in [-1, 1] to scene units, unwarp is its inverse.
  const S = 240, CORE = SIZE * 0.7, EDGE = SIZE * 3, kc = CORE / 3, kq = EDGE - CORE - kc, cell = CORE / (0.375 * S);
  const warp = u => { const a = Math.abs(u), t = (a - 0.75) * 4; return Math.sign(u) * (a <= 0.75 ? a / 0.75 * CORE : CORE + kc * t + kq * t * t); };
  const unwarp = x => {
    const a = Math.min(Math.abs(x), EDGE);
    return Math.sign(x) * (a <= CORE ? a / CORE * 0.75 : 0.75 + (Math.sqrt(kc * kc + 4 * kq * (a - CORE)) - kc) / (2 * kq) / 4);
  };
  // A grid vertex never stands above the road anywhere within a cell diagonal (+ the cross-section's reach) of it, so
  // no flat triangle can bridge over a dip in the road (Eau Rouge, the Spoon); where the road climbs a hillside this
  // cuts it into the slope. Buckets of side D find the road points near a vertex.
  const D = cell * Math.SQRT2 + reach, buckets = new Map(), key = (i, j) => i * 100003 + j;
  for (const r of floor) {
    const k = key(Math.floor(r[0] / D), Math.floor(r[1] / D));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(...r);  // flat x, z, h, as ref above
  }
  const clampH = (x, z, h) => {
    const bi = Math.floor(x / D), bj = Math.floor(z / D);
    for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++) {
      const b = buckets.get(key(i, j));
      if (b) for (let k = 0; k < b.length; k += 3) if ((b[k] - x) ** 2 + (b[k + 1] - z) ** 2 < D * D && b[k + 2] < h) h = b[k + 2];
    }
    return h;
  };
  const ground = new THREE.PlaneGeometry(2, 2, S, S).rotateX(-Math.PI / 2), gp = ground.attributes.position, guv = ground.attributes.uv;
  const H = new Float32Array(gp.count);
  for (let i = 0; i < gp.count; i++) {
    const x = warp(gp.getX(i)), z = warp(gp.getZ(i));
    gp.setXYZ(i, x, H[i] = clampH(x, z, terrainH(x, z)), z);
    guv.setXY(i, x / (2 * EDGE) + 0.5, 0.5 - z / (2 * EDGE));
  }
  ground.computeVertexNormals();
  ground.computeBoundingSphere();
  tex.grass.repeat.set(EDGE * 2 * map.mps / 50, EDGE * 2 * map.mps / 50);  // one 50 m tile
  for (const k of ['normalMap', 'roughnessMap']) tex.ground[k].repeat.setScalar(EDGE * 2 * map.mps / 3);  // the photo is 3 m across
  // the 50 m tile alone is one flat green from any height: world-space noise at ~160 m and ~40 m adds lush and dry
  // patches (darker blue-green, lighter straw), so the land reads at overview and helicopter distances
  // Satellite imagery (satellite()) replaces that over the area it covers, fading out at its edges; the grass tile's
  // grain stays on it as fine detail the ~1 m imagery can't show up close.
  // tufts and soil in the light from a photographed ground's normal and roughness (textures3d.js ground), under any colour
  const grass = mat({map: tex.grass, normalMap: tex.ground.normalMap, roughnessMap: tex.ground.roughnessMap},
                    0xffffff, {normalScale: new THREE.Vector2(0.9, 0.9)});
  Object.assign(grass.userData, {sat: {value: null}, satM: {value: new THREE.Matrix3()}, satOn: {value: 0}, satMean: {value: new THREE.Color()}});
  grass.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, {uMps: {value: map.mps}, uSat: grass.userData.sat, uSatM: grass.userData.satM, uSatOn: grass.userData.satOn,
                              uSatMean: grass.userData.satMean});
    sh.vertexShader = 'varying vec2 vGround;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;');
    sh.fragmentShader = `uniform float uMps, uSatOn;\nuniform sampler2D uSat;\nuniform mat3 uSatM;\nuniform vec3 uSatMean;\nvarying vec2 vGround;\n${NOISE}\n`
      + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec2 gm = vGround * uMps;  // metres
      float patches = 0.7 * noise(gm / 160.0) + 0.3 * noise(gm / 40.0 + 17.0);
      vec3 patchTint = mix(vec3(0.84, 0.88, 0.84), vec3(1.08, 1.04, 0.86), smoothstep(0.15, 0.85, patches));
      diffuseColor.rgb *= patchTint;
      vec2 suv = (uSatM * vec3(vGround, 1.0)).xy;
      vec3 sat = texture2D(uSat, suv).rgb;  // outside any branch: mip selection needs derivatives
      float grain = clamp(dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / 0.16, 0.8, 1.2);
      float cover = uSatOn * smoothstep(0.0, 0.08, min(min(suv.x, 1.0 - suv.x), min(suv.y, 1.0 - suv.y)));
      vec3 around = mix(diffuseColor.rgb, uSatMean * grain * patchTint, uSatOn);  // beyond the image: its mean colour
      diffuseColor.rgb = mix(around, sat * grain, cover);`);
  };
  grass.customProgramCacheKey = () => 'grass';
  add(new THREE.Mesh(ground, grass)).receiveShadow = true;
  // height of the terrain mesh under scene (x, z): bilinear between the grid vertices (row j = z, column i = x)
  const groundAt = (x, z) => {
    const fx = (unwarp(x) + 1) / 2 * S, fz = (unwarp(z) + 1) / 2 * S;
    const i = Math.min(S - 1, Math.max(0, Math.floor(fx))), j = Math.min(S - 1, Math.max(0, Math.floor(fz))), u = fx - i, v = fz - j;
    const at = (a, b) => H[(j + b) * (S + 1) + i + a];
    return (at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v;
  };

  // --- asphalt, run-off, lines, kerbs, gravel, barriers ---
  const runoff = Math.min(m(5), wall);  // Monaco's barriers stand at the edge: run-off is just the gap to them
  add(strip(F, -half - runoff, half + runoff, 0.01, mat(tex.asphalt, 0x9a958a), true, 4, map.mps));
  const trackMat = asphalt(tex.asphalt, width / 2), track = add(strip(F, -half, half, 0.02, trackMat, true, 4, map.mps));
  // the AI's racing line (metres, + = right of travel); the strip's offsets point left, hence the minus. Worked out on
  // the original points (it's O(n^2)) and interpolated onto the dense ones.
  const coarse = racingLine(pts.map(p => { const q = flat(p); return [q.x * map.mps, q.z * map.mps]; }), width / 2);
  const line = dense.src.map(([i, f]) => -(coarse[i] + (coarse[(i + 1) % coarse.length] - coarse[i]) * f));
  track.geometry.setAttribute('line', new THREE.Float32BufferAttribute([...line, line[0]].flatMap(l => [l, l]), 1));
  const white = mat(null, 0xf4f4f4);
  for (const s of [-1, 1]) add(strip(F, s * (half - m(0.6)), s * (half - m(0.25)), 0.03, white, true, 50, map.mps));
  const kerb = mat({map: tex.kerb, normalMap: tex.kerbRidges}), gravel = mat(tex.gravel);
  for (const run of cornerRuns(F, map.mps)) {
    // the outside of the corner: the side away from the chord between the run's ends
    const i = run.length >> 1, mid = run[i].P, a = run[0].P, b = run.at(-1).P;
    const out = Math.sign(run[i].N0.x * (mid.x - (a.x + b.x) / 2) + run[i].N0.z * (mid.z - (a.z + b.z) / 2)) || 1;
    // kerbs where a real circuit has them: the inside over the whole corner (the apex), the outside over its exit half
    add(strip(run, -out * half, -out * (half + m(1.2)), 0.025, kerb, false, 2, map.mps));
    if (run.length - i > 1) add(strip(run.slice(i), out * half, out * (half + m(1.2)), 0.025, kerb, false, 2, map.mps));
    if (ann.preset?.runoff === 'armco') continue;  // no gravel traps on a street circuit
    add(strip(run, out * (half + m(5)), out * (half + Math.min(m(9.8), wall - m(0.3))), 0.012, gravel, false, 6, map.mps));
  }
  // barriers: painted concrete blocks, or bare steel Armco on the street circuit
  const barrier = ann.preset?.runoff === 'armco' ? mat(null, 0xb9bdc4, {metalness: 0.7, roughness: 0.35}) : mat({map: tex.wall});
  // alpha-to-coverage: the 4x MSAA target anti-aliases the cut-out wires; alphaTest also cuts the fence's shadow
  const fence = mat({map: tex.fence}, 0xffffff, {alphaTest: 0.5, alphaToCoverage: true, metalness: 0.6, roughness: 0.45});
  let walls = [];
  // a 1.1 m barrier along frames Fr at offsets o, and the 3 m debris fence on top of it
  const wallAndFence = (Fr, o, closed) => [add(strip(Fr, o, 0, 0, barrier, closed, 8, map.mps, m(1.1))),
    onLayer1(Object.assign(add(strip(Fr, o, 0, m(1.1), fence, closed, 4, map.mps, m(3))), {castShadow: true}))];
  // the fence is cut out by alpha too: on layer 1 like the tree crowns (see there), or it's a solid grey wall to AO and blur
  function onLayer1(o) { o.layers.set(1); return o; }
  // offs[side]: lateral offset of that side's barrier at each outline point, null for an opening (pitLane moves them)
  const barriers = offs => {
    for (const w of walls) { world.remove(w); w.geometry.dispose(); owned.splice(owned.indexOf(w), 1); }
    walls = offs.flatMap(o => {
      if (o.every(x => x !== null)) return wallAndFence(F, o, true);
      const runs = [];  // the openings split the loop into open runs, starting after the first one
      let run = [];
      for (let k = 1, start = o.indexOf(null); k <= o.length; k++) {
        const i = (start + k) % o.length;
        if (o[i] === null) { if (run.length > 1) runs.push(run); run = []; } else run.push(i);
      }
      return runs.flatMap(r => wallAndFence(r.map(i => F[i]), r.map(i => o[i]), false));
    });
  };
  barriers([-1, 1].map(s => F.map(() => s * (half + wall))));

  // --- sausage kerbs: rows of raised yellow humps at the chicane apexes they guard ---
  const humps = F.map((f, i) => [f, i]).filter(([, i]) => ann.kerb[i] === 'sausage');
  if (humps.length) {
    const geo = new THREE.CapsuleGeometry(m(0.14), m(1.1), 4, 8).rotateZ(Math.PI / 2), mesh = new THREE.InstancedMesh(geo,
      new THREE.MeshStandardMaterial({color: 0xf2c200, roughness: 0.6}), humps.length * 2), mtx = new THREE.Matrix4();
    humps.forEach(([f], j) => [-1, 1].forEach((s, k) => {
      const at = f.P.clone().addScaledVector(f.N, s * (half + m(0.45))).addScaledVector(f.B, m(0.1));
      mtx.lookAt(new THREE.Vector3(), f.T, UP).setPosition(at);
      mesh.setMatrixAt(2 * j + k, mtx);
    }));
    mesh.castShadow = true;
    add(mesh);
  }

  // --- the tunnel (Monaco): roof and walls over the outline range, with a strip of lights along the roof; the roof
  // casts the sun's shadow, so the inside is dark but for the lights (bloom makes them glow) ---
  let tunnelPts = null;
  if (ann.tunnel) {
    const [i0, i1] = ann.tunnel, run = [];
    for (let i = i0; i !== i1; i = (i + 1) % F.length) run.push(F[i]);
    if (run.length > 2) {
      const concrete = new THREE.MeshStandardMaterial({color: 0x6f6a62, roughness: 0.95, side: THREE.DoubleSide});
      const span = half + m(1.5), roof = add(strip(run, -span, span, m(6.5), concrete, false, 8, map.mps));
      roof.castShadow = true;
      for (const s of [-1, 1]) add(strip(run, s * span, 0, 0, concrete, false, 8, map.mps, m(6.5))).castShadow = true;
      add(strip(run, -m(0.4), m(0.4), m(6.45), new THREE.MeshStandardMaterial({color: 0x222222, emissive: 0xffe2b0, emissiveIntensity: 3}),
                false, 4, map.mps));
      tunnelPts = run.map(f => f.P);
    }
  }

  // --- trees on the terrain, 20-160 m off the track: conifers and broadleaf crowns of leaf cards (textures3d.js
  // foliage), cut out by alpha. Alpha-to-coverage turns the cut edges into MSAA coverage, so leaves are anti-aliased. ---
  const trunkGeo = new THREE.CylinderGeometry(m(0.22), m(0.42), m(7), 7).translate(0, m(3.5), 0);
  seed = 11;
  const coneGeo = conifer(m), leafGeo = broadleaf(m);
  const N = 1500, mtx = new THREE.Matrix4();
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({color: 0x4a3a2a, roughness: 1}), N);
  const crownMat = new THREE.MeshStandardMaterial({map: tex.foliage, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide,
                                                   roughness: 0.8, vertexColors: true});
  // a card's back face keeps the crown's outward normal: three flips it for back faces, which lit half the leaves from inside
  crownMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal *= faceDirection;');
  };
  const cones = new THREE.InstancedMesh(coneGeo, crownMat, N), leaves = new THREE.InstancedMesh(leafGeo, crownMat, N);
  // Layer 1: left out of the motion-vector and ambient-occlusion passes, which draw with one override material and no
  // alpha cut-out, so every card came out a solid square there (dark AO boxes, smeared blur round the crowns)
  cones.layers.set(1);
  leaves.layers.set(1);
  cones.count = leaves.count = 0;  // filled below
  const clear = (half + wall + m(10)) ** 2, sample = p3.filter((_, i) => i % (2 * every) === 0);
  seed = 7;
  let k = 0;
  for (let tries = 0; tries < N * 4 && k < N; tries++) {
    const p = p3[Math.floor(rand() * p3.length)], ang = rand() * Math.PI * 2, r = m(20 + rand() * 140);
    const x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r;
    if (sample.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < clear)) continue;
    const s = 0.7 + rand() * 0.8, conifer = rand() < 0.5, crowns = conifer ? cones : leaves;
    mtx.makeRotationY(rand() * Math.PI * 2).scale(new THREE.Vector3(s, s, s)).setPosition(x, groundAt(x, z) - m(0.3), z);
    trunks.setMatrixAt(k++, mtx);
    crowns.setMatrixAt(crowns.count, mtx);
    // HSL in sRGB, times the foliage texture's greens: in three's linear working space these lightnesses come out pastel
    // conifers dark and blue-green (lighter ones came out lime)
    crowns.setColorAt(crowns.count++, new THREE.Color().setHSL(conifer ? 0.34 + rand() * 0.06 : 0.2 + rand() * 0.08,
      conifer ? 0.2 + rand() * 0.15 : 0.3 + rand() * 0.25, conifer ? 0.27 + rand() * 0.07 : 0.5 + rand() * 0.12, THREE.SRGBColorSpace));
  }
  trunks.count = k;
  for (const t of [trunks, cones, leaves]) add(t).castShadow = true;

  if (startKnown && F.length > 1) add(gantry(F[0], w, m, tex, map.mps));
  for (const [x, y, num] of corners) {
    const div = document.createElement('div');
    div.className = 'corner3d';
    div.textContent = String(num);
    const lbl = add(new CSS2DObject(div)), at = surface([x, y]);
    lbl.position.set(at.p.x, at.y + m(4), at.p.z);
  }

  // Surface under a map point: nearest outline segment (searched within ~240 m of `hint`, everywhere when there is
  // none or the point is far from it: a scrub or a cut to another car), the height of the banked road at that lateral
  // offset (left of the centre line rises by offset x tan phi), its roll, that offset (lat, scene units, + = left) and
  // the index (the next call's hint).
  // Height, camber and roll are interpolated along that segment, as the road mesh is. Nearest segment, not nearest
  // point: inside a hairpin a position off the curve (a lap-mode replay runs on the chords) is near several of the
  // bunched points at once, and the nearest one flipped back and forth from frame to frame.
  function surface(mp, hint) {
    const p = flat(mp), n = F.length;
    let best = 0, t = 0, d = Infinity;
    const near = i => {  // squared distance to segment i -> i + 1, keeping the closest
      const a = F[i].P, b = F[(i + 1) % n].P, sx = b.x - a.x, sz = b.z - a.z;
      const u = THREE.MathUtils.clamp(((p.x - a.x) * sx + (p.z - a.z) * sz) / (sx * sx + sz * sz || 1), 0, 1);
      const e = (a.x + sx * u - p.x) ** 2 + (a.z + sz * u - p.z) ** 2;
      if (e < d) { d = e; best = i; t = u; }
    };
    const win = 40 * every;  // the original 40 outline points either side
    if (hint !== undefined) for (let o = -win; o <= win; o++) near((hint + o + n) % n);
    if (d > (half + wall + m(40)) ** 2) for (let i = 0; i < n; i++) near(i);
    const a = F[best], b = F[(best + 1) % n];
    const mix = (u, v) => u + (v - u) * t, camber = f => f.N.y / Math.max(0.2, Math.hypot(f.N.x, f.N.z));
    const lat = (p.x - mix(a.P.x, b.P.x)) * mix(a.N0.x, b.N0.x) + (p.z - mix(a.P.z, b.P.z)) * mix(a.N0.z, b.N0.z);
    const road = mix(a.P.y, b.P.y) + lat * mix(camber(a), camber(b));
    // beyond the run-off (a pit lane, its garages, a car that has gone off) the ground, or the road's centre height if
    // that's higher (the terrain is cut below the road near it), eased in over 3 m: the road's camber carried 30-100 m
    // sideways (Silverstone's lane) buried the lane under the grass
    const f = THREE.MathUtils.smoothstep(Math.abs(lat), half + m(3), half + m(6));
    const y = f ? road + (Math.max(groundAt(p.x, p.z), mix(a.P.y, b.P.y)) - road) * f : road;
    return {p, y, roll: Math.asin(mix(a.N.y, b.N.y)) * (1 - f), lat, i: best};
  }

  // trees standing where keep(x, z) says no grow nothing (zero-scale instance matrices)
  const fell = keep => {
    const t = new THREE.Matrix4(), none = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of [trunks, cones, leaves]) {
      for (let j = 0; j < mesh.count; j++) {
        mesh.getMatrixAt(j, t);
        if (!keep(t.elements[12], t.elements[14])) mesh.setMatrixAt(j, none);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  let laneMeshes = [], laneMat, laneLine;

  return {
    trackMat, wettable, surface, groundAt, pts, half,
    // Pit lane (map points of its centre line, entry road to exit road): a strip on the ground beside the track,
    // replacing any earlier one, with a line along each edge. The barrier on its side moves in to become the pit wall
    // 1 m off the lane's edge, or opens where that would leave no room beside the track (the entry and exit roads).
    // Garages line its far side: one per box ({at: map point, color}: the sim's team boxes), else (a replay)
    // neutral ones every 12 m along the middle half of the lane. Trees within 6 m of the lane or near a garage go.
    pitLane(lanePts, boxes = null) {
      for (const o of laneMeshes) {
        world.remove(o); o.geometry.dispose(); owned.splice(owned.indexOf(o), 1);
        if (o.userData.own) o.material.dispose();  // the garages' (lane and line materials are kept)
      }
      let hint;
      const near = lanePts.map(q => { const s = surface(q, hint); hint = s.i; return s; });
      const lp = near.map(s => s.p.clone().setY(s.y)), LF = frames(lp, lp.map(() => 0)), laneHalf = m(2.8);
      laneMat ??= mat(tex.asphalt, 0x8c8c8c);
      laneLine ??= new THREE.MeshStandardMaterial({color: 0xf4f4f4, roughness: 0.8});
      // 12 cm up: the terrain's triangles can stand a little above its bilinear height on a slope
      laneMeshes = [add(strip(LF, -laneHalf, laneHalf, m(0.12), laneMat, false, 4, map.mps)),
                    ...[-1, 1].map(s => add(strip(LF, s * m(2.75), s * m(2.6), m(0.13), laneLine, false, 50, map.mps)))];
      // garages: at each box's lane point, square to the lane there (not to the track: a real lane can swing well
      // away from it), on the side away from the track
      const bay = ({p, y, i}, color) => {
        let k = 0;
        lp.forEach((q, j) => { if (q.distanceToSquared(p) < lp[k].distanceToSquared(p)) k = j; });
        const a = lp[Math.min(k + 1, lp.length - 1)].clone().sub(lp[Math.max(k - 1, 0)]).setY(0).normalize();
        const out = new THREE.Vector3(-a.z, 0, a.x);
        if (out.dot(p.clone().sub(F[i].P).setY(0)) < 0) out.negate();
        return {P: p.clone().setY(y), out, color};
      };
      const bays = boxes ? boxes.map(b => bay(surface(b.at, near[0].i), b.color)) : [];
      if (!boxes) {  // replay: garages every 12 m along the middle half of the lane
        const run = [0];
        for (let k = 1; k < lp.length; k++) run.push(run[k - 1] + lp[k].distanceTo(lp[k - 1]) * map.mps);
        for (let d = run.at(-1) * 0.25; d < run.at(-1) * 0.75; d += 12) bays.push(bay(near[run.findIndex(r => r >= d)], 0x5a5e66));
      }
      laneMeshes.push(...garages(bays, map.mps, 2.8).map(add));
      // the lane's lateral offset (+ = left) at each outline point it passes, interpolated between its points
      const n = F.length, lat = new Array(n).fill(null), latOf = s => { const f = F[s.i]; return (s.p.x - f.P.x) * f.N0.x + (s.p.z - f.P.z) * f.N0.z; };
      near.forEach((s, k) => {
        let a = near[k - 1] ?? s, b = s, steps = (b.i - a.i + n) % n;
        if (steps > n / 4) [a, b, steps] = [b, a, (a.i - b.i + n) % n];  // the lane runs against the outline
        if (steps > n / 4) return;  // not consecutive
        const l0 = latOf(a), l1 = latOf(b);
        for (let j = 0; j <= steps; j++) lat[(a.i + j) % n] = l0 + (l1 - l0) * (steps ? j / steps : 1);
      });
      barriers([-1, 1].map(side => F.map((_, i) => {
        const l = lat[i], line = side * (half + wall);
        if (l === null || Math.sign(l) !== side) return line;
        const pitWall = Math.abs(l) - laneHalf - m(1);
        return pitWall < half + m(1) ? null : side * Math.min(half + wall, pitWall);
      })));
      const sheds = bays.map(b => b.P.clone().addScaledVector(b.out, m(12)));  // the middle of each garage
      fell((x, z) => !lp.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < (laneHalf + m(6)) ** 2)
                     && !sheds.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < m(14) ** 2));
    },
    // satellite ground: texture, uv = M (scene x, z, 1) over the terrain, keep(x, z): whether a tree there stands on
    // vegetation in the image (the others go), mean: the image's mean colour, for the land beyond it
    satellite(texture, M, keep, mean) {
      grass.userData.sat.value = texture;
      grass.userData.satMean.value.copy(mean);
      grass.userData.satM.value.copy(M);
      grass.userData.satOn.value = 1;
      fell(keep);
    },
    // is a scene position inside the tunnel? (for the audio's enclosed reverb)
    inTunnel: v => !!tunnelPts?.some(q => (q.x - v.x) ** 2 + (q.z - v.z) ** 2 < (half + m(2)) ** 2 && v.y < q.y + m(6.5)),
    // free every geometry and material this circuit created (textures are shared and kept)
    dispose() {
      grass.userData.sat.value?.dispose();  // the satellite image is this circuit's own
      for (const o of owned) {
        world.remove(o);
        o.traverse?.(x => {
          x.geometry?.dispose();
          for (const mt of [x.material].flat()) mt?.dispose?.();
        });
      }
    },
  };
}

// Tree crowns as leaf cards: quads [corner, edge u, edge v] with atlas uv rectangles. Normals point out of the crown's
// shape (from `centre` of each vertex, scaled by the crown's radii), not the card's own facing, so the crown shades as one
// soft volume, lit side and shadowed side, instead of a pile of flat quads. Vertex colour darkens the inside and underside:
// the occlusion foliage gets from its own depth. Atlas: v = 0 is the canvas's top row (textures3d.js foliage).
function cards(quads, normalOf, shadeOf) {
  const pos = [], nor = [], uv = [], col = [], idx = [], v = new THREE.Vector3();
  for (const [o, a, b, [u0, v0, u1, v1]] of quads) {
    const base = pos.length / 3;
    for (const [s, t, cu, cv] of [[0, 0, u0, v1], [1, 0, u1, v1], [1, 1, u1, v0], [0, 1, u0, v0]]) {
      v.copy(o).addScaledVector(a, s).addScaledVector(b, t);
      pos.push(v.x, v.y, v.z);
      const n = normalOf(v);
      nor.push(n.x, n.y, n.z);
      uv.push(cu, cv);
      const k = shadeOf(v);
      col.push(k, k, k);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// a random unit vector, and two unit vectors square to it and each other
function basis() {
  const z = rand() * 2 - 1, a = rand() * 2 * Math.PI, n = new THREE.Vector3(Math.sqrt(1 - z * z) * Math.cos(a), z, Math.sqrt(1 - z * z) * Math.sin(a));
  const e = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
  return [n, e, new THREE.Vector3().crossVectors(n, e)];
}

// broadleaf: ~3.8 x 3.2 m ellipsoid crown centred 6 m up, 60 cards of 2.4-3.4 m, most of them in its outer shell
function broadleaf(m) {
  const C = new THREE.Vector3(0, m(6), 0), R = new THREE.Vector3(m(3.8), m(3.2), m(3.8)), quads = [];
  for (let i = 0; i < 60; i++) {
    const [d] = basis(), at = C.clone().add(d.clone().multiply(R).multiplyScalar(0.35 + 0.6 * Math.cbrt(rand())));
    const s = m(2.4 + rand() * 1), [, e2, f2] = basis();
    quads.push([at.clone().addScaledVector(e2, -s / 2).addScaledVector(f2, -s / 2), e2.multiplyScalar(s), f2.multiplyScalar(s), [0, 0, 0.5, 1]]);
  }
  const rel = v => v.clone().sub(C).divide(R);
  return cards(quads, v => rel(v).normalize(), v => { const r = rel(v); return Math.min(1, (0.45 + 0.55 * Math.min(1, r.length())) * (0.78 + 0.22 * r.y)); });
}

// conifer: tiers of branch sprays from 1.8 m to the 11 m top, each spray from the trunk out (the atlas's trunk end at
// u = 0.5) and drooping, 2-3.4 m long low down, shorter up the tree
function conifer(m) {
  const quads = [], top = 11, low = 1.8;
  for (let y = low; y < top - 0.4; y += 0.55) {
    const reach = 0.35 + 3.1 * (1 - (y - low) / (top - low)), n = Math.max(5, Math.round(5 + reach * 2)), spin = rand() * 2 * Math.PI;
    for (let j = 0; j < n; j++) {
      const a = spin + (j + 0.4 * rand()) / n * 2 * Math.PI, droop = 0.25 + 0.25 * rand(), L = m(reach * (0.95 + 0.25 * rand()));
      const out = new THREE.Vector3(Math.cos(a) * Math.cos(droop), -Math.sin(droop), Math.sin(a) * Math.cos(droop));
      // across the spray: tangential, rolled ~35 degrees up so it reads from the side as well as from above
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).applyAxisAngle(out, 0.6 * (rand() - 0.5) + 0.6);
      const w = L * 0.9, root = new THREE.Vector3(0, m(y), 0).addScaledVector(side, -w / 2);
      quads.push([root, out.multiplyScalar(L), side.multiplyScalar(w), [0.5, 0, 1, 1]]);
    }
  }
  for (let j = 0; j < 2; j++) {  // the leader: two crossed upright sprays at the top
    const a = j * Math.PI / 2, e = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), h = m(2.2);
    quads.push([new THREE.Vector3(0, m(top - 2), 0).addScaledVector(e, -h / 2), new THREE.Vector3(0, h, 0), e.clone().multiplyScalar(h), [0.5, 0, 1, 1]]);
  }
  return cards(quads, v => new THREE.Vector3(v.x, m(1.2), v.z).normalize(),
               v => { const out = Math.min(1, Math.hypot(v.x, v.z) / m(2.5)), up = v.y / m(top); return Math.min(1, (0.5 + 0.5 * out) * (0.8 + 0.25 * up)); });
}

function gantry(f, w, m, tex, mps) {
  const g = new THREE.Group(), steel = new THREE.MeshStandardMaterial({color: 0x30333a, roughness: 0.5, metalness: 0.6});
  g.position.copy(f.P);
  g.rotation.y = Math.atan2(-f.T.z, f.T.x);
  const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); g.add(o); return o; };
  const checker = tex.checker.clone();
  checker.repeat.set(1, w * mps / 8);
  checker.needsUpdate = true;
  const line = add(new THREE.PlaneGeometry(m(1.6), w), new THREE.MeshStandardMaterial({map: checker, roughness: 0.8}), 0, 0.035, 0);
  line.rotation.x = -Math.PI / 2;
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(m(0.5), m(8), m(0.5)), steel, -m(4), m(4), s * (w / 2 + m(3)));
  add(new THREE.BoxGeometry(m(0.8), m(1.2), w + m(6)), steel, -m(4), m(7.6), 0);
  const red = new THREE.MeshStandardMaterial({color: 0x330000, emissive: 0xff1a1a, emissiveIntensity: 1.5});
  for (let i = -2; i <= 2; i++) add(new THREE.SphereGeometry(m(0.32), 12, 8), red, -m(3.55), m(7.6), i * m(1.4));
  return g;
}
