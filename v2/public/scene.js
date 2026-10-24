// Draws backdrop + device mockup + the recorded screen onto a 2D canvas.
// Used for the live preview AND the exported video, so what you see is exactly what you download.
import { DEVICES, FORMATS, BACKDROPS, customBackdrop } from './shared.js';

const SHADOW = 'rgba(18,16,40,0.42)';

function rr(ctx, x, y, w, h, r) {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y); ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br); ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h); ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl); ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}
function vgrad(ctx, y0, y1, stops) { const g = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function hgrad(ctx, x0, x1, stops) { const g = ctx.createLinearGradient(x0, 0, x1, 0); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function withShadow(ctx, k, blur, oy, color, fn) {
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur * k; ctx.shadowOffsetY = oy * k; ctx.shadowOffsetX = 0; fn(); ctx.restore();
}
function transparentOf(c) {
  if (c.startsWith('#')) { const n = parseInt(c.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`; }
  return c.replace(/rgba?\(([^,]+),([^,]+),([^,)]+)(,[^)]+)?\)/, 'rgba($1,$2,$3,0)');
}

/* ---------------------------------------------------------------- backdrop */
let noise = null;
function noiseCanvas() {
  if (noise) return noise;
  noise = document.createElement('canvas'); noise.width = noise.height = 256;
  const c = noise.getContext('2d'), img = c.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const v = 96 + Math.random() * 64; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  c.putImageData(img, 0, 0);
  return noise;
}
export function drawBackdrop(ctx, W, H, id, custom) {
  const b = id === 'custom' ? customBackdrop(custom) : (BACKDROPS[id] || BACKDROPS.aurora);
  ctx.fillStyle = b.base; ctx.fillRect(0, 0, W, H);
  for (const [x, y, rx, ry, color, stop] of [...b.glows].reverse()) {
    ctx.save();
    ctx.translate((x / 100) * W, (y / 100) * H);
    ctx.scale((rx / 100) * W, (ry / 100) * H);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, color); g.addColorStop(stop, transparentOf(color));
    ctx.fillStyle = g; ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  }
  // fine grain so gradients don't band in the video
  ctx.save(); ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(noiseCanvas(), 'repeat'); ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* ---------------------------------------------------------------- devices (units = CSS px of the site) */
export function deviceGeometry(id) {
  const { w: vw, h: vh } = DEVICES[id].viewport;
  if (id === 'phone') return { w: vw + 32, h: vh + 32, screen: { x: 16, y: 16, w: vw, h: vh, r: 50 } };
  if (id === 'browser') return { w: vw, h: vh + 58, screen: { x: 0, y: 58, w: vw, h: vh, r: [0, 0, 16, 16] } };
  if (id === 'desktop') { const mw = vw + 50, mh = vh + 50; return { w: mw, h: mh + 133, screen: { x: 25, y: 25, w: vw, h: vh, r: 6 }, mw, mh }; }
  const lidW = vw + 38, lidH = vh + 48, W = Math.round(lidW * 1.12);
  return { w: W, h: lidH + 19, screen: { x: (W - lidW) / 2 + 19, y: 19, w: vw, h: vh, r: 10 }, lidW, lidH };
}

function drawBody(ctx, id, g, k, host) {
  if (id === 'macbook') {
    const lx = (g.w - g.lidW) / 2;
    withShadow(ctx, k, 56, 40, SHADOW, () => { rr(ctx, lx, 0, g.lidW, g.lidH, [30, 30, 10, 10]); ctx.fillStyle = vgrad(ctx, 0, g.lidH, [[0, '#d9dce1'], [0.6, '#b7bbc2'], [1, '#a4a8b0']]); ctx.fill(); });
    withShadow(ctx, k, 30, 16, 'rgba(18,16,40,0.35)', () => { rr(ctx, 0, g.lidH - 1, g.w, 20, [0, 0, 24, 24]); ctx.fillStyle = vgrad(ctx, g.lidH, g.lidH + 20, [[0, '#e3e5e9'], [0.55, '#c3c7ce'], [1, '#a2a6ae']]); ctx.fill(); });
    rr(ctx, g.w / 2 - 105, g.lidH - 1, 210, 8, [0, 0, 12, 12]); ctx.fillStyle = vgrad(ctx, g.lidH, g.lidH + 8, [[0, '#8f939b'], [1, '#b8bcc3']]); ctx.fill();
    rr(ctx, lx + 3, 3, g.lidW - 6, g.lidH - 6, [27, 27, 8, 8]); ctx.fillStyle = '#08080a'; ctx.fill();
  } else if (id === 'phone') {
    ctx.fillStyle = hgrad(ctx, 0, 4, [[0, '#9a9da5'], [1, '#d2d4d9']]);
    for (const [y, h] of [[150, 36], [210, 62], [286, 62]]) { rr(ctx, -3, y, 4, h, 2); ctx.fill(); }
    rr(ctx, g.w - 1, 230, 4, 96, 2); ctx.fill();
    withShadow(ctx, k, 56, 40, SHADOW, () => {
      rr(ctx, 0, 0, g.w, g.h, 66);
      const gr = ctx.createLinearGradient(0, 0, g.w, g.h); gr.addColorStop(0, '#d8d9dd'); gr.addColorStop(0.5, '#8c8f97'); gr.addColorStop(1, '#cfd1d6');
      ctx.fillStyle = gr; ctx.fill();
    });
    rr(ctx, 4, 4, g.w - 8, g.h - 8, 62); ctx.fillStyle = '#050507'; ctx.fill();
  } else if (id === 'browser') {
    withShadow(ctx, k, 56, 40, SHADOW, () => { rr(ctx, 0, 0, g.w, g.h, 16); ctx.fillStyle = '#fff'; ctx.fill(); });
    ctx.save(); rr(ctx, 0, 0, g.w, g.h, 16); ctx.clip();
    ctx.fillStyle = vgrad(ctx, 0, 58, [[0, '#f6f6f7'], [1, '#ececee']]); ctx.fillRect(0, 0, g.w, 58);
    ctx.fillStyle = 'rgba(0,0,0,0.09)'; ctx.fillRect(0, 57, g.w, 1);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { ctx.beginPath(); ctx.arc(27 + i * 23, 29, 7, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); });
    const pw = g.w * 0.46; rr(ctx, (g.w - pw) / 2, 12, pw, 34, 10); ctx.fillStyle = '#e3e3e6'; ctx.fill();
    ctx.fillStyle = '#3a3a40'; ctx.font = '500 16px "Hanken Grotesk", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = (host || 'yoursite.com').replace(/^www\./, '');
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, g.w / 2 + 10, 29);
    // lock icon
    const lx = g.w / 2 - tw / 2 - 6; ctx.strokeStyle = 'rgba(58,58,64,0.6)'; ctx.lineWidth = 2;
    rr(ctx, lx - 6, 27, 12, 9, 2); ctx.stroke(); ctx.beginPath(); ctx.arc(lx, 27, 4, Math.PI, 0); ctx.stroke();
    ctx.restore();
  } else { // desktop monitor
    const nx = g.w / 2 - 95, ny = g.mh - 2;
    withShadow(ctx, k, 26, 18, 'rgba(18,16,40,0.35)', () => { rr(ctx, g.w / 2 - 180, g.mh + 117, 360, 16, [6, 6, 18, 18]); ctx.fillStyle = vgrad(ctx, g.mh + 117, g.mh + 133, [[0, '#e4e6ea'], [1, '#a3a7af']]); ctx.fill(); });
    ctx.beginPath(); ctx.moveTo(nx + 15, ny); ctx.lineTo(nx + 175, ny); ctx.lineTo(nx + 190, ny + 120); ctx.lineTo(nx, ny + 120); ctx.closePath();
    ctx.fillStyle = hgrad(ctx, nx, nx + 190, [[0, '#a9adb5'], [0.45, '#e6e8ec'], [1, '#b6bac1']]); ctx.fill();
    withShadow(ctx, k, 56, 40, SHADOW, () => { rr(ctx, 0, 0, g.mw, g.mh, 26); ctx.fillStyle = vgrad(ctx, 0, g.mh, [[0, '#e1e3e7'], [1, '#b5b9c0']]); ctx.fill(); });
    rr(ctx, 3, 3, g.mw - 6, g.mh - 6, 23); ctx.fillStyle = '#08080a'; ctx.fill();
  }
}

function drawOverlays(ctx, id, g) {
  const s = g.screen;
  if (id === 'macbook') {
    rr(ctx, g.w / 2 - 84, s.y, 168, 28, [0, 0, 14, 14]); ctx.fillStyle = '#08080a'; ctx.fill();
    ctx.beginPath(); ctx.arc(g.w / 2 + 44, s.y + 13, 4, 0, Math.PI * 2); ctx.fillStyle = '#1b2232'; ctx.fill();
  } else if (id === 'phone') {
    rr(ctx, g.w / 2 - 61, 26, 122, 35, 17.5); ctx.fillStyle = '#020203'; ctx.fill();
    rr(ctx, g.w / 2 - 68, g.h - 27, 136, 5, 3); ctx.fillStyle = 'rgba(10,10,14,0.55)'; ctx.fill();
  }
}

function drawPlaceholder(ctx, s, id, text) {
  ctx.fillStyle = '#f4f5f7'; ctx.fillRect(s.x, s.y, s.w, s.h);
  const u = id === 'phone' ? 0.62 : 1;
  ctx.fillStyle = '#16181d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(34 * u)}px "Hanken Grotesk", system-ui, sans-serif`;
  ctx.fillText(text[0], s.x + s.w / 2, s.y + s.h / 2 - 22 * u);
  ctx.fillStyle = '#5a5f6b'; ctx.font = `400 ${Math.round(22 * u)}px "Hanken Grotesk", system-ui, sans-serif`;
  ctx.fillText(text[1], s.x + s.w / 2, s.y + s.h / 2 + 24 * u);
}

/* ---------------------------------------------------------------- the whole frame */
// opts: { format, device, backdrop, custom, source, host, p (0..1 through the film), placeholder:[title, sub], watermark }
export function drawScene(ctx, W, H, opts) {
  const F = FORMATS[opts.format] || FORMATS['16:9'];
  const k0 = W / F.w;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawBackdrop(ctx, W, H, opts.backdrop, opts.custom);

  const g = deviceGeometry(opts.device);
  const padX = opts.format === '9:16' ? 0.9 : opts.format === '1:1' ? 0.86 : 0.84;
  const padY = opts.format === '9:16' ? 0.86 : 0.82;
  const fit = Math.min((F.w * padX) / g.w, (F.h * padY) / g.h, 2.4); // phones fill tall formats properly
  const p = Math.min(1, Math.max(0, opts.p || 0));
  const s = fit * (1.035 - 0.035 * p); // gentle camera push-in that settles
  const ty = 8 - 16 * p;
  ctx.setTransform(k0 * s, 0, 0, k0 * s, k0 * (F.w / 2) - (k0 * s * g.w) / 2, k0 * (F.h / 2 + ty) - (k0 * s * g.h) / 2);
  const k = k0 * s;

  drawBody(ctx, opts.device, g, k, opts.host);
  const sc = g.screen;
  ctx.save();
  rr(ctx, sc.x, sc.y, sc.w, sc.h, sc.r); ctx.clip();
  if (opts.source) {
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(opts.source, sc.x, sc.y, sc.w, sc.h);
  } else drawPlaceholder(ctx, sc, opts.device, opts.placeholder || ['Your site goes here', 'Paste a link on the left to see it move.']);
  ctx.restore();
  drawOverlays(ctx, opts.device, g);

  if (opts.watermark) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const u = k0 * (opts.format === '16:9' ? 1 : 1.15);   // scale with the frame
    const pad = 10 * u, mark = 26 * u, gap = 9 * u, fs1 = 11 * u, fs2 = 16 * u;
    ctx.font = `600 ${fs2}px "Hanken Grotesk", system-ui, sans-serif`;
    const tw = Math.max(ctx.measureText('motionframe').width, (ctx.font = `500 ${fs1}px "Hanken Grotesk", system-ui, sans-serif`, ctx.measureText('made with').width));
    const w = pad * 2 + mark + gap + tw, h = mark + pad * 2;
    const x = W - w - 28 * k0, y = H - h - 24 * k0;
    rr(ctx, x, y, w, h, h / 2.4); ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.fill();
    ctx.lineWidth = 1 * u; ctx.strokeStyle = 'rgba(20,24,32,0.08)'; ctx.stroke();
    rr(ctx, x + pad, y + pad, mark, mark, 7 * u); ctx.fillStyle = '#1a1f2b'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.4 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const cx = x + pad + mark / 2, cy = y + pad + mark / 2, q = mark * 0.2;
    ctx.beginPath(); ctx.moveTo(cx - q, cy + q); ctx.lineTo(cx + q, cy - q); ctx.moveTo(cx - q * 0.6, cy - q); ctx.lineTo(cx + q, cy - q); ctx.lineTo(cx + q, cy + q * 0.6); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(20,24,32,0.55)'; ctx.font = `500 ${fs1}px "Hanken Grotesk", system-ui, sans-serif`;
    ctx.fillText('made with', x + pad + mark + gap, y + pad + fs1 * 0.95);
    ctx.fillStyle = '#141a24'; ctx.font = `600 ${fs2}px "Hanken Grotesk", system-ui, sans-serif`;
    ctx.fillText('motionframe', x + pad + mark + gap, y + pad + mark - 1 * u);
  }
  ctx.restore();
}
