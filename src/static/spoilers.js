// Spoiler-free mode: a race run in the last WINDOW days shows no result (podium, Results, Lap chart, Strategy lab,
// Standings, Drivers) until its replay has played to the flag or the reader asks. Older races are history, not spoilers.
const WINDOW = 30, KEPT = 60;
const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };  // storage blocked: the mode stays off
const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not remembered */ } };
const revealed = () => { try { return JSON.parse(read('lo-revealed')) ?? []; } catch (e) { return []; } };

export const spoilerFree = () => read('lo-spoilers') === '1';
export const setSpoilerFree = on => write('lo-spoilers', on ? '1' : '0');
// date, today: yyyy-mm-dd. A race still to run has nothing to spoil.
export const recent = (date, today, days = WINDOW) => date <= today && (Date.parse(today) - Date.parse(date)) / 864e5 <= days;
export const hides = (year, round, date, today = new Date().toISOString().slice(0, 10)) =>
  spoilerFree() && recent(date, today) && !revealed().includes(`${year}/${round}`);
export const reveal = (year, round) => write('lo-revealed', JSON.stringify([...new Set([...revealed(), `${year}/${round}`])].slice(-KEPT)));
