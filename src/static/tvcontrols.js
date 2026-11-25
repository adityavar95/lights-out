// The F1 TV tiles' own control bar (replaces shaka's stock UI): play/pause, ±10 s, a seek bar with what's buffered, time
// (a live stream's clock time and a LIVE button that goes back to the edge), mute + volume, speed, captions,
// picture-in-picture and fullscreen of the whole tile (so the overlays stay on screen). Shows on hover or while paused;
// hides itself 2.5 s after the mouse stops. `icon` is the viewer's one icon set (line icons on a 24 px grid).
import {markLayer} from './scrubmarks.js';
import {el} from './util.js';

const SPEEDS = [0.5, 1, 1.5, 2];
const solid = d => `<path d="${d}" fill="currentColor" stroke="none"/>`;
const ten = x => `<text x="${x}" y="15.6" font-size="7" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">10</text>`;
const ICONS = {
  play: solid('M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z'),
  pause: solid('M7 4.5h3.2v15H7zM13.8 4.5H17v15h-3.2z'),
  back: `<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>${ten(12.4)}`,
  fwd: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>${ten(11.6)}`,
  vol: `${solid('M11 5 6.5 9H3v6h3.5l4.5 4z')}<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4"/>`,
  mute: `${solid('M11 5 6.5 9H3v6h3.5l4.5 4z')}<path d="m16 9.5 5 5M21 9.5l-5 5"/>`,
  cc: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6"/>',
  pip: `<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/>${solid('M12.5 11.5h6.5v5.5h-6.5z')}`,
  full: '<path d="M8 3.5H5.5a2 2 0 0 0-2 2V8M20.5 8V5.5a2 2 0 0 0-2-2H16M3.5 16v2.5a2 2 0 0 0 2 2H8M16 20.5h2.5a2 2 0 0 0 2-2V16"/>',
  radio: `<path d="M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6"/>${solid('M12 10.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z')}`,
  focus: '<path d="M14.5 3.5h6v6M9.5 20.5h-6v-6M20.5 3.5l-6.5 6.5M3.5 20.5l6.5-6.5"/>',
  close: '<path d="M17.5 6.5l-11 11M6.5 6.5l11 11"/>',
  tune: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5"/><path d="M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.6l1.7-2.1"/><path d="M20 20v-4.5h-4.5"/>',
  grid: '<rect x="3.5" y="5" width="7.5" height="6" rx="1.4"/><rect x="13" y="5" width="7.5" height="6" rx="1.4"/><rect x="3.5" y="13" width="7.5" height="6" rx="1.4"/><rect x="13" y="13" width="7.5" height="6" rx="1.4"/>',
  pipmode: '<rect x="2.5" y="4.5" width="19" height="15" rx="1.8"/><rect x="13" y="12" width="6" height="5" rx="1"/>',
  spot: '<rect x="2.5" y="5" width="13" height="14" rx="1.6"/><rect x="17.5" y="5" width="4" height="6" rx="1"/><rect x="17.5" y="13" width="4" height="6" rx="1"/>',
  playall: `${solid('M3.5 6v12a.7.7 0 0 0 1.1.6l8.6-6a.7.7 0 0 0 0-1.2l-8.6-6A.7.7 0 0 0 3.5 6z')}<path d="M16.5 6v12M20.5 6v12"/>`,
  flag: '<path d="M5 21V4"/><path d="M5 4.5h12.5l-2.4 4 2.4 4H5"/>',
  ext: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  left: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  right: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  more: `${solid('M5.5 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zM12 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zM18.5 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z')}`,
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  teams: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 19a5.5 5.5 0 0 0-2.6-4.7"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
};

// a line icon (stroke follows the text colour); decorative: the button it sits in carries the label
export const toLive = (p, video) => { if (p.goToLive) p.goToLive(); else video.currentTime = p.seekRange().end; };

