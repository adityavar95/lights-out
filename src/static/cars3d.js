// Procedural F1 cars in real metres (+x forward, y up, wheels on y = 0), shaped after each era's regulations.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildRB22, rb22Ready, inkFor} from './rb22.js';
import {helmetGeometry, helmetMaterial, GEAR, VISOR} from './driver.js';

// Approximate dimensions per regulation era, in metres; each entry lists what changed that year.
// len/width/wb: overall length, width, wheelbase; fo: front axle to nose tip; tf/tr: front/rear tyre [radius, width];
// rim: rim radius (13" until 2021, 18" after); nose: high | step | finger | low; fw/rw: front/rear wing span;
// rwTop: rear wing top height; fin: shark fin 0 none, 1 small, 2 big; covers: wheel covers; wing22: curved
// ground-effect wings; pod: sidepod style.
const CHANGES = [
  [0, {len: 4.40, width: 2.00, wb: 2.95, fo: 0.95, tf: [0.33, 0.30], tr: [0.33, 0.38], rim: 0.165, nose: 'high',
       fw: 1.50, rw: 1.00, rwTop: 0.95, fin: 0, beam: true, flaps: 1, pod: 'box'}],
  [1998, {width: 1.80, len: 4.55, wb: 3.05, tf: [0.33, 0.27], tr: [0.33, 0.35], fw: 1.40, grooves: true, flaps: 2}],
  [2008, {fin: 2}],
  [2009, {len: 4.95, wb: 3.25, fo: 1.0, tf: [0.33, 0.245], tr: [0.33, 0.325], fw: 1.80, rw: 0.75, grooves: false, flaps: 3}],
  [2011, {fin: 0}],
  [2012, {nose: 'step', wb: 3.4}],
  [2014, {len: 5.10, wb: 3.45, fo: 1.05, fw: 1.65, nose: 'finger', beam: false, monkey: true, pod: 'coke'}],
  [2015, {nose: 'low'}],
  [2017, {len: 5.50, width: 2.00, wb: 3.6, fo: 1.1, tf: [0.33, 0.305], tr: [0.33, 0.405], fw: 1.80, rw: 0.95, rwTop: 0.80,
          fin: 2, tWing: true, monkey: false}],
  [2018, {fin: 1, tWing: false, halo: true}],
  [2019, {fw: 2.0}],
  [2022, {len: 5.63, fo: 1.15, tf: [0.36, 0.305], tr: [0.36, 0.405], rim: 0.23, covers: true, beam: true, wing22: true,
          rwTop: 0.87, pod: 'downwash', deflectors: true}],
  [2026, {len: 5.40, width: 1.90, wb: 3.4, fo: 1.1, tf: [0.355, 0.28], tr: [0.355, 0.375], fw: 1.90, beam: false,
          deflectors: false}],
];

export function spec(year) {
  let s = {}, era = 0;
  for (const [from, c] of CHANGES) if (year >= from) { s = {...s, ...c}; era = from; }
  return {...s, era};
}

// ---------- PBR textures, computed per texel (no image downloads) ----------

const fract = x => x - Math.floor(x);

// RGBA data texture from fn(u, v) -> [r, g, b, a] in 0..1. Holds vectors, not colours, so it stays out of sRGB decoding.
export function dataTex(size, fn, repeat = true) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      d.set(fn((x + 0.5) / size, (y + 0.5) / size).map(c => Math.round(THREE.MathUtils.clamp(c, 0, 1) * 255)), (y * size + x) * 4);
  const t = new THREE.DataTexture(d, size, size);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 16;  // three clamps it to what the GPU supports
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// tangent-space normal map of a height field h(u, v): central differences give the slope, n = normalize(-k dh/du, -k dh/dv, 1)
export function normalTex(size, h, k) {
  const e = 1 / size;
  return dataTex(size, (u, v) => {
    const dx = (h(u + e, v) - h(u - e, v)) / (2 * e) * k, dy = (h(u, v + e) - h(u, v - e)) / (2 * e) * k, l = Math.hypot(dx, dy, 1);
    return [(-dx / l + 1) / 2, (-dy / l + 1) / 2, (1 / l + 1) / 2, 1];
  });
}

// 2x2 twill carbon, 8 tows per tile: tow (i, j) shows warp (fibres along u) when (i + j) mod 4 < 2, else weft (along v),
// which makes the diagonal ribs. Each tow bulges across its width and dips where it passes under its neighbour.
const warp = (u, v) => (Math.floor(fract(u) * 8) + Math.floor(fract(v) * 8)) % 4 < 2;
const weave = (u, v) => {
  const a = Math.sin(Math.PI * fract(u * 8)), b = Math.sin(Math.PI * fract(v * 8));
  return warp(u, v) ? b * (0.7 + 0.3 * a) : a * (0.7 + 0.3 * b);
};
// anisotropyMap: rg = fibre direction in tangent space ([-1, 1] stored as [0, 1]), b = strength. Fibres scatter light
// into a highlight stretched across them, so the highlight flips between warp and weft tows as the view moves.
const carbonDir = dataTex(64, (u, v) => (warp(u, v) ? [1, 0.5, 1, 1] : [0.5, 1, 1, 1]));
const carbonNormal = normalTex(128, weave, 0.012);
carbonDir.repeat.set(40, 40);  // UVs are in metres on wings/floor: one 2.5 cm tile
carbonNormal.repeat.set(40, 40);

