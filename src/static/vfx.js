// Car and weather effects: exhaust heat haze, plank sparks, tyre smoke, water spray and rain. Particles live in scene units (positions) and are
// simulated in real seconds; `vfx.mps` (metres per scene unit) converts physical speeds and gravity.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {Fn, If, Discard, uniform, attribute, instancedBufferAttribute, instancedDynamicBufferAttribute, uv, time, vec2, vec3, vec4, float, length, dot, max, pow, sqrt, clamp, smoothstep, normalize, cross,
        screenUV, viewportSharedTexture, viewportDepthTexture, viewportLinearDepth, linearDepth, positionView, cameraPosition, cameraFar, cameraNear, mrt} from 'three/tsl';
import {noise} from './track3d.js';

const MAX_SPARKS = 2000, MAX_SMOKE = 600, MAX_SPRAY = 1500, MAX_RAIN = 4000, MAX_SKIDS = 4000;
const rnd = (a, b) => a + Math.random() * (b - a);
const noVelocity = {velocity: vec4(0)};  // see post.js: an effect has no motion vector of its own
const skidMat = new THREE.MeshBasicNodeMaterial({color: 0x0b0b0c, transparent: true, opacity: 0.6, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2});
skidMat.mrtNode = mrt(noVelocity);

// ---------- heat haze ----------

// A transparent sheet showing what's behind it through a wobbling screen offset: rising hot air bends light by far too
// little to compute, so it's two octaves of noise scrolling upwards. Cheaper than a transmission material, which rendered the
// scene a second time per frame. viewportSharedTexture copies the frame once however many cars use it.
const hazeMat = new THREE.MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false});
hazeMat.mrtNode = mrt(noVelocity);
{
  const p = uv().mul(vec2(7, 4)).add(vec2(0, time.mul(-1.8)));
  const wobble = vec2(noise(p).add(noise(p.mul(2).add(11)).mul(0.5)), noise(p.add(5)).add(noise(p.mul(2).add(23)).mul(0.5))).sub(0.75);
  const r = length(uv().sub(0.5)).mul(2).min(1), edge = float(1).sub(r.mul(r));
  hazeMat.backdropNode = viewportSharedTexture(screenUV.add(wobble.mul(0.006).mul(edge)));
  hazeMat.userData.readsViewport = true;  // scene3d.js warmCockpit: copies the frame, which only works inside a pass
  hazeMat.opacityNode = edge.mul(edge).mul(0.65);
}

// plume from the exhaust exit (car metres): one sheet along the car, one across it, so it reads from the side and behind
export function haze(exhaust) {
  const mesh = new THREE.Mesh(mergeGeometries([new THREE.PlaneGeometry(1.4, 0.6).translate(-0.7, 0.15, 0),
                                               new THREE.PlaneGeometry(0.7, 0.6).rotateY(Math.PI / 2).translate(-0.35, 0.15, 0)]), hazeMat);
  mesh.position.copy(exhaust);
  mesh.layers.set(1);  // effects stay on layer 1, away from what casts shadows
  return mesh;
}

// ---------- particles ----------

