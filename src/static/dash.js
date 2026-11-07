// The steering wheel's screen in the cockpit view: readings drawn on a canvas that rb22.js shows on the model's LCD.
export const LEDS = 15, RPM_LOW = 9500, RPM_HIGH = 12300;  // shift lights start at RPM_LOW and are all lit at RPM_HIGH
export const TYRE = {SOFT: ['S', '#ff2d2d'], MEDIUM: ['M', '#ffd400'], HARD: ['H', '#f2f2f2'], INTERMEDIATE: ['I', '#3ec455'], WET: ['W', '#2b8cff']};
export const FLAG = {GREEN: '#2fd06f', YELLOW: '#ffd400', SC: '#ffd400', 'SC IN': '#ffd400', VSC: '#ffd400', 'VSC ENDING': '#ffd400', RED: '#ff2020'};
const W = 384, H = 224, EVERY = 66;  // ms between redraws: each one uploads the texture

export const ledsLit = rpm => (rpm ? Math.round(Math.min(1, Math.max(0, (rpm - RPM_LOW) / (RPM_HIGH - RPM_LOW))) * LEDS) : 0);

let canvas = null, ctx = null, shown = '', at = 0;
export const dash = {drawn: null};  // rb22.js: marks its texture for upload

export function dashCanvas() {
  if (!canvas) {
    canvas = Object.assign(document.createElement('canvas'), {width: W, height: H});
    ctx = canvas.getContext('2d');
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);
  }
  return canvas;
}

// d: {speed, gear, rpm, throttle, brake, drs, lap, total, pos, gap, tyre, status, estimated}
export function drawDash(d) {
  const now = performance.now();
  if (!dash.drawn || now - at < EVERY) return;
  const speed = d.speed == null ? '–' : String(Math.round(d.speed)), gear = d.gear === 0 ? 'N' : String(d.gear ?? '–'), lit = ledsLit(d.rpm);
  const lap = d.lap ? `L${d.lap}${d.total ? `/${d.total}` : ''}` : '–', pos = d.pos && d.pos < 99 ? `P${d.pos}` : '–', ty = TYRE[d.tyre];
  const key = [speed, gear, lit, lap, pos, d.gap, d.tyre, d.drs, d.status, Math.round((d.throttle ?? 0) / 5), !!d.brake].join();
  if (key === shown) return;
  shown = key;
  at = now;
  dashCanvas();
  const c = ctx, text = (s, x, y, size, color = '#f2f2f2', align = 'center') => {
    c.font = `500 ${size}px "Geist Mono", monospace`;
    c.textAlign = align;
    c.fillStyle = color;
    c.fillText(s, x, y);
  };
  c.fillStyle = '#05070a';
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'middle';
  // the race's flag along the top edge, then the shift lights
  c.fillStyle = FLAG[d.status] || '#05070a';
  c.fillRect(0, 0, W, 6);
  for (let i = 0; i < LEDS; i++) {
    c.fillStyle = i >= lit ? '#1b1e24' : i < 5 ? '#2fd06f' : i < 10 ? '#ff2d2d' : '#3d7bff';
    c.beginPath();
    c.arc(34 + i * (W - 68) / (LEDS - 1), 22, 9, 0, 7);
    c.fill();
  }
  // pedals: brake on the left edge, throttle on the right, filling upward
  const bar = (x, share, color) => {
    c.fillStyle = '#1b1e24';
    c.fillRect(x, 40, 14, H - 48);
    c.fillStyle = color;
    const h = (H - 48) * share;
    c.fillRect(x, H - 8 - h, 14, h);
  };
  bar(4, d.brake ? 1 : 0, '#ff2d2d');
  bar(W - 18, (d.throttle ?? 0) / 100, '#2fd06f');
  // the gear large in the middle, with what's worth a glance either side
  text(gear, W / 2, 100, 112);
  if (d.estimated) text('EST', W / 2, 166, 18, '#ffd400');
  text(speed, 76, 78, 50);
  text('KM/H', 76, 112, 18, '#9aa0ab');
  text(pos, W - 76, 78, 50);
  text(lap, W - 76, 112, 20, '#9aa0ab');
  text(d.gap || '–', 76, 172, 28);
  text('GAP', 76, 198, 16, '#9aa0ab');
  text(ty ? ty[0] : '–', W - 76, 172, 40, ty ? ty[1] : '#9aa0ab');
  text('TYRE', W - 76, 198, 16, '#9aa0ab');
  const open = d.drs >= 10, armed = d.drs === 8;  // OpenF1: 10/12/14 open, 8 eligible
  c.fillStyle = open ? '#2fd06f' : armed ? '#ffd400' : '#1b1e24';
  c.fillRect(W / 2 - 40, 182, 80, 32);
  text('DRS', W / 2, 198, 22, open || armed ? '#05070a' : '#6d7380');
  dash.drawn();
}
