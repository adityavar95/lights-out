// The driver, in car space (metres, +x forward, y up, +z right) round the helmet's centre `head`: a shaped helmet with
// its design painted on, an iridescent visor and a rear spoiler, the HANS, and (rb22.js) the race suit with arms whose
// gloves hold the steering wheel and follow it as it turns (two-bone IK). cars3d.js's procedural cars take only the
// helmet and HANS: their cockpit opening is closed, so a body under it would never show.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const R = 0.13;                   // helmet: ~0.29 long, 0.23 wide, 0.26 tall once shaped
const TH = 0.85 * Math.PI;        // the shell's lower edge (polar angle), open at the neck
const UPPER = 0.29, FORE = 0.27;  // shoulder to elbow, elbow to wrist
const GRIP = [-0.01, 0.12];       // the steering wheel's grips: down and out from its centre (the RB22's reach 13.4 cm)
const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);

// unit-sphere point -> helmet surface: longer than wide, flatter sides, the chin bar drawn forward and down, the lower
// edge rising at the back over the neck
function shape(p) {
  const low = Math.max(0, -p.y), chin = Math.max(0, p.x) * low, nape = Math.max(0, -p.x) * low;
  return p.set(p.x * (1.1 + 0.35 * chin), p.y * (1 + 0.2 * chin - 0.25 * nape), p.z * (0.9 - 0.06 * low)).multiplyScalar(R);
}

// a patch of the helmet's surface lifted `lift` m off it (SphereGeometry angles: phi 0 at the back, pi at the front)
function shell(lift, phi0, phiN, th0, thN, ws, hs) {
  const g = new THREE.SphereGeometry(1, ws, hs, phi0, phiN, th0, thN), P = g.attributes.position, v = V(0, 0, 0), n = V(0, 0, 0);
  for (let i = 0; i < P.count; i++) { n.fromBufferAttribute(P, i); shape(v.copy(n)).addScaledVector(n, lift); P.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  if (phiN === 2 * Math.PI) {  // whole turn: the seam's two columns and the crown's vertices share one normal
    const N = g.attributes.normal, avg = (ids) => { const s = V(0, 0, 0); for (const i of ids) s.add(n.fromBufferAttribute(N, i));
      s.normalize(); for (const i of ids) N.setXYZ(i, s.x, s.y, s.z); };
    for (let iy = 0; iy <= hs; iy++) avg([iy * (ws + 1), iy * (ws + 1) + ws]);
    avg([...Array(ws + 1).keys()]);
  }
  return g;
}

// the point on the helmet at phi, theta (lifted `lift`)
const on = (phi, th, lift = 0) => { const n = V(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)); return shape(n.clone()).addScaledVector(n, lift); };

// capsule along +y from 0 to len, radius r0 at the bottom and r1 at the top
function limb(r0, r1, len, seg = 16) {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const a = (i / 6 - 1) * Math.PI / 2; pts.push(new THREE.Vector2(r0 * Math.cos(a), r0 * Math.sin(a))); }
  for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(r1 * Math.cos(a), len + r1 * Math.sin(a))); }
  return new THREE.LatheGeometry(pts, seg);
}

// geometry g (along +y from the origin) laid from a towards b
const lay = (g, a, b) => g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize())).translate(a.x, a.y, a.z);

// Helmet and HANS as geometry lists by material {helmet, visor, gear}, the helmet centred on head.
export function helmetGeometry(head, hans = true) {
  const at = g => g.translate(head.x, head.y, head.z), F = Math.PI, out = {helmet: [], visor: [], gear: []};
  out.helmet.push(at(shell(0, 0, 2 * Math.PI, 0, TH, 48, 28)));
  out.visor.push(at(shell(0.003, F - 1.1, 2.2, 0.39 * F, 0.17 * F, 32, 6)));
  for (const th of [0.385 * F, 0.558 * F]) out.gear.push(at(shell(0.0045, F - 1.13, 2.26, th, 0.012 * F, 32, 1)));  // visor seals
  for (const z of [-1, 1]) {  // visor pivots
    const p = on(F + z * 1.12, 0.47 * F, 0.004);
    out.gear.push(at(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 16).rotateX(Math.PI / 2).translate(p.x, p.y, p.z)));
  }
  const top = on(0, 0.3 * F, 0.006);  // rear spoiler on the back of the crown, its lip kicked up
  out.gear.push(at(new THREE.BoxGeometry(0.05, 0.006, 0.13).rotateZ(0.45).translate(top.x, top.y, 0)));
  for (const z of [-1, 1]) out.gear.push(at(new THREE.BoxGeometry(0.045, 0.018, 0.005).rotateZ(0.6).translate(top.x + 0.002, top.y - 0.004, z * 0.065)));
  if (hans) {  // collar on the shoulders, its back plate up behind the helmet, and the tethers to the helmet's sides
    out.gear.push(at(new THREE.TorusGeometry(0.12, 0.022, 8, 24, 1.2 * Math.PI).rotateX(Math.PI / 2).rotateY(-0.4 * Math.PI).translate(-0.02, -0.18, 0)),
      at(new THREE.BoxGeometry(0.035, 0.12, 0.17).rotateZ(-0.4).translate(-0.15, -0.14, 0)));
    for (const z of [-1, 1]) out.gear.push(at(lay(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6).translate(0, 0.05, 0), V(-0.11, -0.16, z * 0.1), V(-0.03, -0.07, z * 0.118))));
  }
  return out;
}

