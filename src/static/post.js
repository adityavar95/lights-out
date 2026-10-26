// Post-processing: motion vectors -> MSAA HDR scene -> ambient occlusion -> depth of field -> motion blur -> bloom ->
// chromatic aberration -> tone mapping + sRGB (OutputPass) -> SMAA.
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';

const EXPOSURE = 1 / 60;  // simulated camera shutter time, s

// Motion vectors: every object is drawn with this frame's and last frame's model-view-projection, and the difference of
// the two projected positions is how far that surface moved on screen this frame. That covers camera motion (the view
// matrix changed) and per-object motion (the model matrix changed) in one pass. Alpha 1 marks covered pixels.
const velocityShader = {
  uniforms: {uPrevModel: {value: new THREE.Matrix4()}, uPrevViewProj: {value: new THREE.Matrix4()}},
  vertexShader: /* glsl */`
    uniform mat4 uPrevModel, uPrevViewProj;
    varying vec4 vCur, vPrev;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      vCur = projectionMatrix * viewMatrix * modelMatrix * p;
      vPrev = uPrevViewProj * uPrevModel * p;
      gl_Position = vCur;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    varying vec4 vCur, vPrev;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      gl_FragColor = vec4((vCur.xy / vCur.w - vPrev.xy / vPrev.w) * 0.5, 0.0, 1.0);  // NDC spans 2, UV spans 1
    }`,
};

// Gather blur along each pixel's motion vector (scaled to the shutter time and clamped). Samples only count if they moved
// like the centre pixel (|v_sample - v| < |v|), so a car the camera is tracking (v ~ 0) stays sharp instead of smearing into
// the streaking background around it, and vice versa. Per-pixel noise offsets the taps to trade banding for fine grain.
// Sky pixels (no geometry, alpha 0) get the camera's rotation alone: uReproj maps a far-plane point from this frame's
// rotation-only view-projection to last frame's.
const blurShader = {
  uniforms: {tDiffuse: {value: null}, tVelocity: {value: null}, uScale: {value: 0}, uReproj: {value: new THREE.Matrix4()}},
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tVelocity;
    uniform float uScale;
    uniform mat4 uReproj;
    varying vec2 vUv;
    const int TAPS = 12;
    const float MAX_LEN = 0.035;  // of the screen
    vec2 motion(vec2 uv) {
      vec4 v = texture2D(tVelocity, uv);
      if (v.a < 0.5) {
        vec2 ndc = uv * 2.0 - 1.0;
        vec4 prev = uReproj * vec4(ndc, 1.0, 1.0);
        v.xy = (ndc - prev.xy / prev.w) * 0.5;
      }
      vec2 m = v.xy * uScale;
      float l = length(m);
      return l > MAX_LEN ? m * (MAX_LEN / l) : m;
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 v = motion(vUv);
      float len = length(v);
      if (len < 0.0005) { gl_FragColor = base; return; }
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));  // interleaved gradient noise
      vec4 sum = base;
      float total = 1.0;
      for (int i = 0; i < TAPS; i++) {
        vec2 uv = vUv + v * ((float(i) + jitter) / float(TAPS) - 0.5);
        float w = clamp(2.0 - 2.0 * length(motion(uv) - v) / len, 0.0, 1.0);
        sum += texture2D(tDiffuse, uv) * w;
        total += w;
      }
      gl_FragColor = sum / total;
    }`,
};

const SENSOR = 0.024;  // m, full-frame sensor height: with the camera's vertical fov it gives the focal length

// Depth of field: thin-lens circle of confusion F² / (N (s - F)) · |1 - s / w| for focus distance s and depth w, in
// pixels (uScale is the first factor; capped at uRadius), gathered over a jittered Vogel disk of radius uRadius. A sample
// counts where its own blur disk reaches this pixel; one behind this pixel only as far as this pixel's blur, so a sharp
// car gets no halo of the blurred background, while a blurred foreground still spills over it. Depth: the AO pass's
// logarithmic depth buffer.
const dofShader = {
  uniforms: {tDiffuse: {value: null}, tDepth: {value: null}, uFocus: {value: 0}, uScale: {value: 0}, uRadius: {value: 0},
             uLogFar: {value: 0}, uTexel: {value: new THREE.Vector2()}},
  vertexShader: blurShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform float uFocus, uScale, uRadius, uLogFar;
    uniform vec2 uTexel;
    varying vec2 vUv;
    const int TAPS = 32;
    float depthAt(vec2 uv) { return exp2(texture2D(tDepth, uv).x * uLogFar) - 1.0; }  // d = log2(1 + w) / log2(far + 1)
    float coc(float w) { return min(abs(1.0 - uFocus / w) * uScale, uRadius); }  // pixels
    void main() {
      float w0 = depthAt(vUv), c0 = coc(w0);
      float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec4 sum = texture2D(tDiffuse, vUv);
      float total = 1.0;
      for (int i = 0; i < TAPS; i++) {
        float r = sqrt((float(i) + 0.5) / float(TAPS)) * uRadius, a = float(i) * 2.39996323 + spin;  // golden angle
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
        float w = depthAt(uv), c = w > w0 ? min(coc(w), c0) : coc(w), k = clamp(c - r + 1.0, 0.0, 1.0);
        sum += texture2D(tDiffuse, uv) * k;
        total += k;
      }
      gl_FragColor = sum / total;
    }`,
};

