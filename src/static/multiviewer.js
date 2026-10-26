// F1 TV multiviewer, the way MultiViewer does it: a video's channels (international feed, F1 LIVE, tracker, data, every
// driver onboard) side by side, played in the browser by shaka-player (with its open-source UI) from the signed DASH
// manifests /api/f1tv/play returns (with your own F1 TV token: Connect, below). It opens on one stream; ＋ adds any
// feed or driver, as many as you like. The selected tile has the sound and is what Sync lines the others up with.
// Each tile picks its video quality and audio track from every rendition in the stream, and can carry a see-through
// telemetry overlay (speed, gear, RPM, throttle, brake, DRS) from OpenF1 car data (2023+ sessions).
import {get, el, tvHeaders} from './util.js';
import {controls} from './tvcontrols.js';

const SHAKA = 'https://cdn.jsdelivr.net/npm/shaka-player@4.12.6/dist/';
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
  if (v.label === 'Practice') return `Practice ${v.title.match(/(?:practice|fp)\s*(\d)/i)?.[1] ?? 1}`;
  return SESSIONS[v.label] ?? null;
}

// telemetry at a wall-clock time (s since epoch) from /api/f1tv/telemetry's grid, or null outside it / in a data gap
export function telAt(tel, wall) {
  const i = Math.round((wall - Date.parse(tel.start) / 1000) / tel.step);
  return i >= 0 && i < tel.speed.length && tel.speed[i] != null
    ? {speed: tel.speed[i], rpm: tel.rpm[i], gear: tel.n_gear[i], throttle: tel.throttle[i], brake: tel.brake[i], drs: tel.drs[i]} : null;
}

// lights out (wall-clock s): the first launch after 20 s stood still, from the scheduled start on
export function launchAt(tel, after) {
  const t0 = Date.parse(tel.start) / 1000, still = Math.round(20 / tel.step);
  let run = 0;
  for (let i = Math.max(0, Math.round((after - t0) / tel.step)); i < tel.speed.length; i++) {
    const v = tel.speed[i];
    if (v === 0) run++;
    else if (v > 0 && run >= still) return t0 + i * tel.step;
    else run = 0;
  }
  return null;
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
    document.head.append(el('script', {src: `${SHAKA}shaka-player.compiled.js`, onload: () => { shaka.polyfill.installAll(); ok(window.shaka); },
      onerror: () => { shakaReady = null; fail(new Error('Could not load the video player')); }}));
  });
}

function showAccount() {
  json('/api/f1tv/account').then(a => {
    M.account.className = `mvaccount${a.linked ? ' on' : ''}`;
    M.account.textContent = a.linked ? `● ${a.product || 'F1 TV'} connected` : `${a.error || 'Not connected'} · Connect F1 TV`;
  }).catch(() => {});
}

async function json(url) {  // not util.get: play urls are signed per play and expire, so never cached
  const res = await fetch(url, {headers: tvHeaders()}), body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `${res.status} ${res.statusText}`);
  return body;
}

const streamName = s => s.type === 'obc' ? `${s.number ?? ''} ${s.title} · ${s.driver ?? s.team ?? ''}`.trim() : FEEDS[s.title] ?? s.title;

