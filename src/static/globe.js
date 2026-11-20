// The launch view: the Earth as a sphere of Esri imagery with a pin on each circuit of the header's season (setPins).
// Drag spins it; a pin, or a race chosen in the header (app.js selectRace), flies down to that circuit, where sharper
// imagery lands in ever smaller patches round it. Over a circuit and close enough to see it, by that flight or by the
// wheel, Play appears: it opens the race, and the view fades into the 3D circuit once that has loaded. Looking around, a
// patch of imagery as sharp as the window can show follows the view (refine), down to where a flight ends. Drawn by the race's
// renderer on its own CanvasTarget from scene3d.js's master loop, as showroom.js is. Everything is built on open and
// disposed on close: the Earth's texture is ~85 MB on the GPU.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {min, normalView, positionView, smoothstep, uniform, uv} from 'three/tsl';
import {el} from './util.js';
import {ready, setDeck, shared, warmStage} from './scene3d.js';
import {TILES, fetchTile} from './satellite.js';
import {llToVec, vecToLL, tileLL, tilesRound, flight, over, namesFit} from './globemath.js';

const BASE = 5;                 // the whole Earth: 32 x 32 tiles, 8192 px across (the user's choice, ~340 MB on the GPU), as four 4096 px quarters:
                                // tiles show as they land, and each refresh uploads a 64 MB quarter, not the 256 MB whole
const LEVELS = [6, 9, 12, 15];  // the patches round a chosen circuit, 4 x 4 tiles each, from ~2,500 km across to ~5 km
const END = 0.0009;             // where a flight ends: ~5.7 km up, the circuit filling the window
const SHOW = 0.004;             // Play shows from here down (~25 km up), over a circuit
const FLY = 5000, FADE = 900;   // ms
const UNDER = '.hero, .tabs, main, .foot';  // what the globe covers: out of the keyboard's reach while it does

let G = null;

// a fixed sky: ~110 faint dots as CSS gradients, from a seeded sequence so every visit (and the page's poster) matches
function stars() {
  let s = 7;
  const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  return Array.from({length: 110}, () => `radial-gradient(circle at ${(rnd() * 100).toFixed(1)}% ${(rnd() * 100).toFixed(1)}%, rgb(255 255 255 / ${(0.25 + rnd() * 0.6).toFixed(2)}) 0, transparent ${(0.6 + rnd() * 0.9).toFixed(1)}px)`).join(',');
}
const unposter = () => setTimeout(() => document.querySelector('.gposter')?.remove(), 900);  // after the globe has faded in over it

// A piece of the sphere holding the n x n tiles from (x0, y0) at zoom z, with the canvas they are drawn on as its map.
// The vertices sit at the tiles' own Mercator spacing, so the picture needs no reprojection.
function sheet(z, x0, y0, n, segs, material) {
  const geo = new THREE.PlaneGeometry(1, 1, segs, segs), p = geo.attributes.position, t = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...llToVec(...tileLL(z, x0 + t.getX(i) * n, y0 + (1 - t.getY(i)) * n)));
  const canvas = Object.assign(document.createElement('canvas'), {width: n * 256, height: n * 256});
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicNodeMaterial({map, toneMapped: false, fog: false, ...material}));
  mesh.frustumCulled = false;  // the moved vertices left the plane's bounds behind
  return {mesh, canvas, map};
}

// Draws the tiles onto a sheet's canvas, eight requests at a time; each() after every tile; scale: a coarser zoom drawn
// that many times larger. Only the closest zoom is
// among the downloaded tiles (fetch_assets.py), the rest come from Esri.
// shortcut: with no internet the Earth is a plain sphere under its pins; add zoom 4 to tile_list.py if the exe needs it
async function paint(sheet, z, x0, y0, n, each, scale = 1) {
  const g = sheet.canvas.getContext('2d'), jobs = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) jobs.push([x, y]);
  await Promise.all(Array.from({length: 8}, async () => {
    while (jobs.length && !sheet.dead) {  // dead: the view has moved on (refine)
      const [x, y] = jobs.shift();
      try {
        const r = await (z >= 15 ? fetchTile(z, y0 + y, x0 + x) : fetch(`${TILES}/${z}/${y0 + y}/${x0 + x}`));
        const blob = r.ok && await r.blob();
        // shortcut: Esri answers 200 with a "Map data not yet available" picture where it has no imagery this close (open
        // sea): 1,652 bytes up to zoom 13, 2,521 from 14. Left out by size, so the coarser map under it shows; compare
        // the bytes if those ever move
        if (!blob || blob.size === 1652 || blob.size === 2521) continue;
        const img = await createImageBitmap(blob);
        g.drawImage(img, x * 256 * scale, y * 256 * scale, 256 * scale, 256 * scale);
        img.close();
        each?.();
      } catch (e) { /* a tile that doesn't load leaves what is under it */ }
    }
  }));
}

