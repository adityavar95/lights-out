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