function setup() {
  M = {tiles: [], content: null, video: null, offset: 0};
  M.syncOut = el('output', {class: 'mvoffset'});
  M.lights = el('button', {class: 'mvbtn', hidden: true, title: 'Press the moment the start lights go out: lines the data up with the video',
    onclick: lightsOut}, '🏁 Lights out');
  M.datasync = el('div', {class: 'mvsync', role: 'group', 'aria-label': 'Telemetry sync with the video'},
    el('span', {}, 'Data'), [-10, -1, 1, 10].map(d => el('button', {title: `Data ${Math.abs(d)} s ${d < 0 ? 'earlier' : 'later'}`,
      onclick: () => setOffset(M.offset + d)}, `${d > 0 ? '+' : '−'}${Math.abs(d)}s`)), M.syncOut, M.lights);
  M.grid = el('div', {class: 'mvgrid'});
  M.account = el('button', {class: 'mvaccount', popovertarget: 'mvconnect'});
  // MultiViewer's sign-in for a web page: F1's site keeps the subscription token in its login-session cookie
  // (.formula1.com, readable by scripts there), so a bookmarklet clicked on formula1.com brings it back in our URL fragment
  const back = JSON.stringify(`${location.origin}${location.pathname}#f1tv=`);
  const mark = `javascript:(()=>{const m=document.cookie.match(/login-session=([^;]+)/),t=m&&JSON.parse(decodeURIComponent(m[1])).data?.subscriptionToken;if(t)location.href=${back}+t;else alert('Sign in on formula1.com with an F1 TV subscription first, then click this bookmark again.')})()`;
  const stash = () => { try { sessionStorage.setItem('f1tv-back', location.hash); } catch (e) {} };
  M.connect = el('div', {class: 'mvconnect', popover: '', id: 'mvconnect', 'aria-label': 'Connect F1 TV'},
    el('h3', {}, 'Connect F1 TV'),
    el('p', {}, "Sign in on F1's own site, like MultiViewer: your password never reaches this app, nothing is saved on the server, and the connection lasts until you close this tab."),
    el('ol', {},
      el('li', {}, 'Drag this to your bookmarks bar: ', el('a', {class: 'mvmark', href: mark, onclick: e => e.preventDefault()}, 'F1 TV → this app')),
      el('li', {}, el('a', {href: 'https://account.formula1.com/#/en/login', onclick: stash}, 'Sign in at formula1.com'), " (skip if you're signed in there)."),
      el('li', {}, 'On formula1.com, click the bookmark: it brings you back here, connected.')),
    el('button', {class: 'mvbtn', onclick: () => { try { sessionStorage.removeItem('f1tv'); } catch (e) {} showAccount(); }}, 'Disconnect'));
  M.title = el('h2', {});
  M.picker = el('div', {class: 'mvpicker', popover: '', id: 'mvpicker', 'aria-label': 'Add a stream'});
  M.addBtn = el('button', {class: 'mvbtn mvadd', popovertarget: 'mvpicker', title: 'Add a stream: any feed or driver onboard'}, '＋ Add stream');
  M.playBtn = el('button', {class: 'mvbtn', title: 'Play or pause every stream together (lined up first)', onclick: playPauseAll}, '⏯ All');
  M.syncBtn = el('button', {class: 'mvbtn', title: 'Line every stream up with the selected one', onclick: sync}, '⟲ Sync');
  M.uhd = (() => { try { return localStorage.getItem('f1tv-uhd') === '1'; } catch (e) { return false; } })();
  M.uhdBtn = el('button', {class: 'mvbtn mv4k', 'aria-pressed': M.uhd, onclick: toggleUhd,
    title: '4K: the main broadcast and F1 Live locked to 2160p50 HDR (15 Mb/s each); onboards, tracker and data stay up to 1080p'}, '4K');
  // F1 TV's 4K is HEVC Main10 at 2160p50: browsers without a decoder for it (Firefox, Chrome without GPU HEVC) can't play it
  navigator.mediaCapabilities?.decodingInfo({type: 'media-source', video: {contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
    width: 3840, height: 2160, bitrate: 15360000, framerate: 50}}).then(r => {
    if (r.supported) return;
    M.uhdBtn.disabled = true;
    M.uhdBtn.title = "This browser can't decode F1 TV's 4K video (HEVC 10-bit). Open the app in Microsoft Edge (with Microsoft's HEVC Video Extensions) or in Chrome on a GPU that decodes HEVC 10-bit.";
    if (M.uhd) toggleUhd();
  }, () => {});
  M.picker.addEventListener('toggle', e => {  // opens under its button
    if (e.newState !== 'open') return;
    const r = M.addBtn.getBoundingClientRect();
    Object.assign(M.picker.style, {left: `${Math.max(8, Math.min(r.left, innerWidth - M.picker.offsetWidth - 8))}px`, top: `${r.bottom + 6}px`});
  });
  M.dlg = el('dialog', {class: 'mv', 'aria-label': 'F1 TV multiviewer', onclose: () => {
    // the close event comes a task later: if the viewer was reopened meanwhile, its new tiles stay
    if (!M.dlg.open) for (const t of M.tiles.splice(0)) drop(t);
  }},
    el('header', {class: 'mvhead'}, M.title, M.account, M.addBtn, M.playBtn, M.syncBtn, M.uhdBtn, M.datasync,
      el('button', {class: 'mvbtn', 'aria-label': 'Close', onclick: () => M.dlg.close()}, '✕')),
    M.grid, M.picker, M.connect);
  document.body.append(M.dlg);
  M.dlg.addEventListener('pointerdown', e => {  // an open ⚙ menu closes on a click anywhere else
    for (const d of M.dlg.querySelectorAll('.mvset[open]')) if (!d.contains(e.target)) d.open = false;
  });
}

