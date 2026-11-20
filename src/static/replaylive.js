// Live timing on the race screen: F1's free feed, refreshed every second. replay.js owns the view state and passes it in
// through setupLive, because reset() replaces the state object, so it is read through h.S() each time.
import {covered, get, rows} from './util.js';
import {asItStands, POINTS, SPRINT_POINTS} from './season.js';
import {fetchLive, streamLive, liveInfo, liveDrivers, liveFeeds, liveState, liveGps, hasGps, gpsAt, liveCar, resetGps} from './live.js';

// lap fraction -> outline fraction, through the mini-sector boundaries when they match the live feed
function msFrac(ms, f, segments) {
  if (!ms || ms.length - 1 !== segments) return f;
  const n = segments, j = Math.min(n - 1, Math.floor(f * n));
  return ms[j] + (ms[j + 1] - ms[j]) * (f * n - j);
}

export function setupLive(h) {
  const s = () => h.S(), ui = () => h.ui();

  // Live (or most recent) session from F1's free live timing feed, refreshed every second.
  async function showLive() {
    h.reset({live: true, year: new Date().getFullYear()});
    resetGps();
    const token = s().token;
    h.setOverlay('Connecting to F1 live timing…', true);
    let first;
    try {
      // the feed may have nothing yet (just connecting, or F1 hasn't opened the weekend's): asked again until it has
      while (!(first = await fetchLive()).topics.DriverList && token === s().token) {
        h.setOverlay(first.error ? `Live timing unavailable: ${first.error}` : 'No live timing data yet.', true);
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (e) {
      if (token === s().token) h.showFailed(e, showLive);
      return;
    }
    if (token !== s().token) return;
    s().track = await fetch('/api/live/track').then(r => (r.ok ? r.json() : null)).catch(() => null);  // not cached: changes per event
    if (token !== s().token) return;
    h.drawTrack(s().track?.x, s().track?.y, s().track?.rotation ?? 0, s().track?.corners ?? [], !!s().track, 0.1);
    // where each mini-sector starts, as a fraction of the outline (MultiViewer lists the boundaries after the line)
    s().ms = s().track?.minisectors?.length ? [0, ...s().track.minisectors.map(i => s().proj.cum[i] / s().proj.cum.at(-1)), 1] : null;
    const info = liveInfo(first.topics);
    h.prepare({mode: 'live', session: info.title, drivers: liveDrivers(first.topics), intervals: [], duration: 1});
    applyLive(first);
    // a race or sprint: the championship as it stands, as a tower column (replay.js nextColumn offers it once this lands)
    if (info.race) get(`/api/jolpica/${s().year}/driverstandings`).then(rows).then(r => {
      if (token === s().token) s().standings = new Map(r.map(x => [x['Driver.code'], +x.points || 0]));
    }).catch(() => {});
    h.setOverlay('');
    s().playing = true;
    let es = null, opening = false, gen = 0, polling = false;  // the push stream while the tab is visible; the 1 s poll once it fails
    const follow = async () => {
      if (token !== s().token) return document.removeEventListener('visibilitychange', follow);
      if (document.hidden) { gen++; es?.close(); es = null; return; }  // an unseen tab mustn't hold F1's feed open on the server
      if (es || opening || polling) return;
      opening = true;
      const g = ++gen, opened = await streamLive(
        next => { if (token === s().token && next.topics.DriverList) applyLive(next); },
        () => { es = null; polling = true; poll(); });
      opening = false;
      if (g === gen && token === s().token && !document.hidden) es = opened;
      else { opened.close(); follow(); }  // hidden (or shown again) while it opened
    };
    document.addEventListener('visibilitychange', follow);
    follow();
    requestAnimationFrame(function frame() {
      if (token !== s().token) { es?.close(); es = null; return; }
      if (!covered()) h.render(false);
      requestAnimationFrame(frame);
    });
    async function poll() {  // a couple of seconds behind the track at most: feed latency + this 1 s refresh
      while (token === s().token) {
        await new Promise(r => setTimeout(r, 1000));
        if (document.hidden) continue;  // an unseen tab's polls kept F1's feed open on the server for good
        try {
          const next = await fetchLive();
          if (token === s().token && next.topics.DriverList) applyLive(next);
        } catch (e) { /* keep showing the last state; the next poll retries */ }
      }
    }
  }

  function applyLive({topics, auth_error}) {  // one /api/live response
    const info = liveInfo(topics);
    s().live = topics;
    s().liveInfo = info;
    liveGps(topics, Date.now());
    s().liveCar = id => liveCar(topics, id, Date.now());  // live ids are racing numbers, like the feed's keys
    Object.assign(s().data, liveFeeds(topics, info.origin), {race: info.race, total_laps: topics.LapCount?.TotalLaps ?? '–'});
    s().t = (Date.now() - info.origin) / 1000;
    ui().mode.textContent = `${info.live ? '● LIVE' : info.status === 'Inactive' ? 'Next session (not started)' : 'Latest session (finished)'} · ${info.title}${hasGps(Date.now()) ? ' · car GPS' : auth_error ? ` · ${auth_error}` : ''}`;
  }

  function liveRender() {
    const now = Date.now(), st = s(), sv = liveState(st.live, st.drivers, now), cars = {}, ahead = {};
    if (hasGps(now)) {  // real positions (F1 TV); a car without one is in the garage or has stopped sending
      for (const d of st.drivers) {
        const p = gpsAt(d.id, now), q = gpsAt(d.id, now, 500);
        if (p && q) { cars[d.id] = st.proj.rot(...p); ahead[d.id] = st.proj.rot(...q); }
      }
    } else for (const id in sv.fracs) {
      cars[id] = h.pointAt(msFrac(st.ms, sv.fracs[id], sv.segments));
      ahead[id] = h.pointAt(msFrac(st.ms, sv.ahead[id], sv.segments));
    }
    if (st.standings) {  // recomputed only when the order changes
      const key = sv.board.map(b => `${b.d.code}${b.pos}${b.out}`).join();
      if (key !== st.champKey) {
        st.champKey = key;
        st.champ = asItStands(st.standings, sv.board.map(b => ({code: b.d.code, pos: b.pos, out: b.out})),
                              st.live.SessionInfo?.Name === 'Sprint' ? SPRINT_POINTS : POINTS);
      }
      for (const b of sv.board) b.champ = st.champ.get(b.d.code);
    }
    return {cars, ahead, board: sv.board, lap: sv.lap};
  }

  return {showLive, liveRender};
}