export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({viewBox: '0 0 24 24', class: `ico ico-${name}`, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'})) s.setAttribute(k, v);
  s.innerHTML = ICONS[name];
  return s;
}

export function fmtTime(s) {
  if (!isFinite(s)) return '–:––';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// video: the tile's <video>; root: the tile (fullscreen + hover target); player: getter for its shaka player (captions, live)
export function controls(video, root, player) {
  const btn = (name, title, onclick) => el('button', {class: 'tvc-b', title, 'aria-label': title, onclick}, icon(name));
  const play = btn('play', 'Play (k)', () => video.paused ? video.play().catch(() => {}) : video.pause());
  const seek = el('input', {class: 'tvc-seek', type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Position'});
  const marks = markLayer(seek, m => { video.currentTime = m.seek ?? m.t; });
  let marked = null;
  const placeMarks = () => { if (marked && Number.isFinite(video.duration)) marks.set(marked, video.duration); };
  video.addEventListener('durationchange', placeMarks);
  const time = el('span', {class: 'tvc-time'}, '0:00');
  const mute = btn('vol', 'Mute (m)', () => { video.muted = !video.muted; });
  const vol = el('input', {class: 'tvc-vol', type: 'range', min: 0, max: 1, step: 0.05, value: 1, 'aria-label': 'Volume'});
  const speed = el('select', {class: 'tvc-speed', title: 'Speed', 'aria-label': 'Playback speed'}, SPEEDS.map(s => new Option(`${s}×`, s, false, s === 1)));
  const cc = btn('cc', 'Captions', () => {
    const p = player(), on = !p.isTextTrackVisible();
    if (on && !p.getTextTracks().some(t => t.active)) p.selectTextTrack(p.getTextTracks().find(t => t.language === 'en') ?? p.getTextTracks()[0]);
    p.setTextTrackVisibility(on);
    cc.setAttribute('aria-pressed', on);
  });
  // LIVE: lit at the live edge; dimmed when behind it, and then a press goes back to the edge
  const live = el('button', {class: 'tvc-live', hidden: true, title: 'Go to live', onclick: () => {
    const p = player();
    if (p) toLive(p, video);
  }}, 'LIVE');
  const bar = el('div', {class: 'tvc', onpointerdown: e => e.stopPropagation()},
    marks.wrap,
    el('div', {class: 'tvc-row'}, play, btn('back', 'Back 10 s (←)', () => { video.currentTime -= 10; }),
      btn('fwd', 'Forward 10 s (→)', () => { video.currentTime += 10; }), live, time, el('span', {class: 'tvc-sp'}),
      mute, vol, speed, cc, btn('pip', 'Picture in picture', () => video.requestPictureInPicture?.().catch(() => {})),
      btn('full', 'Fullscreen (f)', () => document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.())));
  let dragging = false, idle, paused, muted;
  const dur = () => player()?.isLive?.() ? null : video.duration;
  const draw = () => {
    const d = dur(), t = video.currentTime, p = player(), isLive = !!p?.isLive?.();
    if (paused !== video.paused) {  // icons swap only when the state changes
      paused = video.paused;
      play.replaceChildren(icon(paused ? 'play' : 'pause'));
      play.title = play.ariaLabel = paused ? 'Play (k)' : 'Pause (k)';
    }
    root.classList.toggle('paused', video.paused);
    if (!dragging && d) seek.value = Math.round(t / d * 1000);
    let buf = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t + 1) buf = Math.max(buf, video.buffered.end(i));
    seek.style.setProperty('--played', `${d ? t / d * 100 : 0}%`);
    seek.style.setProperty('--buffered', `${d ? Math.min(100, buf / d * 100) : 0}%`);
    // a live stream's position is seconds since F1 TV's 2024 epoch ("24814:42:42"): the time of day it shows instead
    const at = isLive && p.getPlayheadTimeAsDate?.();
    time.textContent = d ? `${fmtTime(t)} / ${fmtTime(d)}` : at ? at.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : fmtTime(t);
    live.hidden = !isLive;
    if (isLive) live.classList.toggle('behind', p.seekRange().end - t > 12);
    seek.hidden = !d;
    const m = video.muted || !video.volume;
    if (muted !== m) { muted = m; mute.replaceChildren(icon(m ? 'mute' : 'vol')); }
    vol.value = video.muted ? 0 : video.volume;
    cc.hidden = !p?.getTextTracks?.().length;
  };
  for (const e of ['timeupdate', 'progress', 'play', 'pause', 'volumechange', 'durationchange', 'loadedmetadata']) video.addEventListener(e, draw);
  seek.oninput = () => { dragging = true; const d = dur(); if (d) time.textContent = `${fmtTime(seek.value / 1000 * d)} / ${fmtTime(d)}`; };
  seek.onchange = () => { dragging = false; const d = dur(); if (d) video.currentTime = seek.value / 1000 * d; };
  vol.oninput = () => { video.volume = +vol.value; video.muted = !+vol.value; };
  speed.onchange = () => { video.playbackRate = +speed.value; };
  root.addEventListener('pointermove', () => {
    root.classList.add('active');
    clearTimeout(idle);
    idle = setTimeout(() => root.classList.remove('active'), 2500);
  });
  root.addEventListener('pointerleave', () => { clearTimeout(idle); root.classList.remove('active'); });
  root.addEventListener('dblclick', e => { if (e.target.closest('.mvvideo')) bar.querySelector('[title^=Fullscreen]').click(); });
  // keyboard on the focused tile: k/space play, ←/→ 10 s, m mute, f fullscreen
  root.tabIndex = 0;
  root.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('select, input, summary') || (e.key === ' ' && e.target.closest('button'))) return;  // Ctrl+F is the browser's; Space presses a focused button
    const act = {' ': () => play.click(), k: () => play.click(), ArrowLeft: () => { video.currentTime -= 10; }, ArrowRight: () => { video.currentTime += 10; },
      m: () => mute.click(), f: () => bar.querySelector('[title^=Fullscreen]').click()}[e.key];
    if (act) { e.preventDefault(); act(); }
  });
  draw();
  return {bar, draw, setMarks: m => { marked = m; placeMarks(); }};
}
