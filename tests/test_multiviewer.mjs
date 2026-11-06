// Run: node tests/test_multiviewer.mjs  — checks the F1 TV multiviewer's telemetry timing (multiviewer.js).
import assert from 'node:assert/strict';
import {short, sessionsOf} from '../src/static/stream.js';
import {sessionName, telAt, launchAt, sessionStart, renditions, playError, radioList, arrange} from '../src/static/multiviewer.js';
import {broadcastAt, pickVideo} from '../src/static/commentary.js';

assert.equal(sessionName({label: 'Race', title: '2026 United States Grand Prix'}), 'Race');
assert.equal(sessionName({label: 'Practice', title: '2026 United States GP - Practice 3'}), 'Practice 3');
assert.equal(sessionName({label: 'Practice', title: '2019 Brazilian GP - F1 FP2'}), 'Practice 2');
assert.equal(sessionName({label: 'Sprint quali', title: '2025 Belgian GP - Sprint Qualifying'}), 'Sprint Qualifying');
assert.equal(sessionName({label: 'Show', title: 'Pre-Race Show - United States'}), null);

// a 0.5 s grid from 20:00:00: on the grid until 20:03:50 (60 s stood still after the formation lap), then away
const start = '2026-10-25T20:00:00+00:00', t0 = Date.parse(start) / 1000, n = 1000;
const speed = Array.from({length: n}, (_, i) => i * 0.5 < 170 ? 120 : i * 0.5 < 230 ? 0 : Math.min(300, (i * 0.5 - 230) * 20));
const tel = {start, step: 0.5, speed, rpm: speed.map(() => 11000), n_gear: speed.map(v => v ? 3 : 0), throttle: speed.map(() => 100),
  brake: speed.map(() => 0), drs: speed.map(() => 0)};
tel.speed[900] = null;  // a gap in OpenF1's data

assert.equal(launchAt(tel, t0), t0 + 230.5, 'lights out = the first moving sample after the long standstill');
assert.equal(launchAt({...tel, speed: speed.map(() => 100)}, t0), null, 'no standstill, no lights out');
const back = speed.map((v, i) => i * 0.5 >= 222 && i * 0.5 < 230 ? 0 : v || 120);  // the back of the grid: stopped only 8 s
assert.equal(launchAt({...tel, speed: back}, t0), t0 + 230, 'a short stop before lights out still counts');
const roll = speed.map((v, i) => i * 0.5 >= 100 && i * 0.5 < 102 ? 0 : v);  // a 2 s halt on the formation lap
assert.equal(launchAt({...tel, speed: roll}, t0), t0 + 230.5, 'a momentary halt is not the start');
const row = {date: '2026-11-08', time: '17:00:00Z', 'FirstPractice.date': '2026-11-06', 'FirstPractice.time': '11:30:00Z', 'Sprint.date': null};
assert.equal(sessionStart(row, 'Race').toISOString(), '2026-11-08T17:00:00.000Z');
assert.equal(sessionStart(row, 'Practice 1').toISOString(), '2026-11-06T11:30:00.000Z');
assert.equal(sessionStart(row, 'Sprint'), null, 'not on this weekend');
assert.equal(sessionStart(row, 'Press conference'), null, 'not a session we know');
assert.equal(sessionStart(null, 'Race'), null, 'no calendar row');
assert.equal(telAt(tel, t0 + 100).speed, 120);
assert.equal(telAt(tel, t0 + 200).gear, 0);
assert.equal(telAt(tel, t0 - 1), null, 'before the data');
assert.equal(telAt(tel, t0 + 450), null, 'in a gap');
assert.equal(telAt(tel, t0 + n * 0.5 + 10), null, 'after the data');
console.log('multiviewer timing ok');

// the commentary under the 3D replay: the session's own video, on the replay's clock
const weekend = [{id: 1, kind: 'REPLAY', title: '2026 United States GP - Practice 1', start: 1},
  {id: 2, kind: 'REPLAY', title: '2026 United States Grand Prix - Race', start: Date.parse(start) + 300e3},
  {id: 3, kind: 'REPLAY', title: 'Pre-Race Show - United States GP', start: 2},
  {id: 4, kind: 'REPLAY', title: '2026 United States GP - Race (Kids)', start: 3}];
assert.equal(pickVideo(weekend, 'Race').id, 2, 'the race, not its show or kids version');
assert.equal(pickVideo(weekend, 'Practice 1').id, 1);
assert.equal(pickVideo([{id: 5, kind: 'REPLAY', title: '2023 Belgian GP - Sprint Shootout', start: 1}], 'Sprint Shootout').id, 5, "OpenF1's 2023 name for sprint qualifying");
assert.equal(pickVideo(weekend, 'Qualifying'), undefined);
const race = weekend[1];  // broadcast 0 s is 308 s (LEAD) before its scheduled start, here 8 s before the replay's
assert.equal(broadcastAt(start, 0, race, 0), 8);
assert.equal(broadcastAt(start, 100, race, 0), 108);
assert.equal(broadcastAt(start, 100, race, 5), 103, 'a positive offset moves broadcast 0 s later, as in the viewer');
console.log('commentary timing ok');

