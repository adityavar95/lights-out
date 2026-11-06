// F1 TV's commentary under a GPS replay: the session's video played sound-only on the replay's clock. F1 TV replays have
// no clock of their own, so this shares the viewer's estimate and per-video offset (multiviewer.js LEAD, videoZero);
// the nudges or the viewer's Lights out correct it. Needs the tab connected to F1 TV. Finished sessions only: no DRM.
import {get, el, led, tvHeaders} from './util.js';
import {loadShaka, connectPanel, json, playError, sessionName, videoZero, savedOffset, saveOffset} from './multiviewer.js';
import {sessionsOf, tvLabel} from './stream.js';

const DRIFT = 1.5;  // s off the replay before re-seeking: closer would seek on every buffering hiccup
const MAX_SPEED = 2;  // faster than this speech is noise, and the deck goes up to much faster
const C = {on: false, key: null, S: null};

// where in the broadcast (s) a replay time is: `start` = the replay's start (ISO), `t` = s from it
export const broadcastAt = (start, t, video, offset) => Date.parse(start) / 1000 + t - videoZero(video, offset);
// OpenF1 called 2023's sprint qualifying "Sprint Shootout" (server.py asks for it under either name)
export const pickVideo = (videos, session) => sessionsOf(videos).find(v => v.start
  && sessionName({...v, label: tvLabel(v)}) === (session === 'Sprint Shootout' ? 'Sprint Qualifying' : session));

const note = text => { C.note.textContent = text; C.note.hidden = !text; };
function paint() {
  C.btn.setAttribute('aria-pressed', C.on);
  C.nudge.hidden = !C.audio;
  if (C.video) C.out.value = `${C.offset > 0 ? '−' : '+'}${Math.abs(C.offset)}s`;
}

function stop() {
  C.player?.destroy().catch(() => {});
  C.audio?.pause();
  C.player = C.audio = C.video = null;
  note('');
  paint();
}

async function start() {
  const key = C.key, S = C.S;
  C.loading = true;
  note('Loading…');
  try {
    const video = pickVideo(await get(`/api/f1tv/${S.year}/${S.round}`), S.data.session);
    if (!video) throw new Error('F1 TV has no video of this session');
    const [sh, play] = await Promise.all([loadShaka(), json(`/api/f1tv/play/${video.id}`)]);
    if (key !== C.key || !C.on) return;
    const audio = new Audio(), player = C.player = new sh.Player();
    player.configure({manifest: {disableVideo: true, dash: {ignoreMinBufferTime: true}}, preferredAudioLanguage: 'en',
      streaming: {rebufferingGoal: 2, bufferingGoal: 30}});
    player.addEventListener('error', e => note(playError(e.detail)));
    await player.attach(audio);
    const offset = savedOffset(video.id);
    await player.load(play.url, Math.max(0, broadcastAt(C.S.data.start, C.S.t, video, offset)));
    if (player !== C.player) return;  // switched off or moved on while it loaded
    Object.assign(C, {audio, video, offset});
    note('');
    paint();
    syncCommentary(C.S);
  } catch (e) {
    if (key !== C.key || !C.on) return;
    C.on = false;
    stop();
    note(e.code ? playError(e) : e.message);
  } finally {
    C.loading = false;
  }
}

async function toggle() {
  if (C.on) {
    C.on = false;
    return stop();
  }
  const a = await fetch('/api/f1tv/account', {headers: tvHeaders()}).then(r => r.json()).catch(() => ({}));
  if (!a.linked) return C.panel.showPopover();
  C.on = true;
  paint();
  syncCommentary(C.S);
}

function nudge(d) {
  C.offset -= d;
  saveOffset(C.video.id, C.offset);
  paint();
  syncCommentary(C.S);
}

export function commentaryUi() {
  C.btn = el('button', {class: 'neu', 'aria-pressed': false, title: "F1 TV's commentary, in time with the replay", onclick: toggle}, led(), 'Commentary');
  C.note = el('small', {hidden: true});
  C.out = el('output', {class: 'mvoffset'});
  C.nudge = el('div', {class: 'mvsync', hidden: true, role: 'group', 'aria-label': 'Commentary sync with the cars'},
    [-10, -1, 1, 10].map(d => el('button', {title: `Hear it ${Math.abs(d)} s ${d < 0 ? 'later' : 'sooner'}`, onclick: () => nudge(d)},
      `${d > 0 ? '+' : '−'}${Math.abs(d)}`)), C.out);
  C.panel = connectPanel('commentaryconnect', async () => {
    const a = await fetch('/api/f1tv/account', {headers: tvHeaders()}).then(r => r.json()).catch(() => ({}));
    if (a.linked && !C.on) toggle();
  });
  return C.box = el('div', {class: 'deckgroup', hidden: true}, C.btn, C.note, C.nudge, C.panel);
}

// follow the replay: called on every drawn frame, on play / pause and when the race changes
export function syncCommentary(S) {
  if (!C.box) return;
  C.S = S;
  const key = S?.data?.mode === 'gps' && !S.sim && !S.live ? `${S.year}/${S.round}/${S.data.session}` : null;
  if (C.box.hidden === !!key) C.box.hidden = !key;
  if (key !== C.key) {
    stop();
    C.key = key;
  }
  if (!key || !C.on) return;
  if (!C.audio) {
    if (!C.loading) start();
    return;
  }
  const a = C.audio, want = broadcastAt(S.data.start, S.t, C.video, C.offset);
  if (!S.playing || S.speed > MAX_SPEED || want < 0 || want >= a.duration) {
    if (!a.paused) a.pause();
    return;
  }
  if (a.playbackRate !== S.speed) a.playbackRate = S.speed;
  if (Math.abs(a.currentTime - want) > DRIFT && !a.seeking) a.currentTime = want;
  if (a.paused) a.play().catch(() => {});
}
