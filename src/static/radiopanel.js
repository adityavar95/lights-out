// Team radio for the whole field in one panel over the F1 TV viewer (the user's design: one radio box for every
// driver, not one per onboard tile): a grid of driver profiles (F1's headshot in a team-colour ring, code, message
// count; a card glows for FRESH s after that driver speaks), then the messages, newest first, with their words
// (radio.py, transcribed on the server) and a play button. A driver's card plays their latest message and filters the
// list to them. See-through glass, more so while the mouse is elsewhere, so it doesn't spoil the picture under it.
import {el, tvHeaders} from './util.js';
import {icon} from './tvcontrols.js';

const FRESH = 90;  // s a message counts as just said
const POLL = 8000;  // ms between asks while a session is live or clips are still being transcribed

// the messages said by the playhead's time: a replay's list grows as the video plays, so it never tells what's coming
export const radioList = (clips, wall) => clips.filter(c => c.t <= wall);

const hex = c => c ? (c.startsWith('#') ? c : `#${c}`) : '#888';
const clock = t => new Date(t * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});

// wall(): the wall clock (unix s) at the playhead of the stream being watched, or null; live(): whether it's live;
// streams(): the video's streams (F1 TV's driver order and team colours); duck(on): the stream's sound down under a clip
export function radioPanel({wall, live, streams, duck, json}) {
  const R = {clips: [], drivers: {}, sel: null, auto: false, heard: null, seen: 0, playing: null, open: false};
  const count = el('span', {class: 'n'});
  const btn = el('button', {class: 'mvbtn mvradiobtn', hidden: true, 'aria-pressed': 'false', 'aria-controls': 'mvradiopanel',
    title: 'Team radio: every driver, transcribed', onclick: () => toggle()}, icon('radio'), 'Radio', count);
  const sub = el('small', {});
  const autoBtn = el('button', {class: 'mvrpauto', role: 'switch', 'aria-checked': 'false', title: 'Play each new message as it comes in',
    onclick: () => { R.auto = !R.auto; autoBtn.setAttribute('aria-checked', String(R.auto)); }}, icon('vol'), 'Auto-play');
  const all = el('button', {class: 'mvrpall', hidden: true, title: 'Every driver again', onclick: () => select(R.sel)}, 'All drivers');
  const grid = el('div', {class: 'mvrpgrid', role: 'group', 'aria-label': 'Drivers'});
  const feed = el('ol', {class: 'mvrpfeed', 'aria-label': 'Team radio messages', 'aria-live': 'polite'});
  // the words come from a 2.5 GB speech model: asked for here, never fetched unasked (the clips play without it)
  const need = el('div', {class: 'mvrpneed', role: 'note', hidden: true});
  // shortcut: a refused POST (403, 500) leaves the note as it was with no message; say why if that's ever seen
  const getModel = async () => {
    await fetch('/api/f1tv/radio/model', {method: 'POST'}).catch(() => {});
    poll();  // says downloading, or why it isn't
  };
  const root = el('aside', {class: 'mvrp', id: 'mvradiopanel', hidden: true, 'aria-label': 'Team radio'},
    el('header', {}, el('div', {class: 'mvrptitle'}, el('b', {}, 'Team radio'), sub), all, autoBtn,
      el('button', {class: 'mvibtn', title: 'Close', 'aria-label': 'Close team radio', onclick: () => toggle(false)}, icon('close'))),
    grid, need, feed);

  function toggle(on = !R.open) {
    R.open = on;
    root.hidden = !on;
    btn.setAttribute('aria-pressed', String(on));
    R.shown = undefined;  // drawn on the next tick
  }

  async function poll() {
    clearTimeout(R.timer);
    const url = R.url;
    try {
      const r = await json(url);
      if (url !== R.url) return;  // another video meanwhile
      R.clips = r.clips.filter(c => c.text !== '');  // a transcribed clip with no words (a click, engine noise) isn't a message
      R.drivers = r.drivers ?? {};
      R.words = r.transcribe;
      R.model = r.model;
      R.error = r.error;
      R.fails = 0;
      // the tiles may not have loaded yet when it opens, so it keeps asking, just less often off a live session
      R.timer = setTimeout(poll, r.pending || live() || r.model === 'downloading' ? POLL : 30000);
    } catch (e) {
      if (url !== R.url) return;
      R.error = e.message;
      R.fails = (R.fails ?? 0) + 1;
      R.timer = setTimeout(poll, Math.min(POLL * 2 ** R.fails, 120000));  // 16 s, 32 s… up to 2 min
    }
    R.shown = undefined;
  }

  // every driver of the video, in F1 TV's order, with what the radio feed knows of them (code, headshot, colour)
  function roster() {
    const obc = (streams() ?? []).filter(s => s.type === 'obc' && s.number);
    const nums = [...new Set([...obc.map(s => +s.number), ...Object.keys(R.drivers).map(Number).sort((a, b) => a - b)])];
    return nums.map(n => {
      const s = obc.find(x => +x.number === n), d = R.drivers[n] ?? {};
      return {n, tla: d.tla ?? s?.title ?? String(n), name: d.name ?? s?.driver ?? s?.title, team: d.team ?? s?.team,
        colour: hex(d.colour ?? s?.hex), face: d.headshot};
    });
  }

  function select(n) {
    R.sel = R.sel === n ? null : n;
    R.shown = undefined;
    if (R.sel == null) return;
    const said = radioList(R.clips, wall() ?? Infinity).filter(c => c.driver === n);
    if (said.length && R.playing?.url !== said.at(-1).url) play(said.at(-1).url);
  }

  // drawn only when what it shows changes; called every frame by the viewer
  function tick() {
    const w = wall();
    if (w == null) return;
    const said = radioList(R.clips, w);
    if (R.heard == null && R.clips.length) R.heard = said.at(-1)?.t ?? 0;  // what's said before opening isn't auto-played
    const fresh = said.filter(c => c.t > R.heard);
    if (fresh.length) {
      R.heard = fresh.at(-1).t;
      if (R.auto && !R.playing) play(fresh.at(-1).url);
    }
    if (R.open) R.seen = said.length;
    count.textContent = said.length > R.seen ? said.length - R.seen : '';  // unread while the panel was shut
    if (!R.open) return;
    const key = [said.length, said.map(c => `${c.text}${c.error}`).join(), R.sel, R.playing?.url, R.error, R.model, Math.floor(w / 10)].join('|');
    if (key === R.shown) return;
    R.shown = key;
    const ready = R.model === 'ready', ask = R.words && R.model && !ready;
    need.hidden = !ask;
    if (ask) need.replaceChildren(
      el('span', {}, R.model === 'downloading' ? 'Downloading the speech model (2.5 GB). Messages get their words once it\'s here.'
        : R.model === 'failed' ? 'The speech model\'s download stopped. What it has is kept.'
        : 'Words for each message need a speech model: a 2.5 GB download, once. Messages play without it.'),
      R.model === 'downloading' ? '' : el('button', {class: 'mvrpall', onclick: getModel}, R.model === 'failed' ? 'Try again' : 'Download'));
    const people = roster(), by = new Map(people.map(p => [p.n, p]));
    // a failure (a clip that wouldn't play, the radio feed) shows here, not only in an empty list
    sub.textContent = R.error ?? (said.length ? `${said.length} message${said.length > 1 ? 's' : ''} · ${new Set(said.map(c => c.driver)).size} drivers` : '');
    all.hidden = R.sel == null;
    grid.replaceChildren(...people.map(p => {
      const mine = said.filter(c => c.driver === p.n), last = mine.at(-1);
      const cls = ['mvrd', mine.length ? '' : 'quiet', last && w - last.t < FRESH ? 'fresh' : '', R.sel === p.n ? 'sel' : '',
        R.playing && R.clips.find(c => c.url === R.playing.url)?.driver === p.n ? 'onair' : ''].filter(Boolean).join(' ');
      return el('button', {class: cls, style: `--c:${p.colour}`, 'aria-pressed': String(R.sel === p.n),
        title: `${p.name ?? p.tla}${p.team ? ` · ${p.team}` : ''}: ${mine.length ? `${mine.length} message${mine.length > 1 ? 's' : ''}, click to hear the latest` : 'no radio yet'}`,
        onclick: () => select(p.n)},
        el('span', {class: 'face'}, p.face ? el('img', {src: p.face, alt: '', loading: 'lazy', decoding: 'async', onerror: e => e.target.remove()}) : '', el('i', {}, p.n)),
        el('b', {}, p.tla), mine.length ? el('span', {class: 'n'}, mine.length) : '');
    }));
    const shown = said.filter(c => R.sel == null || c.driver === R.sel).reverse();
    feed.replaceChildren(...shown.map(c => {
      const p = by.get(c.driver) ?? {tla: String(c.driver), colour: '#888'}, on = R.playing?.url === c.url;
      return el('li', {style: `--c:${p.colour}`, class: on ? 'onair' : ''},
        el('button', {class: 'mvplay', 'data-url': c.url, title: on ? 'Stop' : 'Play this message', 'aria-label': on ? 'Stop' : `Play ${p.tla}'s message`,
          onclick: () => play(c.url)}, icon(on ? 'pause' : 'play')),
        el('div', {}, el('b', {}, p.tla), el('time', {}, clock(c.t))),
        el('p', {class: c.text ? '' : 'wait'}, c.text ?? c.error ?? (R.words && ready ? 'Transcribing…' : 'Team radio')));
    }), ...(shown.length ? [] : [el('li', {class: 'none'}, R.error ?? (R.sel != null ? 'No radio from this driver yet' : 'No radio yet'))]));
  }

  // one clip at a time, fetched with this tab's F1 TV token (an <audio src> can't send it); again on the playing one stops it
  function stop() {
    R.playing?.abort.abort();
    R.playing?.audio?.pause();  // its onpause tidies up
    if (R.playing) duck(false);
    R.playing = null;
    R.shown = undefined;
  }
  async function play(url) {
    const same = R.playing?.url === url;
    stop();
    if (same) return;
    const me = R.playing = {url, abort: new AbortController()};
    R.shown = undefined;
    try {
      const r = await fetch(`/api/f1tv/radio/audio?${new URLSearchParams({u: url})}`, {headers: tvHeaders(), signal: me.abort.signal});
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      const src = URL.createObjectURL(await r.blob()), audio = me.audio = new Audio(src);
      audio.onended = audio.onpause = () => {
        URL.revokeObjectURL(src);
        if (R.playing !== me) return;
        R.playing = null;
        duck(false);
        R.shown = undefined;
      };
      duck(true);
      await audio.play();
    } catch (e) {
      if (R.playing !== me) return;  // stopped or replaced: not a failure
      R.playing = null;
      duck(false);
      R.error = `Couldn't play that message: ${e.message}`;
      R.shown = undefined;
    }
  }

  return {
    btn, root, tick,
    // a video opens: its session's radio (2023+; F1 TV videos with no session have none)
    open(video, session) {
      stop();
      Object.assign(R, {clips: [], drivers: {}, sel: null, heard: null, seen: 0, error: null, shown: undefined,
        url: session ? `/api/f1tv/radio/${video.year}/${video.round}?session=${encodeURIComponent(session)}` : null});
      btn.hidden = !session;
      if (!session) { toggle(false); clearTimeout(R.timer); return; }
      poll();
    },
    close() {
      clearTimeout(R.timer);
      R.url = null;
      stop();
    },
    poll,
  };
}
