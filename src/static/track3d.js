// Track surface: procedural asphalt as a TSL node material. The racing line its rubber follows comes from sim.js.
import * as THREE from 'three';
import {Fn, uniform, attribute, texture, uv, vec2, vec3, float, fract, floor, dot, mix, smoothstep, clamp, exp, abs, max, min, sqrt, fwidth,
        normalize, normalMap as normalMapNode, materialColor} from 'three/tsl';

const hash = Fn(([p]) => {
  const q = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  q.addAssign(dot(q, q.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
});

// value noise: cheap, tile-free, and the same at every LOD of the road (mx_noise is ~4x the instructions for no visible gain here)
export const noise = Fn(([p]) => {
  const i = floor(p), f = fract(p), s = f.mul(f).mul(f.mul(-2).add(3));
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), s.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(1)), s.x), s.y);
});

// Procedural asphalt. track = (metres across from the left edge, metres along the lap). Rubber laid down on the racing line
// darkens the surface and polishes it smoother, strongest in two tyre tracks 0.8 m either side of the line, inside a broad
// band where different cars' lines overlap; userData.rubber grows over the session (track evolution). Elsewhere tone and
// roughness wander with low-frequency noise (patches, repairs); the photo set's normal and roughness maps give the
// aggregate (the photo is a little warm, the tint cools it).
//
// The photo tiles every 2 m; a second sample of it, rotated 37 deg and at 0.83x the scale, is blended in by low-frequency
// noise so the grid never lines up (its normals rotated back into the first sample's tangent frame). On top: tyre marks
// (thin dark streaks along the lap, densest around the line) and the sealed joints between paving lanes every 4.5 m,
// antialiased by their screen-space width so they fade instead of shimmering at a distance.
//
// Water (wetLine / wetOff, 0..1 from the weather model): depth at a point is the racing line's within ~2 m of the line and
// the off-line value elsewhere, the same blend as weather.js wetAt, so the drying line shows as a matt grey stripe through a
// shiny track. Standing water collects first in the low spots of the surface, so puddles (a low-frequency noise threshold)
// appear before the whole track floods. Water fills the asphalt's pores: light that would have scattered back out is
// trapped, so wet asphalt is darker. A continuous film is optically flat, so roughness drops towards 0.035, and it adds a
// clearcoat lobe for the near-mirror reflection of sky and cars. Water is a dielectric (F0 = 0.02, close to asphalt's
// 0.04), so metalness stays 0: the mirror look is smoothness plus Fresnel, strongest at the grazing angles a camera sees.
// maps: {map, normalMap, roughnessMap} (textures3d.js)
export function asphalt(maps, half) {
  const mat = new THREE.MeshPhysicalNodeMaterial({color: 0xc4d0dc, side: THREE.DoubleSide, clearcoatRoughness: 0.05, ior: 1.5});
  const rubberAmount = uniform(0.3), wetLine = uniform(0), wetOff = uniform(0), normalScale = uniform(1);
  mat.userData = {rubber: rubberAmount, wetLine, wetOff, normalScale};
  const track = uv().mul(4);  // 4 m tiles
  const lat = track.x.sub(half).sub(attribute('line', 'float'));  // metres from the racing line
  // the set's repeat arrives when its photos load: uniform() holds the Vector2 itself, so it follows
  const uvA = uv().mul(uniform(maps.map.repeat));
  const uvB = vec2(dot(uvA, vec2(0.8, -0.6)), dot(uvA, vec2(0.6, 0.8))).mul(0.83).add(0.37);
  const bmix = smoothstep(0.35, 0.65, noise(track.mul(0.3)));

  const band = lat.abs().sub(0.8).div(0.35), broad = lat.div(1.8);
  const rubber = clamp(rubberAmount.mul(exp(band.mul(band).negate()).mul(0.6).add(exp(broad.mul(broad).negate()).mul(0.5)))
    .mul(noise(track.mul(vec2(0.6, 0.08))).mul(0.6).add(0.6)), 0, 1);  // streaky along the lap
  const marks = smoothstep(0.62, 0.9, noise(vec2(lat.mul(3), track.y.mul(0.015))))
    .mul(smoothstep(0.45, 0.75, noise(vec2(lat.mul(0.7).add(5), track.y.mul(0.04))))).mul(exp(lat.mul(lat).div(-20)).mul(0.6).add(0.4));
  const jw = max(fwidth(track.x), 1e-4), jd = abs(fract(track.x.div(4.5).add(0.5)).sub(0.5)).mul(4.5);  // metres to a joint
  const joint = clamp(float(0.03).sub(jd).div(jw).add(0.5), 0, 1).mul(min(1, float(0.06).div(jw)));
  const wet = mix(wetOff, wetLine, exp(lat.mul(lat).div(-8)));
  const puddle = smoothstep(0.55, 0.75, noise(track.mul(0.09).add(3)));
  const water = clamp(wet.mul(1.4).sub(0.15).add(puddle.mul(wet)), 0, 1);

  mat.colorNode = materialColor.rgb.mul(mix(texture(maps.map, uvA), texture(maps.map, uvB), bmix).rgb)
    .mul(noise(track.mul(0.12)).mul(0.16).add(0.92)).mul(rubber.mul(-0.6).add(1))
    .mul(marks.mul(-0.3).add(1)).mul(joint.mul(-0.2).add(1)).mul(mix(1, 0.45, sqrt(water)));
  // bare aggregate ~0.72, polished rubber 0.28, a water film 0.035
  const rough = mix(texture(maps.roughnessMap, uvA).g, texture(maps.roughnessMap, uvB).g, bmix).mul(0.72)
    .mul(noise(track.mul(0.3).add(7)).mul(0.15).add(0.88));
  mat.roughnessNode = mix(mix(rough, 0.28, max(rubber, marks.mul(0.5))), 0.035, water);
  mat.metalnessNode = float(0);
  mat.clearcoatNode = max(water, rubber.mul(0.15));
  // the second sample's slopes rotated into the first's frame, blended, and scaled by the water film smoothing the aggregate
  const nA = texture(maps.normalMap, uvA).xyz, nB = texture(maps.normalMap, uvB).xyz.mul(2).sub(1);
  const nBack = vec3(dot(nB.xy, vec2(0.8, 0.6)), dot(nB.xy, vec2(-0.6, 0.8)), nB.z).mul(0.5).add(0.5);
  mat.normalNode = normalMapNode(normalize(mix(nA.mul(2).sub(1), nBack.mul(2).sub(1), bmix)).mul(0.5).add(0.5), normalScale);
  return mat;
}