// Tyre smoke as lit sphere impostors: each sprite is shaded as if it were a ball of smoke. The normal comes from the sprite
// coordinate (z = sqrt(1 - r^2) towards the viewer); half-Lambert wrap lets light bleed through the thin edges, and a
// Henyey-Greenstein phase function adds the bright silver lining when looking towards the sun through the smoke:
//   p(theta) = (1 - g^2) / (1 + g^2 - 2 g cos theta)^1.5   (normalised so isotropic scattering is 1)
// with theta between the light's travel direction (-L) and the direction to the eye (+z in view space): cos theta = -L.z.
// Where a puff meets the road or a car it fades out by the depth left between them, or the disc's hard intersection shows.
function smokeMaterial(uniforms, albedo, pos, size, alphaAttr, seedAttr) {
  const m = new THREE.PointsNodeMaterial({transparent: true, depthWrite: false, sizeAttenuation: false, fog: false});
  m.mrtNode = mrt(noVelocity);
  // a ball of diameter aSize at depth -z spans aSize * P[1][1] * (viewport height / 2) / -z pixels
  m.positionNode = instancedDynamicBufferAttribute(pos, 'vec3');
  m.sizeNode = instancedDynamicBufferAttribute(size, 'float').mul(uniforms.scale).div(positionView.z.negate()).min(1024);
  const seed = instancedBufferAttribute(seedAttr, 'float'), alpha = instancedDynamicBufferAttribute(alphaAttr, 'float');
  const p = uv().mul(2).sub(1), r2 = dot(p, p);
  const density = Fn(() => {
    If(r2.greaterThan(1), () => { Discard(); });
    // optical depth through a sphere ~ its chord length (1 - r^2), broken up by noise so puffs don't read as discs
    return float(1).sub(r2).mul(noise(p.mul(2.5).add(seed.mul(31))).mul(0.55).add(0.45)).mul(noise(p.mul(6).sub(seed.mul(17))).mul(0.4).add(0.6));
  })();
  const n = vec3(p.x, p.y.negate(), sqrt(max(float(1).sub(r2), 0)));
  const wrap = dot(n, uniforms.sun).mul(0.5).add(0.5);
  const phase = float(0.64).div(pow(float(1.36).add(uniforms.sun.z.mul(1.2)), 1.5));  // g = 0.6
  m.colorNode = float(albedo).mul(uniforms.ambient.add(uniforms.sunColor.mul(wrap.mul(0.7).add(phase.mul(0.3)))));
  // reversed depth renders to depth32float, and the viewport depth copy must match or WebGPU refuses it
  viewportDepthTexture().value.type = THREE.FloatType;
  const range = cameraFar.sub(cameraNear);
  m.opacityNode = density.mul(alpha).mul(clamp(viewportLinearDepth.sub(linearDepth()).mul(range).div(uniforms.soft), 0, 1));
  m.userData.readsViewport = true;
  return m;
}

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
  const p = pool(max, {size: new Float32Array(max)});
  // Instanced per sprite rather than per point: WebGPU has no point size, so three only sizes these on a Sprite with a count
  const inst = (n, k = 1) => new THREE.InstancedBufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage);
  const pos = inst(max, 3), size = inst(max), alpha = inst(max);
  const seed = new THREE.InstancedBufferAttribute(Float32Array.from({length: max}, Math.random), 1);
  const points = new THREE.Sprite(smokeMaterial(uniforms, albedo, pos, size, alpha, seed));
  points.count = max;
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

// Black-body colour of a cooling titanium spark, 3800 K to 1800 K and on to a dull ember. Radiated power goes with T^4, so
// its brightness falls ~20x over that range, and the HDR start is what the bloom catches. Rec. 709 from Planck's law, fitted
// as a table: this runs per spark per frame.
const BLACKBODY = [[3800, 1, 0.56, 0.2], [3000, 1, 0.42, 0.08], [2400, 1, 0.3, 0.03], [1800, 1, 0.18, 0.004]];
const rgb = [0, 0, 0];
function cooling(t) {
  const T = t < 0.75 ? 3800 - (t / 0.75) * 2000 : 1800 - (t - 0.75) * 2400;  // the last quarter is the ember
  const heat = 16 * (T / 3800) ** 4 * (t < 0.75 ? 1 : (1 - t) * 4);
  const b = BLACKBODY.findIndex(([K]) => K <= T), hi = BLACKBODY[Math.max(0, b - 1)], lo = BLACKBODY[b < 0 ? 3 : b];
  const f = hi === lo ? 0 : (hi[0] - T) / (hi[0] - lo[0]);
  for (let c = 0; c < 3; c++) rgb[c] = (hi[c + 1] + (lo[c + 1] - hi[c + 1]) * f) * heat;
  return rgb;
}

