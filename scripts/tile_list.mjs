// Which imagery tiles the app asks for at each circuit, so the download (assets.py) fetches exactly those; scripts/tile_list.py runs this: the same fit and box
// as scene3d.js setGround + groundwork.js, at each size it asks for, plus Stream's aerial picture.
// In (stdin): [{x, y, rotation, mpu, geo: {x, y, lat, lng}}]. Out (stdout): ["z/y/x", ...].
import {readFileSync} from 'node:fs';
import {fitGeo, tileRange} from '../src/static/satellite.js';
import {aerialTiles, ZOOM} from '../src/static/stream.js';

const PAD = 500, SIZES = [2048, 4096, 8192];  // m round the outline; scene3d.js's first pass, then its low and high tier's sharpest
const out = new Set();
for (const {x, y, rotation, mpu, geo} of JSON.parse(readFileSync(0, 'utf8'))) {
  const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const pts = x.map((v, i) => [v * c - y[i] * s, -(v * s + y[i] * c)]);  // as replay.js drawTrack
  const fit = fitGeo(pts, geo.x.map((v, i) => [v, geo.y[i]]));
  for (const {x: X, y: Y} of aerialTiles(geo.lat, geo.lng)) out.add(`${ZOOM}/${Y}/${X}`);
  if (fit.rms > 15) continue;  // groundwork.js shows no imagery for so poor a fit
  const X = pts.map(p => p[0]), Z = pts.map(p => p[1]), pad = PAD / mpu, kx = 111320 * Math.cos(geo.lat * Math.PI / 180);
  const corners = [[Math.min(...X) - pad, Math.min(...Z) - pad], [Math.max(...X) + pad, Math.min(...Z) - pad],
                   [Math.min(...X) - pad, Math.max(...Z) + pad], [Math.max(...X) + pad, Math.max(...Z) + pad]].map(p => {
    const [e, n] = fit.map(p);
    return [geo.lng + e / kx, geo.lat + n / 110570];
  });
  for (const px of SIZES) {
    const {z, a: lo, b: hi} = tileRange(corners, px);
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) out.add(`${z}/${j}/${i}`);
  }
}
console.log(JSON.stringify([...out]));
