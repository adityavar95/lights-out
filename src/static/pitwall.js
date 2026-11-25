// Pit-wall console (simulation only): the race engineer's strategy controls for the selected car (box call, compound,
// pace), the weather deck and the race director's neutralisations. Also, in every session: the broadcast
// race-control banner and the scene's weather look (the simulation's weather, or a replay's rain flag).
import {el, lastBefore, led, setAttr, setText, bannerKind} from './util.js';
import {setWeather} from './scene3d.js';
import {setGhost} from './hud.js';
import {stintLife} from './tyres.js';
import {trackWetness, replayWeather, SKIES} from './weather.js';
import {PACE} from './strategy.js';
import {trackPos} from './sim.js';

const COMPS = [['SOFT', 'S', '#ff2d2d'], ['MEDIUM', 'M', '#ffd400'], ['HARD', 'H', '#f2f2f2'], ['INTERMEDIATE', 'I', '#3ec455'], ['WET', 'W', '#2b8cff']];
const SKY = {CLEAR: 'Clear', OVERCAST: 'Overcast', LIGHT_RAIN: 'Light rain', HEAVY_RAIN: 'Monsoon', DRYING: 'Drying'};
const PACES = [[null, 'Auto'], ['PUSH', 'Push'], ['BALANCED', 'Balanced'], ['SAVE', 'Lift & coast']];
const DIRECTOR = [['GREEN', 'Green flag', ['GREEN']], ['VSC', 'VSC', ['VSC', 'VSC ENDING']], ['SC', 'Safety car', ['SC', 'SC IN']]];
const PIT_STATE = {ENTRY: 'PIT ENTRY', LANE: 'IN PIT LANE', STOPPED: 'TYRE CHANGE', EXIT: 'PIT EXIT'};
const DRY = {cloud: 0.1, rain: 0, wetLine: 0, wetOff: 0};

// the compounds out on track at t in a GPS replay, from each car's lap and stint (nothing in a lap-timing replay or the sim)
function tyresOut(S, t) {
  if (!S.lapsBy || !S.data?.stints) return [];
  return S.drivers.map(d => {
    const lp = S.lapsBy[d.id], n = lp ? lastBefore(lp, t) : -1, lap = Math.max(n < 0 ? 0 : lp[n][1], 1);
    return S.data.stints.find(s => s[0] === d.id && s[1] <= lap && (s[2] ?? 999) >= lap)?.[3];
  }).filter(Boolean);
}

let P, getS, chosen = 'MEDIUM', updatedAt = 0, bannerMsg = null;

const btn = (text, onclick, title) => el('button', {class: 'neu', onclick, title}, led(), text);
const pct = v => `${Math.round(v * 100)}%`;

