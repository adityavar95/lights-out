// Procedural F1 cars in real metres (+x forward, y up, wheels on y = 0), shaped after each era's regulations.
import * as THREE from 'three';
import {Fn, attribute, uniform, texture, uv, vec2, vec3, vec4, float, fract as nFract, floor, sin, dot, mix, smoothstep as nSmooth, fwidth, abs, max, length, normalize, mod,
        positionGeometry, normalGeometry, normalViewGeometry} from 'three/tsl';
import {mergeGeometries, toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
import {noise} from './track3d.js';
import {buildRB22, rb22Ready, inkFor} from './rb22.js';
import {helmetGeometry, helmetMaterial, GEAR, VISOR} from './driver.js';

// Approximate dimensions per regulation era, in metres; each entry lists what changed that year.
// len/width/wb: overall length, width, wheelbase; fo: front axle to nose tip; tf/tr: front/rear tyre [radius, width];
// rim, inch: rim radius and its size in inches; tub: fe | cigar | wedge | null (modern monocoque); air: engine cover (none:
// the engine out in the open); nose: high | step | finger | low | broad; fw/rw: front/rear wing span, 0 none; rwTop: rear wing
// top height; fin: shark fin 0 none, 1 small, 2 big; covers: wheel covers; wing22: curved ground-effect wings; pod: sidepod
// style, none before 1970; floorKind: flat floor's outline, none before 1977.
const CHANGES = [
  // front engine (Alfa 158, W196, 250F): narrow treaded tyres on 16" wire wheels, no wings, no floor
  [0, {len: 4.25, width: 1.62, wb: 2.4, fo: 0.42, tf: [0.36, 0.16], tr: [0.38, 0.19], rim: 0.205, inch: 16, tub: 'fe', air: 'none', nose: 'low',
       fw: 0, rw: 0, rwTop: 0, fin: 0, flaps: 0}],
  // Cooper puts the engine behind the driver and wins the title; a slim cigar on 15" wheels
  [1959, {len: 3.75, width: 1.52, wb: 2.3, fo: 0.55, tf: [0.3, 0.15], tr: [0.32, 0.2], rim: 0.19, inch: 15, tub: 'cigar'}],
  // 3-litre formula: slicks arrive and the tyres grow
  [1966, {len: 3.95, width: 1.72, wb: 2.4, tf: [0.29, 0.2], tr: [0.31, 0.29]}],
  // Lotus 49B's wings: front canards and a rear wing up on stalks off the suspension
  [1968, {width: 1.85, tf: [0.29, 0.25], tr: [0.31, 0.38], fw: 0.95, flaps: 0, canard: true, rw: 0.8, rwTop: 1.15, strut: true}],
  // Lotus 72's wedge, radiators out in sidepods, 13" rims, the wing down on the gearbox, tall periscope airboxes
  [1970, {len: 4.2, width: 2.05, wb: 2.55, fo: 0.8, tf: [0.31, 0.28], tr: [0.32, 0.45], rim: 0.165, inch: 13, tub: 'wedge', air: 'peri', canard: false, fw: 1.3, flaps: 1, rwTop: 0.95, strut: false, rw: 1.0, pod: 'box'}],
  // 1976 Spain: the airbox is cut down. 1977: Lotus 78 and ground effect, wide venturi pods sealed by skirts down to the road
  [1977, {air: 'low', pod: 'ge', floorKind: 'ge', len: 4.35, width: 2.15, wb: 2.7, fw: 1.3}],
  // 1983: flat bottoms, no skirts, short pods; turbos carry huge rear wings, a low monocoque nose
  [1983, {tub: null, air: 'mid', nose: 'low', pod: 'short', floorKind: 'flat', len: 4.4, width: 2.15, wb: 2.85, fo: 0.95, tf: [0.33, 0.3], tr: [0.33, 0.46], fw: 1.5, rw: 1.0, rwTop: 1.0, flaps: 1}],
  // Tyrrell's raised nose goes everywhere; 1993: 2 m wide, narrower rears, a lower rear wing
  [1991, {nose: 'high', len: 4.4, wb: 2.95}],
  [1993, {width: 2.0, tr: [0.33, 0.38], rwTop: 0.95, beam: true}],
  [1998, {width: 1.80, len: 4.55, wb: 3.05, tf: [0.33, 0.27], tr: [0.33, 0.35], fw: 1.40, grooves: true, flaps: 2}],
  [2008, {fin: 2}],
  [2009, {len: 4.95, wb: 3.25, fo: 1.0, tf: [0.33, 0.245], tr: [0.33, 0.325], fw: 1.80, rw: 0.75, grooves: false, flaps: 3}],
  [2011, {fin: 0}],
  [2012, {nose: 'step', wb: 3.4}],
  [2014, {len: 5.10, wb: 3.45, fo: 1.05, fw: 1.65, nose: 'finger', beam: false, monkey: true, pod: 'coke', air: 'blade'}],
  [2015, {nose: 'low'}],
  [2017, {len: 5.50, width: 2.00, wb: 3.6, fo: 1.1, tf: [0.33, 0.305], tr: [0.33, 0.405], fw: 1.80, rw: 0.95, rwTop: 0.80,
          fin: 2, tWing: true, monkey: false}],
  [2018, {fin: 1, tWing: false, halo: true}],
  [2019, {fw: 2.0}],
  [2022, {len: 5.63, fo: 1.15, tf: [0.36, 0.305], tr: [0.36, 0.405], rim: 0.23, inch: 18, covers: true, beam: true, wing22: true, nose: 'broad',
          rwTop: 0.87, pod: 'downwash', deflectors: true, floorKind: 'ground', fin: 0}],
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

// 2x2 twill: each tow passes over two and under two, shifted one per row, which gives carbon its diagonal stair-steps. The
// tow on top is resin-rich and glossier (roughness 0.22), the one going under sits in shadow and scatters more (0.45), and
// the clear resin over the weave stays smooth, so the clearcoat lobe keeps its sharp highlight above the weave's anisotropic one.
function twillCarbon() {
  const m = new THREE.MeshPhysicalNodeMaterial({color: 0x16171b, clearcoat: 0.35, clearcoatRoughness: 0.2, normalMap: carbonNormal, anisotropy: 0.65, anisotropyMap: carbonDir});
  const p = uv().mul(uniform(carbonNormal.repeat)).mul(8), cell = floor(p);
  const over = mod(cell.x.add(cell.y), 4).lessThan(2);
  m.roughnessNode = over.select(float(0.22), float(0.45));
  m.colorNode = over.select(vec3(0.0085, 0.009, 0.011), vec3(0.005, 0.0052, 0.0062));
  return m;
}

// liv: livery(), painted in livery space (userData.toCar: mesh-local -> livery space, set by the car's builder). A map's
// alpha marks what's painted on top (the RB22's race number) in its own colour.
function paintMat(color, year, bare = year >= 2022, liv = livery(null, color, year)) {
  const satin = year >= 2016;
  const m = new THREE.MeshPhysicalNodeMaterial({color, metalness: satin ? 0.1 : 0.45, roughness: satin ? 0.5 : 0.38, clearcoat: satin ? 0.55 : 1, clearcoatRoughness: satin ? 0.16 : 0.1, ior: 1.5});
  const u = m.userData = {livery: true, toCar: uniform(new THREE.Matrix4()), uBase: uniform(liv.base), uSecond: uniform(liv.second),
                          uAccent: uniform(liv.accent), uNoseCol: uniform(liv.nose), uSplit: uniform(liv.split), uStripe: uniform(liv.stripe),
                          uNoseAt: uniform(liv.noseAt)};
  const uBare = float(bare ? 0.24 : -1);
  const obj = positionGeometry;
  const bareMask = nSmooth(uBare.add(0.004), uBare.sub(0.004), obj.y);  // bare carbon below the floor line
  // a Fn with the builder's material, because the RB22 assigns its number map after creating the material
  m.colorNode = Fn(({material}) => {
    const lp = u.toCar.mul(vec4(obj, 1)).xyz;
    const aa = fwidth(lp.x).add(fwidth(lp.y));  // a pixel in livery space: edges anti-aliased, not stair-stepped
    const live = mix(u.uBase, u.uSecond, max(nSmooth(aa, aa.negate(), lp.y.sub(u.uSplit.x).sub(u.uSplit.y.mul(lp.x))), nSmooth(aa, aa.negate(), lp.x.sub(u.uSplit.z))));
    const band = nSmooth(aa, aa.negate(), abs(lp.y.sub(u.uStripe.x).sub(u.uStripe.y.mul(lp.x))).sub(u.uStripe.z))
      .mul(nSmooth(aa.negate(), aa, lp.x.sub(u.uStripe.w))).mul(nSmooth(aa, aa.negate(), lp.x.sub(u.uStripe.w).sub(0.5)));
    let c = mix(mix(live, u.uAccent, band), u.uNoseCol, nSmooth(aa.negate(), aa, lp.x.sub(u.uNoseAt)));
    if (material.map) {
      const painted = texture(material.map);
      c = mix(c, painted.rgb, painted.a);
    }
    return mix(c, vec3(0.008, 0.0085, 0.01), bareMask);
  })();
  m.roughnessNode = mix(float(satin ? 0.5 : 0.38), 0.32, bareMask);
  m.metalnessNode = mix(float(satin ? 0.1 : 0.45), 0, bareMask);
  if (!satin) {  // the flake lobe: 2 mm cells (model space is metres), each tilting the normal a little
    const f = obj.mul(500), c = floor(f);
    const tilt = nFract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))).mul(43758.5453)).sub(0.5);
    // a glint, not sandpaper: it fades out once the cells are under a pixel
    m.normalNode = normalize(normalViewGeometry.add(tilt.mul(0.1).mul(nSmooth(1, 0.3, length(fwidth(f))))));
  }
  return m;
}

