// motionframe v2 — the server only RECORDS the site once (a clean screen video).
// The browser places it in the mockup, previews the real motion, and exports the MP4.
// v1 (server/index.js) is untouched; run this one with `npm run v2`.
import express from 'express';
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import { DEVICES, RECORDERS, QUALITIES, SPEEDS, FPS_OPTIONS, LENGTHS, timeline, scrollAt } from './public/shared.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PORT = Number(process.env.PORT || 4174);
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE ? process.env.ALLOW_PRIVATE === '1' : LOOPBACK;
const MAX_PAGE_CSS = Number(process.env.MAX_PAGE_PX || 30000);
const DATA = process.env.MOTIONFRAME_DATA || path.join(os.tmpdir(), 'motionframe-v2');
fs.mkdirSync(path.join(DATA, 'rec'), { recursive: true });

const userError = (message) => Object.assign(new Error(message), { user: true });

/* ------------------------------------------------------------------ ffmpeg */
function ffmpegWorks(bin) { try { return spawnSync(bin, ['-version'], { timeout: 8000 }).status === 0; } catch { return false; } }
function findFfmpeg() {
  const cands = [process.env.FFMPEG_PATH];
  for (const name of ['ffmpeg-static', '@ffmpeg-installer/ffmpeg']) {
    try { const m = require(name); cands.push(typeof m === 'string' ? m : m && m.path); } catch { /* not installed */ }
  }
  cands.push('ffmpeg');
  for (const c of cands) if (c && ffmpegWorks(c)) return c;
  return null;
}
const FFMPEG = findFfmpeg();
const NO_FFMPEG = 'The video encoder (ffmpeg) couldn’t start on this computer. Run “npm install”, or install ffmpeg and add it to your PATH, then restart.';

/* ------------------------------------------------------------------ URL safety */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') ||
    /^::ffff:(127|10|0)\./.test(v) || v.startsWith('::ffff:192.168.') || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(v);
}
const dnsCache = new Map();
async function hostIsPublic(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) return !isPrivateIp(h);
  const hit = dnsCache.get(h);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  let ok = false;
  try { ok = !(await dns.lookup(h, { all: true })).some((a) => isPrivateIp(a.address)); } catch { ok = false; }
  dnsCache.set(h, { ok, at: Date.now() });
  return ok;
}
async function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw userError('Paste a website link first.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const local = /^(localhost|.*\.local|.*\.localhost)$/i.test(host) || net.isIP(host);
    s = (local ? 'http://' : 'https://') + s;
  }
  let u;
  try { u = new URL(s); } catch { throw userError('That doesn’t look like a valid link.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw userError('Only http and https links are supported.');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) throw userError('That doesn’t look like a valid link.');
  if (!ALLOW_PRIVATE) {
    try { await dns.lookup(u.hostname); } catch { if (!net.isIP(u.hostname)) throw userError(`Couldn’t find ${u.hostname}. Check the spelling and try again.`); }
    if (!(await hostIsPublic(u.hostname))) throw userError('Private and local addresses are blocked on this server.');
  }
  return u.toString();
}
async function guardPrivate(ctx) {
  if (ALLOW_PRIVATE) return;
  await ctx.route('**/*', async (route) => {
    try {
      const u = new URL(route.request().url());
      if (/^https?:$/.test(u.protocol) && !(await hostIsPublic(u.hostname))) return route.abort('blockedbyclient');
    } catch { /* fall through */ }
    return route.continue();
  });
}

/* ------------------------------------------------------------------ browser */
let browserPromise = null;
const LAUNCH_ARGS = ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'];
async function launchBrowser() {
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: LAUNCH_ARGS });
  const channel = process.env.BROWSER_CHANNEL || 'chrome';
  if (channel !== 'none') {
    try { const b = await chromium.launch({ channel, args: LAUNCH_ARGS }); console.log('[v2] using installed Google Chrome'); return b; } catch { /* not installed */ }
  }
  console.log('[v2] using bundled Chromium (.mp4 background videos may not play)');
  return chromium.launch({ args: LAUNCH_ARGS });
}
const getBrowser = () => (browserPromise ||= launchBrowser().catch((e) => { browserPromise = null; throw e; }));