// the video's data offset, kept per video in this browser
function setOffset(s) {
  M.offset = s;
  M.syncOut.value = `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(1)}s`;
  try { localStorage.setItem(`f1tv-sync-${M.video.id}`, s); } catch (e) { /* storage off: the offset lasts this visit */ }
}
const videoT0 = () => M.video.start / 1000 - LEAD + M.offset;

// 4K on/off for every tile, each reloaded where it is
function toggleUhd() {
  M.uhd = !M.uhd;
  M.uhdBtn.setAttribute('aria-pressed', M.uhd);
  try { localStorage.setItem('f1tv-uhd', M.uhd ? '1' : '0'); } catch (e) { /* storage off: lasts this visit */ }
  for (const t of M.tiles) load(t, t.player && !t.player.isLive() ? t.video.currentTime : undefined);
}
const lead = () => M.tiles.find(t => t.root.classList.contains('audio')) ?? M.tiles[0];

// pressed as the lights go out on the selected tile: that moment becomes the data's lights out
function lightsOut() {
  const l = lead(), t = [l, ...M.tiles].find(x => x?.tel), at = t && launchAt(t.tel, M.video.start / 1000);
  if (at == null) return void (M.syncOut.value = 'pick a driver');
  const shift = at - (videoT0() + l.video.currentTime);
  // a press away from the start moves the data by many minutes: ask first
  if (Math.abs(shift) > 300 && !confirm(`That moves the data ${Math.round(Math.abs(shift) / 60)} min ${shift < 0 ? 'earlier' : 'later'}. Are the lights going out right now?`)) return;
  setOffset(M.offset + shift);
}

// open the viewer on an F1 TV video ({id, title} from /api/f1tv/{year}/{round}, label: what it is, e.g. Qualifying)
export async function openViewer(video) {
  if (!M) setup();
  M.title.textContent = video.label ? `${video.label} · ${video.title}` : video.title;
  M.content = null;
  M.video = video;
  M.session = video.start && video.year >= 2023 ? sessionName(video) : null;
  M.datasync.hidden = !M.session;
  M.lights.hidden = !['Race', 'Sprint'].includes(M.session);
  M.addBtn.disabled = true;
  setOffset((() => { try { return +localStorage.getItem(`f1tv-sync-${video.id}`) || 0; } catch (e) { return 0; } })());
  M.dlg.showModal();
  dispatchEvent(new CustomEvent('f1:panel', {detail: M.dlg}));  // the circuits / cars / trace panels close (and stop drawing)
  M.raf ||= requestAnimationFrame(drawTelemetry);
  M.grid.replaceChildren(el('div', {class: 'loading'}, el('div', {class: 'spinner'}), 'Loading channels…'));
  showAccount();
  const first = json(playUrl(''));  // the main feed's play request goes out with the channel list, not after it
  first.catch(() => {});
  try {
    const c = await get(`/api/f1tv/channels/${video.id}`);
    const rank = s => (FIRST.indexOf(s.title) + 1) || (s.type === 'obc' ? 10 + (s.number || 0) : 9);
    M.content = {...c, streams: [...c.streams].sort((a, b) => rank(a) - rank(b))};
  } catch (e) {
    M.grid.replaceChildren(el('p', {class: 'empty err'}, e.message));
    return;
  }
  M.grid.replaceChildren();
  fillPicker();
  M.addBtn.disabled = false;
  addTile(M.content.streams[0], first);  // one screen to start; ＋ adds the rest
}