// Carbon discs glow from ~700 C. userData.brakeTemp 0..1 is driven per car by scene3d.js: nothing cold, then dark red, then
// an HDR orange-yellow that the bloom picks up. base: the material to copy maps and PBR values from.
export function brakeMat(base) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  // not copy(): a node material's copy leaves the PBR values behind, as it isn't a MeshStandardMaterial
  for (const k of ['name', 'color', 'roughness', 'metalness', 'map', 'normalMap', 'normalScale', 'roughnessMap', 'metalnessMap', 'anisotropy', 'anisotropyMap']) if (base[k] !== undefined) m[k] = base[k];
  const t = uniform(0);
  m.userData = {brakeTemp: t};
  m.emissiveNode = mix(vec3(0.25, 0.01, 0), vec3(5.5, 1.1, 0.12), t.mul(t)).mul(nSmooth(0.02, 0.2, t));
  return m;
}

const MAT = {
  // clear resin over the weave: the weave bumps the base normal, the clearcoat stays smooth (another two-lobe material)
  carbon: twillCarbon(),
  tyre: new THREE.MeshStandardMaterial({color: 0x222224, roughness: 0.8}),
  floor: new THREE.MeshPhysicalMaterial({color: 0x08090a, roughness: 0.85, specularIntensity: 0.25}),  // plank and floor: no lacquer, or the sky whitens them at a low angle
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
  return toCreasedNormals(g, 0.7);  // an extrusion's flat facets caught the sun as bright blocks; the trailing edge stays sharp
}

function bend(g, lift) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + lift(p.getZ(i)));
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

// vertex attributes of a wheel's one merged mesh: base colour, [roughness, metalness], [compound stripe, brake glow, rubber]
function part(g, color, rough, metal, stripe = 0, glow = 0, rubber = 0) {
  const flat = g.index ? g.toNonIndexed() : g, n = flat.attributes.position.count, c = new THREE.Color(color);
  flat.deleteAttribute('uv');
  const fill = v => new THREE.Float32BufferAttribute(Array.from({length: n}, () => v).flat(), v.length);
  flat.setAttribute('wcol', fill([c.r, c.g, c.b]));
  flat.setAttribute('wpbr', fill([rough, metal]));
  flat.setAttribute('wmask', fill([stripe, glow, rubber]));
  return flat;
}

