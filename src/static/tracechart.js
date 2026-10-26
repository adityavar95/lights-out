// The telemetry trace plot: five channels stacked on one shared lap-distance axis (Δt, speed, throttle, brake,
// RPM + gear), drawn on a 2D canvas. Two canvases sit on top of each other: the traces (redrawn a few times a second
// at most) and the crosshair (redrawn on mouse move), so scrubbing never repaints 2,500 points per lap.
//
// High-DPI: the canvas backing store is CSS size x devicePixelRatio and the context is scaled by the same factor
// (setTransform in tracemodal.js), so every coordinate here is in CSS pixels yet lines stay 1 device pixel sharp.
import {N, apexes} from './trace.js';
import {SECTOR_COLORS} from './hud.js';

const HEAD = 26, FOOT = 18, LEFT = 46, RIGHT = 12, GAP = 8;
// [title, relative height]
const PANELS = [['Δt  s', 1.1], ['SPEED  km/h', 1.45], ['THROTTLE  %', 0.8], ['BRAKE  %', 0.8], ['RPM · GEAR', 1.1]];
const GRID = 'rgb(255 255 255 / .07)', INK = 'rgb(238 240 246 / .85)', MUTED = 'rgb(139 144 160 / .9)', DRS = 'rgb(47 208 111 / .13)';

// panel rectangles for a w x h canvas, and x <-> lap fraction for the zoom window [x0, x1]
export function layout(w, h, x0, x1) {
  const total = PANELS.reduce((s, p) => s + p[1], 0), free = h - HEAD - FOOT - GAP * (PANELS.length - 1);
  let y = HEAD;
  const panels = PANELS.map(([title, k]) => { const r = {title, y, h: free * k / total}; y += r.h + GAP; return r; });
  const W = w - LEFT - RIGHT;
  return {panels, L: LEFT, W, X: i => LEFT + (i / N - x0) / (x1 - x0) * W, frac: px => x0 + (px - LEFT) / W * (x1 - x0)};
}

// polyline through arr[i0..i1], lifting the pen over NaN (not driven yet); step: hold each value to the next sample
function trace(ctx, arr, X, Y, i0, i1, step = false) {
  ctx.beginPath();
  let pen = false, py = 0;
  for (let i = i0; i <= i1; i++) {
    const v = arr[i];
    if (Number.isNaN(v)) { pen = false; continue; }
    const x = X(i), y = Y(v);
    if (!pen) ctx.moveTo(x, y);
    else { if (step) ctx.lineTo(x, py); ctx.lineTo(x, y); }
    pen = true;
    py = y;
  }
  ctx.stroke();
}