// stage: the 3D stage the HUD sits on; getState: () => the replay's state (S)
export function setupPitwall(stage, getState) {
  getS = getState;
  const sim = () => getS()?.sim, sel = () => getS()?.selected;
  const call = c => {  // a box call for the selected car with compound c; pressing BOX again (no compound) cancels it
    const R = sim(), id = sel();
    if (R && id) R.box(id, c === undefined ? (R.car(id).pit.box ? null : chosen) : c);
  };
  P = {
    box: el('button', {class: 'neu boxbtn', onclick: () => call()}, led(), el('span', {}, 'BOX THIS LAP')),
    comps: COMPS.map(([c, letter, color]) => el('button', {class: 'neu comp', title: c.toLowerCase(), onclick: () => {
      chosen = c;
      if (sim()?.car(sel())?.pit.box) call(c);  // changing the compound of a confirmed call
    }}, el('b', {style: `border-color:${color}`}, letter), el('small'))),
    rejoin: el('div', {class: 'rejoin'}),
    // rear wing trim for every car: each click ~4 % downforce for ~3 % drag (sim.js R.wing)
    wing: el('input', {type: 'range', min: -5, max: 5, step: 1, value: 0, 'aria-label': 'Rear wing angle',
                       oninput: e => { if (sim()) sim().wing = +e.target.value; }}),
    wingText: el('small'),
    paces: PACES.map(([m, t]) => btn(t, () => sim()?.setPace(sel(), m))),
    skies: SKIES.map(s => btn(SKY[s], () => sim()?.setWeather(s))),
    wet: el('input', {type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Track wetness',
                      oninput: e => sim()?.setWetness(+e.target.value / 100)}),
    wetText: el('div', {class: 'wettext'}), sky: el('span', {class: 'skystate'}),
    director: DIRECTOR.map(([s, t]) => btn(t, () => sim()?.deploy(s))),
    drs: el('span', {class: 'drsmod'}), who: el('span', {class: 'pwho'}),
    banner: el('div', {class: 'rcbanner', hidden: true, role: 'status', 'aria-live': 'polite'}),
  };
  // starts collapsed to its header: open, it covers the middle of the view
  P.toggle = el('button', {class: 'neu', 'aria-expanded': false, title: 'Strategy, weather and race control', onclick: () => {
    const collapsed = P.panel.classList.toggle('collapsed');
    P.toggle.setAttribute('aria-expanded', !collapsed);
  }}, led(), 'PIT WALL');
  P.panel = el('section', {class: 'glass pitwall collapsed', hidden: true},
    el('header', {class: 'pwhead'}, P.toggle, P.who),
    el('div', {class: 'pwwrap'}, el('div', {class: 'pwbody'},
      el('div', {class: 'pwcard'}, el('div', {class: 'phead'}, 'STRATEGY'), P.box, el('div', {class: 'comps'}, P.comps), P.rejoin,
        el('div', {class: 'neugroup', role: 'group', 'aria-label': 'Driver pace'}, P.paces),
        el('label', {class: 'wetslider'}, P.wingText, P.wing)),
      el('div', {class: 'pwcard'}, el('div', {class: 'phead'}, 'WEATHER', P.sky),
        el('div', {class: 'neugroup', role: 'group', 'aria-label': 'Weather'}, P.skies),
        el('label', {class: 'wetslider'}, el('small', {}, 'TRACK WETNESS'), P.wet), P.wetText),
      el('div', {class: 'pwcard'}, el('div', {class: 'phead'}, 'RACE DIRECTOR'),
        el('div', {class: 'neugroup', role: 'group', 'aria-label': 'Race control'}, P.director), P.drs))));
  stage.append(P.panel, P.banner);
}

// Broadcast banner: the newest official message for 6 s of race time, sliding in and flashing. Simulations show all
// race control's messages; replays only the big ones (safety cars, red flags, DRS, the chequered flag), since real
// feeds are full of track-limits and blue-flag notes.
function banner(rc, t, sim) {
  const n = rc ? lastBefore(rc, t) : -1;
  let m = null;
  for (let i = n; i >= 0 && t - rc[i][0] <= 6; i--) {
    const [, cat, flag, text] = rc[i];
    if (sim || cat === 'SafetyCar' || ['RED', 'CHEQUERED'].includes(flag) || /DRS|SLIPPERY/.test(text)) { m = rc[i]; break; }
  }
  if (P.banner.hidden !== !m) P.banner.hidden = !m;  // every frame: a same-value write still dirties style
  if (!m || m === bannerMsg) return;
  bannerMsg = m;
  const text = m[3].toUpperCase();
  P.banner.textContent = text;
  P.banner.dataset.kind = bannerKind(text);
  P.banner.classList.remove('show');
  void P.banner.offsetWidth;  // restart the slide-in animation for the new message
  P.banner.classList.add('show');
}

