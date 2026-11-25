// Satellite ground: the replay's outline (F1 timing coordinates, no geographic reference) is georeferenced by fitting it
// to the circuit's real shape (GeoJSON, local metres), and Esri World Imagery tiles for the area round it are stitched on
// a canvas. No three.js or DOM here, so groundwork.js's worker runs it: fitGeo is pure (tests/test_circuits.mjs).
export const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
// AWS Terrain Tiles (open data, no key, to zoom 15): heights in terrarium PNGs, metres = R * 256 + G + B / 256 - 32768
export const fetchDem = (z, y, x) => fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);

// closed polyline -> n points evenly spaced along it
export function resample(pts, n) {
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

// The small correction to the fitted outline (pts, local metres) that puts the most of it on asphalt: road(e, n) is 1 on a
// grey road-coloured pixel of the imagery, 0 off it. The GeoJSON outline the fit follows is hand-drawn, so the imagery can
// sit metres off the photographed road. Hill-climbs a shift (up to ±reach m), a turn and a scale about the outline's
// centre; returns ([e, n]) => [e, n] corrected, or null when no correction beats the plain fit by a clear margin.
export function snapToRoad(pts, road, reach = 40) {
  const n = pts.length, c = pts.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
  const R = Math.sqrt(pts.reduce((s, p) => s + (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2, 0) / n);  // ~the circuit's radius
  // x = [east, north, turn, scale - 1]; turn and scale move the outline's rim by R * x metres
  const warp = ([de, dn, t, k]) => ([e, nn]) => {
    const x = e - c[0], y = nn - c[1], s = 1 + k, cs = Math.cos(t) * s, sn = Math.sin(t) * s;
    return [c[0] + cs * x - sn * y + de, c[1] + sn * x + cs * y + dn];
  };
  const score = x => { const f = warp(x); return pts.reduce((s, p) => s + road(...f(p)), 0) / n; };
  let x = [0, 0, 0, 0], best = score(x);
  const base = best, limit = [reach, reach, reach / R, reach / R];
  for (let step = 8; step >= 0.5; step /= 2) {  // metres at the rim, coarse to fine
    for (let moved = true; moved;) {
      moved = false;
      for (let i = 0; i < 4; i++) for (const sign of [-1, 1]) {
        const y = [...x];
        y[i] += sign * (i < 2 ? step : step / R);
        if (Math.abs(y[i]) > limit[i]) continue;
        const s = score(y);
        if (s > best) { best = s; x = y; moved = true; }
      }
    }
  }
  return best > base + 0.03 ? Object.assign(warp(x), {x, base, best}) : null;
}

// Web Mercator pixel of [lon, lat] at zoom z (256 px tiles)
export const mercator = ([lon, lat], z) => {
  const s = 256 * 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * s, (1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * s];
};

// Downloaded tiles first (scripts/fetch_assets.py); Esri for any it doesn't hold, such as an older layout's edge
export const fetchTile = async (z, y, x) => {
  const local = await fetch(`/static/assets/tiles/${z}/${y}/${x}.jpg`);
  return local.ok ? local : fetch(`${TILES}/${z}/${y}/${x}`);
};

// The sharpest zoom (up to top, 18 ~0.6 m per pixel) whose tiles round [lon, lat] points fit in maxPx square, and their range
function tileRange(corners, maxPx, top = 18) {
  let z = top, a, b;
  for (; z > 10; z--) {
    const px = corners.map(c => mercator(c, z));
    a = [Math.min(...px.map(p => p[0])), Math.min(...px.map(p => p[1]))].map(v => Math.floor(v / 256));
    b = [Math.max(...px.map(p => p[0])), Math.max(...px.map(p => p[1]))].map(v => Math.floor(v / 256));
    if ((b[0] - a[0] + 1) * 256 <= maxPx && (b[1] - a[1] + 1) * 256 <= maxPx) break;
  }
  return {z, a, b};
}

// Imagery covering [lon, lat] points at tileRange's zoom.
// Resolves {canvas (an OffscreenCanvas), z, x0, y0} (x0, y0: the canvas's top-left Mercator pixel); tiles that fail to
// load stay transparent. Called in groundwork.js's worker, which also fetches and decodes the tiles off the main thread.
// get, top: another tile set (fetchDem, 15); raw: decode without colour management, for data such as heights.
export async function satellite(corners, maxPx, onProgress = () => {}, {get: fetchOne = fetchTile, top = 18, raw = false} = {}) {
  const {z, a, b} = tileRange(corners, maxPx, top);
  // willReadFrequently: a CPU canvas. A GPU one's ImageBitmap belongs to the worker's GPU context and went invalid when the
  // worker ended (black ground, 'invalid mailbox name' GL errors)
  const canvas = new OffscreenCanvas((b[0] - a[0] + 1) * 256, (b[1] - a[1] + 1) * 256), g = canvas.getContext('2d', {willReadFrequently: true});
  // Six at a time: a circuit is up to ~480 tiles, and firing them all at once made the browser queue them behind every other
  // request of the page. Retries back off, since a failing tile server won't recover in the next millisecond. Stopping
  // is the worker's terminate() (scene3d.js setGround, on a circuit switch), which cancels whatever is in flight.
  const get = async (x, y, tries = 3) => {
    for (let i = 0; ; i++) {
      try {
        const r = await fetchOne(z, y, x);
        if (r.ok || r.status < 500 || i >= tries) return r;
      } catch (e) {
        if (i >= tries) throw e;
      }
      await new Promise(done => setTimeout(done, 250 * 2 ** i));
    }
  };
  const jobs = [];
  for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) {
    jobs.push(() => get(x, y).then(r => (r.ok ? r.blob() : null)).then(blob => blob && createImageBitmap(blob, raw ? {colorSpaceConversion: 'none', premultiplyAlpha: 'none'} : {}))
      .then(img => { if (img) { g.drawImage(img, (x - a[0]) * 256, (y - a[1]) * 256); img.close(); } }, () => {}));
  }
  let next = 0, finished = 0;
  await Promise.all(Array.from({length: 6}, async () => {
    while (next < jobs.length) {
      await jobs[next++]();
      onProgress(++finished / jobs.length);
    }
  }));
  return {canvas, z, x0: a[0] * 256, y0: a[1] * 256};
}