// brake disc face (cylinder cap UVs are planar, centred on 0.5): concentric machining grooves, and anisotropy running
// round the disc (tangent of the circle through each texel), so the highlight sweeps round as a radial streak
const discNormal = normalTex(256, (u, v) => Math.sin(Math.hypot(u - 0.5, v - 0.5) * 2 * Math.PI * 30), 0.0015);
const discDir = dataTex(128, (u, v) => {
  const x = u - 0.5, y = v - 0.5, l = Math.hypot(x, y) || 1;
  return [-y / l * 0.5 + 0.5, x / l * 0.5 + 0.5, 1, 1];
}, false);

// Two-lobe metallic paint. MeshPhysicalMaterial's base layer is the flake lobe: metallic, fairly rough, tinted by the
// paint. clearcoat is the second lobe: a clear lacquer (F0 0.04, near-mirror) lit with the unperturbed geometric normal.
// Flakes tilt only the base normal; once a flake cell is smaller than a pixel it is unresolvable, so the tilt fades out and
// the flakes survive only statistically, as the base lobe's roughness (no sparkling noise at a distance).
// From 2016 the finish is satin, no flakes: teams went matte to save the gloss's few hundred grams (Red Bull 2016,
// Ferrari 2019, McLaren 2020). bare (2022+ procedural cars): below 0.24 m the bodywork is unpainted carbon, as teams
// leave it to get down to the minimum weight; the RB22's model space is offset, so not there.
// Team liveries (2022+ cars; colour schemes only, no logos), in livery space: u along the car (0 rear, 1 nose tip),
// v up (0 floor, 1 top of the airbox). base everywhere; second below the line v = low[0] + low[1] u and/or behind u = rear;
// an accent band of half-width stripe[2] round v = stripe[0] + stripe[1] u, from u = stripe[3] for half the car's
// length; nose: the tip's colour forward of u = 0.9. Matched on the team's name, first match wins.
const LIVERIES = [
  [/racing bulls|visa|^rb\b|rb f1|alphatauri|toro rosso/, {base: 0xf2f3f5, second: 0x1638c8, accent: 0xe4002b, rear: 0.52, stripe: [0.42, 0, 0.035, 0.12]}],
  [/red bull/, {base: 0x1b2550, second: 0x0d1430, accent: 0xe4002b, low: [0.3, 0], stripe: [0.4, 0.06, 0.05, 0.22], nose: 0xffc906}],
  [/mclaren/, {base: 0xff8000, second: 0x16181c, accent: 0x47c7fc, low: [0.32, 0], rear: 0.3, stripe: [0.6, -0.1, 0.012, 0.35]}],
  [/ferrari/, {base: 0xd8000e, second: 0x111111, accent: 0xf6f6f6, low: [0.24, 0], stripe: [0.58, -0.18, 0.03, 0.25]}],
  [/mercedes/, {base: 0xc5c9cd, second: 0x0d0e10, accent: 0x00d2be, low: [0.62, -0.5], stripe: [0.34, 0.12, 0.022, 0.3]}],
  [/aston/, {base: 0x00594f, second: 0x033a32, accent: 0xcedc00, low: [0.28, 0], stripe: [0.44, 0.06, 0.03, 0.28]}],
  [/alpine|renault/, {base: 0x0a6fd0, second: 0xff7eb6, accent: 0xf6f6f6, rear: 0.42, stripe: [0.5, -0.05, 0.02, 0.45], nose: 0xff7eb6}],
  [/williams/, {base: 0x0b2b6e, second: 0x061c4a, accent: 0x00a3e0, low: [0.3, 0], stripe: [0.48, 0, 0.04, 0.2]}],
  [/haas/, {base: 0xf0f1f2, second: 0x17181b, accent: 0xe10600, low: [0.45, -0.15], stripe: [0.45, -0.15, 0.03, 0.15], nose: 0xe10600}],
  [/audi/, {base: 0xb6bbc0, second: 0x141517, accent: 0xe3000f, rear: 0.45, stripe: [0.4, 0, 0.03, 0.12], nose: 0xe3000f}],
  [/kick|stake|sauber/, {base: 0x39e51f, second: 0x121212, accent: 0x39e51f, low: [0.42, -0.2], rear: 0.32}],
  [/alfa romeo/, {base: 0xa40014, second: 0xf3f3f3, accent: 0x111111, rear: 0.45, stripe: [0.3, 0, 0.03, 0.5]}],
  [/cadillac/, {base: 0x111214, second: 0xf2f2f2, accent: 0xc9a54d, rear: 0.5, stripe: [0.44, 0, 0.018, 0.2]}],
];

// The livery for a team (name), from LIVERIES or, before 2022 or for a team it lacks, one made from the team colour:
// that colour over a darker lower body with a thin contrasting band. Colours as THREE.Color.
export function livery(team, color, year) {
  const hit = year >= 2022 && LIVERIES.find(([re]) => re.test((team ?? '').toLowerCase()))?.[1];
  const L = hit || {base: color, second: new THREE.Color(color).multiplyScalar(0.45), accent: inkFor(color), low: [0.28, 0], stripe: [0.5, 0, 0.02, 0.2]};
  const c = x => new THREE.Color(x);
  return {base: c(L.base), second: c(L.second), accent: c(L.accent), nose: c(L.nose ?? L.base),
          split: new THREE.Vector4(...(L.low ?? [-1, 0]), L.rear ?? -1, 0), stripe: new THREE.Vector4(...(L.stripe ?? [0, 0, 0, 0])),
          noseAt: L.nose ? 0.9 : 2};
}

