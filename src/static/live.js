// Live session from F1's live timing feed (relayed by /api/live), in the shapes the replay view draws.
// Signed in to F1 TV (f1auth.py), the feed carries car GPS and telemetry; without it, each car's place on track
// comes from its completed mini-sectors.

import {tvHeaders} from './util.js';

const TRACK = {'1': 'GREEN', '2': 'YELLOW', '4': 'SC', '5': 'RED', '6': 'VSC', '7': 'VSC ENDING'};
const progress = {};  // driver -> {d: laps done (fractional) as drawn, at: ms}

const lapSeconds = s => {
  if (!s) return null;
  const v = s.split(':').reverse().reduce((sum, p, i) => sum + parseFloat(p) * 60 ** i, 0);
  return v > 20 ? v : null;
};

export async function fetchLive() {
  const res = await fetch('/api/live', {headers: tvHeaders()});  // a connected F1 TV account unlocks car GPS
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `${res.status} ${res.statusText}`);
  return body;
}

// /api/live pushed by /api/live/stream: onData(body) per change; on an error the stream is closed and onFail() called
// once (the caller falls back to fetchLive). EventSource sends no headers, so a token goes through a one-time ticket.
export async function streamLive(onData, onFail) {
  const tv = tvHeaders();
  const {ticket} = tv['X-F1-Token']
    ? await fetch('/api/live/ticket', {method: 'POST', headers: tv}).then(r => r.json()).catch(() => ({}))
    : {};
  const es = new EventSource(`/api/live/stream${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ''}`);
  es.onmessage = e => onData(JSON.parse(e.data));
  es.onerror = () => { es.close(); onFail(); };
  return es;
}

// session start in ms since epoch (StartDate is local time at the circuit)
function origin(info) {
  const [h, m] = (info.GmtOffset || '00:00').replace('-', '').split(':').map(Number);
  const sign = (info.GmtOffset || '').startsWith('-') ? -1 : 1;
  return Date.parse(`${info.StartDate}Z`) - sign * (h * 60 + m) * 60000;
}

export function liveInfo(topics) {
  const info = topics.SessionInfo || {}, status = topics.SessionStatus?.Status;
  return {
    title: `${info.Meeting?.Name ?? 'No session'} · ${info.Name ?? ''}`,
    live: status === 'Started',
    status: status || 'Inactive',
    race: info.Type === 'Race',  // includes sprints
    origin: info.StartDate ? origin(info) : Date.now(),
  };
}

export function liveDrivers(topics) {
  return Object.values(topics.DriverList || {}).filter(d => d?.RacingNumber).map(d => ({
    id: d.RacingNumber, num: +d.RacingNumber, code: d.Tla, name: d.FullName, team: d.TeamName,
    color: d.TeamColour ? `#${d.TeamColour}` : null, headshot: d.HeadshotUrl,
  }));
}

// race control as [t, category, flag, message] and weather as [t, air, track, rain, wind], t = s since session start
export function liveFeeds(topics, start) {
  const w = topics.WeatherData;
  return {
    race_control: Object.values(topics.RaceControlMessages?.Messages || {})
      .map(m => [(Date.parse(m.Utc.endsWith('Z') ? m.Utc : `${m.Utc}Z`) - start) / 1000, m.Category, m.Flag, m.Message]),
    weather: w ? [[-1e9, w.AirTemp, w.TrackTemp, +w.Rainfall, w.WindSpeed]] : [],
  };
}

export function liveStatus(topics) {
  return TRACK[topics.TrackStatus?.Status] || 'GREEN';
}

export function liveClock(topics) {
  const c = topics.ExtrapolatedClock;
  if (!c?.Remaining) return null;
  let s = c.Remaining.split(':').reduce((sum, p) => sum * 60 + +p, 0);
  if (c.Extrapolating) s -= (Date.now() - Date.parse(c.Utc)) / 1000;
  return Math.max(0, s);
}