function build(g) {
  const n = 2 ** BASE / 2;
  g.earth = [[0, 0], [n, 0], [0, n], [n, n]].map(([x0, y0]) => {
    const q = sheet(BASE, x0, y0, n, 64), c = q.canvas.getContext('2d');
    c.fillStyle = '#0b1a2b';  // sea, until the tiles land
    c.fillRect(0, 0, q.canvas.width, q.canvas.height);
    q.dirty = true;
    const each = () => { q.dirty = true; };
    // zoom 3 first, 16 tiles a quarter: the whole Earth in a second, while the 1,024 sharp tiles land over it
    q.done = paint(q, BASE - 2, x0 / 4, y0 / 4, n / 4, each, 4).then(() => paint(q, BASE, x0, y0, n, each)).then(() => { q.dirty = q.whole = true; });
    return q;
  });
  // Mercator stops at 85°: a sphere just under the map closes the poles in ice
  const ice = new THREE.Mesh(new THREE.SphereGeometry(0.997, 64, 32), new THREE.MeshBasicNodeMaterial({color: 0xdfe7ee, toneMapped: false, fog: false}));
  // the air: a shell seen from inside, brightest against the limb and gone a little way out
  const air = new THREE.MeshBasicNodeMaterial({color: 0x6fb2ff, side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false, fog: false});
  air.opacityNode = smoothstep(0, 0.4, positionView.normalize().dot(normalView).abs()).pow(2).mul(0.7);  // by the ray, not view z: the limb is off-axis
  g.air = new THREE.Mesh(new THREE.SphereGeometry(1.07, 96, 48), air);
  g.scene.add(ice, ...g.earth.map(q => q.mesh), g.air);
}

// A soft-edged patch of n x n tiles at zoom z round [lat, lng], drawn over the Earth (higher `order` on top); it fades in
// once loaded. A tile that fails stays clear, so the Earth under it shows.
function patch(g, z, lat, lng, n, order) {
  const [x0, y0] = tilesRound(lat, lng, z, n), shown = uniform(0), e = uv();
  const p = sheet(z, x0, y0, n, 4 * n, {transparent: true, depthTest: false, depthWrite: false});
  p.mesh.material.opacityNode = shown.mul(smoothstep(0, 0.08, min(min(e.x, e.x.oneMinus()), min(e.y, e.y.oneMinus()))));
  p.mesh.renderOrder = order;
  Object.assign(p, {shown, z, lat, lng});
  p.done = paint(p, z, x0, y0, n).then(() => { p.map.needsUpdate = true; p.loaded = true; });
  g.scene.add(p.mesh);
  return p;
}
const drop = (g, p) => { if (!p) return; g.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.map.dispose(); p.mesh.material.dispose(); };

// sharper imagery round the circuit the flight is going to, each patch fading in over the one before as it loads
function detail(g, lat, lng) {
  g.patches.forEach(p => drop(g, p));
  g.patches = LEVELS.map((z, i) => patch(g, z, lat, lng, 4, i + 2));
}

// Looking around: a 12 x 12 tile patch (3072 px) under the camera, at the zoom that gives the window about a texel a
// pixel (the patch is then 1-2 windows across). A new one loads once the view has held a zoom and a place (to a tenth
// of a patch) for 200 ms and is a fifth of a patch away from the one shown, or at another zoom; a load the view has
// left is stopped, so zooming through ten levels fetches the last, not all ten. The patch before stays until the
// new one has faded in.
function refine(g, alt) {
  const c = view(g), cos = Math.cos(c.lat * Math.PI / 180);  // Mercator's tiles shrink towards the poles
  const z = Math.max(BASE + 1, Math.min(15, Math.round(Math.log2(69 * cos / alt)))), span = 12 * 360 / 2 ** z * cos;
  const far = at => !at || at.z !== z || Math.hypot(c.lat - at.lat, (c.lng - at.lng) * cos) > 0.2 * span;
  const key = `${z}:${Math.round(c.lat / span * 10)}:${Math.round(c.lng * cos / span * 10)}`;
  if (g.want !== key) { g.want = key; g.since = performance.now(); }
  if (g.next && far(g.next)) { g.next.dead = true; drop(g, g.next); g.next = null; }
  if (!g.next && far(g.look) && performance.now() - g.since > 200) {
    const p = g.next = patch(g, z, c.lat, c.lng, 12, 1);
    p.done.then(() => { if (G !== g || g.next !== p) return; drop(g, g.old); g.old = g.look; g.look = p; g.next = null; });
  }
  if (g.old && g.look.shown.value === 1) { drop(g, g.old); g.old = null; }
}

