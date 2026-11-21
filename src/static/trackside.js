// Repeated trackside furniture as instanced meshes: catch-fence stanchions, Tecpro corner blocks, braking boards, floodlight
// towers and grandstands. A circuit has thousands of these; instancing makes each kind one draw call. Everything is placed
// from the road frames (circuit3d.js frames: P centre, T along, N left, B up), in scene units through m().
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {normalGeometry, positionGeometry, step, vec2, vec3, vec4, mix, floor, fwidth, smoothstep, abs, mrt} from 'three/tsl';
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

// a geometry with one colour in its vertices, for parts merged under one material
function colored(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({length: n}, () => [c.r, c.g, c.b]).flat(), 3));
  return g;
}

// scene units per metre's inverse, from the circuit's m()
const METRES = m => 1 / m(1);

// a trackside video screen's picture: the broadcast's running order over a dark ground, team-colour bars, a brand strip
function screenTexture() {
  const c = Object.assign(document.createElement('canvas'), {width: 512, height: 288}), g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 288);
  sky.addColorStop(0, '#0d1b33'); sky.addColorStop(1, '#03060c');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 288);
  const teams = ['#3671c6', '#ff8000', '#e8002d', '#27f4d2', '#229971', '#00a1e8', '#6692ff', '#b6babd', '#52e252', '#64c4ff'];
  g.font = '700 19px system-ui, sans-serif'; g.textBaseline = 'middle';
  teams.forEach((t, i) => {
    const y = 22 + i * 24;
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(16, y - 10, 230, 21);
    g.fillStyle = t; g.fillRect(16, y - 10, 6, 21);
    g.fillStyle = '#f2f2f2'; g.fillText(String(i + 1), 30, y + 1); g.fillText(['VER', 'NOR', 'LEC', 'RUS', 'ALO', 'GAS', 'TSU', 'HAM', 'HUL', 'ALB'][i], 62, y + 1);
  });
  const glow = g.createRadialGradient(390, 130, 10, 390, 130, 150);
  glow.addColorStop(0, '#2b5fb8'); glow.addColorStop(1, 'rgba(10,20,40,0)');
  g.fillStyle = glow; g.fillRect(260, 0, 252, 260);
  g.fillStyle = '#e10600'; g.fillRect(0, 258, 512, 30);
  g.fillStyle = '#fff'; g.font = '800 22px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('LIGHTS OUT  ·  LIVE', 256, 274); g.font = '800 54px system-ui, sans-serif'; g.fillText('LAP', 390, 105); g.fillText('LIVE', 390, 165);
  return Object.assign(new THREE.CanvasTexture(c), {colorSpace: THREE.SRGBColorSpace, anisotropy: 16});
}