// mesh-local position -> livery space; box: the paint's bounds in the car's frame (x forward, y up, z across, metres),
// toCar: mesh-local -> car frame
function liveryFrame(box, toCar = new THREE.Matrix4()) {
  const s = box.getSize(new THREE.Vector3()), w = Math.max(-box.min.z, box.max.z);
  return new THREE.Matrix4().makeScale(1 / s.x, 1 / s.y, 1 / w).multiply(new THREE.Matrix4().makeTranslation(-box.min.x, -box.min.y, 0)).multiply(toCar);
}

// liv: livery(), painted in livery space (userData.toCar: mesh-local -> livery space, set by the car's builder). A map's
// alpha marks what's painted on top (the RB22's race number) in its own colour.
function paintMat(color, year, bare = year >= 2022, liv = livery(null, color, year)) {
  const satin = year >= 2016;
  const m = new THREE.MeshPhysicalMaterial(satin ? {color, metalness: 0.1, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3}
                                                 : {color, metalness: 0.45, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.03});
  const u = m.userData = {livery: true, toCar: {value: new THREE.Matrix4()}, uBase: {value: liv.base}, uSecond: {value: liv.second},
                          uAccent: {value: liv.accent}, uNoseCol: {value: liv.nose}, uSplit: {value: liv.split}, uStripe: {value: liv.stripe},
                          uNoseAt: {value: liv.noseAt}};
  m.onBeforeCompile = s => {
    s.uniforms.uBare = {value: bare ? 0.24 : -1};
    Object.assign(s.uniforms, {uToCar: u.toCar, uBase: u.uBase, uSecond: u.uSecond, uAccent: u.uAccent, uNoseCol: u.uNoseCol,
                               uSplit: u.uSplit, uStripe: u.uStripe, uNoseAt: u.uNoseAt});
    s.vertexShader = 'varying vec3 vObj;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    s.fragmentShader = `uniform float uBare, uNoseAt;\nuniform vec3 uBase, uSecond, uAccent, uNoseCol;\nuniform vec4 uSplit, uStripe;
      uniform mat4 uToCar;\nvarying vec3 vObj;\n` + s.fragmentShader
      .replace('#include <map_fragment>', `
        vec3 lp = (uToCar * vec4(vObj, 1.0)).xyz;
        float aa = fwidth(lp.x) + fwidth(lp.y);  // a pixel in livery space: edges anti-aliased, not stair-stepped
        vec3 liv = mix(uBase, uSecond, max(smoothstep(aa, -aa, lp.y - uSplit.x - uSplit.y * lp.x), smoothstep(aa, -aa, lp.x - uSplit.z)));
        float band = smoothstep(aa, -aa, abs(lp.y - uStripe.x - uStripe.y * lp.x) - uStripe.z)
                   * smoothstep(-aa, aa, lp.x - uStripe.w) * smoothstep(aa, -aa, lp.x - uStripe.w - 0.5);
        liv = mix(mix(liv, uAccent, band), uNoseCol, smoothstep(-aa, aa, lp.x - uNoseAt));
        #ifdef USE_MAP
          vec4 painted = texture2D(map, vMapUv);
          liv = mix(liv, painted.rgb, painted.a);
        #endif
        diffuseColor.rgb = liv;
        float bare = 1.0 - smoothstep(uBare - 0.004, uBare + 0.004, vObj.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008, 0.0085, 0.01), bare);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, bare);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, bare);')
      .replace('#include <normal_fragment_maps>', satin ? '#include <normal_fragment_maps>' : `#include <normal_fragment_maps>
      {
        vec3 f = vObj * 500.0;  // 2 mm flake cells (model space is metres)
        vec3 c = floor(f);
        vec3 tilt = fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)),
                                   dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453) - 0.5;
        normal = normalize(normal + tilt * 0.1 * (1.0 - smoothstep(0.3, 1.0, length(fwidth(f)))));  // a glint, not sandpaper
      }`);
  };
  m.customProgramCacheKey = () => `paint${+satin}`;  // uBare is a uniform: bare and painted cars share a program
  return m;
}

// carbon discs glow from ~700 °C: emissive black-body orange, driven per car by scene3d.js (emissiveIntensity)
const discMat = () => Object.assign(MAT.disc.clone(), {emissive: new THREE.Color(0xff4a12), emissiveIntensity: 0});

const MAT = {
  // clear resin over the weave: the weave bumps the base normal, the clearcoat stays smooth (another two-lobe material)
  carbon: new THREE.MeshPhysicalMaterial({color: 0x16171b, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.08,
                                          normalMap: carbonNormal, anisotropy: 0.7, anisotropyMap: carbonDir}),
  disc: new THREE.MeshPhysicalMaterial({color: 0x2b2b2e, roughness: 0.5, metalness: 0.4, normalMap: discNormal,
                                        anisotropy: 0.8, anisotropyMap: discDir}),
  tyre: new THREE.MeshStandardMaterial({color: 0x1d1d1f, roughness: 0.82}),
  rim: new THREE.MeshStandardMaterial({color: 0x34363b, roughness: 0.32, metalness: 0.85}),
  dark: new THREE.MeshPhysicalMaterial({color: 0x050506, roughness: 0.12, metalness: 0.1, clearcoat: 1}),
  light: new THREE.MeshStandardMaterial({color: 0x400000, emissive: 0xff2010, emissiveIntensity: 2}),
  visor: VISOR, gear: GEAR,
};