// v: {A, B (laps or null), colA, colB, nameA, nameB, len, x0, x1, corners [{i, label}], rpmMax, dt (Float32Array Δt)};
// sets v.vTop (the speed axis ceiling) for drawCursor
export function drawTrace(ctx, w, h, v) {
  const {panels, L, W, X} = layout(w, h, v.x0, v.x1);
  const i0 = Math.max(0, Math.floor(v.x0 * N) - 1), i1 = Math.min(N - 1, Math.ceil(v.x1 * N) + 1);
  const laps = [[v.A, v.colA, []], [v.B, v.colB, [6, 4]]].filter(l => l[0]);  // B dashed
  ctx.clearRect(0, 0, w, h);
  ctx.font = '600 10px "Titillium Web", system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  // distance ticks: the round step that gives ~8 labels across the window
  const span = (v.x1 - v.x0) * v.len, stepM = [25, 50, 100, 200, 250, 500, 1000, 2000].find(s => span / s <= 9) ?? 2000;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  for (let m = Math.ceil(v.x0 * v.len / stepM) * stepM; m <= v.x1 * v.len; m += stepM) {
    const x = X(m / v.len * N);
    ctx.fillStyle = GRID;
    ctx.fillRect(x, HEAD, 1, h - HEAD - FOOT);
    ctx.fillStyle = MUTED;
    ctx.fillText(m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 2 : 0)} km` : `${m} m`, x, h - FOOT / 2);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(L, 0, W, h);
  ctx.clip();  // traces and labels never spill into the y-axis gutter when zoomed
  // sector boundaries (the simulation times thirds of the lap) and corner labels along the top
  for (const [k, f] of [[1, 1 / 3], [2, 2 / 3]]) {
    const x = X(f * N);
    ctx.fillStyle = SECTOR_COLORS[k];
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x, HEAD - 4, 1, h - HEAD - FOOT + 4);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
  [0, 1, 2].forEach(k => {
    const x = Math.max(L + 2, X(k / 3 * N) + 3);
    ctx.fillStyle = SECTOR_COLORS[k];
    ctx.fillText(`S${k + 1}`, x, 7);
  });
  let right = -Infinity;
  for (const c of v.corners) {
    const x = X(c.i);
    if (x < L - 40 || x > L + W + 40) continue;
    ctx.fillStyle = 'rgb(255 255 255 / .22)';
    ctx.fillRect(x, HEAD - 6, 1, 6);
    const tw = ctx.measureText(c.label).width;
    if (x - tw / 2 < right + 6) continue;  // labels that would overlap the previous one are dropped, not stacked
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(c.label, x, HEAD - 13);
    right = x + tw / 2;
  }
  ctx.restore();

  const [pDt, pV, pThr, pBrk, pRpm] = panels;
  const Yof = (p, lo, hi) => val => p.y + p.h - (val - lo) / (hi - lo) * p.h;
  const frame = (p, lo, hi, ticks, fmt = x => x) => {
    ctx.fillStyle = 'rgb(255 255 255 / .025)';
    ctx.fillRect(L, p.y, W, p.h);
    const Y = Yof(p, lo, hi);
    ctx.textAlign = 'right';
    for (const t of ticks) {
      ctx.fillStyle = GRID;
      ctx.fillRect(L, Math.round(Y(t)), W, 1);
      ctx.fillStyle = MUTED;
      ctx.fillText(fmt(t), L - 6, Y(t));
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.fillText(p.title, L + 6, p.y + 8);
    return Y;
  };
  const plot = (p, Y, key, opts = {}) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(L, p.y, W, p.h);
    ctx.clip();
    ctx.lineWidth = opts.width ?? 1.6;
    ctx.lineJoin = 'round';
    for (const [lap, col, dash] of laps) {
      ctx.strokeStyle = col;
      ctx.setLineDash(dash);
      ctx.globalAlpha = opts.alpha ?? 1;
      // B gets a soft glow so a teammate (cyan) or a reference lap reads apart from A where they overlap
      ctx.shadowColor = dash.length ? col : 'transparent';
      ctx.shadowBlur = dash.length ? 5 : 0;
      trace(ctx, lap[key], X, Y, i0, i1, opts.step);
    }
    ctx.restore();
  };

  // 1. Δt: symmetric scale round zero; area above the line = A ahead (B's time at that metre is larger), below = B
  const vis = [];
  for (let i = i0; i <= i1; i++) if (!Number.isNaN(v.dt[i])) vis.push(Math.abs(v.dt[i]));
  const m = Math.max(0.05, ...vis) * 1.15, tick = m > 2 ? 1 : m > 0.6 ? 0.25 : 0.05;
  const ticks = [];
  for (let t = -Math.floor(m / tick) * tick; t <= m; t += tick) ticks.push(+t.toFixed(3));
  const Ydt = frame(pDt, -m, m, ticks, t => (t > 0 ? `+${t.toFixed(2)}` : t.toFixed(2)));
  if (v.A && v.B) {
    const zero = Ydt(0);
    const fill = (col, top) => {  // closed path of the curve down to the zero line, clipped to one side of it
      ctx.save();
      ctx.beginPath();
      ctx.rect(L, top ? pDt.y : zero, W, top ? zero - pDt.y : pDt.y + pDt.h - zero);
      ctx.clip();
      const g = ctx.createLinearGradient(0, zero, 0, top ? pDt.y : pDt.y + pDt.h);
      g.addColorStop(0, `${col}10`);
      g.addColorStop(1, `${col}66`);
      ctx.fillStyle = g;
      ctx.beginPath();
      let open = false, lastX = 0;
      for (let i = i0; i <= i1; i++) {
        const d = v.dt[i];
        if (Number.isNaN(d)) { if (open) { ctx.lineTo(lastX, zero); ctx.closePath(); open = false; } continue; }
        const x = X(i);
        if (!open) { ctx.moveTo(x, zero); open = true; }
        ctx.lineTo(x, Ydt(d));
        lastX = x;
      }
      if (open) { ctx.lineTo(lastX, zero); ctx.closePath(); }
      ctx.fill();
      ctx.restore();
    };
    fill(hex(v.colA), true);
    fill(hex(v.colB), false);
    ctx.save();
    ctx.beginPath();
    ctx.rect(L, pDt.y, W, pDt.h);
    ctx.clip();
    ctx.fillStyle = 'rgb(255 255 255 / .35)';
    ctx.fillRect(L, zero, W, 1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    trace(ctx, v.dt, X, Ydt, i0, i1);
    ctx.restore();
    ctx.textAlign = 'right';
    ctx.fillStyle = v.colA;
    ctx.fillText(`▲ ${v.nameA} ahead`, L + W - 6, pDt.y + 8);
    ctx.fillStyle = v.colB;
    ctx.fillText(`▼ ${v.nameB} ahead`, L + W - 6, pDt.y + pDt.h - 8);
  }

  // 2. speed, with DRS / overtake bands (A in the upper half of the panel, B in the lower), speed trap and apexes
  let top = 0;
  for (const [lap] of laps) for (let i = 0; i < N; i++) if (lap.kmh[i] > top) top = lap.kmh[i];
  const vTop = v.vTop = Math.max(370, Math.ceil((top + 10) / 10) * 10), Yv = frame(pV, 0, vTop, [0, 100, 200, 300]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(L, pV.y, W, pV.h);
  ctx.clip();
  laps.forEach(([lap], k) => {
    ctx.fillStyle = DRS;
    for (let i = i0; i <= i1; i++) {
      if (!(lap.drs[i] === 1 || lap.ers[i] === 3)) continue;
      let j = i;
      while (j + 1 <= i1 && (lap.drs[j + 1] === 1 || lap.ers[j + 1] === 3)) j++;
      ctx.fillRect(X(i), pV.y + k * pV.h / 2, X(j + 1) - X(i), pV.h / 2);
      i = j;
    }
  });
  ctx.restore();
  plot(pV, Yv, 'kmh');
  ctx.save();
  ctx.beginPath();
  ctx.rect(L, pV.y, W, pV.h);
  ctx.clip();
  laps.forEach(([lap, col], k) => {
    let peak = -1;
    for (let i = 0; i < N; i++) if (!Number.isNaN(lap.kmh[i]) && (peak < 0 || lap.kmh[i] > lap.kmh[peak])) peak = i;
    if (peak >= 0) badge(ctx, X(peak), Yv(lap.kmh[peak]) + (k ? 12 : -12), `${Math.round(lap.kmh[peak])} km/h`, col);
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    for (const i of apexes(lap)) {  // minimum corner speed: a small marker, A's value above the trace, B's below
      const x = X(i), y = Yv(lap.kmh[i]);
      if (x < L || x > L + W) continue;
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y + (k ? 5 : -5));
      ctx.lineTo(x + 3.5, y + (k ? 5 : -5));
      ctx.lineTo(x, y);
      ctx.fill();
      ctx.fillText(Math.round(lap.kmh[i]), x, y + (k ? 13 : -12));
    }
  });
  ctx.restore();

  // 3. / 4. pedals
  plot(pThr, frame(pThr, 0, 100, [0, 50, 100]), 'throttle');
  plot(pBrk, frame(pBrk, 0, 100, [0, 50, 100]), 'brake');

  // 5. RPM (ceiling from the eras compared: 15k for a V6 hybrid, up to 20k for a V8) with the gear as a stepped trace
  const Yr = frame(pRpm, 0, v.rpmMax, [0, v.rpmMax / 2, v.rpmMax], t => `${t / 1000}k`);
  plot(pRpm, Yr, 'rpm', {width: 1.3});
  const Yg = Yof({y: pRpm.y + 4, h: pRpm.h - 8}, 0.5, 8.5);
  plot(pRpm, Yg, 'gear', {width: 1.1, alpha: 0.55, step: true});
  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  for (const g of [1, 4, 8]) ctx.fillText(g, L + W + 2, Yg(g));
}

// crosshair at bucket i: a laser line through every panel and a dot on each trace
export function drawCursor(ctx, w, h, v, i) {
  ctx.clearRect(0, 0, w, h);
  if (i === null) return;
  const {panels, X} = layout(w, h, v.x0, v.x1), x = X(i);
  ctx.fillStyle = 'rgb(255 60 80 / .9)';
  ctx.shadowColor = 'rgb(255 60 80)';
  ctx.shadowBlur = 6;
  ctx.fillRect(Math.round(x), HEAD - 6, 1, h - HEAD - FOOT + 6);
  ctx.shadowBlur = 0;
  const [, pV, pThr, pBrk, pRpm] = panels;
  const dot = (p, lo, hi, val, col) => {
    if (Number.isNaN(val)) return;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, p.y + p.h - (val - lo) / (hi - lo) * p.h, 3, 0, 2 * Math.PI);
    ctx.fill();
  };
  for (const [lap, col] of [[v.A, v.colA], [v.B, v.colB]]) {
    if (!lap) continue;
    dot(pV, 0, v.vTop, lap.kmh[i], col);
    dot(pThr, 0, 100, lap.throttle[i], col);
    dot(pBrk, 0, 100, lap.brake[i], col);
    dot(pRpm, 0, v.rpmMax, lap.rpm[i], col);
  }
}

function badge(ctx, x, y, text, col) {
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgb(10 11 16 / .85)';
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 7, w, 14, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

// '#3671C6' (or '#36c') -> '#3671c6', so an alpha suffix can be appended
function hex(c) {
  const s = c.replace('#', '');
  return `#${s.length === 3 ? [...s].map(x => x + x).join('') : s.slice(0, 6)}`;
}
