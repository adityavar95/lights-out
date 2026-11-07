// F1 TV multiviewer, the way MultiViewer does it: a video's channels (international feed, F1 LIVE, tracker, data, every
// driver onboard) side by side, played in the browser by shaka-player (with its open-source UI) from the signed DASH
// manifests /api/f1tv/play returns (with your own F1 TV token: Connect, below). It opens on one stream; ＋ adds any
// feed or driver, as many as you like. The selected tile has the sound and is what Sync lines the others up with.
// Each tile picks its video quality and audio track from every rendition in the stream, and can carry a see-through
// telemetry overlay (speed, gear, RPM, throttle, brake, DRS) from OpenF1 car data (2023+ sessions).
import {get, el, tvHeaders, count, skeleton} from './util.js';
import {controls, icon} from './tvcontrols.js';
import {sessionMarks} from './scrubmarks.js';

const SHAKA = '/static/assets/shaka/';
const FIRST = ['INTERNATIONAL', 'F1 LIVE', 'TRACKER', 'DATA'];  // feed order in the picker
const FEEDS = {INTERNATIONAL: 'International broadcast', 'F1 LIVE': 'F1 Live studio', TRACKER: 'Driver tracker', DATA: 'Data channel'};
const AUDIO = {fx: 'Track sound, no commentary', tea: 'Team radio'};  // F1 TV's own audio codes
const CODECS = {avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', av01: 'AV1', vp09: 'VP9'};
// F1 TV replays carry no clock (static DASH, segments from 0 s) and run past F1 TV's scheduled times by a varying amount.
// shortcut: video 0 s = scheduled start - LEAD (measured on the 2026 US GP race: lights out at 538 s), fixed per video by
// the header's data sync (nudges, or Lights out on a race); a broadcast clock would need OCR of the on-screen timing
const LEAD = 308;
const SESSIONS = {Race: 'Race', Qualifying: 'Qualifying', Sprint: 'Sprint', 'Sprint quali': 'Sprint Qualifying'};
let M = null, shakaReady = null;

// OpenF1's name for the session an F1 TV video shows, or null (shows, highlights, interviews have no car data)
export function sessionName(v) {
  // a live video is labelled just Live (stream.js): its title says which session, as a replay's label does
  const t = v.title ?? '', label = v.label !== 'Live' ? v.label : /sprint (qualifying|shootout)/i.test(t) ? 'Sprint quali'
    : /sprint/i.test(t) ? 'Sprint' : /qualifying/i.test(t) ? 'Qualifying' : /practice|\bfp\d/i.test(t) ? 'Practice'
    : /grand prix|\bgp\b/i.test(t) ? 'Race' : null;  // a live studio show (The Cooldown Room…) has none
  if (label === 'Practice') return `Practice ${t.match(/(?:practice|fp)\s*(\d)/i)?.[1] ?? 1}`;
  return SESSIONS[label] ?? null;
}

// telemetry at a wall-clock time (s since epoch) from /api/f1tv/telemetry's grid, or null outside it / in a data gap
export function telAt(tel, wall) {
  const i = Math.round((wall - Date.parse(tel.start) / 1000) / tel.step);
  return i >= 0 && i < tel.speed.length && tel.speed[i] != null
    ? {speed: tel.speed[i], rpm: tel.rpm[i], gear: tel.n_gear[i], throttle: tel.throttle[i], brake: tel.brake[i], drs: tel.drs[i]} : null;
}

// lights out (wall-clock s): the first launch after 5 s stood still, from the scheduled start on. Only 5 s: the back of the
// grid stops for ~10 s before the lights, against ~40 s at the front, and the overlay may be on any car
export function launchAt(tel, after) {
  const t0 = Date.parse(tel.start) / 1000, still = Math.round(5 / tel.step);
  let run = 0;
  for (let i = Math.max(0, Math.round((after - t0) / tel.step)); i < tel.speed.length; i++) {
    const v = tel.speed[i];
    if (v === 0) run++;
    else if (v > 0 && run >= still) return t0 + i * tel.step;
    else run = 0;
  }
  return null;
}

// a session's start from Jolpica's race row (each session's `<Name>.date` + `.time`, the race's own `date` + `time`), or
// null when the row doesn't list it. session: OpenF1's name, as the replay's session list has it
const STARTS = {'Practice 1': 'FirstPractice.', 'Practice 2': 'SecondPractice.', 'Practice 3': 'ThirdPractice.',
  'Sprint Qualifying': 'SprintQualifying.', Sprint: 'Sprint.', Qualifying: 'Qualifying.', Race: ''};
export function sessionStart(race, session) {
  const k = STARTS[session], d = k !== undefined && race?.[`${k}date`];
  return d ? new Date(`${d}T${race[`${k}time`] || '00:00:00Z'}`) : null;
}

// every video rendition (one per resolution/bitrate/codec, best first) and audio track of a stream, from shaka's variants
export function renditions(variants) {
  const video = new Map(), audio = new Map();
  for (const v of variants) {
    if (v.videoId != null && !video.has(v.videoId)) video.set(v.videoId, {id: String(v.videoId), height: v.height, bw: v.videoBandwidth || v.bandwidth,
      label: `${v.height}p${Math.round(v.frameRate || 0) || ''} · ${((v.videoBandwidth || v.bandwidth) / 1e6).toFixed(1)} Mb/s · ${CODECS[(v.videoCodec || '').slice(0, 4)] ?? v.videoCodec}`});
    if (v.language && !audio.has(v.language)) audio.set(v.language, {id: v.language,
      label: `${langName(v.language)} · ${Math.round((v.audioBandwidth || 0) / 1000)} kb/s ${v.channelsCount === 2 ? 'stereo' : `${v.channelsCount ?? '?'}ch`}`});
  }
  return {video: [...video.values()].sort((a, b) => b.height - a.height || b.bw - a.bw), audio: [...audio.values()]};
}

function langName(code) {
  if (AUDIO[code]) return AUDIO[code];
  try { return `${new Intl.DisplayNames(['en'], {type: 'language'}).of(code)} commentary`; } catch (e) { return code; }
}

// shaka's player alone: the controls are our own (tvcontrols.js)
export function loadShaka() {
  return shakaReady ??= new Promise((ok, fail) => {
    document.head.append(el('script', {src: `${SHAKA}shaka-player.compiled.js`, integrity: 'sha384-s9UMqmhXBYMVPmZjMacUXbVuQpiJTQGrmQ0qM3z0yeh7tXSIUb6jA4YWVufS0OYW', crossorigin: 'anonymous', onload: () => { shaka.polyfill.installAll(); ok(window.shaka); },
      onerror: () => { shakaReady = null; fail(new Error('Could not load the video player')); }}));
  });
}

function showAccount() {
  json('/api/f1tv/account').then(a => {
    M.account.className = `mvaccount${a.linked ? ' on' : ''}`;
    M.account.textContent = a.linked ? `● ${a.product || 'F1 TV'} connected` : `${a.error || 'Not connected'} · Connect F1 TV`;
  }).catch(() => {});
}

export async function json(url) {  // not util.get: play urls are signed per play and expire, so never cached
  const res = await fetch(url, {headers: tvHeaders()}), body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `${res.status} ${res.statusText}`);
  return body;
}