// ---------- geometry helpers (all return BufferGeometry in metres) ----------

const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3);

// Catmull-Rom between cross-sections so bodies come out smooth
function smooth(secs, k = 5) {
  const out = [], g = j => secs[Math.min(Math.max(j, 0), secs.length - 1)];
  for (let i = 0; i < secs.length - 1; i++)
    for (let s = 0; s < k; s++) out.push(secs[i].map((_, c) => cr(g(i - 1)[c], g(i)[c], g(i + 1)[c], g(i + 2)[c], s / k)));
  out.push(secs.at(-1));
  return out;
}

// [halfWidth, bottom, top] of a lofted body at x (rings sorted front to rear)
function at(rings, x) {
  const i = Math.max(0, rings.findIndex(r => r[0] <= x) - 1), a = rings[i], b = rings[i + 1] ?? a;
  const f = a[0] === b[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
  return [1, 2, 3].map(c => a[c] + (b[c] - a[c]) * f);
}

// body through cross-sections [x, halfWidth, bottom, top, squareness] listed front to rear: superellipse rings, capped
function loft(secs, z = 0) {
  const rings = smooth(secs), seg = 28, pos = [], idx = [];
  for (const [x, hw, y0, y1, n] of rings)
    for (let j = 0; j < seg; j++) {
      const a = j / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), e = 2 / n;
      pos.push(x, (y0 + y1) / 2 + Math.sign(s) * Math.abs(s) ** e * (y1 - y0) / 2, z + Math.sign(c) * Math.abs(c) ** e * hw);
    }
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + (j + 1) % seg;
      idx.push(a, b, a + seg, b, b + seg, a + seg);
    }
  for (const r of [0, rings.length - 1]) {  // caps get their own vertices so they shade flat
    const base = pos.length / 3, [x, , y0, y1] = rings[r];
    pos.push(x, (y0 + y1) / 2, z, ...pos.slice(r * seg * 3, (r + 1) * seg * 3));
    for (let j = 0; j < seg; j++) {
      const a = base + 1 + j, b = base + 1 + (j + 1) % seg;
      idx.push(...(r ? [base, a, b] : [base, b, a]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.rings = rings;
  return g;
}

// inverted (downforce) wing section, leading edge at x = 0, trailing edge at x = -chord
function airfoil(chord, t, camber) {
  const up = [], lo = [], N = 12;
  for (let i = 0; i <= N; i++) {
    const u = (1 - Math.cos(i / N * Math.PI)) / 2;  // points bunched at the edges
    const th = 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    const yc = -camber * 4 * u * (1 - u);
    up.push(new THREE.Vector2(-u * chord, (yc + th) * chord));
    lo.push(new THREE.Vector2(-u * chord, (yc - th) * chord));
  }
  return new THREE.Shape([...up, ...lo.reverse().slice(1, -1)]);
}

// wing element spanning z0..z1; aoa in degrees (trailing edge up); lift(z) bends it upwards along the span
function wing(chord, z0, z1, aoa, x, y, lift = null, t = 0.1, camber = 0.06) {
  const span = z1 - z0;
  const g = new THREE.ExtrudeGeometry(airfoil(chord, t, camber), {depth: span, bevelEnabled: false, steps: Math.max(1, Math.round(span / 0.06))});
  g.rotateZ(-aoa * Math.PI / 180).translate(x, y, z0);
  if (lift) bend(g, lift);
  return g;
}

function bend(g, lift) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + lift(p.getZ(i)));
  g.computeVertexNormals();
}

// flat plate from a side profile [[x, y], ...], centred on z
function plate(pts, z, thick = 0.012) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), {depth: thick, bevelEnabled: false});
  return g.translate(0, 0, z - thick / 2);
}

// plate lying flat from a top-view outline [[x, z], ...] at height y
function floorPlate(pts, y, thick = 0.02) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z))), {depth: thick, bevelEnabled: false});
  return g.rotateX(Math.PI / 2).translate(0, y + thick, 0);
}

