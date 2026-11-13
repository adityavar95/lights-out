// Scenery textures: asphalt and gravel are Poly Haven CC0 photo sets (colour, normal, roughness) fetched by the browser,
// drawn on canvases until they load (or if they can't); grass, kerbs, walls, fence, start line and shadow blob are canvases.
import * as THREE from 'three';
import {normalTex} from './cars3d.js';

const PH = '/static/assets/textures';  // Poly Haven's, once downloaded (assets.py); until then its 1k sets stream (9 MB, not 133)
const CDN = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k';

let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;  // seeded so textures don't change between loads

// k: draws the same picture on k times the pixels (sharper edges and lettering up close)
function canvasTex(w, h, draw, repeat = true, k = 1) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = w * k;
  c.height = h * k;
  g.scale(k, k);
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;  // three clamps it to what the GPU supports
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
// res: '1k', '2k' or '4k' (on the high tier every set is 4k: the road, seen from a chase camera a few metres up, gets 0.5 mm texels).
function photo(name, metres, tile, fallback, res = '1k') {
  const plain = fill => { const t = canvasTex(4, 4, g => { g.fillStyle = fill; g.fillRect(0, 0, 4, 4); }); t.colorSpace = THREE.NoColorSpace; return t; };
  const set = {map: fallback, normalMap: plain('#8080ff'), roughnessMap: plain('#ffffff')};
  for (const [k, file] of [['map', 'diff'], ['normalMap', 'nor_gl'], ['roughnessMap', 'rough']]) {
    set[k].anisotropy = 16;  // the road is mostly seen at grazing angles; three clamps this to what the GPU supports
    // decoded off the main thread (an <img> decoded inside the texture upload: ~80 ms per 4k photo, at the first frame).
    // An ImageBitmap ignores the texture's flipY, so it comes flipped as the upload would have flipped the <img>.
    const loader = new THREE.ImageBitmapLoader().setCrossOrigin('anonymous').setOptions({imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none'});
    const landed = img => {
        const t = set[k];
        t.dispose();
        t.image = img;
        if (tile) t.repeat.setScalar(tile / metres);  // tile 0: the user sets the repeat (the terrain, per circuit)
        t.flipY = false;  // WebGPU would honour it and undo the flip the loader already made
        t.needsUpdate = true;
        t.onUpdate = () => img.close();  // decoded photos (up to 64 MB each at 4k) aren't needed once on the GPU
    };
    loader.load(`${PH}/${res}/${name}/${name}_${file}_${res}.jpg`, landed, undefined,
      () => loader.load(`${CDN}/${name}/${name}_${file}_1k.jpg`, landed, undefined, () => {}));
  }
  return set;
}

// Tree foliage atlas, 4096 x 2048: a broadleaf leaf cluster (left half) and a conifer branch spray (right half, the trunk
// end at its left edge), drawn leaf by leaf in near-neutral greens that the per-tree instance colour tints. Alpha is cut
// out at 0.5 by the material. Built as RGBA data, not a canvas texture: a canvas stores premultiplied colour, so the
// transparent pixels would be black and the mip levels would draw dark fringes round every leaf; here they carry the
// foliage's mean colour instead.
// kind 'lush' is that atlas (conifers and broadleaf trees); 'palm' (right half: one frond, trunk end at its left edge) and
// 'arid' (left half: a sparse olive-grey crown) draw their own, in the same 2:1 layout.
function foliage(kind = 'lush', S = 2048) {
  const c = document.createElement('canvas');
  c.width = 2 * S;
  c.height = S;
  const g = c.getContext('2d', {willReadFrequently: true}), u = S / 1024;
  const shade = (k, warm) => `rgb(${Math.round(255 * k * (0.8 + 0.12 * warm))},${Math.round(255 * k)},${Math.round(255 * k * (0.62 - 0.1 * warm))})`;
  (kind === 'lush' ? lush : dry)(g, S, u, shade, kind);
  return foliageTex(g, S);
}

function dry(g, S, u, shade, kind) {
  g.lineCap = 'round';
  if (kind === 'palm') {  // a frond: spine along the middle, leaflets slanting to the tip on both sides, no body under it
    const mid = S / 2, ox = S;
    g.strokeStyle = '#5a4c30';
    g.lineWidth = 7 * u;
    g.beginPath(); g.moveTo(ox, mid); g.lineTo(ox + S * 0.97, mid); g.stroke();
    for (let x = 20 * u; x < S * 0.96; x += 7 * u) {
      const len = 0.46 * S * Math.sin(Math.PI * Math.min(1, x / S * 1.04)) ** 0.55 * (0.85 + 0.15 * rand());
      for (const s of [-1, 1]) {
        g.strokeStyle = shade(0.5 + 0.45 * rand() * (x / S + 0.4), rand() * 0.4);
        g.lineWidth = (5 + 3 * rand()) * u;
        g.beginPath(); g.moveTo(ox + x, mid); g.lineTo(ox + x + len * 0.55, mid + s * len * (0.9 + 0.1 * rand())); g.stroke();
      }
    }
    return;
  }
  // arid acacia / shrub: a flat-topped crown of small olive-grey leaf clumps with gaps, on a few grey-brown stems
  const cx = S / 2, cy = S / 2, R = 440 * u, grey = (k, a) => `rgb(${Math.round(255 * k * (0.78 + 0.1 * a))},${Math.round(255 * k * (0.78 + 0.08 * a))},${Math.round(255 * k * (0.5 + 0.1 * a))})`;
  g.strokeStyle = '#5c5240';
  for (let i = 0; i < 14; i++) {
    const a = rand() * 2 * Math.PI;
    g.lineWidth = (3 + 4 * rand()) * u;
    g.beginPath(); g.moveTo(cx, cy + R * 0.2); g.lineTo(cx + Math.cos(a) * R * 0.85, cy + Math.sin(a) * R * 0.5 - R * 0.1); g.stroke();
  }
  for (let i = 0; i < 70; i++) {  // clumps: dark core with lighter leaves on top
    const a = rand() * 2 * Math.PI, r = R * 0.9 * Math.sqrt(rand()), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.5 - R * 0.1;
    g.fillStyle = grey(0.38 + 0.1 * rand(), rand());
    g.beginPath(); g.ellipse(x, y, (50 + 40 * rand()) * u, (28 + 20 * rand()) * u, 0, 0, 2 * Math.PI); g.fill();
    for (let j = 0; j < 40; j++) {
      g.fillStyle = grey(0.55 + 0.4 * rand() * (1 - (y - cy + R) / (2 * R)), rand());
      g.beginPath(); g.ellipse(x + (rand() - 0.5) * 110 * u, y + (rand() - 0.5) * 60 * u, (8 + 6 * rand()) * u, (4 + 2 * rand()) * u, rand() * Math.PI, 0, 2 * Math.PI); g.fill();
    }
  }
}

function lush(g, S, u, shade) {
  // broadleaf: dark inner clumps so the crown is solid inside, then leaves, darker in the middle and underneath
  const R = 470 * u, cx = 512 * u, cy = 512 * u;
  for (let i = 0; i < 40; i++) {
    const a = rand() * 2 * Math.PI, r = R * 0.55 * Math.sqrt(rand());
    g.fillStyle = shade(0.32 + 0.1 * rand(), rand());
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, R * (0.15 + 0.1 * rand()), R * (0.12 + 0.08 * rand()), rand() * Math.PI, 0, 2 * Math.PI);
    g.fill();
  }
  g.strokeStyle = '#4a3a2c';
  for (let i = 0; i < 26; i++) {  // twigs out of the middle
    const a = rand() * 2 * Math.PI;
    g.lineWidth = (2 + 3 * rand()) * u;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8); g.stroke();
  }
  const leaves = [];
  for (let i = 0; i < 9000; i++) {
    const a = rand() * 2 * Math.PI, edge = R * (0.82 + 0.1 * Math.sin(5 * a + 1) + 0.08 * Math.sin(11 * a)), r = edge * Math.sqrt(rand());
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, up = 1 - (y - cy + R) / (2 * R);
    leaves.push([x, y, a, 0.45 + 0.35 * (r / edge) * (0.6 + 0.4 * up) + 0.2 * rand()]);
  }
  leaves.sort((p, q) => p[3] - q[3]);  // lit leaves on top
  for (const [x, y, a, k] of leaves) {
    g.fillStyle = shade(Math.min(1, k), rand());
    g.beginPath();
    g.ellipse(x, y, (11 + 9 * rand()) * u, (5 + 3 * rand()) * u, a + (rand() - 0.5) * 1.6, 0, 2 * Math.PI);
    g.fill();
  }
  // conifer spray: a branch from the trunk (left edge) to the tip, side twigs, needles along both
  const ox = S, mid = S / 2, env = x => 0.4 * S * Math.sin(Math.PI * Math.min(1, x / S * 1.05)) ** 0.7;
  const needles = (x0, y0, x1, y1, len, n, k) => {
    for (let i = 0; i < n; i++) {
      const t = rand(), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, d = Math.atan2(y1 - y0, x1 - x0);
      for (const s of [-1, 1]) {
        const b = d + s * (0.9 + 0.4 * rand());
        g.strokeStyle = shade(k * (0.75 + 0.35 * rand()), 0.2 * rand());
        g.beginPath(); g.moveTo(ox + x, y); g.lineTo(ox + x + Math.cos(b) * len, y + Math.sin(b) * len); g.stroke();
      }
    }
  };
  g.lineCap = 'round';
  // a solid dark body under the needles: without it a spray's coverage averaged under the alpha cut-off a few mips down and
  // the whole conifer dissolved to dust at a distance
  g.fillStyle = shade(0.3, 0.1);
  g.beginPath();
  for (let x = 0; x <= S * 0.93; x += 8 * u) g.lineTo(ox + x, mid - env(x) * 0.62);
  for (let x = S * 0.93; x >= 0; x -= 8 * u) g.lineTo(ox + x, mid + env(x) * 0.62);
  g.fill();
  g.lineWidth = 3 * u;
  for (let x = 30 * u; x < S * 0.92; x += (34 + 20 * rand()) * u) {
    for (const s of [-1, 1]) {
      const h = env(x) * (0.7 + 0.3 * rand()), tx = x + h * 0.6, ty = mid + s * h;
      g.strokeStyle = '#4a3c2e';
      g.lineWidth = 3 * u;
      g.beginPath(); g.moveTo(ox + x, mid); g.lineTo(ox + tx, ty); g.stroke();
      g.lineWidth = 3.4 * u;
      needles(x, mid, tx, ty, (14 + 8 * rand()) * u, Math.ceil(h / (3 * u)), 0.42 + 0.4 * (x / S));
    }
  }
  g.lineWidth = 5 * u;
  g.strokeStyle = '#4a3c2e';
  g.beginPath(); g.moveTo(ox, mid); g.lineTo(ox + S * 0.95, mid); g.stroke();
  g.lineWidth = 2.2 * u;
  needles(0, mid, S * 0.95, mid, 18 * u, 900, 0.6);
}