// Race-suit torso under the helmet, from the hips (the driver lies back, feet forward). No legs: they are inside the
// nose, and the RB22's raised nose has no floor under them.
function bodyGeometry(head) {
  const hips = V(0.4, -0.5, 0).add(head), neck = V(0.03, -0.22, 0).add(head), L = hips.distanceTo(neck);
  const prof = [[0, -0.02], [0.12, 0], [0.13, 0.15], [0.15, L * 0.6], [0.155, L - 0.06], [0.12, L - 0.01], [0.05, L + 0.03], [0, L + 0.04]];
  return [lay(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32).scale(0.78, 1, 1.4), hips, neck)];
}

// the elbow for a shoulder S and wrist W, out and down; W is pulled in when out of reach
function elbow(S, W, side) {
  const d = W.clone().sub(S), l = Math.min(d.length(), UPPER + FORE - 1e-3);
  d.normalize(); W.copy(S).addScaledVector(d, l);
  const a = (UPPER * UPPER - FORE * FORE + l * l) / (2 * l), h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
  const pole = V(-0.2, -0.6, side); pole.addScaledVector(d, -pole.dot(d)).normalize();
  return S.clone().addScaledVector(d, a).addScaledVector(pole, h);
}

// ---------- materials ----------

const css = c => `#${new THREE.Color(c).getHexString()}`;

// HANS carbon, the spoiler, visor seals and pivots
export const GEAR = new THREE.MeshPhysicalMaterial({color: 0x121316, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.15});
// a smoked visor: a thin-film coating gives the blue-to-gold sheen of a real tinted one
export const VISOR = new THREE.MeshPhysicalMaterial({color: 0x05070a, metalness: 0.6, roughness: 0.04, clearcoat: 1,
                                                      iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessMinimum: 280, iridescenceThicknessMaximum: 720});

// The helmet's design on the shell's UVs (u = phi: 0 and 1 the back, 0.5 the front; v = theta over TH, crown at the top):
// base colour, an accent swoosh from the visor's top edge round both sides to the back, edged in a pinstripe, a centre
// stripe over the crown, a darker chin and the black rubber trim at the neck. Glossy lacquer over a little flake.
export function helmetMaterial(base, accent) {
  const W = 512, H = 256, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), pin = new THREE.Color(accent).getHSL({}).l > 0.6 ? '#16181c' : '#f2f2f2';
  g.fillStyle = css(base); g.fillRect(0, 0, W, H);
  g.fillStyle = css(new THREE.Color(base).multiplyScalar(0.35)); g.fillRect(W * 0.3, H * 0.8, W * 0.4, H * 0.2);  // chin
  for (const m of [1, -1]) {  // each side, mirrored about the front
    const x = f => W / 2 + m * f * W / 2;
    g.beginPath(); g.moveTo(x(0), H * 0.42); g.bezierCurveTo(x(0.3), H * 0.42, x(0.6), H * 0.5, x(1), H * 0.26);
    g.lineTo(x(1), H * 0.4); g.bezierCurveTo(x(0.6), H * 0.62, x(0.3), H * 0.5, x(0), H * 0.5); g.closePath();
    g.fillStyle = css(accent); g.fill(); g.strokeStyle = pin; g.lineWidth = 3; g.stroke();
  }
  g.fillStyle = css(accent); g.fillRect(W / 2 - 7, 0, 14, H * 0.42); g.fillRect(0, 0, 7, H * 0.3); g.fillRect(W - 7, 0, 7, H * 0.3);
  g.fillStyle = '#0c0d0f'; g.fillRect(0, H * 0.95, W, H * 0.05);
  const map = new THREE.CanvasTexture(canvas);
  Object.assign(map, {colorSpace: THREE.SRGBColorSpace, anisotropy: 8});
  map.onUpdate = () => { canvas.width = canvas.height = 0; };  // uploaded once: the canvas can go
  return new THREE.MeshPhysicalMaterial({map, roughness: 0.25, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03});
}