// the ＋ menu: every feed, then every driver as a chip in team colours
function fillPicker() {
  const feeds = M.content.streams.filter(s => s.type !== 'obc'), drivers = M.content.streams.filter(s => s.type === 'obc');
  const pick = s => () => { M.picker.hidePopover(); addTile(s); };
  M.picker.replaceChildren(
    el('h4', {}, 'Feeds'), el('div', {class: 'mvfeeds'}, feeds.map(s => el('button', {onclick: pick(s)}, streamName(s)))),
    drivers.length ? el('h4', {}, 'Driver onboards') : null,
    el('div', {class: 'mvdrivers'}, drivers.map(s => el('button', {style: `--c:${s.hex || '#888'}`, onclick: pick(s), title: `${s.driver ?? s.title} · ${s.team ?? ''}`},
      el('b', {}, s.number ?? ''), el('span', {}, s.title), el('small', {}, s.team ?? '')))));
}

function addTile(s, prefetch = null) {
  const t = tile(s);
  t.prefetch = prefetch;
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

// as square a grid as the count allows (1, 2 side by side, 2×2, 3×3…), or with a main stream (⤢): it big on the left,
// the others stacked beside it
function relayout() {
  const n = M.tiles.length;
  M.grid.style.setProperty('--cols', n <= 1 ? 1 : Math.ceil(Math.sqrt(n)));
  M.grid.style.setProperty('--rows', Math.max(1, n - 1));
  M.grid.classList.toggle('spot', n > 1 && M.tiles.some(t => t.root.classList.contains('big')));
  for (const t of M.tiles) t.close.hidden = n === 1;
  if (!n) M.grid.replaceChildren(el('p', {class: 'empty'}, 'Add a stream with ＋ Add stream.'));
  else M.grid.querySelector(':scope > .empty')?.remove();
}

function spotlight(t) {
  const on = !t.root.classList.contains('big');
  for (const x of M.tiles) x.root.classList.toggle('big', on && x === t);
  relayout();
}

function tile(s) {
  const streams = M.content.streams;
  const opt = x => new Option(streamName(x), x.channelId ?? '', false, x === s);
  const pick = el('select', {class: 'mvpick', 'aria-label': 'Stream in this tile'},
    el('optgroup', {label: 'Feeds'}, streams.filter(x => x.type !== 'obc').map(opt)),
    el('optgroup', {label: 'Onboards'}, streams.filter(x => x.type === 'obc').map(opt)));
  const drv = el('select', {class: 'mvpick', 'aria-label': 'Driver data on this tile', title: 'Telemetry overlay', hidden: !M.session},
    new Option('Data off', ''), streams.filter(x => x.type === 'obc' && x.number).map(x => new Option(`${x.title} data`, x.number)));
  const vq = el('select', {'aria-label': 'Video quality'}), aq = el('select', {'aria-label': 'Audio track'});
  const t = {pick, drv, vq, aq, video: el('video', {playsinline: ''}), msg: el('p', {class: 'mvmsg'}), player: null,
    hud: el('div', {class: 'mvtel', hidden: true, 'aria-hidden': 'true'}), now: el('small', {class: 'mvnow'})};
  t.video.muted = true;
  pick.onchange = () => {
    const x = streams.find(y => String(y.channelId ?? '') === pick.value);
    if (x?.type === 'obc' && x.number) { drv.value = x.number; telemetry(t); }  // an onboard brings its driver's data
    load(t);
  };
  drv.onchange = () => telemetry(t);
  vq.onchange = aq.onchange = () => applyQuality(t);
  t.close = el('button', {class: 'mvbtn', title: 'Remove this stream', 'aria-label': 'Remove this stream', onclick: () => removeTile(t)}, '✕');
  t.box = el('div', {class: 'mvvideo'}, t.video);
  t.root = el('div', {class: 'mvtile', onpointerdown: () => listen(t)}, t.box, t.hud,
    el('div', {class: 'mvbar'}, pick, drv,
      el('details', {class: 'mvset'}, el('summary', {title: 'Video quality and audio track'}, '⚙'),
        el('div', {class: 'mvsetpanel'}, el('label', {}, 'Video quality', vq), el('label', {}, 'Audio', aq), t.now)),
      el('button', {class: 'mvbtn', title: 'Main stream: big, the others in a column beside it', 'aria-label': 'Make this the main stream',
        onclick: () => spotlight(t)}, '⤢'), t.close),
    el('span', {class: 'mvsound', title: 'Selected: has the sound, Sync lines the others up with it'}, '🔊'), t.msg);
  t.ctl = controls(t.video, t.root, () => t.player);
  t.root.append(t.ctl.bar);
  if (s.type === 'obc' && s.number) drv.value = s.number;
  telemetry(t);
  return t;
}

// the tile you touch is selected: it has the sound (like MultiViewer's audio focus) and is the one Sync follows
function listen(t) {
  for (const x of M.tiles) {
    x.video.muted = x !== t;
    x.root.classList.toggle('audio', x === t);
  }
  const s = M.content.streams.find(x => String(x.channelId ?? '') === t.pick.value);
  M.syncBtn.textContent = `⟲ Sync all to ${s?.type === 'obc' ? s.title : FEEDS[s?.title]?.split(' ')[0] ?? 'selected'}`;
}

const playUrl = ch => `/api/f1tv/play/${M.content?.id ?? M.video.id}?${new URLSearchParams({...(ch ? {channel: ch} : {}), ...(M.uhd ? {uhd: 1} : {})})}`;

// at: where to start (s); by default where the selected tile is, so a new stream joins it
async function load(t, at) {
  const ch = t.pick.value, s = M.content.streams.find(x => String(x.channelId ?? '') === ch);
  t.root.style.setProperty('--team', s?.hex || 'transparent');
  t.msg.textContent = 'Loading…';
  try {
    const first = t.prefetch;  // the first tile's play request went out with the channel list
    t.prefetch = null;
    const [sh, p] = await Promise.all([loadShaka(), first ?? json(playUrl(ch))]);
    if (!M.tiles.includes(t) || t.pick.value !== ch) return;  // closed or switched while loading
    if (!t.player) {
      t.player = new sh.Player();
      await t.player.attach(t.video);
      // shortcut: live streams are Widevine DASH; the license header is untested (no live session while this was built)
      t.player.getNetworkingEngine().registerRequestFilter((type, req) => {
        if (type === sh.net.NetworkingEngine.RequestType.LICENSE && t.ent) req.headers.entitlementtoken = t.ent;
      });
      t.player.addEventListener('variantchanged', () => showNow(t));
      t.player.addEventListener('adaptation', () => showNow(t));
    }
    t.ent = p.entitlementToken;
    t.hls = p.streamType === 'HLS';  // archive videos (seen on 1995, 2010, 2019): HLS H.264, 1080p at most, never 4K
    const uhd = M.uhd && hasUhd(s) && !t.hls;
    t.player.configure({drm: {servers: p.laURL ? {'com.widevine.alpha': p.laURL} : {}}, preferredAudioLanguage: t.aq.value || 'en',
      // 4K: shaka keeps one video set per stream and picks the cheaper one (HEVC Main, up to 1620p); the 2160p
      // renditions are only in the HEVC Main10 (HDR) set
      preferredVideoCodecs: M.uhd ? ['hvc1.2'] : [],
      // F1 TV's manifests say minBufferTime 30 s, so shaka waited for ~6 segments (5.8 s each) before the first frame
      // a 4K tile keeps 12 s behind the playhead (↺10 still lands in it), not 30 s: ~58 MB less memory per 4K stream
      manifest: {dash: {ignoreMinBufferTime: true}}, streaming: {rebufferingGoal: 2, bufferBehind: uhd ? 12 : 30},
      // abr sized to the tile (a small tile streams a small rendition, so many streams stay smooth), starting from the
      // connection's speed rather than shaka's 1 Mb/s guess, which fetched the first segment twice; in 4K mode too for the
      // streams without 4K (onboards), leaving the decoder and the bandwidth to the 4K ones
      abr: {enabled: true, restrictToElementSize: !uhd, defaultBandwidthEstimate: (navigator.connection?.downlink || 10) * 0.7e6,
        restrictions: {minHeight: uhd ? 2160 : 0}}});  // 4K: only 2160p from the first segment on
    const l = lead();  // a new stream starts where the selected one is, playing or paused like it
    const join = l && l !== t && l.player && !l.player.isLive();
    // load straight at that time: loading from 0 and then seeking fetched the start of the session for nothing
    await t.player.load(p.url, at ?? (join ? l.video.currentTime : undefined));
    t.msg.textContent = '';
    fillQuality(t);
    if (M.uhd) lock4k(t);
    // the selected one kept playing while this one buffered: catch up once it plays (usually inside what's buffered)
    if (join && at == null) t.video.addEventListener('playing', () => { if (!l.video.paused) t.video.currentTime = l.video.currentTime; }, {once: true});
    if (!l || l === t || !l.video.paused) t.video.play().catch(() => {});
  } catch (e) {
    t.msg.textContent = e.code >= 6000 && e.code < 7000 ? 'This stream is DRM-protected and this browser has no Widevine: open it in Chrome or Edge.'
      : e.code ? `Playback error ${e.code}` : e.message;
  }
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

// 4K mode: a stream with a 2160p rendition is locked to it (Auto would size it to the tile and rarely pick it)
function lock4k(t) {
  const top = renditions(t.player.getVariantTracks()).video[0];
  if (top?.height >= 2160 || (t.hls && top)) {  // an archive video has no 4K: 4K mode locks it to its best instead
    t.vq.value = top.id;
    applyQuality(t);
  } else if (hasUhd(M.content.streams.find(x => String(x.channelId ?? '') === t.pick.value))) {
    t.msg.textContent = 'No 4K here: this browser can’t decode F1 TV’s 4K (HEVC 10-bit) video.';
  }
}

function applyQuality(t) {
  const P = t.player, lang = t.aq.value;
  if (!P) return;
  if (lang) P.selectAudioLanguage(lang);
  P.configure({abr: {enabled: !t.vq.value}});
  if (t.vq.value) {
    const v = P.getVariantTracks().find(x => String(x.videoId) === t.vq.value && (!lang || x.language === lang));
    if (v) P.selectVariantTrack(v, true);
  }
  showNow(t);
}

function showNow(t) {
  const v = t.player?.getVariantTracks().find(x => x.active);
  if (v) t.now.textContent = `Playing ${v.height}p${Math.round(v.frameRate || 0) || ''} · ${langName(v.language)}`;
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
    if (t.drv.value === num) t.hud.replaceChildren(name(), el('span', {class: 'lbl'}, e.message));
  }
}

// every frame while the viewer is open: each overlay shows its car at the wall-clock time of its video's playhead
// (replays only: OpenF1 is locked while a session is live). The page is only touched when the 0.5 s sample changes, and
// the panel's place on the picture is CSS (.mvtel): reading tile sizes here forced a layout per tile per frame.
function drawTelemetry() {
  M.raf = M.dlg.open ? requestAnimationFrame(drawTelemetry) : 0;
  for (const t of M.tiles) {
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
