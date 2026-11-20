// One entry point for motion. anime.js and theatre.js load on the first motion, never with the page (app.js stays off this path).
import {calm} from './util.js';

let lib = null, core = null;
// tests swap in fakes here: the page's import map names the real libraries, which node can't resolve
export const useLib = m => { lib = m; };
export const useCore = m => { core = m; sheetP = null; };
const anime = async () => lib ??= await import('animejs');

// --spring (style.css) as an anime.js ease, so motion moved here keeps its curve
export async function spring() { return (await anime()).cubicBezier(.22, 1, .36, 1); }

// Plays one anime.js animation and resolves when it ends. Under reduced motion it runs at duration 0, so it ends in the same state.
export async function play(targets, params) {
  const {animate} = await anime();
  return animate(targets, calm() ? {...params, duration: 0, delay: 0} : params);
}

// Rows or cards arrive one after another, 35 ms apart, in the order the list gives them. Only the first 16 are staggered: a long table would take seconds.
export async function stagger(items) {
  const list = [...items].slice(0, 16);
  if (!list.length || calm()) return;
  for (const n of list) n.style.opacity = '0';  // hidden now: on anime.js's first load they would show, vanish, then fade in
  try {
    const {stagger: step} = await anime();
    await play(list, {opacity: [0, 1], translateY: [6, 0], delay: step(35), duration: 360, ease: await spring()});
  } catch { for (const n of list) n.style.opacity = ''; }  // anime.js didn't load: the rows show, still
}

// Figures count up from 0 as their bars grow (.bars .fill: .6s --spring), once; each ends on its own text, decimals kept.
export async function countUp(nodes, duration = 600) {
  const list = [...nodes].filter(n => n.textContent.trim() && isFinite(+n.textContent)), end = list.map(n => n.textContent);
  if (!list.length || calm()) return;
  const dp = end.map(s => s.split('.')[1]?.length ?? 0), at = {f: 0};
  const show = () => list.forEach((n, i) => { n.textContent = (+end[i] * at.f).toFixed(dp[i]); });
  show();
  try { await play(at, {f: 1, duration, ease: await spring(), onUpdate: show}); }
  finally { list.forEach((n, i) => { n.textContent = end[i]; }); }
}

// The globe's flight timing (globemath.js timing): flight.theatre.json, authored as a theatre.js sheet and played back by
// @theatre/core alone (the studio is a dev tool and never ships). sample(f) gives {turn, climb, drop} at f in 0..1.
let sheetP = null;
export function flightSheet() {
  return sheetP ??= (async () => {
    const C = core ??= (await import('@theatre/core')).default;
    const state = await (await fetch('/static/flight.theatre.json')).json();
    const project = C.getProject('lights-out-flight', {state}), sheet = project.sheet('flight');
    const obj = sheet.object('fly', {turn: C.types.number(0, {range: [0, 1]}), climb: C.types.number(0, {range: [0, 1]}), drop: C.types.number(0, {range: [0, 1]})});
    await project.ready;
    return f => { sheet.sequence.position = f; const {turn, climb, drop} = obj.value; return {turn, climb, drop}; };
  })();
}
