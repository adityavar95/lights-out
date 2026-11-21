// Car showroom: a CARS button in the top HUD opens a glass deck of cars by regulation era, one card per season with that
// season's constructors' champion (2026: Red Bull's RB22, the 3D model; the season is still running). Picking one shows
// it in a 360° orbit preview beside its spec card: power unit and energy recovery from telemetry.js engine(year),
// dimensions from cars3d.js spec(year) (both approximate per-era figures), and the season's results from Jolpica's
// constructor and driver standings. Any team of that season can be previewed in its colours. "Race this era" opens the
// season's first round as a Simulation, whose physics (mass, power, ERS, DRS) and engine audio follow the year.
import {get, rows, el, teamColor, led, skeleton} from './util.js';
import {panelFocus} from './circuitdeck.js';
import {engine} from './telemetry.js';
import {spec} from './cars3d.js';
import {loadRB22, chassisFor} from './rb22.js';
import {openShowroom, closeShowroom, showCar} from './showroom.js';

const ERAS = [['V10', 1996, 2005], ['V8', 2006, 2013], ['Turbo hybrid', 2014, 2021], ['Ground effect', 2022, 2025], ['Active aero', 2026, 2026]];
// year: [Jolpica constructorId, chassis, engine supplier, best-known innovation]
const CARS = {
  1996: ['williams', 'FW18', 'Renault'], 1997: ['williams', 'FW19', 'Renault'], 1998: ['mclaren', 'MP4-13', 'Mercedes'],
  1999: ['ferrari', 'F399', 'Ferrari'], 2000: ['ferrari', 'F1-2000', 'Ferrari'], 2001: ['ferrari', 'F2001', 'Ferrari'],
  2002: ['ferrari', 'F2002', 'Ferrari'], 2003: ['ferrari', 'F2003-GA', 'Ferrari'], 2004: ['ferrari', 'F2004', 'Ferrari'],
  2005: ['renault', 'R25', 'Renault'], 2006: ['renault', 'R26', 'Renault', 'Tuned mass damper (banned mid-season)'],
  2007: ['ferrari', 'F2007', 'Ferrari'], 2008: ['ferrari', 'F2008', 'Ferrari'],
  2009: ['brawn', 'BGP 001', 'Mercedes', 'Double diffuser'], 2010: ['red_bull', 'RB6', 'Renault', 'Exhaust-blown diffuser'],
  2011: ['red_bull', 'RB7', 'Renault', 'Off-throttle blown diffuser'], 2012: ['red_bull', 'RB8', 'Renault'],
  2013: ['red_bull', 'RB9', 'Renault'], 2014: ['mercedes', 'F1 W05 Hybrid', 'Mercedes', 'Split turbo (compressor and turbine at opposite ends)'],
  2015: ['mercedes', 'F1 W06 Hybrid', 'Mercedes'], 2016: ['mercedes', 'F1 W07 Hybrid', 'Mercedes'],
  2017: ['mercedes', 'F1 W08 EQ Power+', 'Mercedes'], 2018: ['mercedes', 'F1 W09 EQ Power+', 'Mercedes'],
  2019: ['mercedes', 'F1 W10 EQ Power+', 'Mercedes'], 2020: ['mercedes', 'F1 W11 EQ Performance', 'Mercedes', 'Dual-axis steering (DAS)'],
  2021: ['mercedes', 'F1 W12 E Performance', 'Mercedes'], 2022: ['red_bull', 'RB18', 'Red Bull Powertrains (Honda)'],
  2023: ['red_bull', 'RB19', 'Honda RBPT'], 2024: ['mclaren', 'MCL38', 'Mercedes'], 2025: ['mclaren', 'MCL39', 'Mercedes'],
  2026: ['red_bull', 'RB22', 'Red Bull Ford'],
};

let D;  // the deck's elements

const badge = (k, v) => el('span', {class: 'cdbadge'}, el('small', {}, k), el('b', {}, v));

export function setupCarsDeck(stage, top) {
  D = {chips: el('div', {class: 'csera', role: 'group', 'aria-label': 'Era'}), grid: el('div', {class: 'cdgrid csgrid'}),
       canvas: el('div', {class: 'csview', 'aria-label': '3D car preview, drag to orbit'}), team: el('select', {class: 'neu', 'aria-label': 'Team livery'}),
       spec: el('div', {class: 'cdbadges'}), stats: el('div', {class: 'csstats'}), title: el('div', {class: 'cstitle'}), year: null};
  D.race = el('button', {class: 'neu', onclick: () => { toggle(false); dispatchEvent(new CustomEvent('f1:circuit', {detail: {year: D.year, round: 1}})); }},
    'Race this era');
  D.team.onchange = () => showTeam();
  D.btn = el('button', {class: 'neu cdbtn', 'aria-expanded': false, 'aria-controls': 'carsdeck', onclick: () => toggle()}, led(), 'CARS');
  D.panel = el('section', {class: 'glass circuitdeck carsdeck', id: 'carsdeck', hidden: true, 'aria-label': 'Car showroom'},
    el('header', {class: 'pwhead'}, el('div', {class: 'phead'}, 'CAR SHOWROOM'),
      el('small', {class: 'cdsub'}, 'Champions by era: specs, season results, studio view'),
      el('button', {class: 'neu cdclose', 'aria-label': 'Close car showroom', onclick: () => toggle(false)}, '✕')),
    D.chips,
    el('div', {class: 'csbody'}, D.grid,
      el('aside', {class: 'csdetail'}, D.title, D.canvas, el('label', {class: 'csteam'}, el('small', {}, 'LIVERY'), D.team), D.spec, D.stats, D.race)));
  D.focus = panelFocus(D.panel, D.btn, () => toggle(false));
  // one big panel at a time: another one opening (circuits, cars, telemetry trace) closes this one
  addEventListener('f1:panel', e => { if (e.detail !== D.panel && !D.panel.hidden) toggle(false, false); });
  D.chips.append(...ERAS.map(([name, from, to]) => el('button', {class: 'neu', 'aria-pressed': false, onclick: () => era(from)}, `${name} ${from}${to > from ? `–${String(to).slice(2)}` : ''}`)));
  top.append(D.btn);
  stage.append(D.panel);
}

