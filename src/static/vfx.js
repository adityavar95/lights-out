// Car and weather effects: exhaust heat haze, plank sparks, tyre smoke, water spray and rain. Particles live in scene units (positions) and are
// simulated in real seconds; `vfx.mps` (metres per scene unit) converts physical speeds and gravity.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {dataTex, normalTex} from './cars3d.js';

const MAX_SPARKS = 2000, MAX_SMOKE = 600, MAX_SPRAY = 1500, MAX_RAIN = 4000;
const rnd = (a, b) => a + Math.random() * (b - a);
const fract = x => x - Math.floor(x);

// periodic value noise on an n x n lattice (tiles seamlessly)
function vnoise(u, v, n) {
  const h = (i, j) => fract(Math.sin((((i % n) + n) % n) * 127.1 + (((j % n) + n) % n) * 311.7) * 43758.5453);
  const x = u * n, y = v * n, i = Math.floor(x), j = Math.floor(y), sx = (x - i) ** 2 * (3 - 2 * (x - i)), sy = (y - j) ** 2 * (3 - 2 * (y - j));
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * sx, b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
  return a + (b - a) * sy;
}

// ---------- heat haze ----------

// three.js draws the opaque scene into a mip-mapped buffer before transmissive surfaces, which then sample it along the
// refracted view ray: the screen offset is ~ thickness * (refract(v, n, 1 / ior) - v). Real hot air has ior ~1.0003, far
// too little to see, so ior is exaggerated; the normal is two octaves of noise scrolling upwards, so what is behind the
// exhaust wobbles like rising turbulent air. alphaMap fades the edges so the distortion has no visible border, and
// specularIntensity 0 stops the "glass" reflecting anything.
const hazeMat = new THREE.MeshPhysicalMaterial({
  transmission: 1, roughness: 0, ior: 1.2, thickness: 0.8, specularIntensity: 0, transparent: true, depthWrite: false,
  side: THREE.DoubleSide,
  normalMap: normalTex(128, (u, v) => vnoise(u, v, 6) + 0.5 * vnoise(u, v, 12), 0.05),
  alphaMap: dataTex(64, (u, v) => { const r = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2); return Array(4).fill((1 - r * r) ** 2); }, false),
});

// plume from the exhaust exit (car metres): one sheet along the car, one across it, so it reads from the side and behind
export function haze(exhaust) {
  const mesh = new THREE.Mesh(mergeGeometries([new THREE.PlaneGeometry(1.4, 0.6).translate(-0.7, 0.15, 0),
                                               new THREE.PlaneGeometry(0.7, 0.6).rotateY(Math.PI / 2).translate(-0.35, 0.15, 0)]), hazeMat);
  mesh.position.copy(exhaust);
  mesh.layers.set(1);  // not in the motion-vector pass
  return mesh;
}

// ---------- particles ----------

// Tyre smoke as lit sphere impostors: each point sprite is shaded as if it were a ball of smoke. The normal comes from the
// sprite coordinate (z = sqrt(1 - r^2) towards the viewer); half-Lambert wrap lets light bleed through the thin edges, and
// a Henyey-Greenstein phase function adds the bright silver lining when looking towards the sun through the smoke:
//   p(theta) = (1 - g^2) / (1 + g^2 - 2 g cos theta)^1.5   (normalised so isotropic scattering is 1)
// with theta between the light's travel direction (-L) and the direction to the eye (+z in view space): cos theta = -L.z.
const smokeShader = {
  vertexShader: /* glsl */`
    attribute float aSize, aAlpha, aSeed;
    uniform float uScale;
    varying float vAlpha, vSeed;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      // a ball of diameter aSize at depth -mv.z spans aSize * P[1][1] * (viewport height / 2) / -mv.z pixels
      gl_PointSize = min(aSize * uScale / -mv.z, 1024.0);
      vAlpha = aAlpha;
      vSeed = aSeed;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uSun, uSunColor, uAmbient;
    uniform float uAlbedo;
    varying float vAlpha, vSeed;
    #include <logdepthbuf_pars_fragment>
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      p.y = -p.y;  // gl_PointCoord runs downwards
      float r2 = dot(p, p);
      if (r2 > 1.0) discard;
      vec3 n = vec3(p, sqrt(1.0 - r2));
      // optical depth through a sphere ~ its chord length (1 - r^2), broken up by noise so puffs don't read as discs
      float density = (1.0 - r2) * (0.45 + 0.55 * noise(p * 2.5 + vSeed * 31.0)) * (0.6 + 0.4 * noise(p * 6.0 - vSeed * 17.0));
      float wrap = dot(n, uSun) * 0.5 + 0.5;
      float g = 0.6, phase = (1.0 - g * g) / pow(1.0 + g * g + 2.0 * g * uSun.z, 1.5);
      vec3 light = uAmbient + uSunColor * (0.7 * wrap + 0.3 * phase);
      gl_FragColor = vec4(vec3(uAlbedo) * light, density * vAlpha);
    }`,
};