function rod(a, b, r = 0.012) {
  const d = new THREE.Vector3().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smoothstep = (a, b, v) => THREE.MathUtils.smoothstep(v, a, b);

// ---------- car template, shared by every car of an era ----------

// tyre lathed from its cross-section, axle along z
function wheel(P, s, [r, w], x, z, stripes) {
  const sh = 0.035, prof = [[s.rim, -w / 2], [r - sh, -w / 2]];
  for (let i = 1; i <= 4; i++) { const a = i / 4 * Math.PI / 2; prof.push([r - sh + Math.sin(a) * sh, -w / 2 + sh - Math.cos(a) * sh]); }
  for (let i = 0; i <= 4; i++) { const a = i / 4 * Math.PI / 2; prof.push([r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh]); }
  prof.push([s.rim, w / 2]);
  const place = g => g.rotateX(Math.PI / 2).translate(x, r, z);
  P.tyre.push(place(new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 40)));
  P.rim.push(place(new THREE.CylinderGeometry(s.rim, s.rim, w * 0.9, 24, 1, true)));
  const face = Math.sign(z) * (w / 2 - 0.03);  // outer face of the rim, set into the tyre
  if (s.covers) P.carbon.push(place(new THREE.CylinderGeometry(s.rim * 0.98, s.rim * 0.98, 0.01, 24).translate(0, face, 0)));
  else for (let k = 0; k < 5; k++)  // open spokes, so the brake disc shows through
    P.rim.push(place(new THREE.BoxGeometry(s.rim * 0.95, 0.02, 0.035).translate(s.rim * 0.475, face, 0).rotateY(k * Math.PI * 0.4)));
  const rd = Math.min(s.rim * 0.8, 0.164);  // 278-328 mm carbon discs
  P.disc.push(place(new THREE.CylinderGeometry(rd, rd, 0.032, 40).translate(0, Math.sign(z) * (w / 2 - 0.12), 0)));
  P.dark.push(place(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12).translate(0, face + Math.sign(z) * 0.012, 0)));  // wheel nut
  for (const side of [-1, 1])  // compound marking on each sidewall
    stripes.push(place(new THREE.TorusGeometry(r - 0.075, 0.009, 6, 48).rotateX(Math.PI / 2).translate(0, side * (w / 2 + 0.002), 0)));
  if (s.grooves) for (const f of [-0.3, -0.1, 0.1, 0.3])
    P.dark.push(place(new THREE.TorusGeometry(r + 0.0005, 0.006, 4, 48).rotateX(Math.PI / 2).translate(0, f * w, 0)));
}

function suspension(P, x, r, wz, inZ, inY, dir) {
  const o = Math.sign(wz) * (Math.abs(wz) - 0.12);  // upright, inside the wheel
  for (const [dy, iy] of [[0.11, inY[1]], [-0.12, inY[0]]])
    for (const dx of [0.22, -0.22]) P.carbon.push(rod(V(x, r + dy, o), V(x + dx * dir, iy, Math.sign(wz) * inZ)));
  P.carbon.push(rod(V(x + 0.08 * dir, r, o), V(x + 0.08 * dir, inY[0] + 0.05, Math.sign(wz) * inZ)));  // track / toe rod
}