const streamName = s => s.type === 'obc' ? `${s.number ?? ''} ${s.title} · ${s.driver ?? s.team ?? ''}`.trim() : FEEDS[s.title] ?? s.title;

// The Connect F1 TV popover (the viewer's and the Stream page's own: a popover inside a closed dialog can't show).
// MultiViewer's sign-in for a web page: F1's site keeps the subscription token in its login-session cookie
// (.formula1.com, readable by scripts there), so a bookmarklet clicked on formula1.com brings it back in our URL fragment.
// In the desktop app (src/desktop.py) it's a Sign in button instead: F1's site opens in a window of the app's own, which reads the cookie.
// onChange: after connecting or Disconnect
export function connectPanel(id, onChange) {
  const back = JSON.stringify(`${location.origin}${location.pathname}#f1tv=`);
  const mark = `javascript:(()=>{const m=document.cookie.match(/login-session=([^;]+)/),t=m&&JSON.parse(decodeURIComponent(m[1])).data?.subscriptionToken;if(t)location.href=${back}+t;else alert('Sign in on formula1.com with an F1 TV subscription first, then click this bookmark again.')})()`;
  const stash = () => { try { sessionStorage.setItem('f1tv-back', location.hash); } catch (e) {} };
  const steps = el('ol', {},
    el('li', {}, 'Drag this to your bookmarks bar (Ctrl/⌘+Shift+B shows it): ', el('a', {class: 'mvmark', href: mark, onclick: e => e.preventDefault()}, 'F1 TV → this app')),
    el('li', {}, el('a', {href: 'https://account.formula1.com/#/en/login', onclick: stash}, 'Sign in at formula1.com'), " (skip if you're signed in there)."),
    el('li', {}, 'On formula1.com, click the bookmark: it brings you back here, connected.'));
  const signin = el('button', {class: 'mvbtn', hidden: true, onclick: async () => {
    signin.disabled = true;
    const t = await window.pywebview.api.f1tv_login().catch(() => null);
    signin.disabled = false;
    if (!t) return;
    count('f1tv_connected');
    try { sessionStorage.setItem('f1tv', t); } catch (e) {}
    panel.hidePopover();
    onChange();
  }}, 'Sign in to F1 TV');
  const desktop = () => { steps.hidden = true; signin.hidden = false; };
  if (window.pywebview?.api?.f1tv_login) desktop(); else window.addEventListener('pywebviewready', desktop, {once: true});
  const panel = el('div', {class: 'mvconnect', popover: '', id, 'aria-label': 'Connect F1 TV',
    ontoggle: e => {
      if (e.newState !== 'open') return;
      count('connect_open');
      disconnect.hidden = !tvHeaders()['X-F1-Token'];
      [...panel.querySelectorAll('a[href], button')].find(x => x.offsetParent)?.focus();
    }},
    el('h3', {}, 'Connect F1 TV'),
    el('p', {}, "Sign in on F1's own site, like MultiViewer: your password never reaches this app, nothing is saved on the server, and the connection lasts until you close this tab."),
    steps, signin);
  const disconnect = el('button', {class: 'mvbtn', hidden: true, onclick: () => {
    try { sessionStorage.removeItem('f1tv'); } catch (e) {}
    disconnect.hidden = true;
    onChange();
  }}, 'Disconnect');
  panel.append(disconnect);
  return panel;
}