// One corner in its own frame, hub at the origin, axle along z, side: +1 the car's right. Everything that turns with the
// wheel is one mesh: one draw call a corner where tyres, rims, discs and stripes were four a car, and now they can roll and steer.
function corner(s, [r, w], side) {
  const sh = Math.min(0.05, w * 0.16), bulge = 0.012, prof = [[s.rim, -w / 2 + 0.012], [s.rim + (r - s.rim) * 0.5, -w / 2 - bulge], [r - sh, -w / 2]];
  for (let i = 1; i <= 5; i++) { const a = i / 5 * Math.PI / 2; prof.push([r - sh + Math.sin(a) * sh, -w / 2 + sh - Math.cos(a) * sh]); }
  for (let i = 0; i <= 5; i++) { const a = i / 5 * Math.PI / 2; prof.push([r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh]); }
  prof.push([s.rim + (r - s.rim) * 0.5, w / 2 + bulge], [s.rim, w / 2 - 0.012]);
  const tyre = 0x222224, metal = s.era >= 2022 ? 0x24262a : s.era < 1966 ? 0xb9bcc0 : 0x4a4d52, face = side * (w / 2 - 0.03);
  const parts = [part(new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 48), tyre, 0.78, 0, 0, 0, 1),
    part(new THREE.CylinderGeometry(s.rim, s.rim, w * 0.9, 32, 1, true), metal, 0.34, 0.9),
    part(new THREE.CylinderGeometry(s.rim * 0.82, s.rim * 0.82, 0.16, 20, 1, true).translate(0, side * (0.08 - w / 2), 0), 0x0c0c0e, 0.6, 0)];  // brake duct drum
  const spoke = (len, across, k, n) => new THREE.BoxGeometry(len, 0.016, across).translate(s.rim * 0.5, face, 0).rotateY(k * 2 * Math.PI / n);
  if (s.covers) {  // 18" aero covers, dished, with a turbine ring of slots
    parts.push(part(new THREE.CylinderGeometry(s.rim * 0.98, s.rim * 0.98, 0.008, 40).translate(0, face, 0), 0x121315, 0.42, 0.1));
    for (let k = 0; k < 12; k++) parts.push(part(new THREE.BoxGeometry(s.rim * 0.34, 0.004, 0.014).translate(s.rim * 0.68, face + side * 0.005, 0).rotateY(k * Math.PI / 6 + 0.25), metal, 0.3, 0.8));
  } else if (s.era < 1966) {  // wire wheels: a laced fan of spokes and a knock-off spinner
    for (let k = 0; k < 28; k++) parts.push(part(spoke(s.rim * 0.95, 0.005, k, 28), 0xc7c9cc, 0.3, 0.9));
    parts.push(part(new THREE.CylinderGeometry(0.03, 0.05, 0.06, 6).translate(0, face + side * 0.03, 0), 0xb9a15a, 0.3, 0.9));
  } else {
    const n = s.era >= 2009 ? 10 : s.era >= 1983 ? 6 : 4;  // cast 4-spokes, then forged 6s, then thin 10s
    for (let k = 0; k < n; k++) parts.push(part(spoke(s.rim * 0.95, s.era >= 2009 ? 0.018 : 0.04, k, n), metal, 0.32, 0.85));
  }
  parts.push(part(new THREE.CylinderGeometry(Math.min(s.rim * 0.8, 0.164), Math.min(s.rim * 0.8, 0.164), 0.032, 40).translate(0, side * (w / 2 - 0.12), 0), 0x2b2b2e, 0.55, 0.3, 0, 1));  // 278-328 mm disc
  parts.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12).translate(0, face + side * 0.012, 0), s.era < 1966 ? 0xb9a15a : 0x0b0b0d, 0.25, 0.3));  // wheel nut
  if (s.era >= 2008) for (const sw of [-1, 1])  // compound marking on each sidewall (coloured from 2007, Bridgestone's white stripe)
    parts.push(part(new THREE.TorusGeometry(r - 0.075, 0.009, 6, 48).rotateX(Math.PI / 2).translate(0, sw * (w / 2 + bulge + 0.002), 0), 0xd8d8d8, 0.7, 0, 1));
  if (s.grooves) for (const f of [-0.3, -0.1, 0.1, 0.3]) parts.push(part(new THREE.TorusGeometry(r + 0.0005, 0.006, 4, 48).rotateX(Math.PI / 2).translate(0, f * w, 0), 0x050506, 0.9, 0));
  return mergeGeometries(parts.map(g => g.rotateX(Math.PI / 2)));
}

// a wheel's one material: colours from the vertices, the compound's colour on the stripes, the brake glow on the disc.
// The rubber: a satin sidewall with a fine grain, and a matte tread scrubbed grey in rings round the tyre (the wheel's
// own frame: axle along z, so a sidewall's normal is mostly z and the tread's is in xy)
function wheelMat(stripe) {
  const m = new THREE.MeshPhysicalNodeMaterial(), mask = attribute('wmask', 'vec3'), pbr = attribute('wpbr', 'vec2'), t = uniform(0);
  const p = positionGeometry, tread = nSmooth(0.7, 0.35, abs(normalGeometry.z));
  const grain = mix(noise(p.xy.mul(380)), noise(vec2(p.z.mul(900), p.x.add(p.y).mul(30))), tread);
  const rubber = mask.z.mul(mix(mix(0.55, 0.75, grain), mix(1.5, 2.1, grain), tread));
  m.colorNode = mix(attribute('wcol', 'vec3'), uniform(stripe.color), mask.x).mul(rubber.add(mask.z.oneMinus()));
  m.roughnessNode = mix(pbr.x, mix(0.62, mix(0.88, 0.98, grain), tread), mask.z);
  m.metalnessNode = pbr.y;
  m.specularIntensityNode = mix(1, 0.3, mask.z);  // rubber reflects far less than the 4 % a plain dielectric gets
  m.emissiveNode = mix(vec3(0.25, 0.01, 0), vec3(5.5, 1.1, 0.12), t.mul(t)).mul(nSmooth(0.02, 0.2, t)).mul(mask.y);
  m.userData = {brakeTemp: t};
  return m;
}

// Wishbones and pushrods: faired from the '80s, so a flat section laid horizontal, round tube before that
function arm(s, a, b, r = 0.012) {
  if (s.era < 1983) return rod(a, b, r);
  const d = new THREE.Vector3().subVectors(b, a), len = d.length(), y = d.clone().normalize(), x = new THREE.Vector3(0, 1, 0).cross(y);
  if (x.lengthSq() < 1e-4) x.set(1, 0, 0);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y), g = new THREE.CylinderGeometry(r * 2, r * 2, len, 8).scale(0.32, 1, 1);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