// every frame
export function updatePitwall(S) {
  const R = S.sim, t = S.t;
  banner(S.data?.race_control, t, !!R);
  if (P.panel.hidden !== !R) P.panel.hidden = !R;
  const now = performance.now();
  if (now - updatedAt < 150) return;  // the console only needs ~6 updates a second
  updatedAt = now;
  setWeather(R ? {cloud: R.W.cloud, rain: R.W.rain, wetLine: R.W.wetLine, wetOff: R.W.wetOff} : S.data?.weather ? replayWeather(S.data.weather, t, tyresOut(S, t)) : DRY);
  if (!R) return setGhost(null);
  // the weather strip above the track: air and track cool under cloud and rain
  S.data.weather[0] = [0, Math.round(26 - 5 * R.W.cloud), Math.round(38 - 16 * Math.max(R.W.cloud - 0.1, 0) - 6 * R.W.rain), R.W.rain > 0.05 ? 1 : 0, 2];

  const id = S.selected, car = id && R.car(id), wet = trackWetness(R.W);
  for (const b of [P.box, ...P.comps, ...P.paces]) b.disabled = !car;
  // strategy: box state, compounds with the stint each would last now, predicted rejoin and its ghost on the radar
  if (car) {
    const pit = car.pit, health = car.tyre.health.reduce((a, b) => a + b) / 4;
    setText(P.who, `${S.byId[id].code} · ${car.tyre.compound} ${Math.round(health)}% · stops ${pit.stops} · ${car.pace.toLowerCase()} pace`);
    const confirmed = pit.state === 'RACING' && !!pit.box;
    setAttr(P.box, 'aria-pressed', confirmed || pit.state !== 'RACING');
    setText(P.box.lastChild, PIT_STATE[pit.state] ?? (confirmed ? `BOX CONFIRMED · ${pit.box.compound}` : 'BOX THIS LAP'));
    P.box.disabled = pit.state !== 'RACING';
    const showing = pit.box?.compound ?? chosen;
    P.comps.forEach((b, i) => {
      const c = COMPS[i][0];
      setAttr(b, 'aria-pressed', c === showing);
      setText(b.lastChild, `~${Math.round(stintLife(c, wet, PACE[car.pace].wear))}L`);  // laps to the 35 % cliff
    });
    const pr = R.predict(id);
    if (pr?.pos && pit.state === 'RACING') {
      const name = o => (o ? `${S.byId[o.id]?.code} ${o.gap.toFixed(1)}s` : '—');
      setText(P.rejoin, `Box now: ${pr.loss < 0 ? '' : '+'}${pr.loss.toFixed(1)}s → P${pr.pos} · behind ${name(pr.ahead)} · ahead of ${name(pr.behind)}`);
      setGhost(trackPos(R.T, pr.s, R.T.line[Math.floor(((pr.s % R.T.len) + R.T.len) % R.T.len / R.T.ds) % R.T.n]));
    } else {
      setText(P.rejoin, pit.state === 'RACING' ? 'Rejoin prediction after the first lap' : '');
      setGhost(null);
    }
    P.paces.forEach((b, i) => setAttr(b, 'aria-pressed', PACES[i][0] === car.paceUser));
  } else {
    setText(P.who, 'Select a driver in the tower to run their strategy');
    setText(P.rejoin, '');
    setGhost(null);
  }
  if (document.activeElement !== P.wing) P.wing.value = R.wing;
  setText(P.wingText, `REAR WING ${R.wing > 0 ? '+' : ''}${R.wing} · downforce ${R.wing >= 0 ? '+' : ''}${R.wing * 4}% · drag ${R.wing >= 0 ? '+' : ''}${R.wing * 3}%`);
  // weather deck: requested sky, live state, wetness (the slider follows the track unless it's being dragged)
  P.skies.forEach((b, i) => setAttr(b, 'aria-pressed', SKIES[i] === R.W.target));
  setText(P.sky, SKY[R.W.state]);
  if (document.activeElement !== P.wet) P.wet.value = Math.round(wet * 100);
  setText(P.wetText, `Rain ${pct(R.W.rain)} · racing line ${pct(R.W.wetLine)} · off-line ${pct(R.W.wetOff)}`);
  // race director
  P.director.forEach((b, i) => setAttr(b, 'aria-pressed', DIRECTOR[i][2].includes(R.control.state)));
  setText(P.drs, `${R.control.drsName} ${R.control.drs ? 'ENABLED' : 'DISABLED'}`);
  setAttr(P.drs, 'data-state', R.control.drs ? 'open' : 'off');
}