function setup() {
  M = {tiles: [], content: null, video: null, offset: 0};
  M.syncOut = el('output', {class: 'mvoffset'});
  M.lights = el('button', {class: 'mvmi', hidden: true, title: 'Shift+click as the lights go out on screen to line the data up with the video',
    onclick: e => { M.more.hidePopover(); lightsOut(e); }}, icon('flag'), el('span', {}, 'Jump to the start', el('small', {}, '10 s before lights out')));
  M.datasync = el('div', {class: 'mvsync', role: 'group', 'aria-label': 'Telemetry sync with the video'},
    el('span', {}, 'Data'), [-10, -1, 1, 10].map(d => el('button', {title: `Data ${Math.abs(d)} s ${d < 0 ? 'earlier' : 'later'}`,
      onclick: () => setOffset(M.offset + d)}, `${d > 0 ? '+' : '−'}${Math.abs(d)}`)), M.syncOut);
  M.grid = el('div', {class: 'mvgrid', tabindex: '-1', autofocus: ''});  // showModal focuses it: no focus ring on the first button
  new ResizeObserver(() => relayout()).observe(M.grid);  // tiles are placed in pixels: again on every size change
  M.account = el('button', {class: 'mvaccount', popovertarget: 'mvconnect'});
  M.connect = connectPanel('mvconnect', showAccount);
  M.title = el('h2', {});
  // one stream picker, for adding a stream (Add stream) or switching one (a tile's label): M.pickFor is the tile, or null
  M.pickTitle = el('h3', {}, 'Add a stream');
  M.picker = el('div', {class: 'mvpicker mvpop', popover: '', id: 'mvpicker', 'aria-label': 'Choose a stream'});
  M.addBtn = el('button', {class: 'mvbtn mvadd', popovertarget: 'mvpicker', title: 'Add a stream: any feed or driver onboard',
    onclick: () => { M.pickFor = null; M.pickAt = M.addBtn; M.pickTitle.textContent = 'Add a stream'; }}, icon('plus'), 'Add stream');
  M.playBtn = el('button', {class: 'mvmi', onclick: () => { M.more.hidePopover(); playPauseAll(); }},
    icon('playall'), el('span', {}, 'Play or pause all', el('small', {}, 'Lined up with the selected stream first')));
  M.syncBtn = el('button', {class: 'mvbtn', title: 'Line every stream up with the selected one', onclick: sync}, icon('sync'), 'Sync');
  M.teams = el('div', {class: 'mvteams mvpop', popover: '', id: 'mvteams', 'aria-label': 'Team view'});
  M.teamBtn = el('button', {class: 'mvbtn', popovertarget: 'mvteams', title: "Team view: the race feed with a team's two onboards"}, icon('teams'), 'Teams');
  M.more = el('div', {class: 'mvmore mvpop', popover: '', id: 'mvmore', 'aria-label': 'More'});
  M.moreBtn = el('button', {class: 'mvbtn mvicon', popovertarget: 'mvmore', title: 'More', 'aria-label': 'More'}, icon('more'));
  // Apple's two layouts: every stream the same size, or the selected one big with the others beside it
  const seg = (name, title, focus) => el('button', {title, 'aria-label': title, 'aria-pressed': String(!focus), onclick: () => setFocus(focus)}, icon(name));
  M.layout = el('div', {class: 'mvseg', role: 'group', 'aria-label': 'Layout'},
    seg('grid', 'Grid: every stream the same size', false), seg('spot', 'Focus: the selected stream big, the others beside it', true));

  // 4K on unless it was switched off here (the decoder check below turns it off where the browser can't play it)
  M.uhd = (() => { try { return localStorage.getItem('f1tv-uhd') !== '0'; } catch (e) { return true; } })();
  M.uhdBtn = el('button', {class: 'mvmi', role: 'switch', 'aria-checked': String(M.uhd), onclick: toggleUhd,
    title: 'The main broadcast and F1 Live in 2160p50 HDR where F1 TV has it (15 Mb/s each); every stream plays its highest quality either way'},
    el('b', {class: 'mvbadge'}, '4K'), el('span', {}, '4K HDR', el('small', {}, 'Main feed in 2160p where F1 TV has it')), el('i', {class: 'mvtoggle'}));
  // F1 TV's 4K is HEVC Main10 at 2160p50: browsers without a decoder for it (Firefox, Chrome without GPU HEVC) can't play it
  navigator.mediaCapabilities?.decodingInfo({type: 'media-source', video: {contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
    width: 3840, height: 2160, bitrate: 15360000, framerate: 50}}).then(r => {
    if (r.supported) return;
    M.uhdBtn.disabled = true;
    M.uhdBtn.title = "This browser can't decode F1 TV's 4K video (HEVC 10-bit). Open the app in Microsoft Edge (with Microsoft's HEVC Video Extensions) or in Chrome on a GPU that decodes HEVC 10-bit.";
    if (M.uhd) toggleUhd();
  }, () => {});
  anchor(M.picker, () => M.pickAt ?? M.addBtn);
  anchor(M.teams, () => M.teamBtn);
  anchor(M.more, () => M.moreBtn);
  // the picker marks what's on screen already, and the stream a tile shows when it's switching that tile
  M.picker.addEventListener('beforetoggle', e => {
    if (e.newState !== 'open') return;
    for (const b of M.picker.querySelectorAll('[data-ch]')) {
      b.classList.toggle('on', M.tiles.some(t => t.pick.value === b.dataset.ch));
      b.classList.toggle('cur', M.pickFor?.pick.value === b.dataset.ch);
    }
  });
  M.more.replaceChildren(M.playBtn, M.lights, M.uhdBtn,
    M.syncRow = el('div', {class: 'mvmisync'}, el('span', {}, 'Telemetry sync', el('small', {}, 'Move the data to match the video')), M.datasync),
    el('hr', {}), M.account);
  M.dlg = el('dialog', {class: 'mv', 'aria-label': 'F1 TV multiviewer',
    // focus starts on the grid and returns to header buttons: the tile keys (k, m, f, arrows) go to the stream you hear
    onkeydown: e => { if (!e.target.closest('.mvtile, select, input, summary, [popover]') && !(e.key === ' ' && e.target.closest('button')) && !e.ctrlKey && !e.metaKey && !e.altKey) lead()?.root.dispatchEvent(new KeyboardEvent('keydown', {key: e.key, bubbles: true})); },
    onclose: () => {
    remember(true);
    // the close event comes a task later: if the viewer was reopened meanwhile, its new tiles stay
    if (!M.dlg.open) for (const t of M.tiles.splice(0)) drop(t);
  }},
    el('header', {class: 'mvhead'},
      el('button', {class: 'mvbtn mvback', title: 'Back (Esc)', onclick: () => M.dlg.close()}, icon('left'), 'Back'),
      el('div', {class: 'mvtitle'}, M.title),
      el('div', {class: 'mvtools'}, M.layout, M.teamBtn, M.syncBtn, M.addBtn, M.moreBtn)),
    M.grid, M.picker, M.teams, M.more, M.connect);
  document.body.append(M.dlg);
  M.dlg.addEventListener('pointerdown', e => {  // an open ⚙ menu closes on a click anywhere else
    for (const d of M.dlg.querySelectorAll('.mvset[open]')) if (!d.contains(e.target)) d.open = false;
  });
}

