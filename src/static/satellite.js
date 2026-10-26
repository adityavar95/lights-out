// Satellite ground: the replay's outline (F1 timing coordinates, no geographic reference) is georeferenced by fitting it
// to the circuit's real shape (GeoJSON, local metres), and Esri World Imagery tiles for the area round it are stitched on
// a canvas. No three.js or DOM here, so groundwork.js's worker runs it: fitGeo is pure (tests/test_circuits.mjs).
const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';

// closed polyline -> n points evenly spaced along it
function resample(pts, n) {
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i - 1], q = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const out = [];
  for (let k = 0, j = 0; k < n; k++) {
    const t = k / n * cum.at(-1);
    while (cum[j + 1] < t) j++;
    const p = pts[j], q = pts[(j + 1) % pts.length], f = (t - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
  }
  return out;
}

// Least-squares similarity w = a z + b between paired points, as complex numbers (a = scale x rotation): 2D Procrustes.
function procrustes(z, w) {
  const n = z.length, zm = [0, 0], wm = [0, 0];
  for (let i = 0; i < n; i++) { zm[0] += z[i][0] / n; zm[1] += z[i][1] / n; wm[0] += w[i][0] / n; wm[1] += w[i][1] / n; }
  let re = 0, im = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const zx = z[i][0] - zm[0], zy = z[i][1] - zm[1], wx = w[i][0] - wm[0], wy = w[i][1] - wm[1];
    re += zx * wx + zy * wy; im += zx * wy - zy * wx; zz += zx * zx + zy * zy;
  }
  const a = [re / zz, im / zz], b = [wm[0] - a[0] * zm[0] + a[1] * zm[1], wm[1] - a[0] * zm[1] - a[1] * zm[0]];
  return p => [a[0] * p[0] - a[1] * p[1] + b[0], a[0] * p[1] + a[1] * p[0] + b[1]];
}

const err = (f, z, w) => z.reduce((s, p, i) => { const q = f(p); return s + (q[0] - w[i][0]) ** 2 + (q[1] - w[i][1]) ** 2; }, 0);

// Map points (x right, y down) -> local metres (x east, y north) of `geo`, the same circuit's outline. The outlines start
// in different places and may run opposite ways or be mirror images, so every start offset, direction and mirror of
// two evenly resampled copies is tried, then the best one is refined by ICP (each point paired with the nearest point of
// the real outline). Returns {map, rms} (rms: metres between the fitted outline and the real one).
export function fitGeo(pts, geo) {
  const N = 128, z = resample(pts, N), g = resample(geo, N);
  let best = null;
  for (const mirror of [1, -1]) {
    const zm = z.map(([x, y]) => [x, mirror * y]);
    for (const w of [g, [...g].reverse()])
      for (let k = 0; k < N; k++) {
        const ws = zm.map((_, i) => w[(i + k) % N]), f = procrustes(zm, ws), e = err(f, zm, ws);
        if (!best || e < best.e) best = {e, mirror, f};
      }
  }
  const dense = resample(geo, 2048), zz = resample(pts, 256).map(([x, y]) => [x, best.mirror * y]);
  let f = best.f, pairs;
  for (let it = 0; it < 10; it++) {
    pairs = zz.map(p => {
      const q = f(p);
      let m = dense[0], d = Infinity;
      for (const c of dense) { const e = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2; if (e < d) { d = e; m = c; } }
      return m;
    });
    f = procrustes(zz, pairs);
  }
  return {map: ([x, y]) => f([x, best.mirror * y]), rms: Math.sqrt(err(f, zz, pairs) / zz.length)};
}

// Web Mercator pixel of [lon, lat] at zoom z (256 px tiles)
export const mercator = ([lon, lat], z) => {
  const s = 256 * 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * s, (1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * s];
};

// Imagery covering [lon, lat] points at the sharpest zoom (up to 18, ~0.6 m per pixel) that fits in maxPx square.
// Resolves {canvas (an OffscreenCanvas), z, x0, y0} (x0, y0: the canvas's top-left Mercator pixel); tiles that fail to
// load stay black. Called in groundwork.js's worker, which also fetches and decodes the tiles off the main thread.
export async function satellite(corners, maxPx) {
  let z = 18, a, b;
  for (; z > 10; z--) {
    const px = corners.map(c => mercator(c, z));
    a = [Math.min(...px.map(p => p[0])), Math.min(...px.map(p => p[1]))].map(v => Math.floor(v / 256));
    b = [Math.max(...px.map(p => p[0])), Math.max(...px.map(p => p[1]))].map(v => Math.floor(v / 256));
    if ((b[0] - a[0] + 1) * 256 <= maxPx && (b[1] - a[1] + 1) * 256 <= maxPx) break;
  }
  // willReadFrequently: a CPU canvas. A GPU one's ImageBitmap belongs to the worker's GPU context and went invalid when the
  // worker ended (black ground, 'invalid mailbox name' GL errors)
  const canvas = new OffscreenCanvas((b[0] - a[0] + 1) * 256, (b[1] - a[1] + 1) * 256), g = canvas.getContext('2d', {willReadFrequently: true});
  const jobs = [];
  for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) {
    jobs.push(fetch(`${TILES}/${z}/${y}/${x}`).then(r => (r.ok ? r.blob() : null)).then(blob => blob && createImageBitmap(blob))
      .then(img => img && g.drawImage(img, (x - a[0]) * 256, (y - a[1]) * 256), () => {}));
  }
  await Promise.all(jobs);
  return {canvas, z, x0: a[0] * 256, y0: a[1] * 256};
}