function build(year) {
  const s = spec(year), P = {paint: [], carbon: [], disc: [], tyre: [], rim: [], dark: [], light: [], halo: [], helmet: [], visor: [], gear: [], stripe: []};
  const tipX = s.len / 2, fx = tipX - s.fo, rx = fx - s.wb, hx = rx + 0.43 * s.wb, modern = s.era >= 2017;
  const ro = s.len - s.fo - s.wb;  // rear overhang: rear axle to the back of the car

  // monocoque and nose, front to rear
  const nose = {
    high: [[tipX - 0.03, 0.04, 0.26, 0.33, 2.5], [fx + 0.3, 0.09, 0.26, 0.45, 2.5], [fx, 0.13, 0.27, 0.53, 2.5]],
    step: [[tipX - 0.03, 0.05, 0.22, 0.30, 2.5], [fx + 0.3, 0.09, 0.22, 0.43, 2.5], [fx - 0.05, 0.12, 0.24, 0.47, 2.5], [fx - 0.25, 0.18, 0.2, 0.62, 3]],
    finger: [[tipX - 0.02, 0.03, 0.11, 0.17, 2], [tipX - 0.3, 0.05, 0.13, 0.24, 2.5], [fx + 0.25, 0.1, 0.17, 0.42, 2.5], [fx - 0.1, 0.15, 0.2, 0.55, 2.5]],
    low: [[tipX - 0.02, 0.07, 0.10, 0.22, 2.5], [fx + 0.4, 0.1, 0.13, 0.33, 2.5], [fx, 0.14, 0.18, 0.50, 2.8]],
  }[s.nose];
  const chassis = loft([...nose,
    [hx + 0.75, 0.22, 0.06, 0.62, 3], [hx + 0.35, 0.27, 0.05, 0.63, 3], [hx, 0.29, 0.05, 0.58, 3],
    [hx - 0.35, 0.3, 0.05, 0.62, 3], [rx + 0.6, 0.2, 0.1, 0.52, 3], [rx + 0.12, 0.12, 0.16, 0.42, 3], [rx - 0.38, 0.05, 0.22, 0.3, 2.5]]);
  P.paint.push(chassis);
  const cockpitY = at(chassis.rings, hx)[2];

  // airbox / engine cover spine from the roll hoop back to the rear wing
  const airbox = loft([[hx - 0.18, 0.11, cockpitY - 0.05, 0.94, 2.5], [hx - 0.35, 0.13, 0.5, 0.95, 2.5], [hx - 0.8, 0.1, 0.45, 0.78, 2.5],
                       [rx + 0.35, 0.05, 0.35, 0.55, 2.5], [rx - 0.1, 0.03, 0.3, 0.4, 2]]);
  P.paint.push(airbox);
  P.dark.push(new THREE.SphereGeometry(0.085, 16, 10).scale(0.3, 0.75, 1).translate(hx - 0.18, 0.86, 0));  // intake
  P.carbon.push(new THREE.BoxGeometry(0.1, 0.05, 0.06).translate(hx - 0.32, 0.97, 0));  // T-cam

  // sidepods
  const pod = {
    box: [[hx + 0.35, 0.62, 0.07, 0.5, 4], [hx - 0.1, 0.64, 0.07, 0.5, 4], [rx + 0.75, 0.45, 0.08, 0.45, 3.5], [rx + 0.3, 0.22, 0.12, 0.38, 3]],
    coke: [[hx + 0.3, 0.6, 0.07, 0.55, 4], [hx - 0.15, 0.62, 0.07, 0.52, 3.5], [rx + 0.8, 0.36, 0.08, 0.45, 3], [rx + 0.25, 0.18, 0.12, 0.38, 3]],
    downwash: [[hx + 0.3, 0.6, 0.24, 0.56, 4], [hx - 0.15, 0.65, 0.18, 0.5, 3.5], [rx + 0.85, 0.42, 0.1, 0.36, 3], [rx + 0.25, 0.18, 0.12, 0.32, 3]],
  }[s.pod];
  P.paint.push(loft(pod));
  for (const z of [-1, 1]) P.dark.push(new THREE.BoxGeometry(0.02, 0.16, 0.24).translate(pod[0][0] + 0.005, (pod[0][2] + pod[0][3]) / 2, z * 0.42));

  // floor, diffuser, bargeboards
  const fz = s.width / 2 - s.tr[1] - 0.04;
  P.carbon.push(floorPlate([[hx + 0.9, -0.3], [hx + 0.55, -0.8], [rx + 0.55, -0.8], [rx + 0.35, -fz], [rx - 0.25, -fz],
                            [rx - 0.25, fz], [rx + 0.35, fz], [rx + 0.55, 0.8], [hx + 0.55, 0.8], [hx + 0.9, 0.3]], 0.03));
  P.carbon.push(new THREE.BoxGeometry(ro * 0.85, 0.015, fz * 2).rotateZ(-0.3).translate(rx - 0.15 - ro * 0.4, 0.04 + ro * 0.13, 0));
  for (const z of [-0.6, -0.25, 0.25, 0.6]) P.carbon.push(plate([[rx - 0.2, 0.04], [rx - ro, 0.28], [rx - ro, 0.32], [rx - 0.2, 0.1]], z * fz / 0.6));
  if (s.era >= 1998 && s.era < 2022)
    for (const z of [-1, 1]) P.carbon.push(plate([[hx + 0.95, 0.05], [hx + 0.5, 0.05], [hx + 0.45, 0.32], [hx + 0.85, 0.25]], z * 0.5, 0.008));

  // front wing
  const fwX = tipX - 0.03, half = s.fw / 2, centre = 0.25;
  const curve = i => z => s.wing22 ? (0.03 + 0.03 * i) * smoothstep(centre, half, Math.abs(z)) : 0;
  P.carbon.push(wing(0.32, -half, half, 4, fwX, 0.075, curve(0)));
  for (let i = 1; i <= s.flaps; i++) {
    const chord = 0.2 - 0.03 * i, x = fwX - 0.2 - 0.07 * i, y = 0.09 + 0.045 * i, a = 12 + 10 * i;
    const mat = i === s.flaps ? P.paint : P.carbon;  // top flap carries the livery
    if (s.wing22) mat.push(wing(chord, -half, half, a, x, y, curve(i)));
    else for (const z of [-1, 1]) mat.push(wing(chord, z > 0 ? centre : -half, z > 0 ? half : -centre, a, x, y));
  }
  for (const z of [-1, 1]) {
    const top = s.wing22 ? 0.2 : 0.26;
    P.paint.push(plate([[fwX + 0.02, 0.03], [fwX - 0.45, 0.03], [fwX - 0.48, top], [fwX - 0.12, top * 0.6]], z * half, 0.01));
    if (s.nose === 'high' || s.nose === 'step')  // pylons hanging the wing under a raised nose
      P.carbon.push(plate([[fwX - 0.08, 0.08], [fwX - 0.4, 0.08], [fwX - 0.35, 0.3], [fwX - 0.15, 0.3]], z * 0.1, 0.01));
  }

  // rear wing
  const rwX = rx - ro + 0.52, rhalf = s.rw / 2, top = s.rwTop;
  const droop = z => s.wing22 ? -0.14 * smoothstep(rhalf - 0.18, rhalf, Math.abs(z)) : 0;  // tips roll down into the endplates
  P.carbon.push(wing(0.34, -rhalf, rhalf, 10, rwX, top - 0.24, droop, 0.12, 0.07));
  P.paint.push(wing(0.22, -rhalf, rhalf, 32, rwX - 0.28, top - 0.1, droop, 0.08, 0.05));
  if (s.era < 2009) P.carbon.push(wing(0.18, -rhalf, rhalf, 20, rwX - 0.05, top - 0.42));  // extra lower element
  for (const z of [-1, 1]) {
    const lowY = s.wing22 ? top - 0.36 : 0.3;
    P.paint.push(plate([[rwX + 0.05, lowY], [rwX - 0.52, lowY + 0.05], [rwX - 0.52, top + 0.02], [rwX + 0.02, top]], z * (rhalf + 0.006)));
  }
  P.carbon.push(plate([[rx - 0.25, 0.28], [rx - 0.42, 0.28], [rwX - 0.2, top - 0.22], [rwX - 0.05, top - 0.22]], 0, 0.02));  // pylon
  if (s.beam) P.carbon.push(wing(0.16, -fz * 0.8, fz * 0.8, 8, rx - 0.35, 0.38));
  if (s.monkey) P.carbon.push(wing(0.12, -0.15, 0.15, 15, rx - 0.3, 0.48));
  if (s.tWing) P.carbon.push(wing(0.1, -0.25, 0.25, 15, rx + 0.1, 0.86));
  P.light.push(new THREE.BoxGeometry(0.03, 0.05, 0.08).translate(rx - 0.42, 0.26, 0));

  // shark fin
  if (s.fin === 2) P.paint.push(plate([[hx - 0.35, 0.92], [rwX - 0.35, top - 0.08], [rwX - 0.3, 0.55], [rx + 0.4, 0.5], [hx - 0.6, 0.72]], 0, 0.008));
  if (s.fin === 1) P.paint.push(plate([[hx - 0.4, 0.88], [rx + 0.2, 0.62], [rx + 0.15, 0.5], [hx - 0.6, 0.7]], 0, 0.008));

  // wheels and suspension
  const zf = s.width / 2 - s.tf[1] / 2, zr = s.width / 2 - s.tr[1] / 2;
  for (const z of [-1, 1]) {
    wheel(P, s, s.tf, fx, z * zf, P.stripe);
    wheel(P, s, s.tr, rx, z * zr, P.stripe);
    suspension(P, fx, s.tf[0], z * zf, 0.15, [0.22, 0.45], -1);
    suspension(P, rx, s.tr[0], z * zr, 0.12, [0.2, 0.38], 1);
    if (s.deflectors) P.carbon.push(wing(0.1, z * zf - 0.1, z * zf + 0.1, 10, fx + 0.12, 2 * s.tf[0] + 0.03));
    // mirrors on stalks
    const mz = z * (modern ? 0.48 : 0.42), my = modern ? 0.68 : 0.64;
    P.carbon.push(rod(V(hx + 0.45, cockpitY - 0.02, z * 0.25), V(hx + 0.47, my, mz), 0.008));
    P.paint.push(new THREE.BoxGeometry(0.06, 0.06, 0.13).translate(hx + 0.47, my, mz));
  }

  // cockpit opening and driver
  P.dark.push(new THREE.CircleGeometry(1, 24).scale(0.42, 0.24, 1).rotateX(-Math.PI / 2).translate(hx + 0.05, cockpitY + 0.004, 0));
  const head = V(hx - 0.02, cockpitY + 0.12, 0);
  for (const [k, list] of Object.entries(helmetGeometry(head, s.era >= 2008))) P[k].push(...list);  // HANS: mandatory from 2003

  // halo: hoop round the head, centre pillar down to the chassis, two rear mounts
  if (s.halo) {
    const r = 0.28, hy = head.y + 0.06, cx = hx - 0.05;
    P.halo.push(new THREE.TorusGeometry(r, 0.022, 10, 28, Math.PI).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2).translate(cx, hy, 0),
      rod(V(cx + r, hy, 0), V(hx + 0.6, at(chassis.rings, hx + 0.6)[2] - 0.01, 0), 0.022),
      ...[-1, 1].map(z => rod(V(cx, hy, z * r), V(cx - 0.08, cockpitY - 0.02, z * r), 0.022)));
  }

  const merged = {};
  for (const [k, list] of Object.entries(P))
    if (list.length) merged[k] = mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)));
  return {s, geo: merged, nose: [fx + 0.15, at(chassis.rings, fx + 0.15)[2]], cover: [hx - 0.5, ...at(airbox.rings, hx - 0.5)],
          eye: V(head.x + 0.06, head.y + 0.01, 0), look: V(head.x + 15, 0.55, 0),
          tcam: V(hx - 0.32, 1.06, 0), tcamLook: V(hx + 15, 0.4, 0),  // just above the T-cam pod on the airbox
          exhaust: V(rx - 0.42, 0.42, 0), plank: [rx + 0.2, hx + 0.6], fronts: [-1, 1].map(z => V(fx, 0.05, z * zf))};
}