function anchor(pop, at) {
  pop.addEventListener('toggle', e => {
    if (e.newState !== 'open') return;
    const r = at().getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const top = r.bottom + 8 + h > innerHeight - 8 ? Math.max(8, r.top - 8 - h) : r.bottom + 8;
    Object.assign(pop.style, {left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`, top: `${top}px`});
  });
}

// Continue watching (stream.js): where the selected stream is in a replay, every 10 s while the viewer is open and when
// it closes; in this browser's localStorage only. Live sessions and the first 30 s aren't kept.
const WATCH = 'f1tv-watch';
export function watched() {
  try { return JSON.parse(localStorage.getItem(WATCH)) || []; } catch (e) { return []; }
}
function remember(closing = false) {
  const l = lead(), v = M?.video;
  if (v && l?.player && !l.player.isLive() && l.video.duration > 0 && l.video.currentTime >= 30) {
    const e = {id: v.id, title: v.title, img: v.img, kind: v.kind, year: v.year, round: v.round, start: v.start, end: v.end, duration: v.duration,
      url: v.url, tier: v.tier, pos: Math.round(l.video.currentTime), len: Math.round(l.video.duration), at: Date.now()};
    try { localStorage.setItem(WATCH, JSON.stringify([e, ...watched().filter(x => x.id !== v.id)].slice(0, 30))); } catch (err) { /* storage off */ }
  }
  if (closing) dispatchEvent(new CustomEvent('f1:watched'));
}

// the video's data offset, kept per video in this browser
function setOffset(s) {
  M.offset = s;
  M.tiles?.forEach(placeMarks);
  M.syncOut.value = `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(1)}s`;
  saveOffset(M.video.id, s);
}
export const savedOffset = id => { try { return +localStorage.getItem(`f1tv-sync-${id}`) || 0; } catch (e) { return 0; } };
export function saveOffset(id, s) {
  try { localStorage.setItem(`f1tv-sync-${id}`, s); } catch (e) { /* storage off: the offset lasts this visit */ }
}
// the wall clock (s since epoch) at a video's 0 s; also the commentary's clock in the 3D replay (commentary.js)
export const videoZero = (video, offset) => video.start / 1000 - LEAD + offset;
const videoT0 = () => videoZero(M.video, M.offset);
// the session's events on a tile's seek bar, by the same clock as the telemetry overlay, so a sync moves them too
function placeMarks(t) {
  const asked = M.events;
  asked?.then(ev => {
    if (!ev || asked !== M.events) return;
    const shift = Date.parse(ev.start) / 1000 - videoT0();
    t.ctl.setMarks({pins: ev.pins.map(m => ({...m, t: m.t + shift, seek: Math.max(0, m.t + shift - 10)})),
                    bands: ev.bands.map(b => ({...b, t: b.t + shift, end: b.end + shift}))});
  });
}

// 4K on/off for every tile, each reloaded where it is
function toggleUhd() {
  M.uhd = !M.uhd;
  M.uhdBtn.setAttribute('aria-checked', String(M.uhd));
  try { localStorage.setItem('f1tv-uhd', M.uhd ? '1' : '0'); } catch (e) { /* storage off: lasts this visit */ }
  for (const t of M.tiles) load(t, t.player && !t.player.isLive() ? t.video.currentTime : undefined);
}
const lead = () => M.tiles.find(t => t.root.classList.contains('audio')) ?? M.tiles[0];

// 🏁 Lights out: every tile jumps to 10 s before the start, found in a car's telemetry (launchAt: its first launch after a
// standstill) and put on the video's clock. It used to only line the data up, which looked like it did nothing; that
// is Shift+click now.
async function lightsOut(e) {
  if (e?.shiftKey) return markLightsOut();
  let tel = M.tiles.find(x => x.tel)?.tel;
  if (!tel) {  // no driver's data picked yet: any car's has the same start
    const num = M.content?.streams.find(s => s.number)?.number;
    tel = num && await get(`/api/f1tv/telemetry/${M.video.year}/${M.video.round}/${num}?session=${encodeURIComponent(M.session)}`).catch(() => null);
  }
  const at = tel && launchAt(tel, M.video.start / 1000);
  if (at == null) return void (M.syncOut.value = 'no start found');
  const to = Math.max(0, at - videoT0() - 10);
  for (const t of M.tiles) if (t.player && !t.player.isLive()) t.video.currentTime = to;
}

// Shift+🏁, pressed as the lights go out on the selected tile: that moment becomes the data's lights out
function markLightsOut() {
  const l = lead(), t = [l, ...M.tiles].find(x => x?.tel), at = t && launchAt(t.tel, M.video.start / 1000);
  if (at == null) return void (M.syncOut.value = 'pick a driver');
  const shiftNow = () => at - (videoT0() + l.video.currentTime), shift = shiftNow();
  if (Math.abs(shift) <= 300) return setOffset(M.offset + shift);
  // a press away from the start moves the data by many minutes: ask first, on screen, with the video still playing; the answer's moment is the one used
  const close = () => { clearTimeout(M.askTimer); M.ask?.remove(); M.ask = null; };
  close();
  const cancel = el('button', {onclick: close}, 'Cancel');
  M.ask = el('div', {class: 'mvask', role: 'alertdialog', 'aria-label': 'Set lights out here?'},
    el('span', {}, `That moves the data ${Math.round(Math.abs(shift) / 60)} min ${shift < 0 ? 'earlier' : 'later'}. Are the lights going out right now?`),
    el('button', {class: 'yes', onclick: () => { setOffset(M.offset + shiftNow()); close(); }}, 'Lights out now'), cancel);
  M.dlg.append(M.ask);
  cancel.focus();
  M.askTimer = setTimeout(close, 15000);
}

// open the viewer on an F1 TV video ({id, title} from /api/f1tv/{year}/{round}, label: what it is, e.g. Qualifying)
export async function openViewer(video) {
  if (!M) setup();
  M.title.replaceChildren(video.label ? el('span', {class: `mvkicker${video.label === 'Live' ? ' live' : ''}`}, video.label) : '',
    video.title.replace(/^\d{4}\s+/, ''));  // the season is in the page header already
  M.content = null;
  M.video = video;
  M.session = video.start && video.year >= 2023 ? sessionName(video) : null;
  M.syncRow.hidden = !M.session;
  M.events = M.session ? get(`/api/events/${video.year}/${video.round}?session=${encodeURIComponent(M.session)}`).then(ev => ({start: ev.start, ...sessionMarks(ev)}), () => null) : null;
  M.lights.hidden = !['Race', 'Sprint'].includes(M.session);
  M.addBtn.disabled = true;
  M.teamBtn.hidden = true;
  setOffset(savedOffset(video.id));
  M.dlg.style.setProperty('--poster', video.img ? `url("${video.img}?w=1920&h=1080&q=HI&o=L")` : 'none');  // behind a tile until its first frame
  M.dlg.showModal();
  dispatchEvent(new CustomEvent('f1:panel', {detail: M.dlg}));  // the circuits / cars / trace panels close (and stop drawing)
  M.raf ||= requestAnimationFrame(drawTelemetry);
  M.grid.replaceChildren(skeleton());
  showAccount();
  const first = json(playUrl(''));  // the main feed's play request goes out with the channel list, not after it
  first.catch(() => {});
  const opened = M.opened = {};  // this opening: Esc or another video while the channels load drops it (reopening can be the same video)
  try {
    const c = await get(`/api/f1tv/channels/${video.id}`);
    if (M.opened !== opened || !M.dlg.open) return;
    const rank = s => (FIRST.indexOf(s.title) + 1) || (s.type === 'obc' ? 10 + (s.number || 0) : 9);
    M.content = {...c, streams: [...c.streams].sort((a, b) => rank(a) - rank(b))};
  } catch (e) {
    if (M.opened === opened) M.grid.replaceChildren(el('p', {class: 'empty err'}, e.message));
    return;
  }
  M.grid.replaceChildren();
  fillPicker();
  // Team view: a card per team in its colour, its two drivers under its name
  const teams = [...M.content.streams.filter(s => s.type === 'obc' && s.team)
    .reduce((m, s) => m.set(s.team, [...(m.get(s.team) ?? []), s]), new Map())];
  M.teams.replaceChildren(el('h3', {}, 'Team view'), el('p', {class: 'mvhint'}, "The race feed big, with the team's two onboards beside it"),
    el('div', {class: 'mvteamgrid'}, teams.map(([team, ds]) => el('button', {style: `--c:${ds[0].hex || '#888'}`,
      onclick: () => { M.teams.hidePopover(); teamView(team); }}, el('b', {}, team), el('small', {}, ds.map(d => d.title).join(' · '))))));
  M.teamBtn.hidden = !teams.length;
  M.addBtn.disabled = false;
  addTile(M.content.streams[0], first, video.resumeAt);  // one screen to start (where you left off); Add stream adds the rest
}

// the stream picker: every feed, then every driver as a card in team colours; adds a tile, or switches the one it opened from
function fillPicker() {
  const feeds = M.content.streams.filter(s => s.type !== 'obc'), drivers = M.content.streams.filter(s => s.type === 'obc');
  const key = s => String(s.channelId ?? '');
  const pick = s => () => {
    M.picker.hidePopover();
    const t = M.pickFor;
    if (!t) return addTile(s);
    if (t.pick.value !== key(s)) { t.pick.value = key(s); t.pick.onchange(); }
  };
  M.picker.replaceChildren(M.pickTitle,
    el('h4', {}, 'Feeds'), el('div', {class: 'mvfeeds'}, feeds.map(s => el('button', {'data-ch': key(s), onclick: pick(s)}, streamName(s)))),
    drivers.length ? el('h4', {}, 'Driver onboards') : null,
    el('div', {class: 'mvdrivers'}, drivers.map(s => el('button', {'data-ch': key(s), style: `--c:${s.hex || '#888'}`, onclick: pick(s), title: `${s.driver ?? s.title} · ${s.team ?? ''}`},
      el('b', {}, s.number ?? ''), el('span', {}, s.title), el('small', {}, s.team ?? '')))));
}

// at: where it starts (s): a replay resumed from Continue watching
function addTile(s, prefetch = null, at = undefined) {
  const t = tile(s);
  t.prefetch = prefetch;
  t.startAt = at;
  M.tiles.push(t);
  M.grid.append(t.root);
  relayout();
  load(t);
  if (M.tiles.length === 1) listen(t);
}

function removeTile(t) {
  const had = t.root.classList.contains('audio');
  M.tiles.splice(M.tiles.indexOf(t), 1);
  drop(t);
  relayout();
  if (had && M.tiles.length) listen(M.tiles[0]);
}

// Where each tile goes: [{x, y, w, h}] px, every tile 16:9 and as big as the space allows, `gap` apart. Grid: the column
// count that gives the biggest tiles, rows centred (a short last row too). Focus (`main`: its index): it big, the others
// as thumbnails in a column beside it or a row under it, whichever leaves it bigger. The old CSS grid split the window
// into equal cells whatever their shape, so a 16:9 picture floated in black bands and a 4th stream sat alone in a row.
export function arrange(n, W, H, gap = 6, main = -1) {
  const R = 9 / 16, out = [];
  if (!n || W <= 0 || H <= 0) return out;
  if (main < 0 || main >= n || n === 1) {
    let best = {w: 0};
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c), w = Math.min((W - (c - 1) * gap) / c, (H - (r - 1) * gap) / r / R);
      if (w > best.w) best = {w, c, r};
    }
    const {w, c, r} = best, h = w * R, y0 = (H - r * h - (r - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / c), inRow = Math.min(c, n - row * c), x0 = (W - inRow * w - (inRow - 1) * gap) / 2;
      out.push({x: x0 + (i % c) * (w + gap), y: y0 + row * (h + gap), w, h});
    }
    return out;
  }
  const k = n - 1;
  // beside: a column of thumbnails at most a quarter of the width; under: a row of them along the bottom
  const tA = Math.min(W / 4, (H - (k - 1) * gap) / k / R), mA = Math.min(W - tA - gap, H / R);
  const tB = Math.min(W / 4, (W - (k - 1) * gap) / k), mB = Math.min((H - tB * R - gap) / R, W);
  const thumbs = [];
  let big;
  if (mA >= mB) {
    const x0 = (W - mA - gap - tA) / 2, colH = k * tA * R + (k - 1) * gap;
    big = {x: x0, y: (H - mA * R) / 2, w: mA, h: mA * R};
    for (let j = 0; j < k; j++) thumbs.push({x: x0 + mA + gap, y: (H - colH) / 2 + j * (tA * R + gap), w: tA, h: tA * R});
  } else {
    const y0 = (H - mB * R - gap - tB * R) / 2, rowW = k * tB + (k - 1) * gap;
    big = {x: (W - mB) / 2, y: y0, w: mB, h: mB * R};
    for (let j = 0; j < k; j++) thumbs.push({x: (W - rowW) / 2 + j * (tB + gap), y: y0 + mB * R + gap, w: tB, h: tB * R});
  }
  for (let i = 0; i < n; i++) out.push(i === main ? big : thumbs.shift());
  return out;
}

const PAD = 8, GAP = 6;
function relayout() {
  const n = M.tiles.length, main = M.tiles.findIndex(t => t.root.classList.contains('big'));
  for (const t of M.tiles) t.close.hidden = n === 1;
  M.layout.hidden = M.syncBtn.hidden = n < 2;  // a layout and lining streams up mean nothing with one stream
  for (const b of M.layout.children) b.setAttribute('aria-pressed', String((b === M.layout.lastChild) === (main >= 0 && n > 1)));
  if (!n) return void M.grid.replaceChildren(el('p', {class: 'empty'}, 'Add a stream to start watching.'));
  M.grid.querySelector(':scope > .empty')?.remove();
  const {width, height} = M.grid.getBoundingClientRect();
  arrange(n, width - 2 * PAD, height - 2 * PAD, GAP, n > 1 ? main : -1).forEach((r, i) => {
    const st = M.tiles[i].root.style;
    st.left = `${PAD + r.x}px`; st.top = `${PAD + r.y}px`; st.width = `${r.w}px`; st.height = `${r.h}px`;
  });
}

// focus on a tile: it becomes the big one; again on the big one: back to the grid
function spotlight(t) {
  const on = !t.root.classList.contains('big');
  for (const x of M.tiles) x.root.classList.toggle('big', on && x === t);
  relayout();
}

// the header's layout switch: focus makes the selected stream (the one with the sound) big
function setFocus(on) {
  const big = M.tiles.find(t => t.root.classList.contains('big')) ?? lead();
  for (const t of M.tiles) t.root.classList.toggle('big', on && t === big);
  relayout();
}

// Apple's team view: the race feed big, the team's two onboards beside it; tiles already showing them stay as they are
function teamView(team) {
  const key = s => String(s.channelId ?? ''), feed = M.content.streams.find(s => s.type !== 'obc');
  const want = [feed, ...M.content.streams.filter(s => s.type === 'obc' && s.team === team)].filter(Boolean);
  for (const s of want) if (!M.tiles.some(t => t.pick.value === key(s))) addTile(s);
  for (const t of [...M.tiles]) if (!want.some(s => key(s) === t.pick.value)) removeTile(t);
  for (const t of M.tiles) t.root.classList.toggle('big', t.pick.value === key(feed));
  relayout();
}

function tile(s) {
  const streams = M.content.streams;
  const opt = x => new Option(streamName(x), x.channelId ?? '', false, x === s);
  const pick = el('select', {class: 'mvpick', 'aria-label': 'Stream in this tile'},
    el('optgroup', {label: 'Feeds'}, streams.filter(x => x.type !== 'obc').map(opt)),
    el('optgroup', {label: 'Onboards'}, streams.filter(x => x.type === 'obc').map(opt)));
  const drv = el('select', {'aria-label': 'Telemetry overlay on this tile'},
    new Option('Data off', ''), streams.filter(x => x.type === 'obc' && x.number).map(x => new Option(`${x.title} data`, x.number)));
  const vq = el('select', {'aria-label': 'Video quality'}), aq = el('select', {'aria-label': 'Audio track'});
  const t = {pick, drv, vq, aq, video: el('video', {playsinline: ''}), msg: el('p', {class: 'mvmsg'}), player: null,
    hud: el('div', {class: 'mvtel', hidden: true, 'aria-hidden': 'true'}), now: el('small', {class: 'mvnow'}),
    radio: el('ol', {class: 'mvradio', hidden: true, 'aria-label': 'Team radio messages'})};
  t.radioCount = el('span', {class: 'n'});
  t.radioBtn = el('button', {class: 'mvibtn mvradiobtn', hidden: true, 'aria-pressed': 'false', title: "Team radio: show or hide this driver's messages",
    'aria-label': 'Team radio', onclick: () => toggleRadio(t)}, icon('radio'), t.radioCount);
  t.video.muted = true;
  pick.onchange = () => {
    const x = streams.find(y => String(y.channelId ?? '') === pick.value);
    if (x?.type === 'obc' && x.number) { drv.value = x.number; telemetry(t); }  // an onboard brings its driver's data
    // the selected tile has no other tile to join (load's default): it stays at its own time; `|| undefined`: not loaded yet, its resume point stands
    load(t, t === lead() && t.player && !t.player.isLive() ? t.video.currentTime || undefined : undefined);
  };
  drv.onchange = () => telemetry(t);
  vq.onchange = aq.onchange = () => applyQuality(t);
  t.close = el('button', {class: 'mvibtn', title: 'Remove this stream', 'aria-label': 'Remove this stream', onclick: () => removeTile(t)}, icon('close'));
  t.chipName = el('span', {class: 'mvchipname'}, streamName(s));
  t.chip = el('button', {class: 'mvchip', title: 'Switch this stream', 'aria-haspopup': 'dialog',
    onclick: () => { M.pickFor = t; M.pickAt = t.chip; M.pickTitle.textContent = 'Switch stream'; M.picker.showPopover(); }},
    el('i', {class: 'mvteam'}), t.chipName, icon('down'));
  t.box = el('div', {class: 'mvvideo'}, t.video);
  // the top bar: the stream's label (team colour, number, driver; a menu to switch stream), then radio, settings, focus,
  // remove; like the control bar it only shows while the mouse moves over the tile
  t.root = el('div', {class: 'mvtile', onpointerdown: () => listen(t)}, t.box, t.hud, t.radio,
    el('div', {class: 'mvbar'}, t.chip, el('span', {class: 'mvsp'}),
      t.radioBtn,
      el('details', {class: 'mvset'}, el('summary', {class: 'mvibtn', title: 'Quality, audio and telemetry', 'aria-label': 'Stream settings'}, icon('tune')),
        el('div', {class: 'mvsetpanel'}, el('label', {}, 'Video quality', vq), el('label', {}, 'Audio', aq),
          el('label', {hidden: !M.session}, 'Telemetry overlay', drv), t.now)),
      el('button', {class: 'mvibtn', title: 'Focus: this stream big, the others beside it', 'aria-label': 'Focus on this stream',
        onclick: () => spotlight(t)}, icon('focus')), t.close),
    el('span', {class: 'mvsound', title: 'You hear this stream; Sync lines the others up with it'}, icon('vol')), t.msg);
  t.ctl = controls(t.video, t.root, () => t.player);
  t.root.append(t.ctl.bar);
  placeMarks(t);
  if (s.type === 'obc' && s.number) drv.value = s.number;
  telemetry(t);
  return t;
}

// A driver onboard's team radio (/api/f1tv/radio: F1's clips, transcribed on the server): the tile's 📻 button (with the
// count so far) shows or hides a list of the messages to scroll through; feeds (International, F1 Live, tracker, data)
// have none. Asked again every 8 s while clips are being transcribed, and all along on a live session, where F1 adds
// each one ~30 s after it's said.
async function radioFeed(t) {
  clearTimeout(t.radioTimer);
  const s = M.content.streams.find(x => String(x.channelId ?? '') === t.pick.value), num = s?.type === 'obc' && s.number;
  if (t.radioNum !== num) { t.clips = null; t.radioShown = undefined; }
  t.radioNum = num;
  t.radioBtn.hidden = !num || !M.session;
  t.radio.hidden = t.radioBtn.hidden || t.radioBtn.getAttribute('aria-pressed') !== 'true';
  if (t.radioBtn.hidden) return;
  try {
    const r = await json(`/api/f1tv/radio/${M.video.year}/${M.video.round}/${num}?session=${encodeURIComponent(M.session)}`);
    if (!M.tiles.includes(t) || t.radioNum !== num) return;  // closed or switched meanwhile
    t.radioWords = r.transcribe;
    // a transcribed clip with no words in it (a click, engine noise) isn't a message
    t.clips = r.clips.filter(c => c.text !== '');
    t.radioError = r.error;
    t.radioFails = 0;
    if (r.pending || t.player?.isLive()) t.radioTimer = setTimeout(() => radioFeed(t), 8000);
  } catch (e) {
    if (!M.tiles.includes(t) || t.radioNum !== num) return;
    t.radioError = e.message;
    t.clips ??= [];  // so the list can say why
    t.radioFails = (t.radioFails ?? 0) + 1;
    t.radioTimer = setTimeout(() => radioFeed(t), Math.min(8000 * 2 ** t.radioFails, 120000));  // 16 s, 32 s… up to 2 min
  }
}

function toggleRadio(t) {
  const on = t.radioBtn.getAttribute('aria-pressed') !== 'true';
  t.radioBtn.setAttribute('aria-pressed', on);
  t.radio.hidden = !on;
  t.radioShown = undefined;  // drawn on the next frame, scrolled to the newest
}

// the messages said by the playhead's time (a live stream's own clock, a replay's via videoT0): a replay's list grows as
// the video plays, so it never tells what's coming
export function radioList(clips, wall) {
  return clips.filter(c => c.t <= wall);
}

// One radio clip at a time, fetching or playing, F1's audio fetched with this tab's F1 TV token (an <audio src> can't send it). Its
// buttons (the box redraws every minute, so found by clip) show ■ while it plays; a second press stops it.
let playing = null;
const mark = (url, text, title) => M.dlg.querySelectorAll('.mvplay').forEach(b => {
  if (b.dataset.url === url) { b.textContent = text; if (title) b.title = title; }
});
function stopClip() {
  playing?.abort.abort();
  playing?.audio?.pause();  // its onpause resets its buttons
  playing = null;
}
async function playClip(url, t) {
  const same = playing?.url === url;
  stopClip();
  if (same) return;
  const me = playing = {url, t, abort: new AbortController()};
  try {
    const r = await fetch(`/api/f1tv/radio/audio?${new URLSearchParams({u: url})}`, {headers: tvHeaders(), signal: me.abort.signal});
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
    const src = URL.createObjectURL(await r.blob()), audio = me.audio = new Audio(src);
    mark(url, '■');
    audio.onended = audio.onpause = () => {
      URL.revokeObjectURL(src);
      if (playing?.audio === audio) playing = null;
      mark(url, '▶');
    };
    await audio.play();
  } catch (e) {
    if (playing !== me) return;  // stopped or replaced: not a failure
    playing = null;
    mark(url, '!', e.message);
  }
}


// the tile you touch is selected: it has the sound (like MultiViewer's audio focus) and is the one Sync follows
function listen(t) {
  for (const x of M.tiles) {
    x.video.muted = x !== t;
    x.root.classList.toggle('audio', x === t);
  }
  const s = M.content.streams.find(x => String(x.channelId ?? '') === t.pick.value);
  M.syncBtn.title = `Line every stream up with ${s?.type === 'obc' ? s.title : FEEDS[s?.title] ?? 'the selected one'}`;
  // the stream you hear: a bright ring as it changes, settling to a quiet one (YouTube TV, Apple TV multiview)
  t.root.classList.add('flash');
  clearTimeout(t.flashTimer);
  t.flashTimer = setTimeout(() => t.root.classList.remove('flash'), 1800);
}

const playUrl = ch => `/api/f1tv/play/${M.content?.id ?? M.video.id}?${new URLSearchParams({...(ch ? {channel: ch} : {}), ...(M.uhd ? {uhd: 1} : {})})}`;

// at: where to start (s); by default where the selected tile is, so a new stream joins it
async function load(t, at) {
  const ch = t.pick.value, s = M.content.streams.find(x => String(x.channelId ?? '') === ch);
  t.root.style.setProperty('--team', s?.hex || 'transparent');
  t.chipName.textContent = s ? streamName(s) : '';
  t.msg.className = 'mvmsg loading';
  t.msg.textContent = 'Loading…';
  try {
    const first = t.prefetch;  // the first tile's play request went out with the channel list
    t.prefetch = null;
    const [sh, p] = await Promise.all([loadShaka(), first ?? json(playUrl(ch))]);
    if (!M.tiles.includes(t) || t.pick.value !== ch) return;  // closed or switched while loading
    if (!t.player) {
      t.player = new sh.Player();
      await t.player.attach(t.video);
      // Live streams are Widevine DASH. The licence request goes through the server (/api/f1tv/license) with the account's
      // tokens: straight from this page it was cross-origin and carried only the entitlement token, and failed.
      // shortcut: only F1's own licence hosts go through it (the server refuses others); untested against a live session
      t.player.getNetworkingEngine().registerRequestFilter((type, req) => {
        if (type !== sh.net.NetworkingEngine.RequestType.LICENSE) return;
        if (/(^|\.)formula1\.com$/.test(new URL(req.uris[0]).hostname)) {
          req.uris = [new URL(`/api/f1tv/license?${new URLSearchParams({u: req.uris[0]})}`, location.href).href];
          Object.assign(req.headers, tvHeaders(), t.ent ? {'X-F1-Entitlement': t.ent} : {});
        } else if (t.ent) req.headers.entitlementtoken = t.ent;
      });
      t.player.addEventListener('variantchanged', () => showNow(t));
      t.player.addEventListener('adaptation', () => showNow(t));
      t.player.addEventListener('buffering', e => t.root.classList.toggle('buffering', e.buffering));  // top quality never steps down: say why the picture froze
    }
    t.ent = p.entitlementToken;
    t.drm = !!p.laURL;  // live streams; replays carry no DRM
    t.kind = p.streamType || '';  // a live stream's says whether it's 4K (HDR_UHD_…); a replay's is just DASH
    t.no4k = null;
    t.hls = p.streamType === 'HLS';  // archive videos (seen on 1995, 2010, 2019): HLS H.264, 1080p at most, never 4K
    const uhd = M.uhd && hasUhd(s) && !t.hls;
    // an onboard opens on its team radio track (tea), a feed on the language picked before (English at first)
    t.player.configure({drm: {servers: p.laURL ? {'com.widevine.alpha': p.laURL} : {}}, preferredAudioLanguage: s?.type === 'obc' ? 'tea' : t.aq.value || 'en',
      // 4K: shaka keeps one video set per stream and picks the cheaper one (HEVC Main, up to 1620p); the 2160p
      // renditions are only in the HEVC Main10 (HDR) set
      preferredVideoCodecs: M.uhd ? ['hvc1.2'] : [],
      // F1 TV's manifests say minBufferTime 30 s, so shaka waited for ~6 segments (5.8 s each) before the first frame
      // a 4K tile keeps 12 s behind the playhead (↺10 still lands in it), not 30 s: ~58 MB less memory per 4K stream
      // 30 s ahead where the stream has it (a replay; live stops at the edge), to ride out a slow patch without stalling
      manifest: {dash: {ignoreMinBufferTime: true}}, streaming: {rebufferingGoal: 2, bufferingGoal: 30, bufferBehind: uhd ? 12 : 30},
      // Highest quality from the first segment, and it never steps down: a slow connection buffers rather than dropping
      // resolution (the user's choice; ABR sized to the tile and stepped down). With ABR off shaka still picks the first
      // rendition from the bandwidth estimate, so the estimate is set past any rendition (top: 2160p at 15.4 Mb/s).
      abr: {enabled: false, restrictToElementSize: false, defaultBandwidthEstimate: 1e9, restrictions: {minHeight: 0}}});
    const l = lead();  // a new stream starts where the selected one is, playing or paused like it
    const join = l && l !== t && l.player && !l.player.isLive();
    // load straight at that time: loading from 0 and then seeking fetched the start of the session for nothing
    await t.player.load(p.url, at ?? t.startAt ?? (join ? l.video.currentTime : undefined));
    t.startAt = undefined;
    t.msg.className = 'mvmsg';  // .mvmsg.loading outranks .mvmsg:empty: an empty spinner stayed over the picture
    t.msg.textContent = '';
    fillQuality(t);
    lockTop(t);
    radioFeed(t);
    // the selected one kept playing while this one buffered: catch up once it plays (usually inside what's buffered)
    if (join && at == null) t.video.addEventListener('playing', () => { if (!l.video.paused) t.video.currentTime = l.video.currentTime; }, {once: true});
    if (!l || l === t || !l.video.paused) t.video.play().catch(() => {});
  } catch (e) {
    t.msg.className = 'mvmsg';
    t.msg.textContent = playError(e);
  }
}

// What went wrong, in words. Only shaka's 6001 means no Widevine; the rest of its DRM errors (6000s) are a licence that
// was refused or never came, which the old message blamed on the browser.
export function playError(e) {
  if (e.code === 6001) return 'This stream is DRM-protected and this browser has no Widevine: open it in Chrome or Edge.';
  const http = [e, ...(e.data ?? [])].find(d => d?.code === 1001);  // BAD_HTTP_STATUS: [uri, status, response text, ...]
  if (http) return `F1 TV refused the ${e.code >= 6000 && e.code < 7000 ? 'stream licence' : 'request'} (HTTP ${http.data[1]})`
    + (http.data[2] ? `: ${String(http.data[2]).slice(0, 160)}` : '');
  if (e.code >= 6000 && e.code < 7000) return `The stream's DRM licence failed (error ${e.code})`;
  return e.code ? `Playback error ${e.code}` : e.message;
}

// the ⚙ menu: every video rendition and audio track the stream has
function fillQuality(t) {
  const {video, audio} = renditions(t.player.getVariantTracks()), lang = t.player.getVariantTracks().find(v => v.active)?.language;
  t.vq.replaceChildren(new Option('Auto (fits the tile)', ''), ...video.map(v => new Option(v.label, v.id)));
  t.aq.replaceChildren(...audio.map(a => new Option(a.label, a.id, false, a.id === lang)));
  showNow(t);
}

// the feeds F1 TV carries in 2160p (main broadcast, F1 Live); the tracker, data channel and onboards stop at 1080p
const hasUhd = s => ['INTERNATIONAL', 'F1 LIVE', 'MAIN'].includes(s?.title);

// Every stream is locked to its highest rendition (2160p where it has one), shown as picked in its ⚙ menu; the menu can
// still choose another or Auto
function lockTop(t) {
  const top = renditions(t.player.getVariantTracks()).video[0];
  const uhdFeed = hasUhd(M.content.streams.find(x => String(x.channelId ?? '') === t.pick.value));
  if (top) {
    t.vq.value = top.id;
    applyQuality(t);
  }
  if (M.uhd && top && top.height < 2160 && !t.hls && uhdFeed) {
    // it plays in HD: say why beside the quality, not over the picture. F1 TV answers every 4K request for a live session
    // in HD (SDR_HD_DASHWV), and keeps serving a finished one as that DRM recording until it re-publishes it as a 4K replay
    // without DRM: Mexico 2026's practices and pre-qualifying show were still HD a day later, the previous weekend's every
    // session 2160p. One it sent in 4K but that has no 2160p here lost it to the DRM: the browser's Widevine generally won't
    // decrypt 4K HEVC (needs hardware DRM)
    t.no4k = !t.drm ? 'no 4K for this video'
      : /UHD/.test(t.kind) ? 'this browser’s DRM can’t play live 4K'
      : t.player.isLive() ? 'F1 TV sends live sessions in HD'
      : 'F1 TV still serves its live recording; the 4K replay comes later';
    showNow(t);
  }
}

function applyQuality(t) {
  const P = t.player, lang = t.aq.value;
  if (!P) return;
  if (lang) P.selectAudioLanguage(lang);
  P.configure({abr: {enabled: !t.vq.value, restrictToElementSize: !t.vq.value}});  // Auto (picked in ⚙) fits the tile
  if (t.vq.value) {
    const v = P.getVariantTracks().find(x => String(x.videoId) === t.vq.value && (!lang || x.language === lang));
    if (v) P.selectVariantTrack(v, true);
  }
  showNow(t);
}

function showNow(t) {
  const v = t.player?.getVariantTracks().find(x => x.active);
  if (v) t.now.textContent = `Playing ${v.height}p${Math.round(v.frameRate || 0) || ''} · ${langName(v.language)}`
    + (t.no4k && v.height < 2160 ? ` · HD only: ${t.no4k}` : '');
  t.root.classList.toggle('uhd', v?.height >= 2160);  // the tile's 4K badge
}

// the picked driver's telemetry for the whole session (cached by util.get, so tiles on one driver share it)
async function telemetry(t) {
  const num = t.drv.value, d = M.content.streams.find(x => String(x.number) === num);
  const name = () => el('b', {style: `--c:${d?.hex || '#888'}`}, d?.title ?? num);
  t.tel = t.parts = null;
  t.hud.hidden = !num || !M.session;
  if (t.hud.hidden) return;
  t.hud.replaceChildren(name(), el('span', {class: 'lbl'}, 'loading data…'));
  try {
    const tel = await get(`/api/f1tv/telemetry/${M.video.year}/${M.video.round}/${num}?session=${encodeURIComponent(M.session)}`);
    if (t.drv.value !== num) return;
    const bar = c => el('i', {class: `bar ${c}`}, el('i'));
    t.hud.replaceChildren(name(), el('span', {class: 'spd'}), el('span', {class: 'gear'}), el('span', {class: 'drs'}, 'DRS'),
      el('span', {class: 'lbl'}, 'RPM'), bar('rpm'), el('span', {class: 'lbl'}, 'THR'), bar('thr'), el('span', {class: 'lbl'}, 'BRK'), bar('brk'));
    t.parts = Object.fromEntries(['spd', 'gear', 'drs'].map(k => [k, t.hud.querySelector(`.${k}`)])
      .concat(['rpm', 'thr', 'brk'].map(k => [k, t.hud.querySelector(`.bar.${k} i`)])));
    t.tel = tel;
    t.shown = undefined;
  } catch (e) {
    if (t.drv.value === num) t.hud.hidden = true;  // no data (a live session, before 2023): no panel, not an error on every tile
  }
}

// every frame while the viewer is open: each overlay shows its car at the wall-clock time of its video's playhead
// (replays only: OpenF1 is locked while a session is live). The page is only touched when the 0.5 s sample changes, and
// the panel's place on the picture is CSS (.mvtel): reading tile sizes here forced a layout per tile per frame.
function drawTelemetry() {
  M.raf = M.dlg.open ? requestAnimationFrame(drawTelemetry) : 0;
  if (performance.now() - (M.savedAt ?? 0) > 10000) { M.savedAt = performance.now(); remember(); }
  for (const t of M.tiles) {
    if (t.clips) {  // the onboard's 📻 count and radio list, touched only when its messages change
      const live = t.player?.isLive(), wall = live ? (t.player.getPlayheadTimeAsDate?.()?.getTime() ?? 0) / 1000 : videoT0() + t.video.currentTime;
      const said = radioList(t.clips, wall), key = said.map(c => `${c.t}${c.text}${c.error}`).join() + (t.radioError ?? '');
      if (key !== t.radioShown) {
        t.radioShown = key;
        t.radioCount.textContent = said.length || '';
        if (!t.radio.hidden) {
          const atEnd = t.radio.scrollHeight - t.radio.scrollTop - t.radio.clientHeight < 40;  // reading older ones: stay there
          t.radio.replaceChildren(...said.map(c => el('li', {},
            el('button', {class: 'mvplay', 'data-url': c.url, title: 'Play this radio message', 'aria-label': 'Play this radio message',
              onclick: () => playClip(c.url, t)}, playing?.url === c.url ? '■' : '▶'),
            el('time', {}, new Date(c.t * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})),
            el('span', {}, c.text ?? c.error ?? (t.radioWords ? 'transcribing…' : 'Team radio')))),
            ...(said.length ? [] : [el('li', {class: 'none'}, t.radioError ?? 'No radio yet')]));
          if (atEnd) t.radio.scrollTop = t.radio.scrollHeight;
        }
      }
    }
    if (!t.tel || !t.parts) continue;
    const r = t.player?.isLive() ? null : telAt(t.tel, videoT0() + t.video.currentTime), key = r && Object.values(r).join();
    if (key === t.shown) continue;
    t.shown = key;
    t.hud.classList.toggle('stale', !r);  // before / after the session's data: the panel fades out
    if (!r) continue;
    t.parts.spd.textContent = r.speed;
    t.parts.gear.textContent = r.gear || 'N';
    t.parts.drs.classList.toggle('on', r.drs >= 10);  // OpenF1: 10/12/14 = flap open, 8 = eligible
    t.parts.rpm.style.width = `${Math.min(100, r.rpm / 130)}%`;  // full bar at 13,000 rpm
    t.parts.thr.style.width = `${r.throttle}%`;
    t.parts.brk.style.width = `${r.brake ? 100 : 0}%`;  // OpenF1's brake is on/off (0 or 100)
  }
}

function drop(t) {
  clearTimeout(t.radioTimer);
  if (playing?.t === t) stopClip();
  t.player?.destroy();
  t.root.remove();
}

// line every tile up with the selected one: by wall-clock time on live streams, by position on replays
function sync() {
  const l = lead(), date = l?.player?.getPlayheadTimeAsDate?.();
  for (const t of M.tiles) {
    if (t === l || !t.player) continue;
    const d = date && t.player.getPlayheadTimeAsDate?.();
    t.video.currentTime = d ? t.video.currentTime + (date - d) / 1000 : l.video.currentTime;
  }
}

function playPauseAll() {
  const play = M.tiles.every(t => t.video.paused);
  if (play) sync();
  for (const t of M.tiles) play ? t.video.play().catch(() => {}) : t.video.pause();
}
