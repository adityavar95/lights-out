# 3D model credits

The project code's licence does not cover these files; each keeps its own licence.

## rb22.glb

- Model: "2026 Redbull RB22" by Tyler_Dave (Sketchfab)
- Licence: [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- Source: taken from [AgentiLoop/F1](https://github.com/AgentiLoop/F1) (`models/rb22.glb`), where the gold fastener
  discs in the `redbull_detail` texture were painted over in the surrounding dark grey (#212421).
- Changes: `rb22.js` (adapted from AgentiLoop/F1's `src/rb22.mjs`) replaces the Red Bull livery at load time: the
  paint texture is refilled in each team's colour with its driver's race number projected onto the nose, the decal
  and race-number meshes are hidden, the accent-coloured parts take a contrast colour, the ORACLE logos are cleared
  from the steering wheel, and the tail of the rear-light mesh becomes the flashing rain light. It also splits the
  wheels per corner (spin, steer, tyre-compound rings), turns the steering wheel, separates the sprung body and makes
  the mirror glass reflect (`mirror.js`, from AgentiLoop/F1's `src/mirror3d.mjs`). Used for 2026+ cars up close.

## redbull-rb22.glb, ferrari-sf26.glb, mclaren-mcl40.glb, mercedes-w17.glb, aston-martin-amr26.glb, audi-r26.glb, cadillac-mac26.glb, williams-fw48.glb, haas-vf26.glb (and their -hires versions in static/assets/cars)

- Models by Tyler_Dave (Sketchfab), each under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/):
  [2026 Redbull RB22](https://sketchfab.com/3d-models/2026-redbull-rb22-0a3d24a58e0549d591a5a48c22eec383),
  [2026 Ferrari SF-26](https://sketchfab.com/3d-models/2026-ferrari-sf-26-e5ca6cecdc42449283f4bed27360f2a7),
  [2026 McLaren MCL40](https://sketchfab.com/3d-models/2026-mclaren-mcl40-96214ad5624f42a0861f77008f8d29e7),
  [2026 Mercedes W17](https://sketchfab.com/3d-models/2026-mercedes-w17-b806f1e70aa343219e7158169549b97b),
  [2026 Aston Martin AMR26](https://sketchfab.com/3d-models/2026-aston-martin-amr26-a50d1c7bc086455c9412470d93fc3fc7),
  [2026 Audi R26](https://sketchfab.com/3d-models/2026-audi-r26-32bf228264b047669b100b0f1b8769ac),
  [2026 Cadillac MAC-26](https://sketchfab.com/3d-models/2026-cadillac-mac-26-95bcd37aa7c649779efc33b90b6c023e),
  [2026 Williams FW48](https://sketchfab.com/3d-models/2026-williams-fw48-4efa51e6d64a4192a83418f1b715c671),
  [2026 Haas VF-26](https://sketchfab.com/3d-models/2026-haas-vf-26-1f41e03886724bc6acd16c92402989bc)
- Source: the adapted GLBs in [Rayman0106/f1-economics-3d-deck](https://github.com/Rayman0106/f1-economics-3d-deck)
  (`assets/cars/2026/`; transforms baked, nose -x, wheels split per corner). The `-hires` files (original PNG textures,
  up to 4096 px) ship in the exe and are fetched as they are by Download assets (`src/assets.py`); the copies here are the 1024 px files
  re-encoded with gltf-transform (dedup, WebP quality 90, meshopt), used until those are downloaded.
- Changes: `rb22.js` keeps each file's own livery, decals and trim (team names, logos and sponsor marks are their owners'
  trademarks), paints the car's race number onto the nose, hides the file's number meshes, and gives carbon, chrome and
  tyres their own roughness. Their mirrors stay modelled (no live glass).

## pirelli_tread.png, pirelli_tread_normal.jpg

- From the model "Ferrari F1-75" (https://sketchfab.com/3d-models/ferrari-f1-75-06454e0f23a44fcdabcc7808aee6caf9) by
  Sketcher (https://sketchfab.com/sketcher987654321), as shipped in [rqphy/LightExperience](https://github.com/rqphy/LightExperience)
  (`static/models/F1/gltf/textures/Wheels_TREAD_*`)
- Licence: [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/): **non-commercial use only**. Pirelli and P Zero
  are Pirelli's trademarks.
- Changes: the normal map re-encoded as JPEG (quality 90, was a 10.7 MB PNG). `cars3d.js` `wheelMat` maps both onto the
  procedural cars' tyres from 2011 (desktop tier) and recolours the yellow print to each car's compound.