// Once the Earth is whole, the tiles a flight to each pin will ask for go into the browser's cache (Esri lets it keep
// them a day), four at a time, so the ground is sharp as a flight comes down. Zoom 15 is on disk (fetch_assets.py).
async function warm(g) {
  const {pins} = g;
  await Promise.all(g.earth.map(q => q.done));
  for (const {c} of pins) for (const z of LEVELS) if (z < 15) {
    const [x0, y0] = tilesRound(c.lat, c.lng, z, 4);
    for (let y = 0; y < 4 && G === g && g.pins === pins; y++)
      await Promise.all([0, 1, 2, 3].map(x => fetch(`${TILES}/${z}/${y0 + y}/${x0 + x}`).then(r => r.blob()).catch(() => {})));
  }
}

const view = g => { const [lat, lng] = vecToLL(g.camera.position.toArray()); return {lat, lng, alt: g.camera.position.length() - 1}; };
// the whole Earth in the window, whatever its shape
const home = g => 3.45 / Math.min(1, g.camera.aspect) - 1;

function place(g, {lat, lng, alt}) {
  g.camera.position.set(...llToVec(lat, lng)).multiplyScalar(1 + alt);
  g.camera.up.set(0, 1, 0);
  g.camera.lookAt(0, 0, 0);
}

// Play's card: the circuit c the view is over (null: none), with the button that opens its race
function card(g, c) {
  g.over = c;
  g.card.classList.toggle('on', !!c);
  g.hint.hidden = !!c;
  if (!c) return;
  const [round, ...facts] = c.facts ?? [];  // the round and date lead; length and lap record follow
  g.card.firstChild.replaceChildren(el('small', {class: 'geyebrow'}, round ?? ''), el('b', {}, c.name), el('small', {}, c.place), ...facts.map(f => el('small', {class: 'gfact'}, f)));
  g.play.textContent = c.label;
  g.after = null;
  // the dossier's other ways in (app.js pin): enter flies down and opens the race first; the rest close the globe and go
  g.acts.replaceChildren(...(c.actions ?? []).map(a => el('button', {onclick: () => { g.after = a.run; a.enter ? enter(g) : closeGlobe(); }}, a.label)));
}

// Play: the race opens under the globe (pick gives the promise of its stage), the view settles over the circuit, and
// once both are done the globe fades
function enter(g) {
  const c = g.over, fly = g.fly = {from: view(g), to: {lat: c.lat, lng: c.lng, alt: END}, t0: performance.now(), ms: view(g).alt > 0.3 ? 3000 : 1200, enter: true, ready: false};
  g.controls.enabled = false;
  Object.assign(g.play, {disabled: true, textContent: 'Loading…'});
  for (const b of g.acts.children) b.disabled = true;
  const go = () => {
    if (G !== g || g.fly !== fly) return;
    fly.ready = true;
    document.body.dataset.globe = 'fade';  // util.js covered(): the stage draws again from here, under the last of the globe
  };
  Promise.resolve(g.pick(c)).then(warmStage).then(go, go);  // the circuit's shaders compiled before it shows
}

// Each pin's name where it fits (globemath.js namesFit; rank: the race on screen, the next one, then the nearest the middle)
function labels(shown) {
  for (const p of shown) p.w ||= p.name.offsetWidth;  // measured once it has a size
  const kept = namesFit(shown);
  for (const p of shown) if (p.free !== kept.has(p)) p.name.classList.toggle('off', !(p.free = kept.has(p)));
}