function suspension(P, s, x, r, wz, inZ, inY, dir) {
  const o = Math.sign(wz) * (Math.abs(wz) - 0.12);  // upright, inside the wheel
  for (const [dy, iy] of [[0.11, inY[1]], [-0.12, inY[0]]])
    for (const dx of [0.22, -0.22]) P.carbon.push(arm(s, V(x, r + dy, o), V(x + dx * dir, iy, Math.sign(wz) * inZ)));
  P.carbon.push(arm(s, V(x + 0.08 * dir, r, o), V(x + 0.08 * dir, inY[0] + 0.05, Math.sign(wz) * inZ)));  // track / toe rod
  P.carbon.push(arm(s, V(x, r - 0.1, o * 0.92), V(x - 0.1 * dir, inY[1] + 0.03, Math.sign(wz) * inZ * 0.8), 0.01));  // pushrod
}

// the front of a body rounded off: a loft ends on a flat cap, which on a nose read as a sawn-off tube
const rounded = ([x, hw, y0, y1, n]) => [[x + 0.02, hw * 0.45, y0 + (y1 - y0) * 0.28, y1 - (y1 - y0) * 0.28, n], [x, hw, y0, y1, n]];

// Monocoque and nose by regulation era, front to rear: [x, half width, bottom, top, squareness]
function tubRings(s, tipX, fx, rx, hx) {
  if (s.tub === 'fe')  // front engine: long bonnet up to the scuttle, the driver sat well back, a tail fairing behind the seat
    return [[tipX - 0.01, 0.15, 0.2, 0.5, 2.1], [tipX - 0.3, 0.22, 0.17, 0.6, 2.2], [hx + 0.75, 0.28, 0.15, 0.72, 2.3], [hx + 0.28, 0.31, 0.15, 0.76, 2.3],
            [hx - 0.1, 0.31, 0.16, 0.66, 2.3], [rx + 0.1, 0.27, 0.22, 0.72, 2.3], [rx - 0.35, 0.16, 0.3, 0.62, 2.2], [rx - 0.62, 0.04, 0.42, 0.5, 2]];
  if (s.tub === 'cigar')  // rear engine in a cigar: a slim tub, round nose, the engine out in the air behind
    return [...rounded([tipX - 0.02, 0.1, 0.2, 0.36, 2.1]), [tipX - 0.35, 0.16, 0.16, 0.44, 2.2], [hx + 0.55, 0.25, 0.13, 0.56, 2.3], [hx + 0.1, 0.29, 0.11, 0.6, 2.3],
            [hx - 0.3, 0.28, 0.13, 0.58, 2.3], [rx + 0.5, 0.2, 0.18, 0.42, 2.3], [rx + 0.2, 0.12, 0.22, 0.36, 2.2]];
  if (s.tub === 'wedge')  // Lotus 72 onwards: a flat wedge rising to the cockpit
    return [...rounded([tipX - 0.02, 0.14, 0.11, 0.19, 3.2]), [fx + 0.25, 0.2, 0.09, 0.34, 3], [hx + 0.7, 0.27, 0.07, 0.56, 3], [hx + 0.2, 0.31, 0.06, 0.6, 3],
            [hx - 0.35, 0.32, 0.06, 0.62, 3], [rx + 0.45, 0.24, 0.1, 0.5, 3], [rx - 0.1, 0.1, 0.2, 0.42, 2.5]];
  const nose = {
    high: [[tipX - 0.03, 0.04, 0.26, 0.33, 2.5], [fx + 0.3, 0.09, 0.26, 0.45, 2.5], [fx, 0.13, 0.27, 0.53, 2.5]],
    step: [[tipX - 0.03, 0.05, 0.22, 0.30, 2.5], [fx + 0.3, 0.09, 0.22, 0.43, 2.5], [fx - 0.05, 0.12, 0.24, 0.47, 2.5], [fx - 0.25, 0.18, 0.2, 0.62, 3]],
    finger: [[tipX - 0.02, 0.03, 0.11, 0.17, 2], [tipX - 0.3, 0.05, 0.13, 0.24, 2.5], [fx + 0.25, 0.1, 0.17, 0.42, 2.5], [fx - 0.1, 0.15, 0.2, 0.55, 2.5]],
    low: [[tipX - 0.02, 0.07, 0.10, 0.22, 2.5], [fx + 0.4, 0.1, 0.13, 0.33, 2.5], [fx, 0.14, 0.18, 0.50, 2.8]],
    // 2022+: broad and flat, landing on the wing's second element, and short of the mainplane's leading edge
    broad: [[tipX - 0.14, 0.09, 0.1, 0.19, 3], [tipX - 0.4, 0.105, 0.11, 0.25, 3], [fx + 0.32, 0.12, 0.14, 0.37, 2.8], [fx - 0.05, 0.16, 0.19, 0.52, 2.8]],
  }[s.nose];
  return [...rounded(nose[0]), ...nose.slice(1),
    [hx + 0.75, 0.22, 0.06, 0.62, 3], [hx + 0.35, 0.27, 0.05, 0.63, 3], [hx, 0.29, 0.05, 0.58, 3],
    [hx - 0.35, 0.3, 0.05, 0.62, 3], [rx + 0.6, 0.2, 0.1, 0.52, 3], [rx + 0.12, 0.12, 0.16, 0.42, 3], [rx - 0.38, 0.05, 0.22, 0.3, 2.5]];
}

// Engine cover from behind the head to the gearbox, or null for an engine out in the air
function coverRings(s, hx, rx, cockpitY) {
  return {
    peri: [[hx - 0.22, 0.15, cockpitY, 1.02, 3], [hx - 0.38, 0.19, 0.6, 1.04, 3], [hx - 0.6, 0.14, 0.5, 0.74, 2.6], [rx + 0.3, 0.1, 0.35, 0.5, 2.5]],  // 1971-76's tall periscope
    low: [[hx - 0.2, 0.12, cockpitY, 0.8, 2.4], [hx - 0.5, 0.15, 0.5, 0.83, 2.5], [rx + 0.4, 0.1, 0.3, 0.55, 2.4], [rx - 0.1, 0.05, 0.3, 0.4, 2]],
    mid: [[hx - 0.2, 0.11, cockpitY - 0.05, 0.9, 2.5], [hx - 0.38, 0.13, 0.5, 0.93, 2.5], [hx - 0.8, 0.1, 0.45, 0.76, 2.5], [rx + 0.35, 0.05, 0.35, 0.55, 2.5], [rx - 0.1, 0.03, 0.3, 0.4, 2]],
    // the modern roll hoop: a slim blade with the oval intake over the driver's head
    blade: [[hx - 0.2, 0.085, cockpitY + 0.02, 0.93, 2.6], [hx - 0.33, 0.105, 0.5, 0.965, 2.6], [hx - 0.62, 0.085, 0.44, 0.86, 2.6], [hx - 1.0, 0.055, 0.38, 0.7, 2.4],
            [rx + 0.35, 0.04, 0.33, 0.52, 2.2], [rx - 0.1, 0.025, 0.3, 0.38, 2]],
  }[s.air] ?? null;
}

