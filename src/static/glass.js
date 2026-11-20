// iOS 26 Liquid Glass, ported from glisse (github.com/0kzh/glisse, MIT, (c) 2026 Kelvin Zhang): a displacement map bends
// the backdrop in a band round the rim, and a painted line lights the edge. Chromium applies SVG
// filters to the live backdrop (so does WebView2); other browsers keep the frost and the rim.
// Surfaces get data-lg (lens or rim only, style.css): a lens only over something worth bending, since each frame of the
// 3D stage re-runs its filter; the big decks, and cards on the flat page, would show nothing but the cost.
const LENS = '.glass:not(.circuitdeck, .tracedeck), .topbar, .notice, .deckmenu, .sghost, .swchip, .introcard, .scard:not(.skel), .sched, .sconnect, .ghint, .gplay, .gclose';
const RIM = '.circuitdeck, .tracedeck, .card, .hero, .calendar, .modeswitch, .racebtn, .livebtn, .nextbtn, .themebtn, .tvbtn, .labbtn, .dcareer, .dcard';
// glisse's glass: how far the rim reaches for what it shows (.45), the band that bends (.25), the dome over it (.5), all
// shares of the shorter side; capped so a tall panel keeps a rim, not a quarter of its width bent
const STRENGTH = .45, DEPTH = .25, DOME = .5, MAX_SIDE = 96;
const RIM_WIDTH = 1.22, EDGE_WIDTH = .5;  // the rim's light and hairline, px: iOS 26.1 measured at 3x by glisse

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const erf = x => Math.tanh(1.7724538509 * x);  // erf(x) ~ tanh(sqrt(pi) x)

// signed distance to a rounded rectangle centred on the origin; negative inside
const sdf = (x, y, hw, hh, r) => {
  const qx = Math.abs(x) - hw + r, qy = Math.abs(y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

// the circular arc sagging by `sag` across `half`, scaled so its slope averages a half over that span
function arc(sag, half) {
  const radius = (half * half + sag * sag) / (2 * sag);
  let sum = 0;
  for (let i = 0; i <= 200; i++) { const x = i / 200 * half, s = x / Math.sqrt(radius * radius - x * x); sum += i % 200 ? s : s / 2; }
  const mean = sum / 200;
  return {radius, scale: mean > 0 ? .5 / mean : 1};
}
const slope = (x, {radius, scale}) => { const inside = Math.min(x, .999 * radius); return inside / Math.sqrt(radius * radius - inside * inside) * scale; };

// RGBA, one pixel per `step` CSS px (the filter stretches it: a smooth pull needs no more, and at 1:1 the HUD's panels froze
// the page ~2 s whenever a camera change resized them): red is the pull across (128 none, lighter pulls from the right),
// green the pull down.
export function lensMap(width, height, radius, step = 1) {
  const hw = width / 2, hh = height / 2, r = clamp(radius, 0, Math.min(hw, hh));
  const cols = Math.ceil(width / step), rows = Math.ceil(height / step), map = new Uint8ClampedArray(cols * rows * 4);
  const side = Math.min(width, height, MAX_SIDE), depth = DEPTH * side;
  const iw = Math.max(0, hw - depth), ih = Math.max(0, hh - depth), ir = clamp(r, 0, Math.min(iw, ih));
  const ramp = 1 / (depth * Math.SQRT2), sag = Math.max(.01, Math.min(DOME * side, Math.min(hw, hh) - 1));
  const ax = arc(sag, hw), ay = arc(sag, hh);
  for (let row = 0, i = 0; row < rows; row++) for (let col = 0; col < cols; col++, i += 4) {
    const x = (col + .5) * width / cols - hw, y = (row + .5) * height / rows - hh, edge = sdf(x, y, hw, hh, r);
    let gx = 128, gy = 128;
    if (edge < 0) {
      const falloff = .5 * (1 + erf(sdf(x, y, iw, ih, ir) * ramp));
      gx = Math.round((.5 - .5 * Math.sign(x) * slope(Math.abs(x), ax) * falloff) * 255);
      gy = Math.round((.5 - .5 * Math.sign(y) * slope(Math.abs(y), ay) * falloff) * 255);
    }
    map[i] = gx; map[i + 1] = gy; map[i + 2] = 128; map[i + 3] = 255;
  }
  return map;
}

// The rim as a 9-slice for border-image, so one picture fits every size with these corners (glisse draws one per size,
// but a card here can be 1800 px wide). A light from the top left lights the left and top, its reflection the right and
// bottom, fading out over the two corners between; under it the hairline. Returns the image's RGBA and the slice in px.
export function rimMap(radius, shine, dpr, edge) {
  const slice = Math.max(Math.ceil(radius), 3), size = Math.round((slice * 2 + 2) * dpr), density = size / (slice * 2 + 2), half = .5 / density, hw = slice + 1;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const x = (col + .5) / density - hw, y = (row + .5) / density - hw, depth = -sdf(x, y, hw, hw, radius);
    if (depth < -half || depth > 2 * RIM_WIDTH) continue;
    const qx = Math.abs(x) - hw + radius, qy = Math.abs(y) - hw + radius;  // the nearest edge's outward normal
    let nx = 0, ny = 0;
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy); nx = Math.sign(x) * qx / l; ny = Math.sign(y) * qy / l; }
    else if (qx > qy) nx = Math.sign(x);
    else ny = Math.sign(y);
    const facing = Math.abs(nx + ny), along = Math.max(0, depth) / (RIM_WIDTH * Math.sqrt(Math.max(1, facing)));
    const cover = clamp((depth + half) * density, 0, 1);
    const lined = clamp((Math.min(EDGE_WIDTH, depth + half) - Math.max(0, depth - half)) * density, 0, 1);
    const light = along < 1 ? shine * Math.min(1, facing) ** 1.5 * (1 - along ** 1.5) * cover : 0;
    const line = edge[3] * lined * (1 - light), alpha = light + line;
    if (alpha <= 0) continue;
    const i = (row * size + col) * 4;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round((255 * light + edge[c] * line) / alpha);
    data[i + 3] = Math.round(255 * alpha);
  }
  return {size, slice, density, data};
}