const v = new THREE.Vector3();
function draw(dt) {
  const g = G, {camera} = g;
  if (!g.w) return;  // hidden (Stream)
  if (!g.ready) { g.ready = true; g.el.classList.add('ready'); unposter(); }  // the first frame is about to be drawn: fade in over the page's poster
  if (g.size) { g.surface.setSize(g.w, g.h, false); g.size = false; }  // here, not in the observer: showroom.js says why
  if (g.fly) {
    const {fly} = g, f = Math.min(1, (performance.now() - fly.t0) / fly.ms);
    g.controls.update();  // the spin's damped leftover dies out here, under the flight, not as a lurch once it lands
    place(g, flight(fly.from, fly.to, f));
    if (f === 1 && !fly.enter) {  // down: the view is the reader's again, with Play under their hand; back out: the Earth spins again
      g.fly = null;
      g.controls.enabled = true;
      if (fly.out) g.controls.autoRotate = true;
      else g.play.focus({preventScroll: true});
    } else if (f === 1 && fly.ready && !g.fading) {  // over the circuit, and its stage is there to be seen
      g.fading = true;
      g.el.classList.add('out');
      setTimeout(() => G === g && closeGlobe(), FADE);
    }
  } else {
    const alt = camera.position.length() - 1;
    g.controls.rotateSpeed = 0.2 * alt;  // the ground under the pointer keeps its pace at any height
    // and a notch of the wheel is a fifth of the height, not of the distance to the Earth's centre (OrbitControls: 0.95 ** zoomSpeed)
    g.controls.zoomSpeed = Math.min(1, Math.log((1 + alt) / (1 + 0.8 * alt)) / 0.0513);
    g.controls.update();
    refine(g, camera.position.length() - 1);
  }
  const alt = camera.position.length() - 1;
  if (!g.fly?.enter) {  // Play: over a circuit and close enough to see it; a race chosen in the header is the one it opens there
    const i = alt < SHOW ? over(g.ats, v.copy(camera.position).normalize().toArray(), alt) : -1, c = g.pins[i]?.c ?? null;
    const chosen = c && g.to?.lat === c.lat && g.to.lng === c.lng;
    if (g.to && ((!g.fly && alt > 1.2) || (c && !chosen))) g.to = null;  // zoomed out by hand, or over another circuit: the choice is let go
    const at = chosen ? g.to : c ?? g.to ?? null;  // a chosen circuit's card shows from the moment of choosing, on the way down too
    if (at !== g.over) card(g, at);
  }
  Object.assign(camera, {near: alt * 0.2, far: alt + 2.5});
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  g.air.visible = alt > 0.1;
  for (const p of [...g.patches, g.look, g.old]) if (p?.loaded) p.shown.value = Math.min(1, p.shown.value + dt * 3);
  // an upload is a quarter's whole 64 MB: one quarter every 300 ms while the tiles land, and after its last the canvas can go
  const q = performance.now() - g.painted > 300 && g.earth.find(x => x.dirty);
  if (q) {
    q.map.needsUpdate = true;
    if (q.whole) q.map.onUpdate = () => { q.canvas.width = q.canvas.height = 0; };
    q.dirty = false;
    g.earth.push(g.earth.shift());  // the next quarter's turn
    g.painted = performance.now();
  }
  // the pins: on this side of the horizon, and away once the ground is close
  const shown = [];
  for (const p of g.pins) {
    const {b, at} = p, facing = at.dot(camera.position), on = (!g.fly || alt > 0.05) && facing > 1 + alt * 0.004;
    if (on) {
      v.copy(at).project(camera);
      [p.x, p.y] = [(v.x + 1) / 2 * g.w, (1 - v.y) / 2 * g.h];
      b.style.setProperty('--pin-x', `${p.x.toFixed(1)}px`);
      b.style.setProperty('--pin-y', `${p.y.toFixed(1)}px`);
      p.rank = (p.c.state === 'shown' ? 4 : p.c.state === 'next' ? 2 : 0) + facing / camera.position.length();
      shown.push(p);
    }
    if (b.hidden === on) b.hidden = !on;
  }
  labels(shown);
  shared().renderer.render(g.scene, camera);
}

export const globeOpen = () => !!G;

// Fly down to a circuit: c is a pin's entry (setPins), or one like it for another race at that pin. Play shows on the way down.
export function flyTo(c) {
  const g = G;
  if (!g?.w || g.fly?.enter) return;  // w: the camera has a place to fly from
  g.to = c;
  g.fly = {from: view(g), to: {lat: c.lat, lng: c.lng, alt: END}, t0: performance.now(), ms: FLY};
  g.controls.enabled = g.controls.autoRotate = false;
  detail(g, c.lat, c.lng);
}

// Back out: the choice is let go and the view rises to the whole Earth, spinning again
function leave(g) {
  const at = view(g);
  g.to = null;
  g.controls.enabled = g.controls.autoRotate = false;
  g.fly = {from: at, to: {lat: at.lat, lng: at.lng, alt: home(g)}, t0: performance.now(), ms: 2400, out: true};
}

