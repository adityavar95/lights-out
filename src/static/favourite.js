// The reader's favourite driver (the ★ in their career dialog, drivers.js): pre-focused in replays and first in Results,
// Standings and Drivers. The favourite team is the team colours' (app.js setTeam, 'f1team'). localStorage, like spoilers.js.
const KEY = 'lo-favourite';
export function favourite() {
  try { const f = JSON.parse(localStorage.getItem(KEY)); return f?.id ? f : null; } catch (e) { return null; }  // storage blocked or garbled: none
}
// d: {id (Jolpica driverId), code, name}, or null to forget
export function setFavourite(d) {
  try { if (d) localStorage.setItem(KEY, JSON.stringify({id: d.id, code: d.code ?? null, name: d.name})); else localStorage.removeItem(KEY); } catch (e) { /* not remembered */ }
}
export const favTeam = () => { try { return localStorage.getItem('f1team'); } catch (e) { return null; } };
// rows with the first that isFav at the top, the rest in their order
export function firstOf(rows, isFav) {
  const i = rows.findIndex(isFav);
  return i <= 0 ? rows : [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)];
}