export function png(data, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  // on the CPU: reading a GPU canvas back waits behind the 3D stage's queue, 1.8 s on a camera switch
  const ctx = canvas.getContext('2d', {willReadFrequently: true}), image = ctx.createImageData(width, height);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

const SVG = 'http://www.w3.org/2000/svg';
const svg = (name, attrs, ...children) => {
  const e = document.createElementNS(SVG, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  e.append(...children);
  return e;
};

// How far each colour bends, red first: glisse's --lg-glass-dispersion, where red bends a fifth of it further than blue
export const colourScales = (scale, dispersion) => [scale * (1 + dispersion / 10), scale, scale * (1 - dispersion / 10)];
const ONLY = ['1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'];

// Measured over the replay (1500x900, RTX 4080): frost 42-45 fps; glisse's graph (grey maps, a pass per direction per
// colour, ~20 nodes) 18; one pass 41-45. So over the 3D stage (dispersion 0) one pass, and elsewhere glisse's colour split
// from its selection filter: a pass per colour on one map.
// shortcut: a coloured map, so on a wide-gamut display Chrome bends it slightly off its direction (glisse's greys avoid that);
// upgrade if a cheaper way to run its graph over the live stage turns up.
function filterOf(id, width, height, href, bend, dispersion) {
  const box = {x: 0, y: 0, width, height}, scale = bend * Math.min(width, height, MAX_SIDE);
  const pass = (scale, result) => svg('feDisplacementMap', {in: 'SourceGraphic', in2: 'field', xChannelSelector: 'R', yChannelSelector: 'G', scale, ...box, ...(result ? {result} : {})});
  const nodes = dispersion > 0 ? [...colourScales(scale, dispersion).flatMap((s, i) => [pass(s, `ray${i}`), svg('feColorMatrix', {in: `ray${i}`, type: 'matrix', values: ONLY[i], result: `c${i}`})]),
    svg('feComposite', {in: 'c0', in2: 'c1', operator: 'arithmetic', k2: 1, k3: 1, result: 'rg'}),
    svg('feComposite', {in: 'rg', in2: 'c2', operator: 'arithmetic', k2: 1, k3: 1})] : [pass(scale)];
  return svg('filter', {id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB', ...box},
    svg('feImage', {href, preserveAspectRatio: 'none', result: 'field', ...box}), ...nodes);
}

// iOS's white at the rim and hairline: fainter on a dark page, as measured by glisse
const SHINE = {light: .3, dark: .3}, HAIRLINE = {light: [0, 0, 0, .08], dark: [255, 255, 255, .08]};
const rims = new Map();
function rim(radius, scheme, shine) {
  const density = Math.min(devicePixelRatio || 1, 3), key = [radius, scheme, density, shine].join();
  if (!rims.has(key)) {
    const {size, slice, density: d, data} = rimMap(radius, shine, density, HAIRLINE[scheme]);
    rims.set(key, `url("${png(data, size, size)}") ${slice * d} / ${slice}px / 0 stretch`);
  }
  return rims.get(key);
}

const maps = new Map(), MAP_STEP = 4;
function mapOf(width, height, radius) {
  const key = [width, height, radius].join();
  if (!maps.has(key)) {
    if (maps.size >= 32) maps.clear();  // sizes pile up while a window is dragged; each is some kB of PNG
    maps.set(key, png(lensMap(width, height, radius, MAP_STEP), Math.ceil(width / MAP_STEP), Math.ceil(height / MAP_STEP)));
  }
  return maps.get(key);
}

let defs, serial = 0;
const fitted = new WeakMap();  // element -> {key, filter}
function fit(el, refracts) {
  const width = el.offsetWidth, height = el.offsetHeight, was = fitted.get(el);
  if (!width || !height) { was?.filter?.remove(); fitted.delete(el); return; }  // hidden or removed: its filter goes with it
  const style = getComputedStyle(el), corner = style.borderTopLeftRadius, scheme = style.colorScheme === 'light' ? 'light' : 'dark';
  const radius = Math.min(width / 2, height / 2, corner.endsWith('%') ? Math.min(width, height) * parseFloat(corner) / 100 : parseFloat(corner) || 0);
  // glisse's settings, set in CSS on the surface or above it
  const setting = (name, fallback) => { const v = parseFloat(style.getPropertyValue(name)); return Number.isFinite(v) ? v : fallback; };
  const bend = setting('--lg-glass-bend', STRENGTH), dispersion = setting('--lg-glass-dispersion', 0), shine = setting('--lg-rim-shine', SHINE[scheme]);
  const key = [width, height, radius, scheme, bend, dispersion, shine].join();
  if (was?.key === key) return;
  el.style.setProperty('--lg-rim', rim(radius, scheme, shine));
  let filter = null;
  if (refracts && el.dataset.lg === 'lens') {
    filter = filterOf(`lg-${++serial}`, width, height, mapOf(width, height, radius), bend, dispersion);
    defs.append(filter);
    el.style.setProperty('--lg-filter', `url("#${filter.id}") saturate(1.5)`);
  }
  was?.filter?.remove();
  fitted.set(el, {key, filter});
}

export function setupGlass() {
  const refracts = /Chrom(?:e|ium)\//.test(navigator.userAgent);
  const host = svg('svg', {width: 0, height: 0, 'aria-hidden': 'true'});
  host.style.cssText = 'position:absolute;pointer-events:none';
  defs = svg('defs', {},
    // the rippled, soft refraction of a liquid-glass button: noise bending the backdrop, then a blur
    svg('filter', {id: 'lg-liquid', x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB'},
      svg('feTurbulence', {type: 'fractalNoise', baseFrequency: '0.05 0.05', numOctaves: 1, seed: 1, result: 'noise'}),
      svg('feGaussianBlur', {in: 'noise', stdDeviation: 2, result: 'soft'}),
      svg('feDisplacementMap', {in: 'SourceGraphic', in2: 'soft', scale: 70, xChannelSelector: 'R', yChannelSelector: 'B', result: 'bent'}),
      svg('feGaussianBlur', {in: 'bent', stdDeviation: 4})));
  host.append(defs);
  document.body.append(host);
  let moving = 0;
  addEventListener('scroll', () => {
    document.documentElement.classList.add('lg-moving');
    clearTimeout(moving);
    moving = setTimeout(() => document.documentElement.classList.remove('lg-moving'), 150);
  }, {capture: true, passive: true});

  const pending = new Set();
  let idle = 0;
  const later = fn => (window.requestIdleCallback || (f => setTimeout(f, 50)))(fn, {timeout: 500});
  const schedule = el => {
    pending.add(el);
    idle ||= later(() => { idle = 0; const els = [...pending]; pending.clear(); els.forEach(e => fit(e, refracts)); });
  };
  const resized = new ResizeObserver(entries => entries.forEach(e => schedule(e.target)));
  // a lens costs frames even off screen (Stream's ~100 cards: 3 fps, the 16 in view alone: 240)
  const seen = new IntersectionObserver(entries => entries.forEach(e => e.target.toggleAttribute('data-lg-far', !e.isIntersecting)), {rootMargin: '300px'});
  const scan = () => {
    for (const el of document.querySelectorAll(`${LENS}, ${RIM}`)) {
      if (el.dataset.lg) continue;
      el.dataset.lg = el.matches(LENS) ? 'lens' : 'rim';
      resized.observe(el);
      if (el.dataset.lg === 'lens') seen.observe(el);
    }
  };
  scan();
  // text updates (the HUD's, every frame) add no elements, so they don't cost a scan
  let scanning = 0;
  new MutationObserver(records => {
    if (scanning || !records.some(r => [...r.addedNodes].some(n => n.nodeType === 1))) return;
    scanning = later(() => { scanning = 0; scan(); });
  }).observe(document.body, {childList: true, subtree: true});
  // the rim follows the theme, which no resize reports
  const retheme = () => document.querySelectorAll('[data-lg]').forEach(schedule);
  new MutationObserver(retheme).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
}