// fixed-size pool reused as a ring: the newest particle overwrites the oldest. clock / end: pool time now and when its
// last particle dies, so a pool with nothing alive costs nothing per frame (see idle)
function pool(n, extra) {
  return {n, next: 0, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), age: new Float32Array(n).fill(1), life: new Float32Array(n).fill(1),
          clock: 0, end: 0, clean: false, ...extra};
}

const born = (p, i, life) => { p.life[i] = life; p.end = Math.max(p.end, p.clock + life); };

// true when every particle is dead and one update has already blanked them (their buffers then stay as they are)
function idle(p, dt) {
  p.clock += dt;
  if (p.clock <= p.end) return (p.clean = false);
  const done = p.clean;
  p.clean = true;
  return done;
}

function spawn(p, origin, vel) {
  const i = p.next;
  p.next = (i + 1) % p.n;
  p.pos.set([origin.x, origin.y, origin.z], i * 3);
  p.vel.set([vel.x, vel.y, vel.z], i * 3);
  p.age[i] = 0;
  return i;
}

// Puffs: soft lit sphere impostors (smokeShader) in a ring-buffer pool. albedo: grey of the medium (smoke ~0.78,
// water spray ~0.92); buoy: upward drift in m/s^2 (hot smoke rises, spray mist sinks back); fade: peak opacity.
function puffs(scene, max, albedo, buoy, fade, uniforms) {
  const p = pool(max, {size: new Float32Array(max)}), geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
  const alpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  geo.setAttribute('aSize', size);
  geo.setAttribute('aAlpha', alpha);
  geo.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({length: max}, Math.random), 1));
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({...smokeShader, transparent: true, depthWrite: false,
                                                                 uniforms: {...uniforms, uAlbedo: {value: albedo}}}));
  points.frustumCulled = false;
  points.layers.set(1);
  scene.add(points);
  return {
    busy: () => !p.clean,
    spawn(origin, vel, life, diameter) {
      const i = spawn(p, origin, vel);
      born(p, i, life);
      p.size[i] = diameter;
    },
    update(dt, k) {
      if (idle(p, dt)) return;
      const M = p.pos, V = p.vel, drag = Math.exp(-1.8 * dt);
      for (let i = 0; i < p.n; i++) {
        const j = i * 3;
        p.age[i] += dt;
        const t = Math.min(1, p.age[i] / p.life[i]);
        V[j] *= drag; V[j + 2] *= drag; V[j + 1] = V[j + 1] * drag + buoy * k * dt;
        M[j] += V[j] * dt; M[j + 1] = Math.max(M[j + 1] + V[j + 1] * dt, 0); M[j + 2] += V[j + 2] * dt;
        size.array[i] = p.size[i] * (0.15 + 0.85 * (1 - Math.exp(-3 * t)));  // billows out fast, then slows
        alpha.array[i] = t >= 1 ? 0 : THREE.MathUtils.smoothstep(t, 0, 0.06) * (1 - t) ** 1.5 * fade;
      }
      pos.array.set(M);
      pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
    },
  };
}