export function createVfx(scene) {
  const self = {mps: 1, rain: 0};

  // Sparks: one quad per spark, stretched along its velocity over a camera exposure and turned to face the camera about
  // that axis, so each is its own motion blur and a slow one is a dot rather than a line. Instanced, so ~2000 of them are
  // one draw call, whatever their colour. The geometry's instance count stays 0 until there's something to draw.
  const sp = pool(MAX_SPARKS, {floor: new Float32Array(MAX_SPARKS)});
  const sGeo = new THREE.InstancedBufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  sGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  sGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const sPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const sVel = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const sCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  sGeo.setAttribute('aPos', sPos);
  sGeo.setAttribute('aVel', sVel);
  sGeo.setAttribute('aCol', sCol);
  sGeo.instanceCount = MAX_SPARKS;
  const uSparkWidth = uniform(0.004);
  const sMat = new THREE.MeshBasicNodeMaterial({blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false});
  {
    const at = attribute('aPos', 'vec3'), v = attribute('aVel', 'vec3'), corner = attribute('position', 'vec3');
    const along = v.mul(0.015), side = normalize(cross(along.add(vec3(1e-5, 0, 0)), cameraPosition.sub(at))).mul(uSparkWidth);
    sMat.positionNode = at.add(along.mul(corner.x)).add(side.mul(corner.y));
    const col = attribute('aCol', 'vec3');
    // brightest down the middle of the streak, fading at its ends
    const soft = smoothstep(0.5, 0.2, uv().sub(0.5).abs().y).mul(smoothstep(0.5, 0.3, uv().sub(0.5).abs().x));
    sMat.colorNode = col.mul(soft);
    sMat.mrtNode = mrt({...noVelocity, emissive: col.mul(soft)});  // straight into the bloom, whatever the threshold
  }
  const sparks = new THREE.Mesh(sGeo, sMat);

  const uniforms = {scale: uniform(1), sun: uniform(new THREE.Vector3()), sunColor: uniform(new THREE.Color(0xfff1dc).multiplyScalar(0.8)),
                    ambient: uniform(new THREE.Color(0.28, 0.31, 0.36)), soft: uniform(1)};
  const smoke = puffs(scene, MAX_SMOKE, 0.78, 0.5, 0.7, uniforms);
  const spray = puffs(scene, MAX_SPRAY, 0.92, -0.6, 0.38, uniforms);

  // Rain: drops in a box 60 m across that travels with the camera, falling at ~9 m/s (raindrop terminal velocity)
  // with a little wind. Each is drawn as a streak of its motion *relative to the camera* over a 1/30 s exposure, so
  // from a car at speed the rain rushes past in long diagonal streaks, and from a hovering camera it falls straight.
  const rGeo = new THREE.BufferGeometry(), rPos = new Float32Array(MAX_RAIN * 3), rDraw = new Float32Array(MAX_RAIN * 6);
  const rAttr = new THREE.BufferAttribute(rDraw, 3).setUsage(THREE.DynamicDrawUsage);
  rGeo.setAttribute('position', rAttr);
  const rain = new THREE.LineSegments(rGeo, Object.assign(new THREE.LineBasicNodeMaterial({color: 0xbfd4e6, transparent: true, opacity: 0.22, depthWrite: false}), {mrtNode: mrt(noVelocity)}));
  let lastCam = null, drops = 0;

  for (const o of [sparks, rain]) {
    o.frustumCulled = false;
    o.layers.set(o === sparks ? 2 : 1);  // sparks write bloom through MRT: a target without it, like the mirror, can't compile them
    scene.add(o);
  }

  // origin: scene position; carVel: the car's velocity in scene units per second
  self.sparks = (origin, carVel) => {
    const k = 1 / self.mps, back = carVel.clone().normalize();
    const v = carVel.clone().multiplyScalar(rnd(0.55, 0.95))         // scraped off moving with the car, then dragged back
      .addScaledVector(back, -rnd(0, 6) * k)
      .add(new THREE.Vector3(rnd(-3, 3) * k, rnd(0.3, 2.5) * k, rnd(-3, 3) * k));
    const i = spawn(sp, origin, v);
    sp.floor[i] = origin.y;  // the road under it: the circuit's height varies by tens of metres
    born(sp, i, rnd(0.25, 0.7));
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

  // sun: unit vector towards the sun (world); heightPx: viewport height in CSS pixels, for sprite sizes (three applies the DPR)
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
  // pts: [{p: Vector3 (scene), state 0/1/2, roll: the road's banking} | null] along the line; null samples (corners-only mode)
  // are transparent. Colours blend over 3 samples (~15 m) at each state change instead of switching, it fades in over the
  // first 3 samples and out over the last quarter, and each edge sits at the road's height across the banking.
  self.ribbon = (pts, halfWidth) => {
    ribbon.visible = !!pts;
    if (!pts) return;
    const n = Math.min(RIB, pts.length), tail = Math.max(1, n * 0.25), at = i => pts[Math.min(Math.max(i, 0), pts.length - 1)];
    const colour = i => { const q = at(i); return q ? RIB_COLOR[q.state] : [0, 0, 0]; };  // additive black = invisible
    for (let i = 0; i < RIB; i++) {
      const cur = at(i), next = at(i + 1) ?? cur, prevP = at(i - 1) ?? cur;
      const a = (cur ?? next ?? prevP)?.p;
      if (!a) { ribCol.fill(0, i * 6, i * 6 + 6); continue; }
      const b = (next ?? cur).p, dir = b.clone().sub((prevP ?? cur).p).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(halfWidth);  // across the line, in the ground plane (+ is the car's right)
      const lift = halfWidth * Math.sin((cur ?? next ?? prevP).roll ?? 0);  // + roll: the right edge lower
      ribPos.set([a.x - side.x, a.y + lift, a.z - side.z, a.x + side.x, a.y - lift, a.z + side.z], i * 6);
      const c0 = colour(i - 1), c1 = colour(i), c2 = colour(i + 1);
      const fade = Math.min(1, (i + 1) / 4) * Math.min(1, (n - 1 - i) / tail);
      const col = [0, 1, 2].map(k => (c0[k] + c1[k] + c2[k]) / 3 * fade);
      ribCol.set([...col, ...col], i * 6);
    }
    ribGeo.attributes.position.needsUpdate = ribGeo.attributes.color.needsUpdate = true;
  };

  // anything on screen that moves by itself (live particles, rain, the player's ribbon)
  self.busy = () => !sp.clean || smoke.busy() || spray.busy() || drops > 0 || ribbon.visible;

  // Tyre marks: one dark quad per rear tyre per frame while it locks or slides, laid on the road in the car's frame. An
  // instanced mesh on layer 1 with no motion vector, like the other effects. They stay until the ring buffer comes round
  // or the circuit changes (clearSkids).
  const skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), skidMat, MAX_SKIDS);
  skids.count = 0; skids.frustumCulled = false; skids.layers.set(1); scene.add(skids);
  let skidNext = 0;
  self.skid = (matrix) => { skids.setMatrixAt(skidNext, matrix); skidNext = (skidNext + 1) % MAX_SKIDS; skids.count = Math.min(skids.count + 1, MAX_SKIDS); skids.instanceMatrix.needsUpdate = true; };
  self.clearSkids = () => { skidNext = 0; skids.count = 0; };
  self.update = (dt, camera, sun, heightPx) => {
    const k = 1 / self.mps, g = 9.81 * k, P = sp.pos, Vl = sp.vel, at = sPos.array, vs = sVel.array, col = sCol.array, quiet = idle(sp, dt);
    uSparkWidth.value = 0.012 * k;
    uniforms.soft.value = 0.5 * k;  // half a metre of depth to fade over
    for (let i = 0; i < (quiet ? 0 : sp.n); i++) {
      const j = i * 3;
      sp.age[i] += dt;
      const t = sp.age[i] / sp.life[i];
      if (t >= 1) { col.fill(0, j, j + 3); continue; }  // additive black draws nothing
      const drag = Math.exp(-2.5 * dt);  // tiny hot particles lose speed fast
      Vl[j] *= drag; Vl[j + 2] *= drag; Vl[j + 1] = Vl[j + 1] * drag - g * dt;
      P[j] += Vl[j] * dt; P[j + 1] += Vl[j + 1] * dt; P[j + 2] += Vl[j + 2] * dt;
      if (P[j + 1] < sp.floor[i]) { P[j + 1] = sp.floor[i]; Vl[j + 1] *= -0.45; Vl[j] *= 0.7; Vl[j + 2] *= 0.7; }  // skip off the asphalt
      at.set([P[j], P[j + 1], P[j + 2]], j);
      vs.set([Vl[j], Vl[j + 1], Vl[j + 2]], j);
      col.set(cooling(t), j);
    }
    if (!quiet) sPos.needsUpdate = sVel.needsUpdate = sCol.needsUpdate = true;
    smoke.update(dt, k);
    spray.update(dt, k);

    // rain: only the first rain x MAX_RAIN drops are drawn; the rest collapse to a point
    const cam = camera.position, box = 30 * k, n = Math.round(self.rain * MAX_RAIN);
    // capped near an F1 car's top speed: at 10x the camera covers ~800 m/s, and the streaks crossed the whole sky
    const camVel = (lastCam && dt > 0 ? cam.clone().sub(lastCam).divideScalar(dt) : new THREE.Vector3()).clampLength(0, 100 * k);
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
    uniforms.scale.value = camera.projectionMatrix.elements[5] * heightPx / 2;
    uniforms.sun.value.copy(sun).transformDirection(camera.matrixWorldInverse);
  };
  return self;
}
