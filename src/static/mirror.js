// Rear-view mirrors that show the scene, from github.com/AgentiLoop/F1 (src/mirror3d.mjs): each frame the mirror is
// drawn as seen from the viewer's eye reflected through the mirror's plane, through a frustum fitted to the glass (its
// near plane on the mirror, so nothing behind the glass shows), and that image is projected back onto the glass.
import * as THREE from 'three';
import {texture, uniform, vec2, vec4, positionGeometry, mrt, output} from 'three/tsl';

const active = new Set();  // the glasses showing their reflection; scene3d.js renders them once a frame
// A mirror's one attachment named as the scene pass's: an effect's material writes only velocity (vfx.js noVelocity), which
// alone matched nothing here and made an empty, invalid shader.
const OUTPUTS = mrt({output});
const mirrorTarget = (width, height) => {
  const target = new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
  target.texture.name = 'output';
  return target;
};

// mesh: the (roughly flat) glass, front faces toward the viewer; width: render target pixels;
// hide: objects left out of the mirror's image (e.g. the car's own rear wheels);
// tilt: radians the mirror is angled up (the view moves up by twice that);
// extend: screen pixels the glass (and its image) reaches further down.
export function makeMirror(mesh, { width = 512, hide = [], tilt = 0.025, extend = 3 } = {}) {
  // The glass's plane in mesh space: area-weighted normal, centroid and a rectangle around it.
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry, P = g.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), centre = new THREE.Vector3();
  let area = 0;
  for (let i = 0; i < P.count; i += 3) {
    a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
    const t = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)), s = t.length() / 2;
    n.add(t); centre.addScaledVector(a.add(b).add(c), s / 3); area += s;
  }
  n.normalize(); centre.divideScalar(area);
  const u = new THREE.Vector3(0, 1, 0).cross(n).normalize(), v = n.clone().cross(u);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < P.count; i++) {
    const d = a.fromBufferAttribute(P, i).sub(centre), x = d.dot(u), y = d.dot(v);
    u0 = Math.min(u0, x); u1 = Math.max(u1, x); v0 = Math.min(v0, y); v1 = Math.max(v1, y);
  }
  const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([x, y]) => centre.clone().addScaledVector(u, x).addScaledVector(v, y));
  // The glass is stretched down (top edge fixed) each frame so the image is `extend` screen px taller at the bottom.
  const vUp = v.clone(), base = [corners[0].clone(), corners[1].clone()], pos = mesh.geometry.attributes.position, orig = pos.array.slice();
  const weight = Array.from({ length: pos.count }, (_, i) => (v1 - a.fromBufferAttribute(pos, i).sub(centre).dot(vUp)) / (v1 - v0));
  let shift = 0;
  const stretch = s => {
    if (Math.abs(s - shift) < 1e-6) return;
    shift = s;
    for (let i = 0; i < pos.count; i++) for (let k = 0; k < 3; k++) pos.array[3 * i + k] = orig[3 * i + k] - vUp.getComponent(k) * s * weight[i];
    pos.needsUpdate = true;
    corners[0].copy(base[0]).addScaledVector(vUp, -s); corners[1].copy(base[1]).addScaledVector(vUp, -s);
  };
  // Tilt the reflecting plane up about the glass's horizontal axis so the view clears the car's own bodywork.
  { const nt = n.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(v, Math.sin(tilt));
    v.multiplyScalar(Math.cos(tilt)).addScaledVector(n, -Math.sin(tilt)); n.copy(nt); }

  const target = mirrorTarget(width, Math.max(16, Math.round(width * (v1 - v0) / (u1 - u0))));
  const textureMatrix = uniform(new THREE.Matrix4()), mirrorCamera = new THREE.PerspectiveCamera();
  mirrorCamera.layers.enable(1);  // tree crowns and fences are on layer 1 (circuit3d.js)
  // Project the rendered image back onto the glass. Linear HDR like the scene: the post chain tone-maps it with everything else.
  // NDC y is up and a node uv's y is down, hence the flip.
  const modelled = mesh.material, glass = new THREE.MeshBasicNodeMaterial({ name: 'mirror', fog: false });
  const clip = textureMatrix.mul(vec4(positionGeometry, 1)), ndc = clip.xy.div(clip.w);
  glass.colorNode = texture(target.texture, vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(-0.5).add(0.5))).rgb;
  // mesh.userData.mirror(on): the glass reflects (on) or goes back to its modelled material.
  (mesh.userData.mirror = on => { mesh.material = on ? glass : modelled; if (on) active.add(render); else { active.delete(render); stretch(0); } });
  mesh.userData.disposeMirror = () => { active.delete(render); target.dispose(); glass.dispose(); };

  const q = new THREE.Vector3(), down = new THREE.Vector3(), size = new THREE.Vector2();
  const C = new THREE.Vector3(), N = new THREE.Vector3(), up = new THREE.Vector3(), eye = new THREE.Vector3(), p = new THREE.Vector3();
  // From the master loop, not onBeforeRender: WebGPU can't start another render pass from inside one
  const render = (renderer, scene, camera, shadows) => {
    C.copy(centre).applyMatrix4(mesh.matrixWorld);
    N.copy(n).transformDirection(mesh.matrixWorld); up.copy(v).transformDirection(mesh.matrixWorld);
    const dist = eye.setFromMatrixPosition(camera.matrixWorld).sub(C).dot(N);
    if (dist <= 1e-3) return; // seen from behind
    // Screen px per metre down the glass at its bottom edge, then stretch it by `extend` px.
    p.copy(base[0]).lerp(base[1], 0.5).applyMatrix4(mesh.matrixWorld); down.copy(vUp).transformDirection(mesh.matrixWorld).negate();
    q.copy(p).addScaledVector(down, 0.01).project(camera);
    const pxPerM = Math.abs(q.y - p.project(camera).y) / 2 * renderer.getSize(size).y / 0.01;
    if (pxPerM > 0) stretch(extend / pxPerM / mesh.matrixWorld.getMaxScaleOnAxis());
    eye.addScaledVector(N, -2 * dist).add(C); // the eye reflected through the plane
    mirrorCamera.position.copy(eye); mirrorCamera.up.copy(up);
    mirrorCamera.lookAt(p.copy(eye).add(N)); mirrorCamera.updateMatrixWorld();
    let l = Infinity, r = -Infinity, bt = Infinity, tp = -Infinity;
    for (const k of corners) {
      p.copy(k).applyMatrix4(mesh.matrixWorld).applyMatrix4(mirrorCamera.matrixWorldInverse);
      const x = p.x * dist / -p.z, y = p.y * dist / -p.z;
      l = Math.min(l, x); r = Math.max(r, x); bt = Math.min(bt, y); tp = Math.max(tp, y);
    }
    // the camera's conventions set first: the renderer rebuilds a mismatched projection, which would lose this fitted one
    mirrorCamera.coordinateSystem = renderer.coordinateSystem;
    mirrorCamera._reversedDepth = camera.reversedDepth;  // read-only in public; three only ever flips it from its own render()
    mirrorCamera.projectionMatrix.makePerspective(l, r, tp, bt, dist, camera.far, renderer.coordinateSystem, camera.reversedDepth);
    mirrorCamera.projectionMatrixInverse.copy(mirrorCamera.projectionMatrix).invert();
    textureMatrix.value.copy(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse).multiply(mesh.matrixWorld);

    const previous = renderer.getRenderTarget();
    const shown = hide.map(o => o.visible);
    mesh.visible = false; hide.forEach(o => { o.visible = false; });
    shadows(false);  // the cascades drawn for the main view are good enough at mirror size
    renderer.setMRT(OUTPUTS);
    renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, mirrorCamera);
    renderer.setRenderTarget(previous);
    renderer.setMRT(null);
    shadows(true);
    hide.forEach((o, i) => { o.visible = shown[i]; });
    mesh.visible = true;
  };
  return mesh;
}