export function createVfx(scene) {
  const self = {mps: 1, rain: 0};

  // sparks: line segments from where the spark is to where it was 15 ms ago, i.e. its motion during a camera exposure,
  // so each one is its own motion blur (particles are left out of the motion-vector pass)
  const sp = pool(MAX_SPARKS, {});
  const sGeo = new THREE.BufferGeometry();
  const sPos = new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const sCol = new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 6), 3).setUsage(THREE.DynamicDrawUsage);
  sGeo.setAttribute('position', sPos);
  sGeo.setAttribute('color', sCol);
  const sparks = new THREE.LineSegments(sGeo, new THREE.LineBasicMaterial({vertexColors: true, blending: THREE.AdditiveBlending,
                                                                          transparent: true, depthWrite: false}));

  const uniforms = {uScale: {value: 1}, uSun: {value: new THREE.Vector3()}, uSunColor: {value: new THREE.Color(0xfff1dc).multiplyScalar(0.8)},
                    uAmbient: {value: new THREE.Color(0.28, 0.31, 0.36)}};
  const smoke = puffs(scene, MAX_SMOKE, 0.78, 0.5, 0.7, uniforms);
  const spray = puffs(scene, MAX_SPRAY, 0.92, -0.6, 0.38, uniforms);

  // Rain: drops in a box 60 m across that travels with the camera, falling at ~9 m/s (raindrop terminal velocity)
  // with a little wind. Each is drawn as a streak of its motion *relative to the camera* over a 1/30 s exposure, so
  // from a car at speed the rain rushes past in long diagonal streaks, and from a hovering camera it falls straight.
  const rGeo = new THREE.BufferGeometry(), rPos = new Float32Array(MAX_RAIN * 3), rDraw = new Float32Array(MAX_RAIN * 6);
  const rAttr = new THREE.BufferAttribute(rDraw, 3).setUsage(THREE.DynamicDrawUsage);
  rGeo.setAttribute('position', rAttr);
  const rain = new THREE.LineSegments(rGeo, new THREE.LineBasicMaterial({color: 0xbfd4e6, transparent: true, opacity: 0.22, depthWrite: false}));
  let lastCam = null, drops = 0;

  for (const o of [sparks, rain]) {
    o.frustumCulled = false;
    o.layers.set(1);
    scene.add(o);
  }

  // origin: scene position; carVel: the car's velocity in scene units per second
  self.sparks = (origin, carVel) => {
    const k = 1 / self.mps, back = carVel.clone().normalize();
    const v = carVel.clone().multiplyScalar(rnd(0.55, 0.95))         // scraped off moving with the car, then dragged back
      .addScaledVector(back, -rnd(0, 6) * k)
      .add(new THREE.Vector3(rnd(-3, 3) * k, rnd(0.3, 2.5) * k, rnd(-3, 3) * k));
    born(sp, spawn(sp, origin, v), rnd(0.2, 0.55));
  };
  self.smoke = (origin, carVel) => {
    const k = 1 / self.mps;
    smoke.spawn(origin, carVel.clone().multiplyScalar(rnd(0.2, 0.4)).add(new THREE.Vector3(rnd(-1, 1) * k, rnd(0.2, 1) * k, rnd(-1, 1) * k)),
                rnd(1.4, 2.6), rnd(2.2, 3.5) * k);
  };
  // Rooster tail: the diffuser and rear tyres fling water up and back. In the world frame the mist starts moving with
  // the car (~60 %), kicked up 2-5 m/s and back 6-10 m/s, then air drag stops it within a second or so: behind a car at
  // speed it streams out as a plume tens of metres long, which is what blinds the car behind.
  self.spray = (origin, carVel) => {
    const k = 1 / self.mps, back = carVel.clone().normalize();
    const v = carVel.clone().multiplyScalar(rnd(0.5, 0.7)).addScaledVector(back, -rnd(6, 10) * k)
      .add(new THREE.Vector3(rnd(-1.5, 1.5) * k, rnd(2, 5) * k, rnd(-1.5, 1.5) * k));
    spray.spawn(origin, v, rnd(0.8, 1.6), rnd(1.5, 4) * k);
  };

  // sun: unit vector towards the sun (world); heightPx: drawing-buffer height, for point sizes
  // Racing-line ribbon: a strip hovering over the line ahead of the player, one quad per sample, coloured per point.
  // The colours are HDR (above 1) and additively blended, so the bloom pass gives it a holographic glow.
  const RIB = 60, ribPos = new Float32Array(RIB * 2 * 3), ribCol = new Float32Array(RIB * 2 * 3), ribGeo = new THREE.BufferGeometry();
  ribGeo.setAttribute('position', new THREE.BufferAttribute(ribPos, 3).setUsage(THREE.DynamicDrawUsage));
  ribGeo.setAttribute('color', new THREE.BufferAttribute(ribCol, 3).setUsage(THREE.DynamicDrawUsage));
  ribGeo.setIndex(Array.from({length: RIB - 1}, (_, i) => [2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2]).flat());
  const ribbon = new THREE.Mesh(ribGeo, new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false}));
  Object.assign(ribbon, {frustumCulled: false, visible: false});
  ribbon.layers.set(1);
  scene.add(ribbon);
  const RIB_COLOR = [[0.1, 2.2, 0.7], [2.4, 1.4, 0.1], [2.6, 0.12, 0.15]];  // emerald full throttle, amber lift, crimson brake
  // pts: [{p: Vector3 (scene), state 0/1/2} | null] along the line; null samples (corners-only mode) are transparent
  self.ribbon = (pts, halfWidth) => {
    ribbon.visible = !!pts;
    if (!pts) return;
    for (let i = 0; i < RIB; i++) {
      const cur = pts[Math.min(i, pts.length - 1)], next = pts[Math.min(i + 1, pts.length - 1)] ?? cur, prevP = pts[Math.max(i - 1, 0)] ?? cur;
      const a = (cur ?? next ?? prevP)?.p;
      if (!a) continue;
      const b = (next ?? cur).p, dir = b.clone().sub((prevP ?? cur).p).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(halfWidth);  // across the line, in the ground plane
      ribPos.set([a.x - side.x, a.y, a.z - side.z, a.x + side.x, a.y, a.z + side.z], i * 6);
      const col = cur ? RIB_COLOR[cur.state] : [0, 0, 0];  // additive black = invisible
      ribCol.set([...col, ...col], i * 6);
    }
    ribGeo.attributes.position.needsUpdate = ribGeo.attributes.color.needsUpdate = true;
  };

  // anything on screen that moves by itself (live particles, rain, the player's ribbon)
  self.busy = () => !sp.clean || smoke.busy() || spray.busy() || drops > 0 || ribbon.visible;

  self.update = (dt, camera, sun, heightPx) => {
    hazeMat.normalMap.offset.y -= dt * 0.9;  // the haze rises
    const k = 1 / self.mps, g = 9.81 * k, P = sp.pos, Vl = sp.vel, out = sPos.array, col = sCol.array, quiet = idle(sp, dt);
    for (let i = 0; i < (quiet ? 0 : sp.n); i++) {
      const j = i * 3, o = i * 6;
      sp.age[i] += dt;
      const t = sp.age[i] / sp.life[i];
      if (t >= 1) { col.fill(0, o, o + 6); continue; }  // additive black draws nothing
      const drag = Math.exp(-2.5 * dt);  // tiny hot particles lose speed fast
      Vl[j] *= drag; Vl[j + 2] *= drag; Vl[j + 1] = Vl[j + 1] * drag - g * dt;
      P[j] += Vl[j] * dt; P[j + 1] += Vl[j + 1] * dt; P[j + 2] += Vl[j + 2] * dt;
      if (P[j + 1] < 0) { P[j + 1] = 0; Vl[j + 1] *= -0.3; Vl[j] *= 0.7; Vl[j + 2] *= 0.7; }  // skip off the asphalt
      out.set([P[j], P[j + 1], P[j + 2], P[j] - Vl[j] * 0.015, P[j + 1] - Vl[j + 1] * 0.015, P[j + 2] - Vl[j + 2] * 0.015], o);
      // cooling titanium: white-yellow (HDR, so bloom catches it) fading through orange to dull red
      const heat = (1 - t) ** 2 * 14;
      col.set([heat, heat * (0.85 - 0.6 * t), heat * (0.5 - 0.47 * t)], o);
      col.copyWithin(o + 3, o, o + 3);
    }
    if (!quiet) sPos.needsUpdate = sCol.needsUpdate = true;
    smoke.update(dt, k);
    spray.update(dt, k);

    // rain: only the first rain x MAX_RAIN drops are drawn; the rest collapse to a point
    const cam = camera.position, box = 30 * k, n = Math.round(self.rain * MAX_RAIN);
    const camVel = lastCam && dt > 0 ? cam.clone().sub(lastCam).divideScalar(dt) : new THREE.Vector3();
    lastCam = cam.clone();
    const fall = [1.5 * k, -9 * k, 0.8 * k], ex = 1 / 30, dry = !n && !drops;  // dry: no rain now or last frame
    drops = n;
    for (let i = 0; i < (dry ? 0 : MAX_RAIN); i++) {
      const j = i * 3, o = i * 6;
      if (i >= n) { rDraw.fill(0, o, o + 6); continue; }
      for (let a = 0; a < 3; a++) {
        rPos[j + a] += fall[a] * dt;
        const rel = rPos[j + a] - cam.getComponent(a);  // wrap round the box so it always surrounds the camera
        if (rel < -box || rel > box || (a === 1 && rPos[j + 1] < 0)) rPos[j + a] = cam.getComponent(a) + (a === 1 ? rnd(0, 1) * box : rnd(-box, box));
      }
      rDraw.set([rPos[j], rPos[j + 1], rPos[j + 2], rPos[j] - (fall[0] - camVel.x) * ex, rPos[j + 1] - (fall[1] - camVel.y) * ex,
                 rPos[j + 2] - (fall[2] - camVel.z) * ex], o);
    }
    if (!dry) rAttr.needsUpdate = true;
    uniforms.uScale.value = camera.projectionMatrix.elements[5] * heightPx / 2;
    uniforms.uSun.value.copy(sun).transformDirection(camera.matrixWorldInverse);
  };
  return self;
}
