// The Why: the deck's button and a panel over the stage telling what decided this race (story.js). Picking a beat plays
// that moment of the replay, following its car.
import {get, el, rows, failed, skeleton, count} from './util.js';
import {panelFocus} from './circuitdeck.js';
import {raceModel} from './whatif.js';
import {raceStory, flagLaps, AT_LAP_END} from './story.js';

const MODEL_KINDS = new Set(['cost', 'gain']);
const CAVEAT = "Lap times from Jolpica. Beats marked “model” are the Strategy lab's verdicts in hindsight: rivals keep their real races and their real passes, and team orders and tyre compounds aren't known to it.";

// race: () => {year, round} shown now; open: (lap, atEnd, {id, code}) plays that moment
export function setupStory(stage, race, open) {
  const body = el('div', {class: 'storybody'});
  const btn = el('button', {class: 'neu', 'aria-expanded': false, 'aria-controls': 'storypanel', title: 'What decided this race, moment by moment', onclick: () => toggle()}, 'Why');
  const close = el('button', {class: 'neu', 'aria-label': 'Close', onclick: () => toggle(false)}, '×');
  const panel = el('section', {id: 'storypanel', class: 'storypanel', 'aria-label': 'What decided this race', hidden: true},
    el('header', {class: 'pwhead'}, el('div', {class: 'phead'}, 'WHY'), close), body);
  const focus = panelFocus(panel, btn, () => toggle(false));
  addEventListener('f1:panel', e => { if (e.detail !== panel && !panel.hidden) toggle(false, false); });
  stage.append(panel);
  let shown = null, last = null;

  function toggle(on = panel.hidden, restore = true) {
    panel.hidden = !on;
    btn.setAttribute('aria-expanded', on);
    if (!on) return focus.closed(restore);
    count('why_open');
    dispatchEvent(new CustomEvent('f1:panel', {detail: panel}));
    focus.opened();
    load();
  }

  async function load() {
    const {year, round} = race(), key = `${year}/${round}`;
    if (shown === key) return;
    shown = key;
    body.replaceChildren(skeleton());
    const table = kind => get(`/api/jolpica/${year}/${kind}?round=${round}`).then(rows);
    try {
      const [laps, results, pits] = await Promise.all([table('laps'), table('results'), table('pitstops')]);
      if (shown === key) draw(laps, results, pits);
    } catch (e) {
      if (shown === key) { shown = null; body.replaceChildren(failed(e, load)); }
    }
  }

  function draw(laps, results, pits) {
    last = [laps, results, pits];
    const {data} = race();  // what race control called, once this race's GPS replay is here
    const flags = data?.mode === 'gps' && data.session === 'Race' && data.race_control ? flagLaps(data.race_control, data.duration, data.laps) : null;
    if (!laps.length || !results.length) return body.replaceChildren(el('p', {class: 'empty'}, 'No lap times for this race, so there is nothing to work out yet.'));
    const story = raceStory(raceModel(laps, pits), results, {flags});
    const code = id => results.find(r => r['Driver.driverId'] === id)?.['Driver.code'];
    body.replaceChildren(el('p', {class: 'storyhead'}, story.headline),
      el('ol', {class: 'storybeats'}, story.beats.map(b => el('li', {}, el('button', {class: 'storybeat', onclick: () => {
        count('why_moment');
        open(b.lap, b.lap > 1 && AT_LAP_END.has(b.kind), {id: b.id, code: code(b.id)});
      }}, el('span', {class: 'storylap'}, `L${b.lap}`), el('span', {}, b.text, MODEL_KINDS.has(b.kind) ? el('small', {class: 'storytag'}, 'model') : null))))),
      ...story.notes.map(n => el('p', {class: 'storynote'}, n)),
      el('p', {class: 'storynote'}, CAVEAT));
  }

  return {btn, closePanel: () => { if (!panel.hidden) toggle(false); }, reset: () => { shown = last = null; if (!panel.hidden) load(); }, refresh: () => { if (last) draw(...last); }};
}