let opening = null;  // the showroom's device and scene, ready to show a car

// C opens and closes it from anywhere on the stage
export const toggleCars = () => toggle();
// a link's car (share.js car): the deck open on that season's champion
export function openCar(year) {
  if (!CARS[year] || !D) return;
  if (D.panel.hidden) { D.year = year; toggle(true); }
  era(ERAS.find(e => year >= e[1] && year <= e[2])[1], year);
}
const address = car => dispatchEvent(new CustomEvent('f1:address', {detail: car ? {car} : {}}));  // the open car is in the address

function toggle(open = D.panel.hidden, restore = true) {
  D.panel.hidden = !open;
  if (open) dispatchEvent(new CustomEvent('f1:panel', {detail: D.panel}));
  D.btn.setAttribute('aria-expanded', open);
  if (!open) { closeShowroom(); D.focus.closed(restore); address(null); return; }
  D.focus.opened();
  opening = openShowroom(D.canvas);
  if (D.year === null) era(2026);
}

// one card per season of the era starting `from`; year: the one to show, else the era's last
function era(from, year) {
  const [, , to] = ERAS.find(e => e[1] === from);
  [...D.chips.children].forEach((b, i) => b.setAttribute('aria-pressed', ERAS[i][1] === from));
  const cards = [];
  for (let y = from; y <= to; y++) {
    const [team, chassis] = CARS[y], e = engine(y);
    cards.push(el('button', {class: 'cdcard cscard', 'data-year': y, style: `--team: ${teamColor(team)}`, onclick: () => pick(y)},
      el('div', {class: 'cdtitle'}, el('b', {}, chassis), el('span', {class: 'cdtag'}, y === 2026 ? '3D MODEL' : 'CHAMPION')),
      el('div', {class: 'cdname'}, `${y} · ${e.name}`)));
  }
  D.grid.replaceChildren(...cards);
  pick(year ?? to);
}

async function pick(year) {
  D.year = year;
  address(year);
  for (const c of D.grid.children) c.setAttribute('aria-current', c.dataset.year === String(year));
  const [team, chassis, supplier, note] = CARS[year], e = engine(year), s = spec(year);
  const hp = Math.round((e.pIce + e.pK) / 745.7 / 10) * 10;
  D.title.replaceChildren(el('b', {}, chassis), el('small', {}, ` ${year}`));
  D.spec.replaceChildren(...[badge('ENGINE', `${supplier} ${e.name}`), badge('REV LIMIT', `${e.rpmMax.toLocaleString()} rpm`),
    badge('POWER', `≈${hp} hp`), badge('MIN WEIGHT', `${e.minMass} kg`), badge('POWER / WEIGHT', `≈${(hp / e.minMass).toFixed(2)} hp/kg`),
    badge('WHEELBASE', `≈${Math.round(s.wb * 1000)} mm`), badge('RIMS', `${s.inch}"`),
    badge('TYRES', s.grooves ? 'grooved' : 'slick'), badge('ERS', e.pK ? `${e.pK / 1e3} kW` : 'none'), year >= 2026 ? badge('OVERTAKE', 'active aero') : badge('DRS', e.drs ? 'yes' : 'no'),
    note && badge('INNOVATION', note)].filter(Boolean));
  D.team.replaceChildren(new Option(team, team));
  D.stats.replaceChildren(skeleton(3));
  try {
    const [cons, drivers] = await Promise.all(['constructorstandings', 'driverstandings'].map(k => get(`/api/jolpica/${year}/${k}`).then(rows)));
    if (D.year !== year) return;
    D.cons = cons;
    D.drivers = drivers;
    D.team.replaceChildren(...cons.map(c => new Option(`P${c.position} ${c['Constructor.name']}`, c['Constructor.constructorId'])));
    D.team.value = cons.some(c => c['Constructor.constructorId'] === team) ? team : cons[0]?.['Constructor.constructorId'];
  } catch (err) {
    if (D.year !== year) return;
    D.cons = D.drivers = [];
    D.stats.replaceChildren(el('small', {class: 'muted'}, `No season results: ${err.message}`));
  }
  showTeam();
}

// the chosen team's season and colours
function showTeam() {
  const id = D.team.value, c = D.cons?.find(x => x['Constructor.constructorId'] === id);
  if (c) {
    const names = D.drivers.filter(d => d.Constructors?.some(x => x.constructorId === id))
      .map(d => `${d['Driver.givenName']} ${d['Driver.familyName']}${d['Driver.permanentNumber'] ? ` #${d['Driver.permanentNumber']}` : ''} (P${d.position})`);
    D.stats.replaceChildren(badge('CONSTRUCTORS', `P${c.position}${D.year === 2026 ? ' so far' : ''}`), badge('WINS', c.wins), badge('POINTS', c.points),
      el('div', {class: 'csdrivers'}, names.join(' · ')));
  }
  const year = D.year;
  if (year >= 2026) D.title.firstChild.textContent = chassisFor(c?.['Constructor.name'] ?? id);  // the team's own model, or the RB22
  opening.then(() => showCar(teamColor(id), year, c?.['Constructor.name'] ?? id, year >= 2026 ? () => loadRB22([c?.['Constructor.name'] ?? id]).catch(() => {}) : null));  // the procedural 2026 car if the model can't load
}
