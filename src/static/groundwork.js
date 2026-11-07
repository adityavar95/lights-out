// The satellite ground's heavy part on a worker thread (scene3d.js setGround), ~0.5 s per circuit that used to freeze the
// page: fit the outline to the circuit's real shape, fetch, decode and stitch the imagery, and find the vegetation in it.
// In: {url (/api/geo), pts (map coords), map {k, cx, cy}, box [x0, x1, z0, z1] and L (scene units), maxPx}.
// Out: null (no real outline), {rms} (fit too poor), {error}, or {rms, image (ImageBitmap), m (affine scene x, z -> uv,
// [a, b, u0, d, e, v0]), mask {w, h, data (1 = vegetation)}, mean [r, g, b] (0-1)}.
import {fitGeo, mercator, satellite} from './satellite.js';

onmessage = async ({data: {url, pts, map, box: [x0, x1, z0, z1], L, maxPx}}) => {
  try {
    const r = await fetch(url);
    if (!r.ok) return postMessage(null);
    const geo = await r.json(), fit = fitGeo(pts, geo.x.map((x, i) => [x, geo.y[i]]));
    if (fit.rms > 15) return postMessage({rms: fit.rms});
    const kx = 111320 * Math.cos(geo.lat * Math.PI / 180);  // local metres -> degrees, as the server's GeoJSON projection
    const lonLat = (X, Z) => { const [e, n] = fit.map([X / map.k + map.cx, Z / map.k + map.cy]); return [geo.lng + e / kx, geo.lat + n / 110570]; };
    const img = await satellite([[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(p => lonLat(...p)), maxPx, progress => postMessage({progress}));
    const uv = (X, Z) => { const [px, py] = mercator(lonLat(X, Z), img.z); return [(px - img.x0) / img.canvas.width, (py - img.y0) / img.canvas.height]; };
    const o = uv(0, 0), ux = uv(L, 0), uz = uv(0, L);
    // vegetation: green beats red and blue, on a 512 px copy (reading the full image would be ~50 MB)
    const w = 512, h = Math.round(512 * img.canvas.height / img.canvas.width), small = new OffscreenCanvas(w, h).getContext('2d', {willReadFrequently: true});
    small.drawImage(img.canvas, 0, 0, w, h);
    const px = small.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h), mean = [0, 0, 0];
    for (let i = 0; i < w * h; i++) {
      mask[i] = px[4 * i + 1] > px[4 * i] * 1.05 && px[4 * i + 1] > px[4 * i + 2] ? 1 : 0;
      for (let k = 0; k < 3; k++) mean[k] += px[4 * i + k] / (w * h) / 255;
    }
    const image = img.canvas.transferToImageBitmap();
    postMessage({rms: fit.rms, image, m: [(ux[0] - o[0]) / L, (uz[0] - o[0]) / L, o[0], (ux[1] - o[1]) / L, (uz[1] - o[1]) / L, o[1]],
                 mask: {w, h, data: mask}, mean}, [image, mask.buffer]);
  } catch (e) {
    postMessage({error: String(e)});
  }
};
