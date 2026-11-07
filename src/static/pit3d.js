// Pit garages along the pit lane and the pit crews that service a stopped car. Built in metres (like the cars) and
// scaled to scene units by 1 / mps.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const BAY = 12;     // m between garage centres (the sim's box spacing)
const DOOR = 4.6;   // m, garage door height
const DEEP = 14;    // m, garage depth
const APRON = 2;    // m of working area between the lane's edge and the garage doors

const tint = (geo, color) => {
  const c = new THREE.Color(color), n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({length: n}, () => [c.r, c.g, c.b]).flat(), 3));
  return geo;
};

// Garages for boxes [{P (lane centre, scene), out (unit vector away from the track), color}]:
// per bay a floor, back wall and partitions under an upper floor, a team-colour band over the door, a lit ceiling
// panel inside, and the team's box painted on the lane (where the car stops). laneHalf: m. Returns the meshes.
export function garages(boxes, mps, laneHalf) {
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const parts = {shell: [], upper: [], glass: [], band: [], light: [], paint: []}, m = new THREE.Matrix4(), s = 1 / mps;
  for (const {P, out, color} of boxes) {
    const up = new THREE.Vector3(0, 1, 0), z0 = laneHalf + APRON;  // m from the lane's centre to the doors
    // a right-handed basis (x = up x z), or the mirrored boxes would face inside out; a bay is symmetric in x
    const x = new THREE.Vector3().crossVectors(up, out);
    m.makeBasis(x, up, out).scale(new THREE.Vector3(s, s, s)).setPosition(P);
    const put = (list, g) => list.push(g.applyMatrix4(m));
    put(parts.shell, box(BAY, 0.1, DEEP, 0, -0.05, z0 + DEEP / 2));                   // floor
    put(parts.shell, box(BAY, DOOR, 0.3, 0, DOOR / 2, z0 + DEEP));                    // back wall
    for (const x of [-BAY / 2, BAY / 2]) put(parts.shell, box(0.6, DOOR, DEEP, x, DOOR / 2, z0 + DEEP / 2));  // partitions
    put(parts.upper, box(BAY, 4, DEEP + 1.5, 0, DOOR + 2.6, z0 + DEEP / 2 - 0.75));   // upper floor, overhanging the doors
    put(parts.upper, box(BAY, 0.35, DEEP + 3, 0, DOOR + 4.8, z0 + DEEP / 2 - 1.5));   // the roof, its edge shading the windows
    put(parts.glass, box(BAY - 0.5, 2.4, 0.08, 0, DOOR + 2.7, z0 - 1.54));            // the hospitality floor's window band
    put(parts.band, tint(box(BAY - 0.6, 0.6, 0.2, 0, DOOR + 0.3, z0 - 0.75), color));
    put(parts.light, new THREE.PlaneGeometry(BAY - 2, DEEP - 2).rotateX(Math.PI / 2).translate(0, DOOR - 0.02, z0 + DEEP / 2));
    // the box: a team-colour rectangle where the car stops, 6.4 x 2.6 m
    for (const [w, d, x, z] of [[6.4, 0.12, 0, -1.3], [6.4, 0.12, 0, 1.3], [0.12, 2.6, -3.2, 0], [0.12, 2.6, 3.2, 0]])
      put(parts.paint, tint(box(w, 0.01, d, x, 0.03, z), color));
  }
  const mesh = (list, material, cast = true) => {
    const o = new THREE.Mesh(mergeGeometries(list), material);
    o.castShadow = cast;
    o.receiveShadow = true;
    o.userData.own = true;  // its material goes with it
    return o;
  };
  if (!boxes.length) return [];
  return [
    mesh(parts.shell, new THREE.MeshStandardMaterial({color: 0x9da1a6, roughness: 0.6})),
    mesh(parts.upper, new THREE.MeshStandardMaterial({color: 0xe4e6e9, roughness: 0.8})),
    mesh(parts.glass, new THREE.MeshStandardMaterial({color: 0x10151b, roughness: 0.08, metalness: 0.85}), false),
    mesh(parts.band, new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.5}), false),
    mesh(parts.light, new THREE.MeshStandardMaterial({color: 0x111111, emissive: 0xf4f6ff, emissiveIntensity: 1.2}), false),
    mesh(parts.paint, new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.7}), false),
  ];
}

// ---------- crew ----------

// One crew member in metres, feet on y = 0: legs, torso and arms (the suit), and a helmet.
const SUIT = mergeGeometries([
  ...[-0.1, 0.1].map(x => new THREE.CapsuleGeometry(0.08, 0.7, 4, 8).translate(x, 0.43, 0)),
  new THREE.CapsuleGeometry(0.17, 0.42, 4, 10).translate(0, 1.14, 0),
  ...[-0.26, 0.26].map(x => new THREE.CapsuleGeometry(0.06, 0.55, 4, 8).translate(x, 1.12, 0)),
]);
const HELMET = new THREE.SphereGeometry(0.15, 16, 12).scale(1, 1.05, 1.1).translate(0, 1.67, 0);