function contextOptions(device, dsf) {
  return {
    viewport: { width: device.viewport.w, height: device.viewport.h },
    deviceScaleFactor: dsf, isMobile: device.mobile, hasTouch: device.mobile,
    userAgent: device.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' : undefined,
    ignoreHTTPSErrors: true, reducedMotion: 'no-preference',
  };
}

/* ---- deterministic page time (same technique as v1 live mode) ---- */
const PAGE_STEP = (dtMs) => {
  for (const a of document.getAnimations()) {
    if (a.timeline !== document.timeline) continue;
    if (!a.__mf) { a.__mf = 1; try { a.pause(); } catch { /* ignore */ } }
    try { a.currentTime = (Number(a.currentTime) || 0) + dtMs; } catch { /* ignore */ }
  }
  for (const v of document.querySelectorAll('video')) {
    if (!v.__mf) { v.__mf = 1; v.__play = !v.paused || v.autoplay; v.__t = 0; try { v.pause(); } catch { /* ignore */ } }
    if (!v.__play || !isFinite(v.duration) || v.duration <= 0) continue;
    v.__t += dtMs / 1000;
    v.__t = v.loop ? v.__t % v.duration : Math.min(v.__t, v.duration);
    if (Math.abs(v.currentTime - v.__t) > 0.001) {
      v.__seeking = true;
      v.addEventListener('seeked', () => { v.__seeking = false; }, { once: true });
      try { v.currentTime = v.__t; } catch { v.__seeking = false; }
    }
  }
};
async function settle(page, maxMs) {
  const t0 = Date.now();
  const ready = () => page.evaluate(() => {
    for (const v of document.querySelectorAll('video')) if (v.__seeking) return false;
    const vh = window.innerHeight;
    for (const i of document.images) { if (i.complete) continue; const r = i.getBoundingClientRect(); if (r.bottom > 0 && r.top < vh) return false; }
    return true;
  });
  while (Date.now() - t0 < maxMs) { if (await ready()) return; await page.waitForTimeout(25); }
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => { v.__seeking = false; }));
}
async function bufferVideos(page, maxMs) {
  const t0 = Date.now();
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => { try { v.preload = 'auto'; } catch { /* ignore */ } }));
  while (Date.now() - t0 < maxMs) {
    const ok = await page.evaluate(() => [...document.querySelectorAll('video')].every((v) =>
      !isFinite(v.duration) || v.duration <= 0 || (v.buffered.length > 0 && v.buffered.end(v.buffered.length - 1) >= v.duration - 0.3)));
    if (ok) return;
    await page.waitForTimeout(250);
  }
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(userError(`The site stopped responding while recording (${what}). Try again.`)), ms))]);

/* ------------------------------------------------------------------ recordings */
const recs = new Map();      // id -> rec
const recByKey = new Map();  // key -> id
let queue = Promise.resolve();

