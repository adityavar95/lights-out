// Post-processing as one TSL node graph on a THREE.RenderPipeline. A single pass writes colour, velocity and emissive
// through MRT, because WebGPU charges for a second scene draw what the old WebGL chain paid three times over (beauty,
// velocity with an override material, GTAO's own normal pass). From there:
// HDR scene x half-res GTAO -> depth of field -> motion blur -> bloom -> chromatic aberration -> AgX + sRGB -> SMAA.
import * as THREE from 'three';
import {pass, mrt, output, velocity, emissive, uniform, Fn, vec2, vec3, vec4, float, mix, Loop, If, uv, convertToTexture,
        renderOutput, clamp, length, dot, fract, sqrt, cos, sin, min, max, pow, screenCoordinate} from 'three/tsl';
import {ao} from 'three/addons/tsl/display/GTAONode.js';
import {bloom} from 'three/addons/tsl/display/BloomNode.js';
import {smaa} from 'three/addons/tsl/display/SMAANode.js';

const EXPOSURE = 1 / 100;  // simulated camera shutter time, s: a broadcast camera's (1/60 smeared fast pans and the ground)
const SENSOR = 0.024;      // m, full-frame sensor height: with the camera's vertical fov it gives the focal length
const BLUR_TAPS = 16, DOF_TAPS = 32;
// of the screen: the longest streak. 0.035 (~90 px, 16 taps 5 px apart) smeared the chase camera's fences and stands into
// ghosted bands at speed; at 0.015 the near ground still streaks and the background stays readable.
const MAX_BLUR = 0.015;

const ign = () => fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)).mul(52.9829189));  // interleaved gradient noise