// Where each of a stop's 17 crew works, in the car's frame (m, +x forward, +z right) and how low (1 standing, 0.6
// kneeling): the front and rear jacks, three per wheel (gun, tyre off, tyre on), two holding the car upright and
// the release controller ahead of the car on the garage side (g: +1 or -1, the garage's side in z).
function stations(car, g) {
  const L = car.len ?? 5.4, fx = car.hubs ? car.hubs[0][0] : L / 2 - 1.15, rx = car.hubs ? car.hubs[2][0] : fx - (car.wb ?? 3.4);
  const tz = car.hubs ? Math.abs(car.hubs[0][1]) : 0.78, out = [[L / 2 + 0.9, 0, 1], [-L / 2 - 0.9, 0, 1]];
  for (const x of [fx, rx]) for (const z of [-1, 1]) out.push([x, z * (tz + 0.7), 0.6], [x - 0.55, z * (tz + 1.25), 0.8], [x + 0.55, z * (tz + 1.25), 0.8]);
  out.push([0.3, -1.45, 0.85], [0.3, 1.45, 0.85], [L / 2 + 2.2, g * 1.8, 1]);
  return out;
}

const IN = 0.4, OUT = 1.2, LINGER = 2;  // s: rushing out to the car, walking back, then standing at the garage

// Crews for up to `max` simultaneous stops. track(id, car, stopped, side, color, simDt) per car per frame; a car that
// stops off the track (in the pit lane) gets a crew at that spot until it has driven off and the crew walked back.
export function createCrews(max = 4) {
  const group = new THREE.Group(), suitMat = new THREE.MeshStandardMaterial({roughness: 0.75});
  const helmetMat = new THREE.MeshPhysicalMaterial({color: 0x17181c, roughness: 0.3, clearcoat: 1});
  const N = 17, slots = Array.from({length: max}, () => {
    const g = new THREE.Group(), suits = new THREE.InstancedMesh(SUIT, suitMat, N), helmets = new THREE.InstancedMesh(HELMET, helmetMat, N);
    for (const o of [suits, helmets]) { o.castShadow = true; o.frustumCulled = false; g.add(o); }
    g.visible = false;
    group.add(g);
    return {g, suits, helmets, id: null};
  });
  const state = {}, m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();

  function place(slot, work, from, f) {
    work.forEach(([x, z, low], i) => {
      const [x0, z0] = from[i], e = f * f * (3 - 2 * f), lowNow = 1 + (low - 1) * e;
      m.compose(p.set(x0 + (x - x0) * e, 0, z0 + (z - z0) * e), q, sc.set(1, lowNow, 1));
      slot.suits.setMatrixAt(i, m);
      slot.helmets.setMatrixAt(i, m);
    });
    slot.suits.instanceMatrix.needsUpdate = slot.helmets.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    track(id, car, stopped, side, color, simDt) {
      let s = state[id];
      if (!s && stopped) {
        const slot = slots.find(x => !x.id);
        if (!slot) return;
        slot.id = id;
        const work = stations(car, side);
        s = state[id] = {slot, work, from: work.map(([x, z]) => [x * 0.9, side * (4 + Math.abs(z) * 0.3)]), phase: 'in', t: 0};
        slot.g.position.copy(car.group.position);
        slot.g.rotation.set(0, car.group.rotation.y, 0);
        slot.g.scale.copy(car.group.scale);
        for (let i = 0; i < N; i++) slot.suits.setColorAt(i, new THREE.Color(color));  // team kit
        slot.suits.instanceColor.needsUpdate = true;
        slot.g.visible = true;
      }
      if (!s || simDt <= 0) return;
      s.t += simDt;
      if (s.phase === 'in' && s.t >= IN) { s.phase = 'work'; s.t = 0; }
      if (s.phase === 'work' && !stopped) { s.phase = 'out'; s.t = 0; }
      if (s.phase === 'out' && s.t > OUT + LINGER) {
        s.slot.g.visible = false;
        s.slot.id = null;
        delete state[id];
        return;
      }
      const f = s.phase === 'in' ? s.t / IN : s.phase === 'work' ? 1 : 1 - Math.min(1, s.t / OUT);
      place(s.slot, s.work, s.from, f);
    },
    clear() {
      for (const slot of slots) { slot.g.visible = false; slot.id = null; }
      for (const k of Object.keys(state)) delete state[k];
    },
  };
}