function boardTexture(text) {
  const c = Object.assign(document.createElement('canvas'), {width: 256, height: 256}), g = c.getContext('2d');
  g.scale(2, 2);
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111';
  g.font = '700 58px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  return Object.assign(new THREE.CanvasTexture(c), {colorSpace: THREE.SRGBColorSpace, anisotropy: 16});
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
        if (d - last < m(2.45)) continue;
        last = d;
        items.push({p: at(f, -side * (half + wall - m(0.7)), m(0.5)), f, color: k++ % 2 ? red : white});
      }
    }
    if (items.length) made.push(instanced(new THREE.BoxGeometry(m(0.9), m(1), m(2.4)), tecpro, items));  // one per road frame (every ~2.5 m), end to end
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
    // a board on two legs (their uvs land on the white of the texture); it stood on nothing
    const board = mergeGeometries([new THREE.BoxGeometry(m(1.3), m(1.3), m(0.08)), ...[-1, 1].map(s => new THREE.BoxGeometry(m(0.07), m(0.8), m(0.07)).translate(s * m(0.45), -m(1), 0))]);
    made.push(instanced(board, mat, items));
  }
  const poles = [];
  for (let d = 0, i = 0; i < n; i++) if (dist[i] >= d) { poles.push(i); d += m(700); }

  // floodlight towers beside the track; their lamps stay off until a night sky turns them on
  let lampBeam = null;
  const spots = [];
  const lamp = new THREE.MeshStandardNodeMaterial({color: 0x20242c, emissive: 0xfff2d8, emissiveIntensity: 0});
  const towers = poles.map((i, k) => ({p: at(F[i], (k % 2 ? 1 : -1) * (half + wall + m(14)), 0), f: F[i]})).filter(t => clear(t.p, m(8)));
  if (towers.length) {
    made.push(instanced(new THREE.CylinderGeometry(m(0.22), m(0.35), m(26), 8).translate(0, m(13), 0), steel, towers));
    made.push(instanced(new THREE.BoxGeometry(m(6), m(2.6), m(0.5)).translate(0, m(26.5), 0), lamp, towers, {shadow: false}));
    // the light on the track under each tower: a faint cone from the lamp to the ground, additive, on layer 1 with no motion
    // vector; its opacity follows the night (night() below)
    const beam = new THREE.MeshBasicNodeMaterial({color: 0xfff2d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false});
    beam.mrtNode = mrt({velocity: vec4(0)});
    const cone = instanced(new THREE.ConeGeometry(m(16), m(26.5), 24, 1, true).translate(0, m(13.25), 0), beam, towers, {shadow: false});
    cone.layers.set(1);
    made.push(cone);
    lampBeam = beam;
    // real light: a spot on the road under each tower, off until a night sky lights it (night() below)
    for (const t of towers) {
      const spot = new THREE.SpotLight(0xfff0dc, 0, m(90), 0.8, 0.7, 0);
      spot.position.copy(t.p).addScaledVector(t.f.B, m(26.5));
      spot.target.position.copy(t.f.P);
      spot.visible = false;
      spots.push(spot);
    }
  }

  // marshal posts every ~330 m just behind the barrier, alternate sides: an orange cabin, a roof, a dark light panel facing the track
  const post = mergeGeometries([colored(new THREE.BoxGeometry(m(2.4), m(2.4), m(2.2)).translate(0, m(1.2), 0), 0xd9661f), colored(new THREE.BoxGeometry(m(2.9), m(0.18), m(2.7)).translate(0, m(2.5), 0), 0xe8e8e8),
    colored(new THREE.BoxGeometry(m(1.7), m(0.8), m(0.08)).translate(0, m(1.7), m(1.13)), 0x0b0c0e)]);
  const postMat = new THREE.MeshStandardNodeMaterial({vertexColors: true, roughness: 0.7});
  const marshals = [];
  let side = 1;
  for (let d = m(120), i = 0; i < n; i++) if (dist[i] >= d) {
    side = -side; d += m(330);
    const s = {N: F[i].T.clone().multiplyScalar(side), B: F[i].B, T: F[i].N.clone().multiplyScalar(side)};  // its +z faces the track
    const p = at(F[i], side * (half + wall + m(2.2)));
    if (clear(p, wall + m(1.2))) marshals.push({p, f: s});
  }
  if (marshals.length) made.push(instanced(post, postMat, marshals));

  // Grandstands on the outside of some corners and along the start straight, facing the track: a concrete base, 18 rows of
  // seats rising away from it, a back wall and a cantilever roof on brackets, instanced. Built with z towards the track.
  const ROWS = 18, TREAD = 0.85, RISE = 0.42, BASE = 2.4, WIDE = 44, DEEP = ROWS * TREAD;
  const profile = new THREE.Shape([[0, 0], [0, BASE]].map(([z, y]) => new THREE.Vector2(z, y)));
  for (let k = 0; k < ROWS; k++) profile.lineTo(-k * TREAD - TREAD, BASE + k * RISE), profile.lineTo(-k * TREAD - TREAD, BASE + (k + 1) * RISE);
  profile.lineTo(-DEEP, 0);
  // the shape is drawn in (z, y), extruded along x: rotate its plane's x onto z
  const standGeo = new THREE.ExtrudeGeometry(profile, {depth: WIDE, bevelEnabled: false}).translate(0, 0, -WIDE / 2).rotateY(-Math.PI / 2).scale(1 / METRES(m), 1 / METRES(m), 1 / METRES(m));
  const crowd = new THREE.MeshStandardNodeMaterial({roughness: 0.9});
  {
    // a seat is ~55 cm by a row: its own colour, an eighth of them empty and showing the stand's plastic. Past a few pixels a seat
    // would only shimmer, so it gives way to blocks of colour that survive the distance. Risers are the same crowd in shade.
    const c = positionGeometry.mul(METRES(m)), row = floor(c.y.sub(BASE).div(RISE)), cell = vec2(floor(c.x.div(0.55)), row);
    const pick = (at, k) => step(at, noise(cell.mul(k).add(0.5)));
    const seat = mix(mix(vec3(0.03, 0.04, 0.07), vec3(0.2, 0.05, 0.05), pick(0.55, 13.7)), mix(vec3(0.34, 0.33, 0.3), vec3(0.28, 0.2, 0.1), pick(0.62, 7.1)), pick(0.55, 3.3));
    const dressed = mix(vec3(0.05, 0.09, 0.15), seat, step(0.2, noise(cell.mul(19.3).add(0.5))));
    const block = mix(mix(vec3(0.07, 0.08, 0.12), vec3(0.16, 0.07, 0.07), step(0.5, noise(c.xy.div(9).add(3)))), vec3(0.24, 0.23, 0.2), step(0.55, noise(c.xy.div(5).add(11))));
    const far = smoothstep(0.35, 1.2, fwidth(cell.x));
    const people = mix(dressed, block, far).mul(mix(0.55, 1, step(0.5, normalGeometry.y)));
    const concrete = vec3(0.11, 0.115, 0.12), seating = step(BASE, c.y).mul(step(abs(normalGeometry.x), 0.5)).mul(step(-0.5, normalGeometry.z));
    // along the base's top, a painted band: the same dark and white as the barrier's boards
    const band = step(1.7, c.y).mul(step(c.y, BASE)).mul(step(0.5, normalGeometry.z));
    crowd.colorNode = mix(mix(concrete, vec3(0.03, 0.035, 0.05), band), people, seating);
  }
  // back wall, a roof rising towards the track, brackets from the wall's top out under it, and a fascia along its front edge
  const wallTop = 15.2, roofDepth = DEEP + 3;
  const bar = (a, b, r) => {
    const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), g = new THREE.BoxGeometry(r, d.length(), r);
    return g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  };
  const roofParts = [colored(new THREE.BoxGeometry(WIDE + 2, 0.25, roofDepth).rotateX(-0.07).translate(0, wallTop + 0.7, -DEEP + roofDepth / 2 - 0.4), 0xc2c7cd),
    colored(new THREE.BoxGeometry(WIDE + 2, 0.7, 0.2).translate(0, wallTop + 0.7 + 0.07 * roofDepth / 2 - 0.15, -DEEP + roofDepth - 0.4), 0x22252b),
    colored(new THREE.BoxGeometry(WIDE, wallTop, 0.3).translate(0, wallTop / 2, -DEEP - 0.15), 0x5d6168)];
  for (let k = -3; k <= 3; k++) {
    const x = k * WIDE / 6.2;
    roofParts.push(colored(new THREE.BoxGeometry(0.5, wallTop + 0.6, 0.5).translate(x, (wallTop + 0.6) / 2, -DEEP - 0.5), 0x7b8087),
      colored(bar([x, wallTop - 4, -DEEP - 0.3], [x, wallTop + 0.6 + 0.07 * roofDepth * 0.55, -DEEP + roofDepth * 0.55], 0.28), 0x7b8087));
  }
  const roofGeo = mergeGeometries(roofParts).scale(1 / METRES(m), 1 / METRES(m), 1 / METRES(m));
  roofParts.forEach(t => t.dispose());
  const roofMat = new THREE.MeshStandardNodeMaterial({vertexColors: true, metalness: 0.2, roughness: 0.6});
  // The crowd: a seated body and a head on a seat every 55 cm, a fifth of the seats empty and an aisle every 11 m, shirts in
  // a fan palette. One stand's people are one merged geometry, instanced like the stand: one draw call for every stand's
  // crowd, and no shadow pass (the roof's shadow still falls on them). The painted treads under them fill the gaps.
  const peopleGeo = (() => {
    let s = 5;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    // mostly dark, white and grey, as a real crowd is; team and flag colours muted, or the stand looked like confetti
    const shirts = [0x1a1c22, 0x23262e, 0x2c3242, 0xd8d8d4, 0xbfc0bc, 0x6e737c, 0x4a4f58, 0x8f2a2e, 0x2b4277, 0xc9a63a, 0x2f6b48, 0xb86a32, 0x3f8aa8];
    const skins = [0xe6b996, 0xc68f63, 0x8d5a3b, 0x5a3825];
    const body = new THREE.BoxGeometry(0.42, 0.62, 0.28), head = new THREE.BoxGeometry(0.2, 0.24, 0.22), parts = [];
    for (let k = 0; k < ROWS; k++) for (let x = -WIDE / 2 + 0.4; x < WIDE / 2 - 0.3; x += 0.55) {
      if (((x + WIDE / 2) % 11) < 0.9 || r() < 0.2) continue;
      const y = BASE + k * RISE + 0.45, z = -(k + 0.62) * TREAD, dx = (r() - 0.5) * 0.08, lean = (r() - 0.5) * 0.12;
      const shirt = shirts[Math.floor(r() * shirts.length)], tall = 0.92 + 0.16 * r();
      parts.push(colored(body.clone().scale(1, tall, 1).translate(x + dx, y + 0.31 * tall, z), shirt),
        colored(head.clone().translate(x + dx + lean * 0.3, y + 0.62 * tall + 0.14, z + 0.02), r() < 0.25 ? shirt : skins[Math.floor(r() * skins.length)]));
    }
    const g = mergeGeometries(parts).scale(1 / METRES(m), 1 / METRES(m), 1 / METRES(m));
    parts.forEach(p => p.dispose()); body.dispose(); head.dispose();
    return g;
  })();
  const peopleMat = new THREE.MeshStandardNodeMaterial({vertexColors: true, roughness: 0.85});
  const stands = [];
  const addStand = (f, side) => {
    const front = half + wall + m(7), out = dir => f.N.clone().multiplyScalar(side * dir);
    const p = at(f, side * front, 0), rotated = {N: f.T.clone().multiplyScalar(side), B: f.B, T: f.N.clone().multiplyScalar(side)};
    // nothing of it on another stretch of road: its corners and the middle of its back
    const test = [[-22, 0], [22, 0], [-22, -DEEP], [22, -DEEP], [0, -DEEP]].map(([x, z]) => p.clone().addScaledVector(f.T, m(x)).addScaledVector(out(1), m(-z)));
    if (test.every(q => clear(q, wall + m(3)))) stands.push({p, f: rotated});
  };
  // three in a row down each side of the start straight (a pit lane on one side clears its own, see clearOf), then every other corner
  for (const k of [-1, 0, 1]) for (const s of [1, -1]) {
    let i = 0;
    while (i < n - 1 && dist[i] < (k + 1.2) * m(46)) i++;
    addStand(F[i], s);
  }
  for (const k of [1, 2]) {
    let i = n - 1;
    while (i > 0 && dist[n - 1] - dist[i] < k * m(46)) i--;
    addStand(F[i], 1);
    addStand(F[i], -1);
  }
  runs.forEach((run, r) => { if (r % 2 === 0 && run.length > 3) { const f = run[run.length >> 1]; addStand(f, -Math.sign(f.P.clone().sub(run[0].P).dot(run[0].N)) || 1); } });
  // a video screen beside every other stand: a 12 x 6.75 m panel 9 m up on two legs, facing the track from its end
  const shown = stands.filter((_, k) => k % 2 === 0).map(({p, f}) => ({p: p.clone().addScaledVector(f.N, m(WIDE / 2 + 5)), f})).filter(s => clear(s.p, wall + m(3)));
  const screenFrame = mergeGeometries([new THREE.BoxGeometry(12.6, 7.3, 0.6).translate(0, 12.4, -0.35),
    ...[-4, 4].map(x => new THREE.BoxGeometry(0.5, 9, 0.5).translate(x, 4.5, -0.6))]).scale(1 / METRES(m), 1 / METRES(m), 1 / METRES(m));
  const screenFace = new THREE.PlaneGeometry(12, 6.75).translate(0, 12.4, 0.02).scale(1 / METRES(m), 1 / METRES(m), 1 / METRES(m));
  const screenMat = new THREE.MeshStandardNodeMaterial({color: 0x000000, roughness: 0.35, emissiveMap: screenTexture(), emissive: 0xffffff, emissiveIntensity: 1.4});
  const screenMeshes = shown.length ? [instanced(screenFrame, steel, shown), instanced(screenFace, screenMat, shown, {shadow: false})] : [];
  // an advertising bridge over the middle of the longest straight that isn't the start's (the gantry stands there):
  // legs behind each barrier, a box girder across, a board on each face
  const bridges = [];
  {
    let best = null;
    for (let r = 0; r < runs.length; r++) {
      const a = F.indexOf(runs[(r - 1 + runs.length) % runs.length].at(-1)), b = F.indexOf(runs[r][0]);
      const len = (dist[b] - dist[a] + dist[n - 1]) % dist[n - 1], mid = (dist[a] + len / 2) % dist[n - 1];
      if (b < a || a === -1 || b === -1) continue;  // the straight over the line: the gantry's
      if (len > m(350) && (!best || len > best.len)) best = {len, mid};
    }
    if (best) { let i = 0; while (i < n - 1 && dist[i] < best.mid) i++; bridges.push({p: F[i].P.clone(), f: F[i]}); }
  }
  const span = 2 * (half + wall) + m(3), M1 = m(1);
  const bridgeGeo = bridges.length ? mergeGeometries([new THREE.BoxGeometry(span + M1, m(2.2), m(1.6)).translate(0, m(7.6), 0),
    ...[-1, 1].map(s => new THREE.BoxGeometry(m(1), m(8.7), m(1.4)).translate(s * span / 2, m(4.35), 0))]) : null;
  const bridgeBoard = new THREE.PlaneGeometry(span - m(2), m(1.9));
  const boards = bridges.length ? mergeGeometries([-1, 1].map(s => bridgeBoard.clone().rotateY(s < 0 ? Math.PI : 0).translate(0, m(7.6), s * m(0.82)))) : null;
  bridgeBoard.dispose();
  const brandMat = new THREE.MeshStandardNodeMaterial({map: (() => {
    const c = Object.assign(document.createElement('canvas'), {width: 1024, height: 64}), g = c.getContext('2d');
    g.fillStyle = '#0c0d10'; g.fillRect(0, 0, 1024, 64);
    g.fillStyle = '#e10600'; g.fillRect(0, 0, 1024, 6); g.fillRect(0, 58, 1024, 6);
    g.fillStyle = '#fff'; g.font = 'italic 900 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k < 4; k++) g.fillText('LIGHTS OUT', 128 + k * 256, 33);
    return Object.assign(new THREE.CanvasTexture(c), {colorSpace: THREE.SRGBColorSpace, anisotropy: 16});
  })(), roughness: 0.55});
  const bridgeMeshes = bridges.length ? [instanced(bridgeGeo, steel, bridges), instanced(boards, brandMat, bridges, {shadow: false})] : [];
  const standMeshes = stands.length ? [instanced(standGeo, crowd, stands), instanced(roofGeo, roofMat, stands), instanced(peopleGeo, peopleMat, stands, {shadow: false})] : [];
  made.push(...standMeshes, ...screenMeshes, ...bridgeMeshes);

  const stanchionGeo = new THREE.CylinderGeometry(m(0.05), m(0.05), m(4.1), 6).translate(0, m(2.05), 0);
  let posts = null;
  return {
    meshes: made,
    spots,  // the floodlights' spotlights: circuit3d adds them and their targets to the world
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
    // a pit lane's points: the stands standing on it go (zero-scale instances)
    clearOf(points) {
      const none = new THREE.Matrix4().makeScale(0, 0, 0), reach = (m(30)) ** 2;
      stands.forEach(({p}, i) => {
        if (points.some(q => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < reach)) for (const o of standMeshes) { o.setMatrixAt(i, none); o.instanceMatrix.needsUpdate = true; }
      });
      for (const [list, meshes] of [[shown, screenMeshes], [bridges, bridgeMeshes]]) list.forEach(({p}, i) => {
        if (points.some(q => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < reach)) for (const o of meshes) { o.setMatrixAt(i, none); o.instanceMatrix.needsUpdate = true; }
      });
    },
    night: v => { lamp.emissiveIntensity = v; if (lampBeam) lampBeam.opacity = Math.min(0.12, v * 0.015); for (const s of spots) { s.visible = v > 0; s.intensity = v * 1.4; } },
    dispose(world) {
      for (const s of spots) world.remove(s, s.target);
      if (posts) { world.remove(posts); posts.dispose(); }
      stanchionGeo.dispose();
      standGeo.dispose();
      roofGeo.dispose();
      roofMat.dispose();
      for (const o of made) { world.remove(o); o.geometry.dispose(); o.dispose(); }
      for (const mat of boardMats) { mat.map.dispose(); mat.dispose(); }
      screenMat.emissiveMap.dispose(); screenMat.dispose(); brandMat.map.dispose(); brandMat.dispose();
      steel.dispose(); lamp.dispose(); crowd.dispose(); peopleMat.dispose(); postMat.dispose();
    },
  };
}