function foliageTex(g, S) {
  const img = g.getImageData(0, 0, 2 * S, S).data, sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < img.length; i += 4 * 61) if (img[i + 3] > 200) { sum[0] += img[i]; sum[1] += img[i + 1]; sum[2] += img[i + 2]; n++; }
  for (let i = 0; i < img.length; i += 4) if (img[i + 3] === 0) for (let k = 0; k < 3; k++) img[i + k] = sum[k] / n;
  const t = new THREE.DataTexture(new Uint8Array(img.buffer), 2 * S, S);
  Object.assign(t, {colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
                    magFilter: THREE.LinearFilter, anisotropy: 16, needsUpdate: true});
  t.onUpdate = () => { t.image.data = null; };  // uploaded once: the 32 MB of pixels can go
  return t;
}

export function textures(high) {
  return {
    asphalt: photo('asphalt_pit_lane', 2, 4, speckle('#2e2f34', 26000, 0.12), high ? '4k' : '2k'),  // fresh, uncracked: cracks would repeat every tile
    gravel: photo('gravel_floor', 2.25, 6, speckle('#b8a580', 30000, 0.3), high ? '4k' : '1k'),
    // kerb: red/white blocks a metre long (strip UVs repeat every 2 m) with ridges every 12.5 cm across them
    kerbRidges: normalTex(64, (u, v) => 0.5 * Math.sin(2 * Math.PI * 16 * v), 0.006),
    // debris fence on the barriers: 8 cm diamond mesh; stanchions and rails are real geometry (trackside.js, circuit3d.js)
    fence: canvasTex(512, 384, (g, w, h) => {
      g.strokeStyle = 'rgba(150,155,160,0.75)';
      g.lineWidth = 2;
      for (let x = -h; x < w + h; x += 10) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke();
      }
    }, true, 2),
    // relief for the terrain under its satellite / grass colour: tufts and soil in the normal and roughness maps
    ground: photo('sparse_grass', 3, 0, speckle('#5a7a3a', 2000, 0.2), high ? '4k' : '2k'),
    foliageOf: (cache => kind => cache[kind] ??= foliage(kind))({}),  // atlas per tree kind, drawn when a circuit first needs it
    grass: canvasTex(1024, 1024, (g, w, h) => {  // plain speckle: mowing stripes shimmer from a distance
      g.fillStyle = '#427f31';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 96000; i++) {
        g.fillStyle = `rgba(0,${40 + rand() * 60},0,${0.25 * rand()})`;
        g.fillRect(rand() * w, rand() * h, 2, 2);
      }
    }),
    kerb: canvasTex(8, 64, (g, w, h) => {
      g.fillStyle = '#a30d12';  // the tone curve lifts red towards salmon
      g.fillRect(0, 0, w, h / 2);
      g.fillStyle = '#e8e8e4';
      g.fillRect(0, h / 2, w, h / 2);
    }, true, 4),
    // one 8 m tile of barrier, 1.1 m tall: two boards on a concrete base, tyre scuffs low down, a joint at each block
    wall: canvasTex(2048, 282, (g, w, h) => {
      const boardH = h * 0.8;
      [['#16181d', '#f2f2f2'], ['#eeeeec', '#16181d']].forEach(([back, ink], k) => {
        const x = k * w / 2;
        g.fillStyle = back;
        g.fillRect(x, 0, w / 2, boardH);
        g.fillStyle = '#c4161c';
        g.fillRect(x, boardH - 10, w / 2, 10);
        g.fillStyle = ink;
        g.font = '800 italic 112px Geist, system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('LIGHTS OUT', x + w / 4, boardH / 2 + 2);
      });
      g.fillStyle = '#7d7f82';
      g.fillRect(0, boardH, w, h - boardH);
      for (let i = 0; i < 90; i++) {  // rubber and dirt
        g.fillStyle = `rgba(15,15,15,${0.04 + 0.1 * rand()})`;
        g.fillRect(rand() * w, h * (0.55 + 0.45 * rand()), 40 + rand() * 260, 2 + rand() * 7);
      }
      g.fillStyle = 'rgba(0,0,0,0.5)';
      for (const x of [0, w / 2]) g.fillRect(x - 2, 0, 4, h);
    }, true, 2),
    // three-rail Armco, 1.1 m tall: 8 m of rails over dark gaps, each rail bright along its bulge
    armco: canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#34363a';
      g.fillRect(0, 0, w, h);
      for (let k = 0; k < 3; k++) {
        const y = 6 + k * 42, rail = g.createLinearGradient(0, y, 0, y + 34);
        rail.addColorStop(0, '#6e7278'); rail.addColorStop(0.5, '#c8ccd2'); rail.addColorStop(1, '#5c6066');
        g.fillStyle = rail;
        g.fillRect(0, y, w, 34);
      }
      g.fillStyle = '#2a2c30';
      for (const x of [0, w / 2]) g.fillRect(x, 0, 6, h);
    }, true, 2),
    checker: canvasTex(64, 16, (g, w, h) => {
      for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        g.fillRect(x * 8, y * 8, 8, 8);
      }
    }, true, 8),
    blob: canvasTex(64, 64, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }, false),
  };
}