// Timing tower rows plus each car's fraction of the lap now (`fracs`) and 0.5 s ahead (`ahead`, for heading).
// Cars are eased between mini-sectors at their last lap's pace, so they glide rather than jump.
export function liveState(topics, drivers, nowMs) {
  const lines = topics.TimingData?.Lines || {}, apps = topics.TimingAppData?.Lines || {}, race = liveInfo(topics).race;
  const stats = topics.TimingStats?.Lines || {};  // session bests: speed traps and their ranking
  const fracs = {}, ahead = {}, board = [];
  let segments = 0;
  for (const d of drivers) {
    const ln = lines[d.id] || {};
    const segs = Object.values(ln.Sectors || {}).flatMap(s => Object.values(s?.Segments || {}));
    const total = segs.length || 1, done = segs.filter(s => s?.Status).length, laps = ln.NumberOfLaps || 0;
    segments = Math.max(segments, segs.length);
    const target = laps + done / total, pace = lapSeconds(ln.LastLapTime?.Value) || lapSeconds(ln.BestLapTime?.Value) || 100;
    const p = progress[d.id] ??= {d: target, at: nowMs};
    const dt = Math.min(1, (nowMs - p.at) / 1000);
    p.at = nowMs;
    if (target > p.d + 0.5 || target < p.d - 1.5) p.d = target;          // first data or a jump too big to animate
    else if (target > p.d) p.d += (target - p.d) * Math.min(1, dt * 3);  // catch up with the latest mini-sector
    else p.d = Math.max(p.d, Math.min(p.d + dt / pace, target + 1 / total));  // creep on until the next one
    const off = ln.InPit || ln.Retired || ln.Stopped;  // no pit lane geometry, so cars in the pits leave the track
    if (!off) {
      fracs[d.id] = p.d % 1;
      ahead[d.id] = (p.d + 0.5 / pace) % 1;
    }
    const pos = +ln.Position || 99, stints = Object.values(apps[d.id]?.Stints || {}), stint = stints.at(-1);
    const trap = stats[d.id]?.BestSpeeds?.ST;  // fastest speed-trap reading this session, km/h, Position 1 = session best
    board.push({
      d, pos, lap: laps, tyre: stint?.Compound, age: stint?.TotalLaps, pit: !!(ln.InPit || ln.PitOut),
      stops: Math.max(0, stints.length - 1), trap: trap?.Value || '', trapBest: trap?.Position === 1,
      interval: ln.IntervalToPositionAhead?.Value || '', last: ln.LastLapTime?.Value || '',
      // F1 flags each sector: overall fastest (purple), personal best (green), else completed (yellow)
      sectors: Object.values(ln.Sectors || {}).map(x => (x?.OverallFastest ? 'p' : x?.PersonalFastest ? 'g' : x?.Value ? 'y' : '')),
      out: !!(ln.Retired || ln.Stopped || ln.KnockedOut),
      gapText: race ? (pos === 1 ? `LAP ${topics.LapCount?.CurrentLap ?? laps + 1}` : ln.GapToLeader || ln.IntervalToPositionAhead?.Value || '')
                    : ln.BestLapTime?.Value || '',
    });
  }
  board.sort((a, b) => a.pos - b.pos);
  return {fracs, ahead, board, segments, lap: race ? topics.LapCount?.CurrentLap : null};
}

// ---------- car GPS + telemetry (Position / CarData, F1 TV only) ----------

const GPS_DELAY = 1800;  // ms drawn behind the newest sample, so there is always a later one to interpolate towards
const gps = {};  // driver -> [[ms, x, y, onTrack]] in time order
let clock = null;  // {feed, wall}: the feed time (ms) drawn at wall time `wall`; null until the first GPS sample
let newestSample = 0;  // ms of the latest GPS sample seen

// add a poll's Position samples to the buffers and keep the drawing clock in step with the feed
export function liveGps(topics, nowMs) {
  let newest = 0;
  for (const e of topics.Position?.Position || []) {
    const ms = Date.parse(e.Timestamp);
    newest = Math.max(newest, ms);
    for (const [id, c] of Object.entries(e.Entries || {})) {
      const a = gps[id] ??= [];
      if (!a.length || ms > a.at(-1)[0]) a.push([ms, c.X, c.Y, c.Status !== 'OffTrack']);
      while (a[0][0] < ms - 10000) a.shift();
    }
  }
  if (!newest) return;
  newestSample = Math.max(newestSample, newest);
  const target = newest - GPS_DELAY;  // re-anchor only on real drift, else polls would make the cars stutter
  if (!clock || Math.abs(clock.feed + nowMs - clock.wall - target) > 1000) clock = {feed: target, wall: nowMs};
}

const feedTime = (nowMs, offset) => clock.feed + nowMs - clock.wall + offset;

// GPS is in use while samples keep coming; when they stop (no F1 TV token any more), placement falls back to mini-sectors
export const hasGps = nowMs => clock !== null && feedTime(nowMs, 0) - newestSample < 5000;
export function resetGps() { clock = null; newestSample = 0; for (const id in gps) delete gps[id]; }

// a car's F1 x/y at wall time nowMs (+ offset ms), or null: no recent sample, or in the garage
export function gpsAt(id, nowMs, offset = 0) {
  const a = gps[id];
  if (!clock || !a?.length) return null;
  const t = feedTime(nowMs, offset);
  let j = a.findIndex(s => s[0] > t);
  if (j === -1) return t - a.at(-1)[0] < 3000 && a.at(-1)[3] ? [a.at(-1)[1], a.at(-1)[2]] : null;  // feed stalled: hold
  if (j === 0) return null;
  const p = a[j - 1], q = a[j], f = (t - p[0]) / (q[0] - p[0]);
  return p[3] ? [p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f] : null;
}

// the focused car's readings at wall time nowMs, in OpenF1's car_data field names; null without CarData
const CHANNELS = {0: 'rpm', 2: 'speed', 3: 'n_gear', 4: 'throttle', 5: 'brake', 45: 'drs'};
export function liveCar(topics, id, nowMs) {
  const entries = topics.CarData?.Entries;
  if (!clock || !entries?.length) return null;
  const t = feedTime(nowMs, 0);
  const e = entries.findLast(x => Date.parse(x.Utc) <= t) ?? entries[0];
  const ch = e.Cars?.[id]?.Channels;
  if (!ch) return null;
  const out = Object.fromEntries(Object.entries(CHANNELS).map(([k, f]) => [f, ch[k] ?? null]));
  if (out.brake !== null) out.brake = out.brake > 0 ? 100 : 0;  // on/off, as OpenF1 reports it
  return out;
}