// The radiator inlets on a sidepod's front face, set just proud of its flat cap: z0..z1 out from the centre, y0..y1 up
function inlet(P, x, z0, z1, y0, y1) {
  const r = Math.min(z1 - z0, y1 - y0) * 0.3;
  for (const [a, b] of [[z0, z1], [-z1, -z0]]) {
    const sh = new THREE.Shape();
    sh.moveTo(a + r, y0); sh.lineTo(b - r, y0); sh.quadraticCurveTo(b, y0, b, y0 + r); sh.lineTo(b, y1 - r); sh.quadraticCurveTo(b, y1, b - r, y1);
    sh.lineTo(a + r, y1); sh.quadraticCurveTo(a, y1, a, y1 - r); sh.lineTo(a, y0 + r); sh.quadraticCurveTo(a, y0, a + r, y0);
    P.dark.push(new THREE.ShapeGeometry(sh, 6).rotateY(Math.PI / 2).translate(x, 0, 0));
  }
}

// floor outline by era, one side (+z), front to rear; the car's tail end is added by build()
const FLOOR = {
  ge: (hx, rx, fz) => [[hx + 0.55, 0.3], [hx + 0.3, 0.72], [rx + 0.7, 0.72], [rx + 0.35, fz]],
  flat: (hx, rx, fz) => [[hx + 0.75, 0.25], [hx + 0.4, 0.52], [hx + 0.1, 0.72], [rx + 0.75, 0.74], [rx + 0.42, fz]],
  ground: (hx, rx, fz) => [[hx + 0.78, 0.22], [hx + 0.55, 0.46], [hx + 0.3, 0.66], [hx - 0.1, 0.8], [rx + 0.85, 0.82], [rx + 0.55, 0.72], [rx + 0.35, fz]],
};

