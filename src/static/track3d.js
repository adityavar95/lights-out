// Track surface: procedural asphalt shader. The racing line its rubber follows comes from sim.js.
import * as THREE from 'three';

export const NOISE = /* glsl */`
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}`;

// Procedural asphalt: MeshStandardMaterial with GLSL injected. vTrack = (metres across from the left edge, metres along the
// lap). Rubber laid down on the racing line darkens the surface and polishes it smoother (lower roughness), strongest in
// two tyre tracks 0.8 m either side of the line, inside a broad band where different cars' lines overlap; uRubber grows
// over the session (track evolution). Elsewhere tone and roughness wander with low-frequency noise (patches, repairs);
// the photo set's normal and roughness maps give the aggregate (the photo is a little warm, the tint cools it).
//
// The photo tiles every 2 m; a second sample of it, rotated 37 deg and at 0.83x the scale, is blended in by low-frequency
// noise so the grid never lines up (its normals rotated back into the first sample's tangent frame). On top: tyre marks
// (thin dark streaks along the lap, densest around the line) and the sealed joints between paving lanes every 4.5 m,
// antialiased by their screen-space width so they fade instead of shimmering at a distance.
//
// Water (uWetLine / uWetOff, 0..1 from the weather model): depth at a point is the racing line's within ~2 m of the line
// and the off-line value elsewhere, the same blend as weather.js wetAt, so the drying line shows as a matt grey stripe
// through a shiny track. Standing water collects first in the low spots of the surface, so puddles (a low-frequency
// noise threshold) appear before the whole track floods. Water fills the asphalt's pores: light that would have
// scattered back out is trapped, so wet asphalt is darker. A continuous film is optically flat, so roughness drops
// towards 0.035 and the image-based lighting becomes near-mirror reflections of the sky and cars. Water is a dielectric
// (F0 = 0.02, close to asphalt's 0.04), so metalness stays 0: the mirror look is smoothness plus Fresnel, which makes
// reflections strongest at the grazing angles a camera sees a track from.
// maps: {map, normalMap, roughnessMap} (textures3d.js)
export function asphalt(maps, half) {
  const mat = new THREE.MeshStandardMaterial({...maps, color: 0xd0d6e0, roughness: 1, side: THREE.DoubleSide});
  Object.assign(mat.userData, {rubber: {value: 0.3}, wetLine: {value: 0}, wetOff: {value: 0}});
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRubber = mat.userData.rubber;
    sh.uniforms.uWetLine = mat.userData.wetLine;
    sh.uniforms.uWetOff = mat.userData.wetOff;
    sh.uniforms.uHalf = {value: half};
    sh.vertexShader = 'attribute float line;\nvarying float vLine;\nvarying vec2 vTrack;\n' +
      sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvLine = line;\nvTrack = uv * 4.0;');  // 4 m tiles
    sh.fragmentShader = `uniform float uRubber, uHalf, uWetLine, uWetOff;\nvarying float vLine;\nvarying vec2 vTrack;\n${NOISE}
      const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
      vec2 uvB(vec2 uv) { return ROT * uv * 0.83 + 0.37; }\n` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        float bmix = smoothstep(0.35, 0.65, noise(vTrack * 0.3));
        diffuseColor *= mix(texture2D(map, vMapUv), texture2D(map, uvB(vMapUv)), bmix);
        float lat = vTrack.x - uHalf - vLine;  // metres from the racing line
        float rubber = clamp(uRubber * (0.6 * exp(-pow((abs(lat) - 0.8) / 0.35, 2.0)) + 0.5 * exp(-pow(lat / 1.8, 2.0)))
                             * (0.6 + 0.6 * noise(vTrack * vec2(0.6, 0.08))), 0.0, 1.0);  // streaky along the lap
        diffuseColor.rgb *= (0.92 + 0.16 * noise(vTrack * 0.12)) * (1.0 - 0.6 * rubber);
        float marks = smoothstep(0.62, 0.9, noise(vec2(lat * 3.0, vTrack.y * 0.015)))
                    * smoothstep(0.45, 0.75, noise(vec2(lat * 0.7 + 5.0, vTrack.y * 0.04))) * (0.4 + 0.6 * exp(-lat * lat / 20.0));
        float jw = max(fwidth(vTrack.x), 1e-4), jd = abs(fract(vTrack.x / 4.5 + 0.5) - 0.5) * 4.5;  // metres to a joint
        float joint = clamp((0.03 - jd) / jw + 0.5, 0.0, 1.0) * min(1.0, 0.06 / jw);
        diffuseColor.rgb *= (1.0 - 0.3 * marks) * (1.0 - 0.2 * joint);
        float wet = mix(uWetOff, uWetLine, exp(-lat * lat / 8.0));
        float puddle = smoothstep(0.55, 0.75, noise(vTrack * 0.09 + 3.0));
        float water = clamp(wet * 1.4 - 0.15 + puddle * wet, 0.0, 1.0);
        diffuseColor.rgb *= mix(1.0, 0.45, sqrt(water));`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * mix(texture2D(roughnessMap, vRoughnessMapUv).g, texture2D(roughnessMap, uvB(vRoughnessMapUv)).g, bmix);
        roughnessFactor = mix(roughnessFactor * (0.88 + 0.15 * noise(vTrack * 0.3 + 7.0)), 0.55, max(rubber, 0.5 * marks));
        roughnessFactor = mix(roughnessFactor, 0.035, water);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 nA = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0, nB = texture2D(normalMap, uvB(vNormalMapUv)).xyz * 2.0 - 1.0;
        nB.xy = nB.xy * ROT;  // = transpose(ROT) * xy: the rotated sample's slopes in the first sample's frame
        vec3 mapN = normalize(mix(nA, nB, bmix));
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);`);
  };
  mat.customProgramCacheKey = () => 'asphalt';
  return mat;
}