// options: graphics.js's msaa, smaa, ao, dof, blur, bloom, lens, contrast, saturation
export function createPost(renderer, scene, camera, options) {
  // MSAA here, not on the canvas: edges of wishbones, fences and track lines are resolved while the values are still HDR
  const scenePass = pass(scene, camera, {samples: options.msaa ? 4 : 0});
  // Velocity blends by its own alpha: a solid surface writes alpha 1, and an effect (vfx.js noVelocity) writes 0 and leaves the
  // surface's vector. Without this every smoke puff stamped one vector over its whole disc, and the blur smeared the car under it.
  const keepUnder = Object.assign(new THREE.BlendMode(THREE.CustomBlending), {blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor});
  scenePass.setMRT(mrt({output, velocity, emissive}).setBlendMode('velocity', keepUnder));
  const color = scenePass.getTextureNode('output'), depth = scenePass.getTextureNode('depth'), vel = scenePass.getTextureNode('velocity');
  const glow = scenePass.getTextureNode('emissive');

  // contrast and saturation: Blender's AgX "Punchy" look by default, since AgX alone has lifted blacks and pale colours
  const uPunch = uniform(options.contrast), uSaturation = uniform(options.saturation);
  const uScale = uniform(0), uReproj = uniform(new THREE.Matrix4()), uFarZ = uniform(1);
  // view depth from a depth value for either depth convention: clip z = A z + B, clip w = -z, so d = -A - B / z
  const uA = uniform(0), uB = uniform(0);
  const viewDepth = d => uB.div(d.add(uA));
  const uFocus = uniform(0), uCoc = uniform(0), uRadius = uniform(0), uDof = uniform(0), uTexel = uniform(new THREE.Vector2(1, 1));

  // Motion vector at p, as a uv offset across the exposure. NDC y is up and uv y is down, hence the flip. The sky gets
  // the camera's rotation alone: the background mesh follows the camera, so its stored velocity means nothing.
  const motion = Fn(([p]) => {
    const d = depth.sample(p).r, ndc = vec2(p.x.mul(2).sub(1), float(1).sub(p.y.mul(2)));
    const prev = uReproj.mul(vec4(ndc, uFarZ, 1));
    const sky = ndc.sub(prev.xy.div(prev.w));
    const v = d.equal(uFarZ).select(sky, vel.sample(p).xy).mul(vec2(0.5, -0.5)).mul(uScale).toVar();
    v.assign(length(v).lessThan(1000).select(v, vec2(0)));  // false for NaN too: one bad vector must not smear
    const l = length(v);
    If(l.greaterThan(MAX_BLUR), () => { v.assign(v.mul(float(MAX_BLUR).div(l))); });
    return v;
  });

  // Gather along the motion vector. A tap only counts if it moved like this pixel (|v_tap - v| < |v|), so a car the camera
  // tracks (v ~ 0) stays sharp instead of smearing into the streaking ground around it, which three's stock motionBlur
  // node doesn't do: on a chase camera it blurred the very thing being watched.
  const blurOf = tex => Fn(() => {
    const p = uv(), base = tex.sample(p), v = motion(p).toVar(), len = length(v);
    const sum = vec4(base).toVar(), total = float(1).toVar(), jitter = ign();
    If(len.greaterThanEqual(0.0005), () => {
      Loop(BLUR_TAPS, ({i}) => {
        const q = p.add(v.mul(float(i).add(jitter).div(BLUR_TAPS).sub(0.5)));
        const w = clamp(float(2).sub(length(motion(q).sub(v)).mul(2).div(len)), 0, 1);
        sum.addAssign(tex.sample(q).mul(w));
        total.addAssign(w);
      });
    });
    return sum.div(total);
  })();

  // Thin-lens circle of confusion F^2 / (N (s - F)) |1 - s / w| in pixels, over a jittered Vogel disk. A tap counts where
  // its own blur reaches this pixel; one behind this pixel only as far as this pixel's blur, so a sharp car gets no halo
  // of the blurred background while a blurred foreground still spills over it.
  const dofOf = tex => Fn(() => {
    const p = uv(), base = tex.sample(p);
    const sum = vec4(base).toVar(), total = float(1).toVar();
    If(uDof.greaterThan(0.5), () => {
    const coc = w => min(float(1).sub(uFocus.div(w)).abs().mul(uCoc), uRadius);
    const w0 = viewDepth(depth.sample(p).r), c0 = coc(w0), spin = ign().mul(6.2831853);
    Loop(DOF_TAPS, ({i}) => {
      const r = sqrt(float(i).add(0.5).div(DOF_TAPS)).mul(uRadius), a = float(i).mul(2.39996323).add(spin);
      const q = p.add(vec2(cos(a), sin(a)).mul(r).mul(uTexel));
      const w = viewDepth(depth.sample(q).r), c = w.greaterThan(w0).select(min(coc(w), c0), coc(w));
      const k = clamp(c.sub(r).add(1), 0, 1);
      sum.addAssign(tex.sample(q).mul(k));
      total.addAssign(k);
    });
    });
    return sum.div(total);
  })();

  // GTAO varies its samples by a 5x5 noise tile and leaves the denoising to the caller; unfiltered it speckled the ground under every car.
  // One axis of a 5-tap blur across that tile, in half-res texels, keeping to the same surface so the AO doesn't bleed across a car's edge.
  const aoBlur = (tex, axis) => Fn(() => {
    const p = uv(), w0 = viewDepth(depth.sample(p).r);
    const sum = tex.sample(p).r.toVar(), total = float(1).toVar();
    for (const i of [-4, -2, 2, 4]) {
      const q = p.add(axis.mul(uTexel).mul(i));
      const k = clamp(float(1).sub(viewDepth(depth.sample(q).r).sub(w0).abs().div(w0.mul(0.05))), 0, 1);
      sum.addAssign(tex.sample(q).r.mul(k));
      total.addAssign(k);
    }
    return vec4(sum.div(total), 0, 0, 1);
  })();

  let aoNode = null, bloomNode = null, smaaNode = null, tier = options, focusAt = 0, stop = 0, height = 1, mps = 1;
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;  // renderOutput below does it before SMAA, which wants the display image

  const targets = [], target = n => { const r = convertToTexture(n); targets.push(r); return r; };
  const build = () => {
    // every rebuild makes new full-screen targets: 14 setting changes at 4K ran the GPU out of memory
    for (const n of [aoNode, bloomNode, smaaNode]) n?.dispose?.();
    for (const r of targets.splice(0)) r.renderTarget?.dispose();
    aoNode = bloomNode = smaaNode = null;
    let image = color;
    if (tier.ao) {
      // Normals from depth, not an MRT target: smoke writes no depth but overwrote the normal under it, and GTAO turned each
      // puff into a black disc. Only what's in the depth buffer can occlude.
      aoNode = ao(depth, null, camera);
      aoNode.resolutionScale = 0.5;  // half-res: ~4x cheaper, and contact shadows are soft anyway
      aoNode.radius.value = 0.35 / mps;
      aoNode.thickness.value = 1 / mps;
      aoNode.scale.value = 1.1;
      // multiplied here rather than fed to lighting through builtinAOContext: that needs AO before the beauty pass, so a
      // second depth + normal draw, the cost the single MRT pass exists to avoid
      image = vec4(image.rgb.mul(aoBlur(target(aoBlur(aoNode.getTextureNode(), vec2(1, 0))), vec2(0, 1)).r), 1);
    }
    let sharp = target(image);
    if (tier.dof) sharp = target(dofOf(sharp));
    const blurred = tier.blur ? target(blurOf(sharp)) : sharp;
    // threshold in linear HDR: 2.5 rather than a display-range 0.85, or every pixel of the photographed sky would bloom.
    // Only sun glints, sparks, hot brakes and rain lights get there, and emissive is lifted so they always do.
    if (tier.bloom) bloomNode = bloom(blurred.rgb.add(glow.rgb.mul(1.5)), 0.32, 0.45, 2.5);
    // lateral chromatic aberration: red and blue land at slightly different magnifications, ~1 px at a 1080p corner
    const lens = !tier.lens ? blurred : Fn(() => {
      const p = uv(), d = p.sub(0.5), o = d.mul(dot(d, d)).mul(0.002);
      return vec4(blurred.sample(p.add(o)).r, blurred.sample(p).g, blurred.sample(p.sub(o)).b, 1);
    })();
    // AgX keeps highlights from clipping but flattens everything else: a red livery came out salmon, the asphalt pale grey.
    // The look goes on after the curve, where the image is display-encoded, as Blender's does.
    const shown = pow(max(renderOutput(vec4(bloomNode ? lens.rgb.add(bloomNode.rgb) : lens.rgb, 1)).rgb, vec3(0)), vec3(uPunch));
    const graded = vec4(clamp(mix(vec3(dot(shown, vec3(0.2126, 0.7152, 0.0722))), shown, uSaturation), 0, 1), 1);
    // on the tone-mapped image: specular and shader aliasing MSAA doesn't touch
    pipeline.outputNode = tier.smaa ? (smaaNode = smaa(target(graded))) : graded;
    pipeline.needsUpdate = true;
  };
  build();

  const rot = new THREE.Matrix4(), prevRot = new THREE.Matrix4(), inv = new THREE.Matrix4();
  let skip = true;
  return {
    pipeline,
    scenePass,
    // rebuilds the graph, a stall of a frame or two, so only when the graph changes; contrast and saturation are uniforms
    setOptions(o) {
      uPunch.value = o.contrast;
      uSaturation.value = o.saturation;
      const same = ['msaa', 'smaa', 'ao', 'dof', 'blur', 'bloom', 'lens'].every(k => o[k] === tier[k]);
      tier = o;
      if (same) return;
      build();
      skip = true;
    },
    setSize(w, h, pr) {
      uTexel.value.set(1 / (w * pr), 1 / (h * pr));
      height = h * pr;
    },
    // depth of field: focus distance in scene units and the lens f-number (0 / undefined = off)
    focus(distance, fNumber) {
      uDof.value = distance > 0 && fNumber > 0 && tier.dof ? 1 : 0;
      focusAt = distance;
      stop = fNumber;
    },
    reset() { skip = true; },  // after a camera cut: no blur from the jump
    setMps(m) {
      mps = m;
      if (aoNode) { aoNode.radius.value = 0.35 / m; aoNode.thickness.value = 1 / m; }  // scene units
    },
    // shutter: 0..1 scale on top of the exposure (1 / replay speed, so a sped-up replay isn't a smear)
    render(dt, shutter = 1) {
      camera.updateMatrixWorld();
      const e = camera.projectionMatrix.elements;
      uA.value = e[10];
      uB.value = e[14];
      uFarZ.value = renderer.reversedDepthBuffer ? 0 : 1;
      rot.extractRotation(camera.matrixWorldInverse).premultiply(camera.projectionMatrix);
      if (skip) prevRot.copy(rot);
      uReproj.value.copy(prevRot).multiply(inv.copy(rot).invert());
      // per-frame motion -> motion during the exposure: v_frame / dt * EXPOSURE
      uScale.value = skip ? 0 : shutter * EXPOSURE / Math.max(dt, 1 / 240);
      if (uDof.value) {
        const f = SENSOR / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), s = focusAt * mps;
        uFocus.value = focusAt;
        uCoc.value = f * f / (stop * Math.max(s - f, f)) / SENSOR * height;
        uRadius.value = THREE.MathUtils.clamp(uCoc.value * 3, 1, 0.012 * height);  // the far blur and nearer
      }
      pipeline.render();
      prevRot.copy(rot);
      skip = false;
    },
    dispose() {
      for (const n of [aoNode, bloomNode, smaaNode]) n?.dispose?.();
      for (const r of targets) r.renderTarget?.dispose();
      scenePass.dispose();
      pipeline.dispose();
    },
  };
}