// Rendering the scene into a mirror for the first time builds every material's shader again for that target: it took ~2 s on the
// switch to the cockpit. So they are built ahead, a few at a time, into a target of the same format.
export async function warmMirrors(renderer, scene, meshes, stillWanted) {
  const target = mirrorTarget(16, 16);
  await warmFor(renderer, scene, meshes, target, OUTPUTS, stillWanted);
  target.dispose();
}

// Builds each mesh's pipeline for `target` off the GPU process's main thread. A render builds a pipeline it lacks synchronously,
// and DXC holds that thread (and so the whole page): a car's close-up parts took ~2 s the first time a camera got near one.
export async function warmFor(renderer, scene, meshes, target, outputs, stillWanted) {
  const camera = new THREE.PerspectiveCamera(), previous = renderer.getRenderTarget();
  camera.layers.enableAll();
  let slice = performance.now();
  for (const mesh of meshes) {
    if (!stillWanted()) break;
    const culled = mesh.frustumCulled, was = renderer.getRenderTarget();
    mesh.frustumCulled = false;
    renderer.setMRT(outputs);
    renderer.setRenderTarget(target);
    const done = renderer.compileAsync(mesh, camera, scene);  // its synchronous part picks up the target
    renderer.setRenderTarget(was);
    renderer.setMRT(null);
    mesh.frustumCulled = culled;
    await done;
    if (performance.now() - slice > 8) { await new Promise(r => setTimeout(r)); slice = performance.now(); }  // a frame gets a turn
  }
  renderer.setRenderTarget(previous);
  renderer.setMRT(null);
}

// shadows(on): switches the sun's cascades on or off around a mirror's render
// One mirror a frame, in turn: each is a whole scene pass (~2 ms of the main thread), and a glass a few centimetres wide
// at the edge of the view reads the same at half the frame rate.
let turn = 0;
export function renderMirrors(renderer, scene, camera, shadows) {
  if (active.size) [...active][turn++ % active.size](renderer, scene, camera, shadows);
}