// The pins: [{name, place, lat, lng, label, ...}], the circuits of the season in the header. A pin flies to its circuit.
export function setPins(list) {
  const g = G;
  if (!g) return;
  g.pins = list.map(c => {
    const name = el('i', {class: 'gname off', 'aria-hidden': 'true'}, c.country ?? '');
    return {c, at: new THREE.Vector3(...llToVec(c.lat, c.lng)), name,
      b: el('button', {class: 'gpin', hidden: true, 'data-state': c.state || null, 'aria-label': `${c.name}, ${c.place}`, onclick: () => flyTo(c)},
        name, el('span', {}, el('b', {}, c.name), el('small', {}, c.place)))};
  });
  g.ats = list.map(c => llToVec(c.lat, c.lng));
  g.pinbox.replaceChildren(...g.pins.map(p => p.b));
  warm(g);
}

// pick(entry): Play's, opens that race and returns the promise of its stage (app.js); closed(entered): after the globe
// has gone, entered when through Play
export async function openGlobe(pick, closed) {
  if (G || !ready) return;  // no GPU: the page as it was
  const canvas = el('canvas', {'aria-hidden': 'true'}), pinbox = el('div', {class: 'gpins'});
  const hint = el('p', {class: 'ghint', role: 'status'}, el('b', {}, 'Pick a circuit.'), ' Watch its race in 3D, drive it, or open it on F1 TV. Drag to spin, scroll to zoom.');
  const play = el('button', {class: 'gprimary', onclick: () => enter(G)}), acts = el('div', {class: 'gacts'});
  const card = el('div', {class: 'gplay'}, el('span', {'aria-live': 'polite'}), play, acts, el('button', {class: 'gback', onclick: () => leave(G)}, '← Whole Earth'));
  const g = G = {pick, closed, hint, pinbox, play, acts, card, pins: [], ats: [], patches: [], w: 0, h: 0, painted: 0,
    el: el('section', {class: 'globe', 'aria-label': 'World map of circuits'}, canvas, pinbox, hint, card,
      el('small', {class: 'gcredit'}, 'Imagery: Esri, Maxar, Earthstar Geographics'),
      el('button', {class: 'themebtn gclose', title: 'Skip the globe, to the race page (Esc)', onclick: closeGlobe}, 'Race page ›'))};
  g.el.style.setProperty('--stars', stars());
  g.keys = e => { if (e.key === 'Escape' && !document.querySelector('dialog:modal, :popover-open')) closeGlobe(); };
  addEventListener('keydown', g.keys);
  dispatchEvent(new CustomEvent('f1:panel', {detail: g.el}));  // the showroom lets go of the renderer's one deck
  for (const x of document.querySelectorAll(UNDER)) x.inert = true;
  document.body.dataset.globe = 'on';
  document.body.append(g.el);
  g.surface = new THREE.CanvasTarget(canvas);
  g.surface.setPixelRatio(Math.min(devicePixelRatio, 2));
  g.scene = new THREE.Scene();
  g.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
  g.controls = new OrbitControls(g.camera, canvas);
  Object.assign(g.controls, {enableDamping: true, dampingFactor: 0.08, enablePan: false, autoRotate: true, autoRotateSpeed: 0.35, minDistance: 1 + END, maxDistance: 7});
  canvas.addEventListener('pointerdown', () => {  // it's yours now: the spin stops, and so does a flight
    g.controls.autoRotate = false;
    if (g.fly && !g.fly.enter) { g.fly = null; g.controls.enabled = true; }
  });
  g.ro = new ResizeObserver(() => {
    const first = !g.w;
    [g.w, g.h] = [g.el.clientWidth, g.el.clientHeight];
    if (!g.w || !g.h) return;
    g.size = true;
    g.camera.aspect = g.w / g.h;
    if (first && !g.fly) place(g, {lat: 22, lng: 12, alt: home(g)});
    else if (!g.fly && g.controls.autoRotate) g.camera.position.setLength(1 + home(g));  // still whole in a window resized before it's touched
  });
  g.ro.observe(g.el);
  build(g);  // before the GPU is there: the tiles are on their way while it starts
  await ready.catch(() => {});
  if (G !== g) return;
  if (!shared().renderer) return closeGlobe();
  setDeck({surface: g.surface, draw});
}

export function closeGlobe() {
  const g = G;
  if (!g) return;
  G = null;
  removeEventListener('keydown', g.keys);
  for (const x of document.querySelectorAll(UNDER)) x.inert = false;
  delete document.body.dataset.globe;
  document.querySelector('.gposter')?.remove();  // no GPU: the globe never drew
  g.el.remove();
  for (const s of [...g.earth ?? [], ...g.patches, g.look, g.next, g.old]) if (s) s.dead = true;  // paint stops asking for tiles
  if (g.surface) {
    setDeck(null);
    g.ro.disconnect();
    g.controls.dispose();
    g.scene.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    g.surface.dispose?.();
  }
  g.closed?.(!!g.fading, g.after);
}