async function record(rec) {
  const { url, kind, speed, fps, quality, codec, length } = rec.opts;
  const device = RECORDERS[kind];
  const dsf = quality === '4k' ? device.dsf : Math.max(1, Math.ceil(device.dsf / 2));
  const browser = await getBrowser();
  const ctx = await browser.newContext(contextOptions(device, dsf));
  const ext = codec === 'vp9' ? 'webm' : 'mp4';
  const out = path.join(DATA, 'rec', rec.id + '.' + ext);
  rec.ext = ext;
  let ff;
  try {
    await guardPrivate(ctx);
    const page = await ctx.newPage();
    await page.clock.install({ time: Date.now() });
    await page.addInitScript(() => {
      const st = document.createElement('style');
      st.textContent = 'html,body{scroll-behavior:auto!important}';
      (document.head || document.documentElement).appendChild(st);
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
    });
    rec.phase = 'loading';
    let resp;
    try { resp = await page.goto(url, { waitUntil: 'load', timeout: 30_000 }); } catch (e) {
      const msg = String(e.message).split('\n')[0];
      if (/ERR_NAME_NOT_RESOLVED/.test(msg)) throw userError('We couldn’t find that site. Check the spelling and try again.');
      if (/ERR_CONNECTION_REFUSED/.test(msg)) throw userError('That site refused the connection. Is it running?');
      throw userError('That site took too long to load (30s). Try again in a moment.');
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await bufferVideos(page, 8000);
    await page.waitForTimeout(400);
    rec.title = (await page.title().catch(() => '')) || '';
    rec.status = resp ? resp.status() : 0;

    const fullH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    const pageH = Math.max(device.viewport.h, Math.min(fullH, MAX_PAGE_CSS));
    const { duration, scrollSecs } = timeline(Math.max(0, pageH - device.viewport.h), speed, length);
    const frames = Math.ceil(duration * fps);
    Object.assign(rec, { frames, duration, pageHeight: pageH, fullHeight: fullH, truncated: fullH > pageH, phase: 'recording' });

    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.evaluate(() => document.querySelectorAll('video').forEach((v) => { try { v.currentTime = 0; } catch { /* ignore */ } }));
    await page.evaluate(PAGE_STEP, 0);
    await settle(page, 1500);

    // Frames stream straight into ffmpeg: one H.264 file of just the screen, short GOP so the browser can seek per frame.
    const W = device.viewport.w * dsf, H = device.viewport.h * dsf;
    ff = spawn(FFMPEG, [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-vf', `scale=${W - (W % 2)}:${H - (H % 2)}:in_range=full:out_range=tv,format=yuv420p`,
      ...(codec === 'vp9'
        ? ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '24', '-b:v', '0', '-g', String(Math.max(1, Math.round(fps / 2)))]
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-g', String(Math.max(1, Math.round(fps / 2))), '-bf', '0', '-movflags', '+faststart']),
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', out,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d; });
    const ffDone = new Promise((res, rej) => {
      ff.on('error', (e) => rej(userError(NO_FFMPEG + ' (' + e.code + ')')));
      ff.on('close', (c) => (c === 0 ? res() : rej(new Error('Encoder failed: ' + ffErr.slice(-300)))));
    });
    ff.stdin.on('error', () => {});

    const dt = 1000 / fps, t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      if (rec.cancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      const frac = scrollAt(i / fps, scrollSecs);
      await page.evaluate(({ f, c }) => {
        const max = Math.max(0, Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight);
        window.scrollTo({ top: Math.round(f * Math.min(max, c - window.innerHeight)), left: 0, behavior: 'instant' });
      }, { f: frac, c: MAX_PAGE_CSS });
      await page.waitForTimeout(20);
      await withTimeout(page.clock.runFor(dt), 20_000, 'timers');
      await withTimeout(page.evaluate(PAGE_STEP, dt), 20_000, 'animations');
      await settle(page, 700);
      const buf = await withTimeout(page.screenshot({ type: 'jpeg', quality: 90 }), 20_000, 'screenshot');
      rec.latest = buf; // shown live in the mockup while recording
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      rec.frame = i + 1;
      rec.progress = (i + 1) / frames;
      rec.etaSec = Math.max(0, Math.round(((Date.now() - t0) / 1000 / (i + 1)) * (frames - i - 1)) + 2);
    }
    rec.phase = 'encoding';
    ff.stdin.end();
    await ffDone;
    rec.file = out;
    rec.size = fs.statSync(out).size;
    rec.width = W - (W % 2); rec.height = H - (H % 2);
  } catch (e) {
    try { ff && ff.kill('SIGKILL'); } catch { /* ignore */ }
    fs.rmSync(out, { force: true });
    throw e;
  } finally {
    await ctx.close().catch(() => {});
  }
}

function enqueue(rec) {
  rec.state = 'queued';
  queue = queue.then(async () => {
    if (rec.cancelled) { rec.state = 'cancelled'; return; }
    rec.state = 'recording';
    const t0 = Date.now();
    console.log(`[v2] recording ${rec.id} ${rec.opts.url} (${rec.opts.kind}, ${rec.opts.quality}, ${rec.opts.fps}fps, length ${rec.opts.length || 'auto'})`);
    try {
      await record(rec);
      rec.state = 'done'; rec.progress = 1; rec.etaSec = 0; rec.latest = null;
      console.log(`[v2] recording ${rec.id} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      rec.latest = null;
      if (e.cancelled) rec.state = 'cancelled';
      else { rec.state = 'error'; rec.error = e.user ? e.message : 'Recording failed. ' + String(e.message).split('\n')[0].slice(0, 200); console.error(`[v2] recording ${rec.id} FAILED:`, e && e.stack || e); }
      recByKey.delete(rec.key);
    }
  });
}

/* ------------------------------------------------------------------ http */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
const clientIp = (req) => String(req.get('cf-connecting-ip') || req.get('true-client-ip') || req.ip || '').split(',')[0].trim();
const RATE_LIMIT = process.env.RATE_LIMIT ? process.env.RATE_LIMIT !== 'off' : !LOOPBACK;
const hits = new Map();
const rateLimit = (name, max, windowMs) => (req, res, next) => {
  if (!RATE_LIMIT) return next();
  const key = name + '|' + clientIp(req), now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return res.status(429).json({ error: `You’re going a bit fast. Please wait a few minutes (limit: ${max} per ${Math.round(windowMs / 60000)} min).` });
  list.push(now); hits.set(key, list); next();
};

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/mp4-muxer.mjs', (req, res) => res.type('js').sendFile(path.join(ROOT, 'node_modules/mp4-muxer/build/mp4-muxer.mjs')));
app.use('/fonts/sans', express.static(path.join(ROOT, 'node_modules/@fontsource/hanken-grotesk/files'), { maxAge: '30d' }));
app.use('/fonts/mono', express.static(path.join(ROOT, 'node_modules/@fontsource/jetbrains-mono/files'), { maxAge: '30d' }));
app.use('/rec', express.static(path.join(DATA, 'rec'), { maxAge: '1h' }));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (!e.user) console.error(e);
  res.status(e.user ? 400 : 500).json({ error: e.user ? e.message : 'Something went wrong on our side. Please try again.' });
});
const view = (r) => ({
  id: r.id, state: r.state, phase: r.phase, progress: r.progress || 0, frame: r.frame || 0, frames: r.frames || 0, etaSec: r.etaSec ?? null,
  error: r.error, url: r.opts.url, host: new URL(r.opts.url).host, title: r.title, kind: r.opts.kind, fps: r.opts.fps, quality: r.opts.quality,
  duration: r.duration, pageHeight: r.pageHeight, fullHeight: r.fullHeight, truncated: r.truncated, width: r.width, height: r.height,
  videoUrl: r.state === 'done' ? `/rec/${r.id}.${r.ext || 'mp4'}` : undefined,
});

app.post('/api/record', rateLimit('record', Number(process.env.RECORDS_PER_15MIN || 16), 15 * 60_000), wrap(async (req, res) => {
  if (!FFMPEG) throw userError(NO_FFMPEG);
  const b = req.body || {};
  const url = await normalizeUrl(b.url);
  const fps = Number(b.fps || 30);
  const kind = RECORDERS[b.kind] ? b.kind : (DEVICES[b.device] ? DEVICES[b.device].rec : null);
  if (!kind || !SPEEDS[b.speed] || !QUALITIES[b.quality] || !FPS_OPTIONS.includes(fps)) throw userError('Invalid settings.');
  const length = LENGTHS.includes(Number(b.length)) ? Number(b.length) : 0;
  const opts = { url, kind, speed: b.speed, quality: b.quality, fps, codec: b.codec === 'vp9' ? 'vp9' : 'h264', length };
  const key = crypto.createHash('sha1').update(JSON.stringify(opts)).digest('hex').slice(0, 16);
  const existing = recs.get(recByKey.get(key));
  if (!b.fresh && existing && ['queued', 'recording', 'done'].includes(existing.state)) return res.json(view(existing));
  const active = [...recs.values()].filter((r) => r.state === 'queued' || r.state === 'recording');
  if (active.length >= 6) throw userError('The recorder is busy. Please try again in a minute.');
  const rec = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 12), key, opts, createdAt: Date.now(), ip: clientIp(req) };
  recs.set(rec.id, rec); recByKey.set(key, rec.id);
  enqueue(rec);
  res.json(view(rec));
}));
app.get('/api/record/:id', (req, res) => {
  const r = recs.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'That recording expired. Load the site again.' });
  const ahead = r.state === 'queued' ? [...recs.values()].filter((x) => x.createdAt < r.createdAt && (x.state === 'queued' || x.state === 'recording')).length : 0;
  res.json({ ...view(r), ahead });
});
app.get('/api/record/:id/latest.jpg', (req, res) => {
  const r = recs.get(req.params.id);
  if (!r || !r.latest) return res.status(204).end();
  res.set('Cache-Control', 'no-store').type('jpeg').send(r.latest);
});
app.delete('/api/record/:id', (req, res) => { const r = recs.get(req.params.id); if (r) { r.cancelled = true; recByKey.delete(r.key); } res.json({ ok: true }); });
// Launch settings, set as environment variables on the host (Hugging Face: Space → Settings → Variables).
const LAUNCH = {
  watermark: process.env.WATERMARK !== 'off',                 // "made with motionframe" on exports
  waitlistUrl: /^https:\/\//.test(process.env.WAITLIST_URL || '') ? process.env.WAITLIST_URL : 'https://docs.google.com/forms/d/e/1FAIpQLScueqm8YKUAq_AhEvxrX--hKgTcUbmBFHW-NqCbPidP9EXKXQ/viewform',
  feedbackUrl: /^https:\/\//.test(process.env.FEEDBACK_URL || '') ? process.env.FEEDBACK_URL : 'https://x.com/Julious_design',
  feedbackLabel: process.env.FEEDBACK_LABEL || '@Julious_design',
};
app.get('/api/health', (_req, res) => res.set('Access-Control-Allow-Origin', '*').json({ ok: true, version: 2, encoder: !!FFMPEG, allowPrivate: ALLOW_PRIVATE, ...LAUNCH }));

setInterval(() => {
  const cutoff = Date.now() - 2 * 3600_000;
  for (const [id, r] of recs) if (r.createdAt < cutoff) { recs.delete(id); recByKey.delete(r.key); if (r.file) fs.rmSync(r.file, { force: true }); }
  for (const [k, v] of hits) if (!v.some((t) => t > Date.now() - 3600_000)) hits.delete(k);
}, 10 * 60_000).unref();

process.on('unhandledRejection', (e) => console.error('[v2] unhandled rejection:', e && e.stack || e));
process.on('uncaughtException', (e) => console.error('[v2] uncaught exception:', e && e.stack || e));
app.listen(PORT, HOST, () => {
  if (!FFMPEG) console.warn('[v2] WARNING: ' + NO_FFMPEG);
  console.log(`motionframe v2 running → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${ALLOW_PRIVATE ? '' : '  (private addresses blocked)'}`);
});
const shutdown = async () => { try { (await browserPromise)?.close(); } catch { /* ignore */ } process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
