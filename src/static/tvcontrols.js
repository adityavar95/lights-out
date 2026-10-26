// The F1 TV tiles' own control bar, in the app's glass look (replaces shaka's stock UI): play/pause, ±10 s, a seek bar
// with what's buffered, time, mute + volume, speed, captions, picture-in-picture and fullscreen of the whole tile (so the
// telemetry overlay and stream bar stay on screen). Shows on hover or while paused; hides itself 2.5 s after the mouse stops.
import {el} from './util.js';

const SPEEDS = [0.5, 1, 1.5, 2];

export function fmtTime(s) {
  if (!isFinite(s)) return '–:––';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// video: the tile's <video>; root: the tile (fullscreen + hover target); player: getter for its shaka player (captions, live)
export function controls(video, root, player) {
  const btn = (label, title, onclick) => el('button', {class: 'tvc-b', title, 'aria-label': title, onclick}, label);
  const play = btn('▶', 'Play (k)', () => video.paused ? video.play().catch(() => {}) : video.pause());
  const seek = el('input', {class: 'tvc-seek', type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Position'});
  const time = el('span', {class: 'tvc-time'}, '0:00 / –:––');
  const mute = btn('🔇', 'Mute (m)', () => { video.muted = !video.muted; });
  const vol = el('input', {class: 'tvc-vol', type: 'range', min: 0, max: 1, step: 0.05, value: 1, 'aria-label': 'Volume'});
  const speed = el('select', {class: 'tvc-speed', title: 'Speed', 'aria-label': 'Playback speed'}, SPEEDS.map(s => new Option(`${s}×`, s, false, s === 1)));
  const cc = btn('CC', 'Captions', () => {
    const p = player(), on = !p.isTextTrackVisible();
    if (on && !p.getTextTracks().some(t => t.active)) p.selectTextTrack(p.getTextTracks().find(t => t.language === 'en') ?? p.getTextTracks()[0]);
    p.setTextTrackVisibility(on);
    cc.setAttribute('aria-pressed', on);
  });
  const live = el('span', {class: 'tvc-live', hidden: true}, '● LIVE');
  const bar = el('div', {class: 'tvc', onpointerdown: e => e.stopPropagation()},
    seek,
    el('div', {class: 'tvc-row'}, play, btn('↺10', 'Back 10 s (←)', () => { video.currentTime -= 10; }),
      btn('10↻', 'Forward 10 s (→)', () => { video.currentTime += 10; }), time, live, el('span', {class: 'tvc-sp'}),
      mute, vol, speed, cc, btn('⧉', 'Picture in picture', () => video.requestPictureInPicture?.().catch(() => {})),
      btn('⛶', 'Fullscreen (f)', () => document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.())));
  let dragging = false, idle;
  const dur = () => player()?.isLive?.() ? null : video.duration;
  const draw = () => {
    const d = dur(), t = video.currentTime;
    play.textContent = video.paused ? '▶' : '❚❚';
    play.title = video.paused ? 'Play (k)' : 'Pause (k)';
    root.classList.toggle('paused', video.paused);
    if (!dragging && d) seek.value = Math.round(t / d * 1000);
    let buf = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t + 1) buf = Math.max(buf, video.buffered.end(i));
    seek.style.setProperty('--played', `${d ? t / d * 100 : 0}%`);
    seek.style.setProperty('--buffered', `${d ? Math.min(100, buf / d * 100) : 0}%`);
    time.textContent = d ? `${fmtTime(t)} / ${fmtTime(d)}` : fmtTime(t);
    live.hidden = !player()?.isLive?.();
    seek.hidden = !d;
    mute.textContent = video.muted || !video.volume ? '🔇' : '🔊';
    vol.value = video.muted ? 0 : video.volume;
    cc.hidden = !player()?.getTextTracks?.().length;
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
  // keyboard on the focused tile: k/space play, ←/→ 10 s, m mute, f fullscreen
  root.tabIndex = 0;
  root.addEventListener('keydown', e => {
    if (e.target.closest('select, input, button, summary')) return;
    const act = {' ': () => play.click(), k: () => play.click(), ArrowLeft: () => { video.currentTime -= 10; }, ArrowRight: () => { video.currentTime += 10; },
      m: () => mute.click(), f: () => bar.querySelector('[title^=Fullscreen]').click()}[e.key];
    if (act) { e.preventDefault(); act(); }
  });
  draw();
  return {bar, draw};
}