function build(year) {
  const s = spec(year), P = {paint: [], carbon: [], floor: [], rim: [], dark: [], light: [], halo: [], helmet: [], visor: [], gear: []};
  const tipX = s.len / 2, fx = tipX - s.fo, rx = fx - s.wb, hx = rx + (s.tub === 'fe' ? 0.24 : 0.43) * s.wb, modern = s.era >= 2017;
  const ro = s.len - s.fo - s.wb;  // rear overhang: rear axle to the back of the car

  // monocoque and nose
  const chassis = loft(tubRings(s, tipX, fx, rx, hx));
  P.paint.push(chassis);
  const cockpitY = at(chassis.rings, hx)[2];
  if (s.tub === 'fe') P.dark.push(new THREE.CircleGeometry(1, 24).scale(0.1, 0.13, 1).rotateY(Math.PI / 2).translate(tipX - 0.005, 0.35, 0));  // the radiator grille

  // engine cover, or the engine itself with its exhausts and a bare roll hoop
  const coverSecs = coverRings(s, hx, rx, cockpitY), airbox = coverSecs && loft(coverSecs);
  if (airbox) {
    P.paint.push(airbox);
    const top = coverSecs[0][3];
    P.dark.push(new THREE.SphereGeometry(0.075, 16, 10).scale(0.3, 0.8, 1).translate(hx - 0.2, top - 0.075, 0));  // intake
    if (s.era >= 1993) P.carbon.push(new THREE.BoxGeometry(0.11, 0.035, 0.05).translate(hx - 0.34, top + 0.05, 0));  // T-cam
  } else {
    const hoop = s.tub === 'fe' ? 0.92 : 0.86;
    P.rim.push(rod(V(hx - 0.22, cockpitY - 0.1, -0.16), V(hx - 0.22, hoop, -0.1), 0.014), rod(V(hx - 0.22, cockpitY - 0.1, 0.16), V(hx - 0.22, hoop, 0.1), 0.014), rod(V(hx - 0.22, hoop, -0.1), V(hx - 0.22, hoop, 0.1), 0.014));
    if (s.tub === 'fe') for (const y of [0.3, 0.42]) P.rim.push(rod(V(hx + 0.65, y, 0.3), V(rx - 0.1, 0.24, 0.34), 0.026));  // side exhausts
    else {
      P.dark.push(new THREE.BoxGeometry(0.65, 0.3, 0.42).translate(rx + 0.125, 0.36, 0));  // the engine
      for (const z of [-1, 1]) for (let k = 0; k < 4; k++) P.rim.push(new THREE.CylinderGeometry(0.03, 0.022, 0.1, 10).translate(rx + 0.4 - k * 0.14, 0.55, z * 0.12));  // intake trumpets
      for (const z of [-1, 1]) P.rim.push(rod(V(rx + 0.1, 0.34, z * 0.2), V(rx - 0.42, 0.42, z * 0.13), 0.028));  // exhausts
    }
  }

  // sidepods, their mouths, and ground-effect skirts
  const pod = {
    box: [[hx + 0.35, 0.62, 0.07, 0.5, 4], [hx - 0.1, 0.64, 0.07, 0.5, 4], [rx + 0.75, 0.45, 0.08, 0.45, 3.5], [rx + 0.3, 0.22, 0.12, 0.38, 3]],
    ge: [[hx + 0.75, 0.74, 0.04, 0.34, 5], [hx + 0.05, 0.74, 0.04, 0.44, 5], [rx + 0.75, 0.72, 0.04, 0.44, 5], [rx + 0.35, 0.36, 0.12, 0.38, 4]],
    short: [[hx + 0.08, 0.72, 0.06, 0.46, 4.5], [hx - 0.4, 0.7, 0.06, 0.46, 4], [rx + 0.85, 0.44, 0.08, 0.42, 3.2], [rx + 0.35, 0.2, 0.12, 0.35, 3]],
    coke: [[hx + 0.3, 0.6, 0.07, 0.55, 4], [hx - 0.15, 0.62, 0.07, 0.52, 3.5], [rx + 0.8, 0.36, 0.08, 0.45, 3], [rx + 0.25, 0.18, 0.12, 0.38, 3]],
    // ground-effect downwash: a raised nose, undercut from the floor, its top falling away to the beam wing
    downwash: [[hx + 0.28, 0.56, 0.26, 0.56, 4], [hx + 0.02, 0.62, 0.2, 0.55, 3.6], [hx - 0.45, 0.6, 0.15, 0.5, 3.2], [rx + 0.85, 0.42, 0.11, 0.38, 3], [rx + 0.3, 0.18, 0.12, 0.3, 3]],
  }[s.pod];
  if (pod) {
    P.paint.push(loft(pod));
    const [px, hw, y0, y1] = pod[0], m = (y1 - y0) * 0.12;
    inlet(P, px + 0.004, 0.3, hw - 0.05, y0 + m, y1 - m);
    if (s.pod === 'ge') for (const z of [-1, 1]) P.carbon.push(plate([[hx + 0.75, 0.015], [rx + 0.75, 0.015], [rx + 0.75, 0.1], [hx + 0.75, 0.1]], z * 0.745, 0.012));  // skirts
  }

  // floor, diffuser, bargeboards
  const fz = s.width / 2 - s.tr[1] - 0.04;
  if (s.floorKind) {
    const half = FLOOR[s.floorKind](hx, rx, fz), tail = [...half, [rx - 0.25, fz]];
    P.floor.push(floorPlate([...tail.map(([x, z]) => [x, -z]), ...tail.reverse()], 0.03));
    const dx = Math.min(ro * 0.8, 0.62);  // the diffuser ramps up behind the axle; strakes under it
    P.floor.push(new THREE.BoxGeometry(dx, 0.015, fz * 2).rotateZ(-0.34).translate(rx - 0.25 - dx * 0.42, 0.04 + dx * 0.16, 0));
    for (const z of [-0.6, -0.25, 0.25, 0.6]) P.floor.push(plate([[rx - 0.2, 0.04], [rx - 0.25 - dx * 0.84, 0.24], [rx - 0.25 - dx * 0.84, 0.3], [rx - 0.2, 0.1]], z * fz / 0.6));
    if (s.floorKind === 'ground') for (const z of [-1, 1]) {  // the floor's raised edge, and the fences under the sidepod's mouth
      P.floor.push(new THREE.BoxGeometry(hx - 0.1 - (rx + 0.85), 0.05, 0.012).translate((hx - 0.1 + rx + 0.85) / 2, 0.075, z * 0.815));
      for (const k of [0.3, 0.4, 0.5]) P.floor.push(plate([[hx + 0.68, 0.03], [hx + 0.2, 0.03], [hx + 0.2, 0.11], [hx + 0.55, 0.15]], z * k, 0.008));
    }
  }
  if (s.era >= 1998 && s.era < 2022)
    for (const z of [-1, 1]) P.carbon.push(plate([[hx + 0.95, 0.05], [hx + 0.5, 0.05], [hx + 0.45, 0.32], [hx + 0.85, 0.25]], z * 0.5, 0.008));

  // front wing: the mainplane and flaps cascade, swept back to the tips and (2022+) curling up into the endplates
  if (s.fw) {
    const fwX = tipX - 0.02, half = s.fw / 2, centre = s.wing22 ? 0.18 : 0.25, sweep = s.wing22 ? 0.3 : 0;
    const curve = i => z => s.wing22 ? (0.012 + 0.028 * i) * smoothstep(centre, half, Math.abs(z)) : 0;
    const swept = g => {
      if (sweep) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) - sweep * (p.getZ(i) / half) ** 2); return toCreasedNormals(g, 0.7); }
      return g;
    };
    P.carbon.push(swept(wing(s.canard ? 0.16 : 0.32, -half, half, 4, fwX, 0.075, curve(0))));
    for (let i = 1; i <= s.flaps; i++) {
      const chord = 0.2 - 0.03 * i, x = fwX - 0.2 - 0.07 * i, y = 0.09 + 0.045 * i, a = 12 + 10 * i;
      const list = i === s.flaps ? P.paint : P.carbon;  // top flap carries the livery
      if (s.wing22) list.push(swept(wing(chord, -half, half, a, x, y, curve(i))));
      else for (const z of [-1, 1]) list.push(wing(chord, z > 0 ? centre : -half, z > 0 ? half : -centre, a, x, y));
    }
    for (const z of [-1, 1]) {
      const top = s.wing22 ? 0.22 : s.canard ? 0.14 : 0.26, at0 = fwX - sweep;
      P.paint.push(plate([[at0 + 0.02, 0.03], [at0 - 0.45, 0.03], [at0 - 0.48, top], [at0 - 0.12, top * 0.6]], z * half, 0.01));
      if (s.nose === 'high' || s.nose === 'step')  // pylons hanging the wing under a raised nose
        P.carbon.push(plate([[fwX - 0.08, 0.08], [fwX - 0.4, 0.08], [fwX - 0.35, 0.3], [fwX - 0.15, 0.3]], z * 0.1, 0.01));
    }
  }

  // rear wing
  const rwX = rx - ro + 0.52, rhalf = s.rw / 2, top = s.rwTop;
  if (s.rw) {
    const droop = z => s.wing22 ? -0.14 * smoothstep(rhalf - 0.18, rhalf, Math.abs(z)) : 0;  // tips roll down into the endplates
    P.carbon.push(wing(0.34, -rhalf, rhalf, 10, rwX, top - 0.24, droop, 0.12, 0.07));
    P.paint.push(wing(0.22, -rhalf, rhalf, 32, rwX - 0.28, top - 0.1, droop, 0.08, 0.05));
    if (s.era >= 1983 && s.era < 2009) P.carbon.push(wing(0.18, -rhalf, rhalf, 20, rwX - 0.05, top - 0.42));  // extra lower element
    for (const z of [-1, 1]) {
      const lowY = s.wing22 ? top - 0.36 : s.strut ? top - 0.34 : 0.3;
      P.paint.push(plate(s.wing22 ? [[rwX + 0.04, lowY + 0.02], [rwX - 0.42, lowY], [rwX - 0.52, lowY + 0.1], [rwX - 0.52, top + 0.02], [rwX - 0.06, top + 0.02], [rwX + 0.04, top - 0.08]]
                                 : [[rwX + 0.05, lowY], [rwX - 0.52, lowY + 0.05], [rwX - 0.52, top + 0.02], [rwX + 0.02, top]], z * (rhalf + 0.006)));
    }
    if (s.strut) for (const z of [-1, 1]) P.rim.push(rod(V(rx, s.tr[0] + 0.1, z * 0.5), V(rwX - 0.1, top - 0.24, z * 0.3), 0.012));  // 1968's high wing, on stalks off the suspension
    else P.carbon.push(plate([[rx - 0.25, 0.28], [rx - 0.42, 0.28], [rwX - 0.2, top - 0.22], [rwX - 0.05, top - 0.22]], 0, 0.02));  // pylon
    if (s.beam) P.carbon.push(wing(0.16, -fz * 0.8, fz * 0.8, 8, rx - 0.35, 0.38));
    if (s.monkey) P.carbon.push(wing(0.12, -0.15, 0.15, 15, rx - 0.3, 0.48));
    if (s.tWing) P.carbon.push(wing(0.1, -0.25, 0.25, 15, rx + 0.1, 0.86));
  }
  if (s.era >= 1968) P.light.push(new THREE.BoxGeometry(0.03, 0.05, 0.08).translate(rx - 0.42, 0.26, 0));
  if (s.era >= 2014) P.rim.push(new THREE.CylinderGeometry(0.05, 0.055, 0.2, 14).rotateZ(Math.PI / 2).translate(rx - 0.4, 0.42, 0));  // the turbo era's single tailpipe

  // shark fin
  if (s.fin === 2) P.paint.push(plate([[hx - 0.35, 0.92], [rwX - 0.35, top - 0.08], [rwX - 0.3, 0.55], [rx + 0.4, 0.5], [hx - 0.6, 0.72]], 0, 0.008));
  if (s.fin === 1) P.paint.push(plate([[hx - 0.4, 0.88], [rx + 0.2, 0.62], [rx + 0.15, 0.5], [hx - 0.6, 0.7]], 0, 0.008));

  // wheels (their own meshes, see corner) and suspension
  const zf = s.width / 2 - s.tf[1] / 2, zr = s.width / 2 - s.tr[1] / 2, wheels = [];
  for (const z of [-1, 1]) {
    wheels.push({x: fx, z: z * zf, r: s.tf[0], front: true, geo: corner(s, s.tf, z)}, {x: rx, z: z * zr, r: s.tr[0], front: false, geo: corner(s, s.tr, z)});
    suspension(P, s, fx, s.tf[0], z * zf, 0.15, s.tub === 'fe' ? [0.25, 0.42] : [0.22, 0.45], -1);
    suspension(P, s, rx, s.tr[0], z * zr, 0.12, [0.2, 0.38], 1);
    if (s.deflectors) {  // the 2022-25 winglet over the front tyre, on an arm from the upright
      P.carbon.push(wing(0.14, z * zf - 0.12, z * zf + 0.12, 8, fx + 0.14, 2 * s.tf[0] + 0.022));
      P.carbon.push(rod(V(fx + 0.04, s.tf[0] + 0.12, z * (zf - 0.14)), V(fx + 0.06, 2 * s.tf[0] + 0.02, z * (zf - 0.11)), 0.006));
    }
    // mirrors: a wide, shallow pod, its glass facing back, on a stalk (out of the halo's way from 2018)
    if (s.era >= 1966) {
      const mz = z * (modern ? 0.47 : 0.4), my = modern ? 0.66 : cockpitY + 0.03, mx = hx + (modern ? 0.42 : 0.3);
      P.carbon.push(rod(V(mx - 0.02, cockpitY - 0.04, z * 0.24), V(mx, my - 0.02, mz - z * 0.03), 0.006));
      P.paint.push(new THREE.SphereGeometry(1, 12, 8).scale(0.035, 0.03, 0.075).translate(mx, my, mz));
      P.dark.push(new THREE.PlaneGeometry(0.13, 0.05).rotateY(-Math.PI / 2).translate(mx - 0.034, my, mz));
    }
  }

  // cockpit opening, its padded rim, and the driver. From 1996 the sides rise round the head; before that the shoulders show
  P.dark.push(new THREE.CircleGeometry(1, 24).scale(0.42, 0.24, 1).rotateX(-Math.PI / 2).translate(hx + 0.05, cockpitY + 0.004, 0));
  const head = V(hx - 0.02, cockpitY + (s.era >= 1996 ? 0.075 : s.tub ? 0.13 : 0.1), 0);
  if (s.era >= 1996)
    P.dark.push(loft([[hx + 0.12, 0.2, cockpitY - 0.02, cockpitY + 0.06, 3], [hx - 0.08, 0.2, cockpitY - 0.02, cockpitY + 0.085, 3], [hx - 0.24, 0.15, cockpitY - 0.02, cockpitY + 0.12, 3]]));
  if (s.era < 1983) P.dark.push(new THREE.BoxGeometry(0.008, 0.12, 0.3).rotateZ(0.5).translate(hx + 0.32, cockpitY + 0.05, 0));  // the aero screen
  for (const [k, list] of Object.entries(helmetGeometry(head, s.era >= 2008))) P[k].push(...list);  // HANS: mandatory from 2003

  // halo: titanium hoop round the head from two rear mounts, the centre pillar from its front down to the chassis
  if (s.halo) {
    const hy = head.y + 0.085, cx = hx - 0.05;
    const hoop = new THREE.CatmullRomCurve3([V(cx - 0.2, cockpitY - 0.015, -0.27), V(cx - 0.05, hy - 0.03, -0.285), V(cx + 0.22, hy, -0.24), V(cx + 0.42, hy + 0.005, 0),
                                             V(cx + 0.22, hy, 0.24), V(cx - 0.05, hy - 0.03, 0.285), V(cx - 0.2, cockpitY - 0.015, 0.27)], false, 'centripetal');
    P.halo.push(new THREE.TubeGeometry(hoop, 48, 0.026, 10), rod(V(cx + 0.42, hy, 0), V(hx + 0.62, at(chassis.rings, hx + 0.62)[2] - 0.01, 0), 0.03));
  }

  const merged = {};
  for (const [k, list] of Object.entries(P))
    if (list.length) merged[k] = mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)));
  const coverAt = airbox ? [hx - 0.5, ...at(airbox.rings, hx - 0.5)] : [hx - 0.4, ...at(chassis.rings, hx - 0.4)], hoopTop = coverSecs ? coverSecs[1][3] : 0.9;
  // the far level of detail draws all four as one mesh, placed
  const far = mergeGeometries(wheels.map(w => w.geo.clone().translate(w.x, w.r, w.z)));
  return {s, geo: merged, wheels, far, nose: [fx + 0.15, at(chassis.rings, fx + 0.15)[2]], cover: coverAt,
          eye: V(head.x + 0.06, head.y + 0.01, 0), look: V(head.x + 15, 0.55, 0),
          tcam: V(hx - 0.32, hoopTop + 0.09, 0), tcamLook: V(hx + 15, 0.4, 0),  // just above the T-cam pod on the airbox
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

// One shadow caster for a group of parts that move together (the sprung body, a wheel), instead of one per part. Each of
// the sun's cascades redraws every caster: 22 cars' parts were ~750 draws a frame there, 7-9 ms of the main thread, and
// the RB22 alone is 57 meshes. The parts are merged as they stand now and stop casting; the merged mesh sits on
// SHADOW_LAYER, which only the sun's cameras see (scene3d.js). `cache[key]`: the geometry, shared by every car built alike.
export const SHADOW_LAYER = 3;
const CASTER = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});
function shadowProxy(group, cache, key) {
  group.updateWorldMatrix(true, true);
  const inv = group.matrixWorld.clone().invert(), rel = new THREE.Matrix4(), v = new THREE.Vector3(), out = [], build = !cache[key];
  (function walk(o) {
    if (!o.visible) return;
    if (o.isMesh && o.castShadow) {
      o.castShadow = false;
      if (build) {
        const P = o.geometry.attributes.position, ix = o.geometry.index;
        rel.multiplyMatrices(inv, o.matrixWorld);
        for (let i = 0, n = ix ? ix.count : P.count; i < n; i++) { v.fromBufferAttribute(P, ix ? ix.getX(i) : i).applyMatrix4(rel); out.push(v.x, v.y, v.z); }
      }
    }
    o.children.forEach(walk);
  })(group);
  if (build) cache[key] = Object.assign(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(out, 3)), {userData: {shared: true}});
  const proxy = new THREE.Mesh(cache[key], CASTER);
  proxy.castShadow = true;
  proxy.layers.set(SHADOW_LAYER);
  group.add(proxy);
}
const rb22Casters = {};

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
  if (dist < Infinity) {  // the race: the showroom's own lamps see no SHADOW_LAYER
    shadowProxy(near.body, rb22Casters, 'body');
    near.wheels.forEach((w, i) => shadowProxy(w.spin, rb22Casters, i));
  }
  const lod = new THREE.LOD(), group = new THREE.Group();
  lod.addLevel(near.group, 0);
  lod.addLevel(far.group, dist);
  group.add(lod);
  return {...far, ...near, group, discs: [...far.discs, ...near.discs],
          dispose: () => { far.dispose(); near.dispose(); shadow.geometry.dispose(); shadow.material.dispose(); }};
}