// shaka variants = every video rendition × audio track; the ⚙ menu lists each once, best video first
const variants = [];
for (const [videoId, height, vbw, codec] of [[1, 540, 2048000, 'avc1.4d401f'], [2, 1080, 6144000, 'avc1.640028'], [3, 1080, 5632000, 'hvc1.1.6.L120']])
  for (const language of ['eng', 'fx', 'tea']) variants.push({videoId, height, frameRate: 50, videoBandwidth: vbw, videoCodec: codec, language, audioBandwidth: 192000, channelsCount: 2});
const {video, audio} = renditions(variants);
assert.deepEqual(video.map(v => v.label), ['1080p50 · 6.1 Mb/s · H.264', '1080p50 · 5.6 Mb/s · HEVC', '540p50 · 2.0 Mb/s · H.264']);
assert.deepEqual(audio.map(a => a.label), ['English commentary · 192 kb/s stereo', 'Track sound, no commentary · 192 kb/s stereo', 'Team radio · 192 kb/s stereo']);
// playback errors: only 6001 is a browser without Widevine; a refused licence says so, with F1 TV's status
assert.match(playError({code: 6001}), /no Widevine/);
const refused = playError({code: 6007, data: [{code: 1001, data: ['https://f1tv.formula1.com/la', 403, 'Entitlement expired']}]});
assert.match(refused, /refused the stream licence \(HTTP 403\): Entitlement expired/);
assert.doesNotMatch(refused, /Widevine/);
assert.equal(playError({code: 6012}), "The stream's DRM licence failed (error 6012)");
assert.equal(playError({code: 1002}), 'Playback error 1002');
// team radio list on an onboard: every message said by the playhead, none still to come (a replay's list grows as it plays)
const clips = [{t: 100, text: 'a'}, {t: 110, text: 'b'}, {t: 400, text: 'c'}];
assert.deepEqual(radioList(clips, 99), []);
assert.deepEqual(radioList(clips, 110).map(c => c.text), ['a', 'b']);
assert.deepEqual(radioList(clips, 1e10).map(c => c.text), ['a', 'b', 'c']);  // live, or the end of a replay: all of them
// a live video's label is just Live: the session comes from its title (it was null, so live tiles had no data or radio)
assert.equal(sessionName({label: 'Live', title: '2026 Mexico City GP - Practice 1'}), 'Practice 1');
assert.equal(sessionName({label: 'Live', title: '2026 Mexico City Grand Prix'}), 'Race');
assert.equal(sessionName({label: 'Live', title: '2026 Mexico City GP - Sprint Qualifying'}), 'Sprint Qualifying');
assert.equal(sessionName({label: 'Live', title: 'The Cooldown Room - Williams'}), null);
// layout: every tile 16:9, inside the stage, none overlapping, in grid and focus, wide and tall windows
const inside = (rs, W, H) => rs.every(r => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6);
const apart = rs => rs.every((a, i) => rs.every((b, j) => i >= j || a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6));
for (const [W, H] of [[1600, 900], [1263, 1213], [390, 760], [2560, 1080]]) for (let n = 1; n <= 8; n++) for (const main of [-1, 0, n - 1]) {
  const rs = arrange(n, W, H, 6, main);
  assert.equal(rs.length, n);
  assert.ok(rs.every(r => Math.abs(r.h / r.w - 9 / 16) < 1e-9), `16:9 ${W}x${H} n${n}`);
  assert.ok(inside(rs, W, H), `inside ${W}x${H} n${n} main${main}`);
  assert.ok(apart(rs), `overlap ${W}x${H} n${n} main${main}`);
}
assert.deepEqual(arrange(1, 1600, 900)[0], {x: 0, y: 0, w: 1600, h: 900});  // one stream fills a 16:9 stage
const tall = arrange(4, 1263, 1213);  // four streams in a tall window: 2 x 2, not 3 + 1 with a lone tile
assert.equal(new Set(tall.map(r => r.y)).size, 2);
const focus = arrange(4, 1600, 900, 6, 0);  // focus: the main one well over half the width, the others beside it
assert.ok(focus[0].w > 1100 && focus.slice(1).every(r => r.x > focus[0].x + focus[0].w), JSON.stringify(focus));
// Stream billboard chips: a weekend's sessions oldest first, short names; shows, highlights and press conferences left out
const wk = [
  {title: '2026 Mexico City Grand Prix', kind: 'REPLAY', start: 5}, {title: 'Weekend Warm-Up - Mexico', kind: 'REPLAY', start: 0},
  {title: '2026 Mexico City GP - Practice 2', kind: 'LIVE', start: 2}, {title: '2026 Mexico City GP - Practice 1', kind: 'REPLAY', start: 1},
  {title: 'Practice 1 Highlights - Mexico City', kind: 'RACE HIGHLIGHTS', start: 1.5}, {title: '2026 Mexico City GP - Qualifying', kind: 'REPLAY', start: 4},
  {title: 'FIA Drivers Press Conference - Mexico', kind: 'PRESS CONFERENCE', start: 0.5}, {title: '2026 Mexico City GP - Sprint Qualifying', kind: 'REPLAY', start: 3},
  {title: '2026 Mexico City GP - F1 Kids', kind: 'REPLAY', start: 5.1},  // the race again, for children: not a session of its own
];
assert.deepEqual(sessionsOf(wk).map(short), ['FP1', 'FP2', 'Sprint quali', 'Qualifying', 'Race']);
console.log('multiviewer renditions ok');
