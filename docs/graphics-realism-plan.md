# 3D graphics realism: audit and plan (Oct 2026)

## 1. Audit

What's there (`scene3d.js`, `circuit3d.js`, `track3d.js`, `textures3d.js`, `cars3d.js`, `rb22.js`, `post.js`, `vfx.js`):
a solid physically based pipeline. It has a Poly Haven HDRI for image-based light, four-cascade sun shadows (CSM),
4x MSAA half-float HDR, per-object motion blur, bloom, two-lobe flake paint, anisotropic carbon and discs,
satellite ground, and an asphalt shader with rubber and water.

Chase-cam screenshots (COTA, 2026 Simulation) and a read of the code show where the realism goes:

| # | Area | Finding | Impact |
|---|------|---------|--------|
| A1 | Colour | `ACESFilmicToneMapping` shifts and oversaturates hues: kerb red goes neon, team colours drift (blue towards purple, red towards orange). | High: every pixel |
| A2 | Asphalt | 256 px canvas speckle with no normal or roughness map. The track reads as flat grey plastic up close. The speckle is reused as a bump map. | High |
| A3 | Gravel | 256 px canvas speckle with a pink cast. No relief. | Medium |
| A4 | Kerbs | Flat 8x64 canvas stripe, saturated `#d42b2b`, 1.6 m wide. Laid on **both** sides of every corner for its whole length. Real kerbs sit on the inside apex and the outside exit and are ridged. | High: the most visible element in chase views |
| A5 | Trees | `flatShading` icosahedra (detail 1) and 7-sided cones. Faceted, uniform and toy-like. Every chase/heli shot shows them. | High |
| A6 | Barriers | A 1.1 m painted wall and nothing above it. No debris fence, a signature of every F1 circuit. | Medium |
| A7 | Paint | Every era uses glossy metallic flake (metalness 0.45). Since 2016 F1 liveries are matte or satin (Red Bull 2016, Ferrari 2019, McLaren 2020, Alpine 2021) because gloss costs weight. | Medium |
| A8 | Bodywork | 2022+ cars leave much of the lower bodywork as bare carbon to save paint weight. The procedural car paints it all. | Medium |
| A9 | Decals | The race number is `MeshBasicMaterial` (unlit), so it glows in shadow, in the Monaco tunnel and under cloud. | Bug |
| A10 | RB22 | `redbull_detail` has no `metallicFactor`, so glTF's default 1 makes those dark parts chrome. The accent trim (`redbull_color`) is metallic 0.5. | Medium |
| A11 | Brakes | Carbon discs never glow. Real ones reach ~1000 °C and glow orange under heavy braking. | Low/medium: a recognisable detail |
| A12 | AO | No screen-space ambient occlusion. Wheel wells, cockpit and undertray look flat. | High, but **blocked**: see 3 |
| A13 | Wet | The wet track reflects only the HDRI, not the cars. Needs SSR. | Medium, **blocked** |
| A14 | Sky | The 2k HDRI is ~6 px/degree, so the sky is soft in the 30° heli view. 4k is ~25 MB. | Low |

## 2. Research