// returns {group, body, halo, stripe, light, discs (brake-glow materials), len, width, wb, eye, look, tcam, tcamLook, exhaust, plank, fronts}; blob: soft
// contact-shadow texture; far: scene units beyond which a 2026+ car switches from the RB22 model to the procedural one,
// and past 5 x far (~250 m, a car under ~15 px) every car is only its paint and tyres: 2 draw calls instead of ~12
export function buildCar(color, num, year, blob, far = Infinity, team = null) {
  const t = templates[spec(year).era] ??= build(year), liv = livery(team, color, year);
  const paint = paintMat(color, year, year >= 2022, liv);
  t.geo.paint.boundingBox ?? t.geo.paint.computeBoundingBox();
  paint.userData.toCar.value.copy(liveryFrame(t.geo.paint.boundingBox));  // the era's geometry is in the car's frame
  const own = {
    paint, stripe: new THREE.MeshStandardMaterial({color: 0xd8d8d8, roughness: 0.7}),
    helmet: helmetMaterial(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55), liv.accent, num),
    light: MAT.light.clone(),  // per car: it flashes while that car harvests energy
  };
  const group = new THREE.Group(), body = new THREE.Group(), halo = new THREE.Group();
  const mesh = (geo, mat, shadow = true) => Object.assign(new THREE.Mesh(geo, mat), {castShadow: shadow});
  for (const [k, geo] of Object.entries(t.geo)) (k === 'halo' ? halo : body).add(mesh(geo, own[k] ?? MAT[k === 'halo' ? 'carbon' : k]));
  own.wheel = wheelMat(own.stripe);
  const wheelSet = new THREE.Group(), wheels = t.wheels.map(w => {
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.position.set(w.x, w.r, w.z);
    spin.add(mesh(w.geo, own.wheel));
    pivot.add(spin);
    wheelSet.add(pivot);
    return {pivot, spin, front: w.front};
  });
  if (far < Infinity) {
    const lod = new THREE.LOD(), close = new THREE.Group(), tiny = new THREE.Group();
    close.add(body, halo, wheelSet);
    // a 2026+ car shows this level only past the RB22's range, where a steered wheel's shadow is no different: one caster
    if (t.s.era >= 2026 && rb22Ready()) shadowProxy(close, t.casters ??= {}, 'all');
    else shadowProxy(body, t.casters ??= {}, 'body');
    tiny.add(mesh(t.geo.paint, paint), mesh(t.far, MAT.tyre, false));
    lod.addLevel(close, 0);
    lod.addLevel(tiny, far * 5);
    group.add(lod);
  } else group.add(body, halo, wheelSet);
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
  const shared = new Set([...Object.values(t.geo), t.far, ...t.wheels.map(w => w.geo)]);
  const dispose = () => {
    for (const mt of Object.values(own)) mt.dispose();
    own.helmet.map.dispose();
    group.traverse(o => { if (o.geometry && !shared.has(o.geometry) && !o.geometry.userData.shared) o.geometry.dispose(); });
    shadow.material.dispose();
    decal?.map.dispose();
    decal?.dispose();
  };
  const car = {group, body, halo, wheels, tyre: s.tr, stripe: own.stripe, light: own.light, discs: [own.wheel], len: s.len, width: s.width, wb: s.wb, eye: t.eye, look: t.look, tcam: t.tcam,
               tcamLook: t.tcamLook, exhaust: t.exhaust, plank: t.plank, fronts: t.fronts, dispose};
  return s.era >= 2026 && rb22Ready() ? withRB22(car, color, num, blob, far, liv) : car;
}
