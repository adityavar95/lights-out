// Scenery textures: asphalt and gravel are Poly Haven CC0 photo sets (colour, normal, roughness) fetched by the browser,
// drawn on canvases until they load (or if they can't); grass, kerbs, walls, fence, start line and shadow blob are canvases.
import * as THREE from 'three';
import {normalTex} from './cars3d.js';

const PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg';

let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;  // seeded so textures don't change between loads

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function speckle(base, n, alpha) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${alpha * rand()})` : `rgba(0,0,0,${alpha * rand()})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
    }
  });
}

// Material maps {map, normalMap, roughnessMap} for Poly Haven set `name`, one image `metres` across, on strips whose UVs
// repeat every `tile` metres. They exist at once (canvas colour, flat normal, roughness 1), so materials compile with
// every map, and each photo replaces its canvas when it lands; dispose() first, as the GPU texture changes size.
// res: '1k' or '2k' (the road, seen from a chase camera a few metres up, gets 1 mm texels).
function photo(name, metres, tile, fallback, res = '1k') {
  const plain = fill => { const t = canvasTex(4, 4, g => { g.fillStyle = fill; g.fillRect(0, 0, 4, 4); }); t.colorSpace = THREE.NoColorSpace; return t; };
  const set = {map: fallback, normalMap: plain('#8080ff'), roughnessMap: plain('#ffffff')};
  for (const [k, file] of [['map', 'diff'], ['normalMap', 'nor_gl'], ['roughnessMap', 'rough']]) {
    set[k].anisotropy = 16;  // the road is mostly seen at grazing angles; three clamps this to what the GPU supports
    new THREE.ImageLoader().setCrossOrigin('anonymous').load(`${PH}/${res}/${name}/${name}_${file}_${res}.jpg`, img => {
      const t = set[k];
      t.dispose();
      t.image = img;
      t.repeat.setScalar(tile / metres);
      t.needsUpdate = true;
    }, undefined, () => {});
  }
  return set;
}

export function textures() {
  return {
    asphalt: photo('asphalt_pit_lane', 2, 4, speckle('#2e2f34', 26000, 0.12), '2k'),  // fresh, uncracked: cracks would repeat every tile
    gravel: photo('gravel_floor', 2.25, 6, speckle('#b8a580', 30000, 0.3)),
    // kerb: red/white blocks a metre long (strip UVs repeat every 2 m) with ridges every 12.5 cm across them
    kerbRidges: normalTex(64, (u, v) => 0.5 * Math.sin(2 * Math.PI * 16 * v), 0.006),
    // debris fence on the barriers: 8 cm diamond mesh, a post every 4 m (one tile), top and bottom rails. Alpha cut out
    // at 0.5: the wires are 0.6, so at the first coarser mip they average under the cut-off and drop out together (fully
    // opaque wires dithered into moiré dots at mid distance), leaving posts and rails.
    fence: canvasTex(512, 384, (g, w, h) => {
      g.strokeStyle = 'rgba(163,168,173,0.6)';
      g.lineWidth = 2;
      for (let x = -h; x < w + h; x += 10) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke();
      }
      g.fillStyle = '#6d7277';
      g.fillRect(0, 0, 14, h);  // post
      g.fillRect(0, 0, w, 6);   // top rail
      g.fillRect(0, h - 6, w, 6);
    }),
    grass: canvasTex(256, 256, (g, w, h) => {  // plain speckle: mowing stripes shimmer from a distance
      g.fillStyle = '#427f31';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6000; i++) {
        g.fillStyle = `rgba(0,${40 + rand() * 60},0,${0.25 * rand()})`;
        g.fillRect(rand() * w, rand() * h, 2, 2);
      }
    }),
    kerb: canvasTex(8, 64, (g, w, h) => {
      g.fillStyle = '#c4161c';
      g.fillRect(0, 0, w, h / 2);
      g.fillStyle = '#e8e8e4';
      g.fillRect(0, h / 2, w, h / 2);
    }),
    wall: canvasTex(128, 32, (g, w, h) => {
      g.fillStyle = '#1f3f8f';
      g.fillRect(0, 0, w / 2, h);
      g.fillStyle = '#ececec';
      g.fillRect(w / 2, 0, w / 2, h);
      g.fillStyle = '#222';
      g.fillRect(0, h * 0.82, w, h * 0.18);
    }),
    checker: canvasTex(64, 16, (g, w, h) => {
      for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        g.fillRect(x * 8, y * 8, 8, 8);
      }
    }),
    blob: canvasTex(64, 64, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }, false),
  };
}