- **Tone mapping:** three r169 ships `NeutralToneMapping`, Khronos PBR Neutral. Khronos recommends it for
  glTF/PBR content: it keeps hue and saturation of the base colour and compresses only the highlights. The cars'
  livery colours are the subject here, so it fits better than ACES (hue shifts) or AgX (desaturated). For grey it is
  `x - 0.04` below 0.76. ACES at exposure 0.8 maps 0.18 grey to ~0.16. Neutral needs exposure ~1.0-1.1 to match the
  mid-tones and keeps more highlight detail.
  ([three.js tone-mapping overview](https://discourse.threejs.org/t/tone-mapping-overview/75204))
- **Matte liveries:** weight is the reason. Gloss costs "a few hundred grams", and since 2022 teams leave bare carbon
  on sidepods, engine cover and floor edges. ([The Drive](https://www.thedrive.com/accelerator/f1-teams-are-stripping-paint-off-their-cars-to-save-weight),
  [The Race, Mark Hughes](https://www.the-race.com/formula-1/mark-hughes-on-dull-2024-formula-1-liveries/),
  [isitfast](https://isitfast.co.uk/f1-teams-removing-paint/))
- **Textures:** Poly Haven CC0 PBR sets come from the same `dl.polyhaven.org` host as the HDRI, with
  `Access-Control-Allow-Origin: *`. `asphalt_pit_lane` (2 m, dark, uniform, no cracks) suits fresh racing asphalt.
  `asphalt_02` has long cracks that would tile visibly along a lap. `gravel_floor` is 2.25 m. Each 1k JPG is
  0.5-1.5 MB.
- **AO with a logarithmic depth buffer:** the renderer needs `logarithmicDepthBuffer` (near 0.05, far 30000 units,
  ratio 6e5). GTAO/SAO/N8AO rebuild view position from perspective depth, so log depth breaks them. Forum reports
  say only the newer WebGPU renderer fixes AO with log depth.
  ([forum](https://discourse.threejs.org/t/is-there-a-way-to-use-ssao-when-camera-far-is-large/74514))
  So SSAO (A12), SSR (A13) and depth of field wait for a three.js upgrade with reverse-Z or WebGPU. That is out of
  scope for this pass.

## 3. Plan

Each step is independent, falls back to the current look if a download fails, and changes no public API.

### Phase 1: colour pipeline
1. `scene3d.js`: `NeutralToneMapping`, exposure 0.8 -> 1.0. `carsdeck.js` preview: same tone mapping, so the deck
   and the race match.

### Phase 2: ground surfaces (`textures3d.js`, `track3d.js`, `circuit3d.js`, `scene3d.js`)
2. `textures3d.js` `pbr(name, metres)`: loads Poly Haven `diff`/`nor_gl`/`rough` 1k JPGs into textures that exist up
   front. Until a load lands they hold the canvas look (diffuse = the current speckle, normal = flat, roughness =
   white), so materials compile once with their maps and the images swap in. Per-set repeat converts the strip's tile
   size to the texture's real size.
3. Asphalt (`asphalt_pit_lane`, slightly cooled tint): track, run-off and pit lane. `asphalt()` takes `{map,
   normalMap, roughnessMap}` in place of the speckle-as-bump-map. Rain flattens `normalScale`, not `bumpScale`
   (`setWeather`).
4. Gravel (`gravel_floor`) with normal and roughness.
5. Kerbs: TV-graphic red `#c4161c` and off-white, a canvas ridge normal map, 1.2 m wide. Placed like the real thing:
   the inside of the corner over the whole run and the outside over its exit half (the side already computed for
   gravel traps).

### Phase 3: trackside (`circuit3d.js`)
6. Debris fence: a 3 m alpha-tested diamond-mesh strip with posts every 4 m, on top of every barrier (it follows the
   pit-lane openings because it is built in `barriers()`). `alphaToCoverage` keeps the wires anti-aliased under MSAA.
   It casts shadows: three's shadow depth material honours `alphaMap`/`alphaTest`.
7. Trees: smooth-shaded, noise-displaced crowns (broadleaf: lumpy icosphere, detail 3; conifer: three stacked tiers)
   with a baked vertex-colour gradient (dark underside and core, lit top) that multiplies the per-instance colour.
   No more facets.

### Phase 4: cars (`cars3d.js`, `rb22.js`, `scene3d.js`)
8. `paintMat(color, year)`: gloss metallic flake before 2016, satin from 2016 (metalness 0.1, roughness 0.5,
   clearcoat 0.5 at roughness 0.3, flakes off).
9. 2022+: bare-carbon lower bodywork. Below 0.24 m (car space) the paint shader blends to dark, rougher carbon.
   Procedural car only: the RB22's model space is offset, so it is off there.
10. The number decal becomes a lit `MeshStandardMaterial`.
11. RB22: `redbull_detail` metalness 0, accent clone metalness 0 and roughness 0.45 (matte trim).
12. Brake glow: per-car disc material clones (procedural and RB22 `discs*`). `effects()` builds disc heat from
    braking g: it rises in ~0.3 s past ~2.5 g and cools with a ~2 s time constant. Emissive is black-body orange,
    intensity up to 3, so bloom picks it up.

### Deferred (documented, not in this pass)
- SSAO / GTAO, SSR on the wet track, depth of field: need a three.js upgrade (r17x reverse-Z or WebGPU).
- 4k HDRI for the heli view: ~25 MB download, and the 2k one is fine at chase distance.
- Grandstands, crowds, marshal posts, advertising boards: need assets.
- Tyre sidewall branding: trademarks.

## 4. Verification
- `node tests/*.mjs` and `tests/test_server.py` stay green (no physics or API change).
- In the browser, chase/T-cam/heli/overview screenshots of a Simulation before and after: kerb placement, fence,
  trees, asphalt detail, paint finish, brake glow under braking, and no console errors. Check the fallback by
  blocking `dl.polyhaven.org`: the canvas textures stay.