// Lateral chromatic aberration: red and blue land at slightly different magnifications, growing with the square of the
// distance from the centre (~3 px at the corners of a 1080p frame, nothing in the middle).
const caShader = {
  uniforms: {tDiffuse: {value: null}},
  vertexShader: blurShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5, o = d * dot(d, d) * 0.006;
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(texture2D(tDiffuse, vUv + o).r, c.g, texture2D(tDiffuse, vUv - o).b, c.a);
    }`,
};

export function createPost(renderer, scene, camera) {
  // 4x MSAA in a half-float target: anti-aliases geometry edges (wishbones, fences, track lines) and keeps HDR values
  // above 1 for bloom; the OutputPass tone maps at the end
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: 4}));
  const velocity = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType});  // half resolution is plenty for blur
  const velMat = new THREE.ShaderMaterial({...velocityShader, side: THREE.DoubleSide});
  const prev = new WeakMap(), prevVP = new THREE.Matrix4(), prevRot = new THREE.Matrix4(), rot = new THREE.Matrix4();
  const clear = new THREE.Color();
  let skip = true, frame = 0;
  velMat.onBeforeRender = (r, s, c, g, object) => {
    const p = prev.get(object);  // not drawn last frame (e.g. an LOD level that just switched in): no motion of its own
    velMat.uniforms.uPrevModel.value.copy(p?.frame === frame - 1 ? p : object.matrixWorld);
    velMat.uniformsNeedUpdate = true;  // per-object uniform: upload before every draw
  };
  const blur = new ShaderPass(blurShader);
  blur.uniforms.tVelocity.value = velocity.texture;
  // Ground-truth AO: contact darkening under the floor, in wheel arches, at barrier feet. GTAO rebuilds view positions from
  // perspective depth, but this renderer's depth is logarithmic (d = log2(1 + w) / log2(far + 1)), so both of its shaders
  // get a getViewPosition that scales the pixel's view ray to w instead (converting back to perspective depth bands at range).
  const ao = new GTAOPass(scene, camera, 1, 1);
  const viewPos = `vec3 getViewPosition(const in vec2 uv, const in float depth) {
    vec4 ray = cameraProjectionMatrixInverse * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 p = ray.xyz / ray.w;
    return p * ((exp2(depth * ${Math.log2(camera.far + 1).toFixed(6)}) - 1.0) / -p.z);
  }`;
  for (const m of [ao.gtaoMaterial, ao.pdMaterial]) m.fragmentShader = m.fragmentShader.replace(/vec3 getViewPosition\([^)]*\) \{[^}]*\}/, viewPos);
  // its normal/depth pass: no effects or contact-shadow decals (layer 1), and the beauty pass already drew the shadow maps
  const [hide, show] = [ao.overrideVisibility, ao.restoreVisibility];
  ao.overrideVisibility = () => { camera.layers.disable(1); renderer.shadowMap.autoUpdate = false; hide.call(ao); };
  ao.restoreVisibility = () => { show.call(ao); renderer.shadowMap.autoUpdate = true; camera.layers.enable(1); };
  const dof = new ShaderPass(dofShader);
  dof.uniforms.tDepth.value = ao.depthTexture;
  dof.uniforms.uLogFar.value = Math.log2(camera.far + 1);
  dof.enabled = false;
  let focusAt = 0, stop = 0, height = 1, mps = 1;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(ao);
  composer.addPass(dof);
  composer.addPass(blur);
  // threshold in linear HDR: only sun glints on paint, halo and wet-look clearcoat, sparks and the sun itself bloom
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 2.5));
  composer.addPass(new ShaderPass(caShader));
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass(1, 1));  // on the tone-mapped image: specular and shader aliasing MSAA doesn't touch

  return {
    setSize(w, h) {
      const pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);  // the composer keeps the ratio it was built with otherwise
      composer.setSize(w, h);
      velocity.setSize(Math.max(1, Math.round(w * pr / 2)), Math.max(1, Math.round(h * pr / 2)));
      dof.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
      height = h * pr;
    },
    // depth of field: focus distance in scene units and the lens f-number (0 / undefined = off)
    focus(distance, fNumber) {
      dof.enabled = distance > 0 && fNumber > 0;
      focusAt = distance;
      stop = fNumber;
    },
    reset() { skip = true; },  // after a camera cut: no blur from the jump
    setMps(m) { mps = m; ao.updateGtaoMaterial({radius: 1 / m, thickness: 1 / m}); },  // AO reach ~1 m, in scene units
    // shutter: 0..1 scale on top of the exposure (1 / replay speed, so a sped-up replay isn't a smear)
    render(dt, shutter = 1) {
      frame++;
      camera.updateMatrixWorld();
      rot.extractRotation(camera.matrixWorldInverse).premultiply(camera.projectionMatrix);
      blur.uniforms.uReproj.value.copy(prevRot).multiply(rot.clone().invert());
      // per-frame motion -> motion during the exposure: v_frame / dt * EXPOSURE
      blur.uniforms.uScale.value = skip ? 0 : shutter * EXPOSURE / Math.max(dt, 1 / 240);
      if (skip) prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      velMat.uniforms.uPrevViewProj.value.copy(prevVP);
      if (dof.enabled) {
        const u = dof.uniforms, f = SENSOR / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), s = focusAt * mps;
        u.uFocus.value = focusAt;
        u.uScale.value = f * f / (stop * Math.max(s - f, f)) / SENSOR * height;
        u.uRadius.value = THREE.MathUtils.clamp(u.uScale.value * 3, 1, 0.012 * height);  // the far blur and nearer
      }

      const bg = scene.background, alpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      scene.background = null;
      scene.overrideMaterial = velMat;
      camera.layers.disable(1);  // effects and contact shadows have no motion vectors of their own
      renderer.shadowMap.autoUpdate = false;  // shadow maps are rendered once, for the beauty pass
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(velocity);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(clear, alpha);
      renderer.shadowMap.autoUpdate = true;
      camera.layers.enable(1);
      scene.overrideMaterial = null;
      scene.background = bg;

      composer.render(dt);

      prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      prevRot.extractRotation(camera.matrixWorldInverse).premultiply(camera.projectionMatrix);
      scene.traverseVisible(o => {  // hidden LOD levels are most of the scene
        if (o.isMesh) (prev.get(o) ?? prev.set(o, new THREE.Matrix4()).get(o)).copy(o.matrixWorld).frame = frame;
      });
      skip = false;
    },
  };
}
