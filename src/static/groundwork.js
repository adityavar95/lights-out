// The satellite ground's heavy part on a worker thread (scene3d.js setGround), ~0.5 s per circuit that used to freeze the
// page: fit the outline to the circuit's real shape, fetch, decode and stitch the imagery, and find the vegetation in it.
// In: {url (/api/geo), pts (map coords), map {k, cx, cy}, box [x0, x1, z0, z1] and L (scene units), maxPx, dem (bool)}.
// Out: null (no real outline), {rms} (fit too poor), {error}, or {rms, image (ImageBitmap), m (affine scene x, z -> uv,
// [a, b, u0, d, e, v0]), mask {w, h, data (1 = vegetation)}, mean [r, g, b] (0-1), dem}: with dem asked for and its tiles
// in, the ground's heights over +-6 L (the terrain's whole square), {m (as above), w, h, data (metres, NaN: no tile)}.
import {fetchDem, fitGeo, mercator, resample, satellite, snapToRoad} from './satellite.js';

onmessage = async ({data: {url, pts, map, box: [x0, x1, z0, z1], L, maxPx, dem}}) => {
  try {
    const r = await fetch(url);
    if (!r.ok) return postMessage(null);
    const geo = await r.json(), fit = fitGeo(pts, geo.x.map((x, i) => [x, geo.y[i]]));
    if (fit.rms > 15) return postMessage({rms: fit.rms});
    const kx = 111320 * Math.cos(geo.lat * Math.PI / 180);  // local metres -> degrees, as the server's GeoJSON projection
    let snap = p => p;  // the fit's correction onto the photographed road, once the imagery is in
    const lonLat = (X, Z) => { const [e, n] = snap(fit.map([X / map.k + map.cx, Z / map.k + map.cy])); return [geo.lng + e / kx, geo.lat + n / 110570]; };
    // heights at up to ~20-40 m a pixel, matching the terrain grid's cells; offline it stays the made-up hills
    const E = 6 * L, demP = dem ? satellite([[-E, -E], [E, -E], [-E, E], [E, E]].map(p => lonLat(...p)), 2048, undefined,
                                            {get: fetchDem, top: 15, raw: true}).catch(() => null) : null;
    const img = await satellite([[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(p => lonLat(...p)), maxPx, progress => postMessage({progress}));
    {  // road pixels read on a copy of at most 2048 px (~1-3 m a pixel): the full image's pixels would be up to 256 MB
      const s = Math.min(1, 2048 / Math.max(img.canvas.width, img.canvas.height)), W = Math.round(img.canvas.width * s), H = Math.round(img.canvas.height * s);
      const g = new OffscreenCanvas(W, H).getContext('2d', {willReadFrequently: true});
      g.drawImage(img.canvas, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;
      const road = (e, n) => {  // asphalt: grey (channels within 28) and neither shadow-black nor kerb- or roof-bright
        const [X, Y] = mercator([geo.lng + e / kx, geo.lat + n / 110570], img.z), u = Math.floor((X - img.x0) * s), v = Math.floor((Y - img.y0) * s);
        if (u < 0 || v < 0 || u >= W || v >= H) return 0;
        const i = 4 * (v * W + u), hi = Math.max(px[i], px[i + 1], px[i + 2]);
        return hi - Math.min(px[i], px[i + 1], px[i + 2]) < 28 && hi > 35 && hi < 150 ? 1 : 0;
      };
      snap = snapToRoad(resample(pts.map(fit.map), 2048), road) ?? snap;
    }
    // the affine scene (x, z) -> uv of a stitched tile set, [a, b, u0, d, e, v0]
    const affine = im => {
      const uv = (X, Z) => { const [px, py] = mercator(lonLat(X, Z), im.z); return [(px - im.x0) / im.canvas.width, (py - im.y0) / im.canvas.height]; };
      const o = uv(0, 0), ux = uv(L, 0), uz = uv(0, L);
      return [(ux[0] - o[0]) / L, (uz[0] - o[0]) / L, o[0], (ux[1] - o[1]) / L, (uz[1] - o[1]) / L, o[1]];
    };
    // vegetation: green beats red and blue, on a 512 px copy (reading the full image would be ~50 MB)
    const w = 512, h = Math.round(512 * img.canvas.height / img.canvas.width), small = new OffscreenCanvas(w, h).getContext('2d', {willReadFrequently: true});
    small.drawImage(img.canvas, 0, 0, w, h);
    const px = small.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h), mean = [0, 0, 0];
    for (let i = 0; i < w * h; i++) {
      mask[i] = px[4 * i + 1] > px[4 * i] * 1.05 && px[4 * i + 1] > px[4 * i + 2] ? 1 : 0;
      for (let k = 0; k < 3; k++) mean[k] += px[4 * i + k] / (w * h) / 255;
    }
    const d = await demP, heights = d && (() => {
      const {width: W, height: H} = d.canvas, p = d.canvas.getContext('2d').getImageData(0, 0, W, H).data, data = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) data[i] = p[4 * i + 3] ? p[4 * i] * 256 + p[4 * i + 1] + p[4 * i + 2] / 256 - 32768 : NaN;
      return {m: affine(d), w: W, h: H, data};
    })();
    const m = affine(img), image = img.canvas.transferToImageBitmap();
    postMessage({rms: fit.rms, image, m, mask: {w, h, data: mask}, mean, dem: heights},
                [image, mask.buffer, ...(heights ? [heights.data.buffer] : [])]);
  } catch (e) {
    postMessage({error: String(e)});
  }
};
