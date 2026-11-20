// A scrubber's important events: named pins on the track, and bands for neutralised stretches, on every player with a
// timeline. Sources: a GPS replay's feeds, the Why's facts for a lap-timing replay, /api/events for F1 TV (pure, and tested);
// markLayer draws them. A mark: {t, end?, kind, label, id? (the car), seek? (where to land, a little before t)}.
import {el, get, rows} from './util.js';
import {neutralBands, leadChanges, marksGradient, KIND_NAME} from './moments.js';
import {highlightReel} from './highlights.js';
import {raceModel} from './whatif.js';
import {raceStory, AT_LAP_END} from './story.js';

export const NO_MARKS = {pins: [], bands: []};
const COLOR = {sc: '#ffc800', vsc: '#ffe680', slow: '#ffc800', red: '#ff2d38', out: '#ff8a3d', pit: '#9aa0a6', pass: '#7cc4ff', radio: '#c69cff'};  // else white
const byTime = list => list.sort((a, b) => a.t - b.t);
const named = b => ({t: b.t, kind: b.kind, label: KIND_NAME[b.kind]});
const chequered = rc => rc.filter(r => r[2] === 'CHEQUERED').map(r => ({t: r[0], kind: 'finish', label: 'Chequered flag'}));

// from: lights out. A race: what the Highlights reel picks (highlights.js). Practice and qualifying have no order to
// follow, so just their flags, chequered ones included: they end each part of qualifying.
export function gpsMarks(data, from = 0) {
  const bands = neutralBands(data.race_control ?? [], data.duration).filter(b => b.end > from);
  if (!data.intervals?.length) return {bands, pins: byTime([...bands.map(named), ...chequered(data.race_control ?? [])])};
  return {bands, pins: byTime(highlightReel(data, from).map(c => ({t: c.at, seek: Math.min(c.t0, c.at), kind: c.kind, id: c.id,
    label: `${c.lap ? `Lap ${c.lap} · ` : ''}${c.text}`})))};
}

// A lap-timing replay's: the Why's beats, facts only (its pit-call verdicts are the model's, not events). cum: the replay's
// cumulative lap times by driver.
const FACTS = {lead: 'lead', retired: 'out', slow: 'pit', undercut: 'pit'};
export function storyMarks(beats, cum) {
  const start = L => (L <= 1 ? 0 : Math.min(...Object.values(cum).map(c => c[L - 2] ?? Infinity)));
  const pins = [], bands = [];
  for (const b of beats) {
    const kind = b.band?.kind ?? FACTS[b.kind];
    if (!kind) continue;
    const atEnd = b.lap > 1 && AT_LAP_END.has(b.kind), t = start(atEnd ? b.lap + 1 : b.lap);
    if (!Number.isFinite(t)) continue;
    pins.push({t, seek: Math.max(0, t - (atEnd ? 20 : 3)), kind, id: b.id, label: `Lap ${b.lap} · ${b.text}`});
    if (b.band) bands.push({t, kind, end: start(b.band.to + 1)});
  }
  return {pins: byTime(pins), bands: bands.map(x => ({...x, end: Number.isFinite(x.end) ? x.end : x.t}))};
}

export async function lapMarks(year, round, cum) {
  const table = kind => get(`/api/jolpica/${year}/${kind}?round=${round}`).then(rows);
  const [laps, results, pits] = await Promise.all([table('laps'), table('results'), table('pitstops')]);
  if (!laps.length || !results.length) return NO_MARKS;
  return storyMarks(raceStory(raceModel(laps, pits), results, {limit: 30}).beats, cum);
}

// Team radio on a GPS replay (fan roadmap A4): /api/f1tv/radio's clips (t: unix s) as pins at their moment, the replay's
// clock counting from start (ISO). A transcribed clip with no words (a click, engine noise) isn't a message.
export function radioMarks(clips, start) {
  const t0 = Date.parse(start) / 1000;
  return clips.filter(c => c.text !== '').map(c => ({t: c.t - t0, seek: Math.max(0, c.t - t0 - 2), kind: 'radio', id: String(c.driver), clip: c.url,
    label: `Team radio · ${c.text ?? 'no words yet'}`}));
}

// F1 TV: /api/events' session, its times in seconds from `start`
export function sessionMarks(ev) {
  const from = ev.first_lap ?? null, code = id => ev.drivers.find(d => d.id === id)?.code ?? id;
  const bands = neutralBands(ev.race_control, ev.duration).filter(b => from === null || b.end > from);
  const flags = chequered(ev.race_control);
  return {bands, pins: byTime([...bands.map(named),
    ...(from === null ? [] : [{t: from, kind: 'start', label: 'Lights out'},
      ...leadChanges(ev.positions, from + 45).map(c => ({t: c.t, kind: 'lead', label: `${code(c.id)} takes the lead`}))]),
    ...(from === null ? flags : flags.slice(0, 1))])};
}

// Wraps a range input; pick(mark) when a pin is clicked. set(marks, duration) places them; a mark's times are the input's.
export function markLayer(input, pick) {
  const layer = el('div', {class: 'mkpins'}), wrap = el('div', {class: 'marked'}, input, layer);
  return {wrap, set({pins, bands} = NO_MARKS, duration = 0) {
    input.style.setProperty('--marks', marksGradient(bands, duration));
    layer.replaceChildren(...pins.filter(m => m.t >= 0 && m.t <= duration).map(m => {
      const at = m.t / duration;
      return el('button', {class: `mk${at < 0.2 ? ' mk-l' : at > 0.8 ? ' mk-r' : ''}`, type: 'button', tabindex: -1, 'aria-label': m.label, 'data-label': m.label,
        style: `left:${(at * 100).toFixed(2)}%;--mk:${COLOR[m.kind] ?? '#fff'}`, onclick: () => pick(m)});
    }));
  }};
}