const templates = {};

function numberDecal(num) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '900 italic 92px "Titillium Web", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#111';
  g.strokeText(num, 64, 70);
  g.fillStyle = '#fff';
  g.fillText(num, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // lit like the paint it's on (unlit, it glowed in shadow and in the Monaco tunnel)
  return new THREE.MeshStandardMaterial({map: t, roughness: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -2});
}

// Soft contact shadows: one under the car, a tighter one under each tyre's contact patch where the shadow maps can't
// resolve the gap; one mesh (one draw call), on layer 1, which the motion-vector pass skips. tyres: [[x, z, radius,
// width]]. Returns the mesh.
function contactShadows(body, blob, len, width, tyres) {
  const planes = [[0, 0, len * 1.1, width * 1.15], ...tyres.map(([x, z, r, w]) => [x, z, r * 1.6, w * 1.5])]
    .map(([x, z, l, w]) => new THREE.PlaneGeometry(l, w).rotateX(-Math.PI / 2).translate(x, 0.01, z));
  const shadow = new THREE.Mesh(mergeGeometries(planes), new THREE.MeshBasicMaterial({map: blob, transparent: true, depthWrite: false}));
  shadow.layers.set(1);
  body.add(shadow);
  return shadow;
}

// The 2026+ car: the RB22 model (rb22.js) up close, this era's procedural car beyond `far` scene units, as a THREE.LOD
// that the renderer switches per camera. Both levels share the procedural car's tyre-stripe and rear-light materials,
// so setTyre and the light flash drive both. The returned parts (body, eye, cameras, effects anchors) are the RB22's,
// plus wheels / steeringWheel / mirrors for scene3d.js to animate.
function withRB22(far, color, num, blob, dist, liv) {
  const near = buildRB22({paint: paintMat(0xffffff, 2026, false, liv), accent: liv.accent, ink: inkFor(liv.nose), num,
                          stripe: far.stripe, light: far.light, helmet: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55)});
  near.paintMesh.updateWorldMatrix(true, false);  // the car's frame: its group isn't in a scene yet
  near.paintMesh.material.userData.toCar.value.copy(liveryFrame(new THREE.Box3().setFromObject(near.paintMesh), near.paintMesh.matrixWorld));
  const shadow = contactShadows(near.body, blob, near.len, near.width, near.hubs);
  const lod = new THREE.LOD(), group = new THREE.Group();
  lod.addLevel(near.group, 0);
  lod.addLevel(far.group, dist);
  group.add(lod);
  return {...far, ...near, group, discs: [...far.discs, ...near.discs],
          dispose: () => { far.dispose(); near.dispose(); shadow.geometry.dispose(); shadow.material.dispose(); }};
}

