// Run: node tests/test_multiviewer.mjs  — checks the F1 TV multiviewer's telemetry timing (multiviewer.js).
import assert from 'node:assert/strict';
import {sessionName, telAt, launchAt, renditions} from '../src/static/multiviewer.js';

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
assert.equal(telAt(tel, t0 + 100).speed, 120);
assert.equal(telAt(tel, t0 + 200).gear, 0);
assert.equal(telAt(tel, t0 - 1), null, 'before the data');
assert.equal(telAt(tel, t0 + 450), null, 'in a gap');
assert.equal(telAt(tel, t0 + n * 0.5 + 10), null, 'after the data');
console.log('multiviewer timing ok');

// shaka variants = every video rendition × audio track; the ⚙ menu lists each once, best video first
const variants = [];
for (const [videoId, height, vbw, codec] of [[1, 540, 2048000, 'avc1.4d401f'], [2, 1080, 6144000, 'avc1.640028'], [3, 1080, 5632000, 'hvc1.1.6.L120']])
  for (const language of ['eng', 'fx', 'tea']) variants.push({videoId, height, frameRate: 50, videoBandwidth: vbw, videoCodec: codec, language, audioBandwidth: 192000, channelsCount: 2});
const {video, audio} = renditions(variants);
assert.deepEqual(video.map(v => v.label), ['1080p50 · 6.1 Mb/s · H.264', '1080p50 · 5.6 Mb/s · HEVC', '540p50 · 2.0 Mb/s · H.264']);
assert.deepEqual(audio.map(a => a.label), ['English commentary · 192 kb/s stereo', 'Track sound, no commentary · 192 kb/s stereo', 'Team radio · 192 kb/s stereo']);
console.log('multiviewer renditions ok');