// Nomex weave as a normal map (fine twill bumps), shared by every suit
let weave = null;
function fabric() {
  if (weave) return weave;
  const n = 64, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const s = Math.sin((x + y) / n * 2 * Math.PI * 8), t = Math.cos((x - y) / n * 2 * Math.PI * 8);
    d.set([128 + 40 * s, 128 + 40 * t, 240, 255], (y * n + x) * 4);
  }
  weave = new THREE.DataTexture(d, n, n);
  Object.assign(weave, {wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, magFilter: THREE.LinearFilter,
                        minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, needsUpdate: true});
  weave.repeat.set(24, 24);
  return weave;
}

// fireproof suit cloth: matte, with a cloth sheen at grazing angles and the weave up close
const suitMaterial = color => new THREE.MeshPhysicalMaterial({color, roughness: 0.85, sheen: 1, sheenRoughness: 0.5,
  sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), normalMap: fabric(), normalScale: new THREE.Vector2(0.35, 0.35)});

// ---------- the whole driver (rb22.js) ----------

const shared = new Map();  // head + wheel -> merged geometry, shared by every car with that cockpit (never disposed)
const one = list => mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)));

// The driver seated at head, hands on the steering wheel (a Group whose rotation.x turns it, in the same frame as the
// driver). helmet / accent / suit: colours. Adds the body and arms to `parent` and the gloves to the wheel. Returns
// {materials (this driver's own, to dispose), head (the helmet's group, pivoting at the neck), pose()}: pose() puts the arms where the wheel's grips are now.
export function seatDriver(parent, wheel, head, {helmet, accent, suit}) {
  const key = [...head.toArray(), ...wheel.position.toArray()].map(v => v.toFixed(3)).join();
  if (!shared.has(key)) {
    const h = helmetGeometry(head);
    shared.set(key, {helmet: one(h.helmet), visor: one(h.visor), gear: one(h.gear), suit: one(bodyGeometry(head)),
      upper: one([limb(0.056, 0.047, UPPER)]), fore: one([limb(0.045, 0.036, FORE)]),
      gloves: one([-1, 1].map(z => limb(0.038, 0.034, 0.055).scale(1.3, 1, 1.05).translate(0, GRIP[0] - 0.028, z * GRIP[1])))});
  }
  const G = shared.get(key), mats = {helmet: helmetMaterial(helmet, accent), suit: suitMaterial(suit)};
  const mesh = (geo, mat) => Object.assign(new THREE.Mesh(geo, mat), {castShadow: true, receiveShadow: true});
  // the head turns about the neck (a pivot just below the helmet), which chassis() rolls and pitches with the g-forces;
  // its meshes are offset back by the pivot, so at rest they sit exactly where the merged geometry put them
  const neck = V(0.03, -0.22, 0).add(head), headGroup = new THREE.Group();
  headGroup.position.copy(neck);
  for (const m of [mesh(G.helmet, mats.helmet), mesh(G.visor, VISOR), mesh(G.gear, GEAR)]) { m.position.copy(neck).negate(); headGroup.add(m); }
  parent.add(headGroup, mesh(G.suit, mats.suit));
  wheel.add(mesh(G.gloves, mats.suit));
  const arms = [-1, 1].map(side => {
    const upper = mesh(G.upper, mats.suit), fore = mesh(G.fore, mats.suit);
    parent.add(upper, fore);
    return {side, upper, fore, S: V(0.04, -0.21, side * 0.17).add(head)};
  });
  const W = V(0, 0, 0), q = new THREE.Quaternion(), d = V(0, 0, 0);
  const orient = (o, a, b) => { o.position.copy(a); o.quaternion.copy(q.setFromUnitVectors(UP, d.subVectors(b, a).normalize())); };
  let posed = null;
  const pose = () => {
    const t = wheel.rotation.x;
    if (t === posed) return;
    posed = t;
    for (const {side, upper, fore, S} of arms) {
      const y = GRIP[0], z = side * GRIP[1];  // the grip, turned with the wheel; the wrist 5 cm behind it
      W.set(-0.05,y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)).add(wheel.position);
      const E = elbow(S, W, side);
      orient(upper, S, E); orient(fore, E, W);
    }
  };
  pose();
  return {materials: [mats.helmet, mats.helmet.map, mats.suit], pose, head: headGroup};
}