// returns {group, body, halo, stripe, light, discs (brake-glow materials), len, wb, eye, look, tcam, tcamLook, exhaust, plank, fronts}; blob: soft
// contact-shadow texture; far: scene units beyond which a 2026+ car switches from the RB22 model to the procedural one,
// and past 5 x far (~250 m, a car under ~15 px) every car is only its paint and tyres: 2 draw calls instead of ~12
export function buildCar(color, num, year, blob, far = Infinity, team = null) {
  const t = templates[spec(year).era] ??= build(year), liv = livery(team, color, year);
  const paint = paintMat(color, year, year >= 2022, liv);
  t.geo.paint.boundingBox ?? t.geo.paint.computeBoundingBox();
  paint.userData.toCar.value.copy(liveryFrame(t.geo.paint.boundingBox));  // the era's geometry is in the car's frame
  const own = {
    paint, disc: discMat(), stripe: new THREE.MeshStandardMaterial({color: 0xd8d8d8, roughness: 0.7}),
    helmet: helmetMaterial(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55), liv.accent),
    light: MAT.light.clone(),  // per car: it flashes while that car harvests energy
  };
  const group = new THREE.Group(), body = new THREE.Group(), halo = new THREE.Group();
  const mesh = (geo, mat, shadow = true) => Object.assign(new THREE.Mesh(geo, mat), {castShadow: shadow});
  for (const [k, geo] of Object.entries(t.geo)) (k === 'halo' ? halo : body).add(mesh(geo, own[k] ?? MAT[k === 'halo' ? 'carbon' : k]));
  if (far < Infinity) {
    const lod = new THREE.LOD(), close = new THREE.Group(), tiny = new THREE.Group();
    close.add(body, halo);
    tiny.add(mesh(t.geo.paint, paint), mesh(t.geo.tyre, MAT.tyre, false));
    lod.addLevel(close, 0);
    lod.addLevel(tiny, far * 5);
    group.add(lod);
  } else group.add(body, halo);
  const s = t.s, fx = s.len / 2 - s.fo, tyres = [];
  for (const [x, [r, w]] of [[fx, s.tf], [fx - s.wb, s.tr]]) for (const z of [-1, 1]) tyres.push([x, z * (s.width / 2 - w / 2), r, w]);
  const shadow = contactShadows(body, blob, s.len, s.width, tyres);
  let decal = null;
  if (num !== null && num !== undefined) {
    decal = numberDecal(String(num));
    // nose (lies flat, reads from behind the car) and both airbox sides, as one mesh
    const plates = [new THREE.PlaneGeometry(0.28, 0.28).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2).translate(t.nose[0], t.nose[1] + 0.005, 0),
      ...[-1, 1].map(z => new THREE.PlaneGeometry(0.17, 0.17).rotateY(z > 0 ? 0 : Math.PI)
        .translate(t.cover[0], (t.cover[2] + t.cover[3]) / 2, z * (t.cover[1] + 0.004)))];
    body.add(new THREE.Mesh(mergeGeometries(plates), decal));
  }
  // frees what this car owns: its materials, decal and contact-shadow planes (the era's geometry and MAT are shared)
  const shared = new Set(Object.values(t.geo));
  const dispose = () => {
    for (const mt of Object.values(own)) mt.dispose();
    own.helmet.map.dispose();
    group.traverse(o => { if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose(); });
    shadow.material.dispose();
    decal?.map.dispose();
    decal?.dispose();
  };
  const car = {group, body, halo, stripe: own.stripe, light: own.light, discs: [own.disc], len: s.len, wb: s.wb, eye: t.eye, look: t.look, tcam: t.tcam,
               tcamLook: t.tcamLook, exhaust: t.exhaust, plank: t.plank, fronts: t.fronts, dispose};
  return s.era >= 2026 && rb22Ready() ? withRB22(car, color, num, blob, far, liv) : car;
}
