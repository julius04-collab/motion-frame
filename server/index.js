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
import {
  DEVICES, FORMATS, QUALITIES, BACKDROPS, FPS_OPTIONS, SPEEDS, MOTIONS, timeline, scrollAt,
} from '../public/shared.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
// On your own machine (loopback bind) previewing localhost / LAN sites is fine.
// When exposed on a network, block private addresses so the server can't be used to probe them.
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE ? process.env.ALLOW_PRIVATE === '1' : LOOPBACK;

const DATA = process.env.MOTIONFRAME_DATA || path.join(os.tmpdir(), 'motionframe-data');
fs.mkdirSync(path.join(DATA, 'captures'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'videos'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'frames'), { recursive: true });

// Find an ffmpeg that actually runs. A bundled binary can be present but broken (failed download,
// wrong platform, antivirus quarantine -> "spawn EFTYPE"), so every candidate is test-run first.
function ffmpegWorks(bin) {
  try { return spawnSync(bin, ['-version'], { timeout: 8000 }).status === 0; } catch { return false; }
}
function findFfmpeg() {
  const cands = [process.env.FFMPEG_PATH];
  for (const name of ['ffmpeg-static', '@ffmpeg-installer/ffmpeg']) {
    try { const m = require(name); cands.push(typeof m === 'string' ? m : m && m.path); } catch { /* not installed */ }
  }
  cands.push('ffmpeg'); // anything on PATH
  for (const c of cands) if (c && ffmpegWorks(c)) return c;
  return null;
}
const FFMPEG = findFfmpeg();
const NO_FFMPEG = 'The video encoder (ffmpeg) couldn’t start on this computer. Run “npm install”, or install ffmpeg from ffmpeg.org and add it to your PATH, then restart motionframe.';

const userError = (message) => Object.assign(new Error(message), { user: true });

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

const dnsCache = new Map(); // host -> { ok, at }
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
    // Local dev servers and bare IPs almost never speak TLS, so default those to http.
    const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const local = /^(localhost|.*\.local|.*\.localhost)$/i.test(host) || net.isIP(host);
    s = (local ? 'http://' : 'https://') + s;
  }
  let u;
  try { u = new URL(s); } catch { throw userError('That doesn’t look like a valid link.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw userError('Only http and https links are supported.');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) {
    throw userError('That doesn’t look like a valid link.');
  }
  if (!ALLOW_PRIVATE) {
    try { await dns.lookup(u.hostname); } catch { if (!net.isIP(u.hostname)) throw userError(`Couldn’t find ${u.hostname}. Check the spelling and try again.`); }
    if (!(await hostIsPublic(u.hostname))) {
      throw userError('Private and local addresses are blocked on this server. Run it locally (or set ALLOW_PRIVATE=1) to preview them.');
    }
  }
  return u.toString();
}

/* ------------------------------------------------------------------ browser */

let browserPromise = null;
const LAUNCH_ARGS = ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'];
async function launchBrowser() {
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: LAUNCH_ARGS });
  const channel = process.env.BROWSER_CHANNEL || 'chrome';
  if (channel !== 'none') {
    // Installed Google Chrome can play H.264 (.mp4) hero videos; Playwright's bundled Chromium cannot.
    try { const b = await chromium.launch({ channel, args: LAUNCH_ARGS }); console.log('motionframe: using installed Google Chrome'); return b; } catch { /* not installed */ }
  }
  console.log('motionframe: using bundled Chromium (.mp4/H.264 background videos may not play; install Google Chrome for those)');
  return chromium.launch({ args: LAUNCH_ARGS });
}
function getBrowser() {
  if (!browserPromise) browserPromise = launchBrowser().catch((e) => { browserPromise = null; throw e; });
  return browserPromise;
}

// Tiny semaphore so a burst of "load" clicks can't spawn unbounded browser contexts.
function limiter(max) {
  let active = 0; const waiters = [];
  return async (fn) => {
    if (active >= max) await new Promise((r) => waiters.push(r));
    active++;
    try { return await fn(); } finally { active--; waiters.shift()?.(); }
  };
}
const captureSlot = limiter(2);

/* ------------------------------------------------------------------ capture */

const captures = new Map();      // id -> meta
const captureByKey = new Map();  // key -> { id, at }
const STRIP_CSS = 2400;          // css px per strip (keeps every image far below Chromium's 16384px limit)
const MAX_PAGE_CSS = 10000;      // longest page we'll film; videos stay a sensible length

const stripPath = (id, i) => path.join(DATA, 'captures', `${id}-${i}.jpg`);

function capture(url, deviceId, fresh) {
  return captureSlot(() => doCapture(url, deviceId, fresh));
}

async function doCapture(url, deviceId, fresh) {
  const device = DEVICES[deviceId];
  if (!device) throw userError('Unknown device.');
  const key = crypto.createHash('sha1').update(url + '|' + deviceId).digest('hex').slice(0, 16);
  const hit = captureByKey.get(key);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60_000 && captures.has(hit.id)) return captures.get(hit.id);

  const browser = await getBrowser();
  const ctx = await browser.newContext(deviceContextOptions(device, device.dsf));
  try {
    await guardPrivate(ctx);
    const page = await ctx.newPage();
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    } catch (e) {
      const msg = String(e.message).split('\n')[0].replace(/^page\.goto: /, '');
      if (/ERR_NAME_NOT_RESOLVED/.test(msg)) throw userError('We couldn’t find that site. Check the spelling and try again.');
      if (/ERR_CONNECTION_REFUSED/.test(msg)) throw userError('That site refused the connection. Is it running?');
      if (/Timeout/.test(msg)) throw userError('That site took too long to load (30s). Try again in a moment.');
      throw userError(`Couldn’t open that site (${msg}).`);
    }
    if (response && response.status() >= 400 && response.status() !== 401) {
      // Still film it (some sites 4xx bots but render fine), but surface it to the UI.
    }
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});

    // Scroll through once so lazy images and reveal-on-scroll animations fire.
    await page.evaluate(async (cap) => {
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      const total = () => Math.min(document.documentElement.scrollHeight, cap);
      for (let y = 0; y < total(); y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 250));
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 500));
    }, MAX_PAGE_CSS);
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    const fullH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    const cssH = Math.max(device.viewport.h, Math.min(fullH, MAX_PAGE_CSS));
    const n = Math.ceil(cssH / STRIP_CSS);
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 14);
    for (let i = 0; i < n; i++) {
      const y = i * STRIP_CSS;
      const h = Math.min(STRIP_CSS, cssH - y);
      const buf = await page.screenshot({
        type: 'jpeg', quality: 92, fullPage: true,
        clip: { x: 0, y, width: device.viewport.w, height: h },
      });
      fs.writeFileSync(stripPath(id, i), buf);
    }
    const title = (await page.title().catch(() => '')) || '';
    const meta = {
      id, url, host: new URL(url).host, title, device: deviceId,
      width: device.viewport.w, height: cssH, strips: n, stripH: STRIP_CSS,
      truncated: fullH > cssH, fullHeight: fullH, status: response ? response.status() : 0,
      createdAt: Date.now(),
    };
    captures.set(id, meta);
    captureByKey.set(key, { id, at: Date.now() });
    return meta;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------ render jobs */

const jobs = new Map();
let queue = Promise.resolve();

function composeUrl(o, liveDuration = 0) {
  const q = new URLSearchParams({
    device: o.device, bg: o.backdrop, custom: o.custom || '', format: o.format,
    shot: o.captureId, speed: o.speed, render: '1',
  });
  if (liveDuration) { q.set('live', '1'); q.set('dur', String(liveDuration)); }
  return `http://127.0.0.1:${PORT}/compose.html?${q}`;
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

function deviceContextOptions(device, dsf) {
  return {
    viewport: { width: device.viewport.w, height: device.viewport.h },
    deviceScaleFactor: dsf,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    userAgent: device.mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      : undefined,
    ignoreHTTPSErrors: true,
    reducedMotion: 'no-preference',
  };
}

/* Runs inside the page: advance every CSS/Web animation and every playing <video> by exactly dtMs,
   so the film shows the site's real motion at a perfectly even frame rate (time is virtual). */
const PAGE_STEP = async (dtMs) => {
  for (const a of document.getAnimations()) {
    if (a.timeline !== document.timeline) continue; // scroll-driven animations follow the real scroll
    if (!a.__mf) { a.__mf = 1; try { a.pause(); } catch { /* ignore */ } }
    try { a.currentTime = (Number(a.currentTime) || 0) + dtMs; } catch { /* ignore */ }
  }
  const waits = [];
  for (const v of document.querySelectorAll('video')) {
    if (!v.__mf) { v.__mf = 1; v.__play = !v.paused || v.autoplay; v.__t = 0; try { v.pause(); } catch { /* ignore */ } }
    if (!v.__play || !isFinite(v.duration) || v.duration <= 0) continue;
    v.__t += dtMs / 1000;
    v.__t = v.loop ? v.__t % v.duration : Math.min(v.__t, v.duration);
    if (Math.abs(v.currentTime - v.__t) > 0.001) {
      waits.push(new Promise((res) => {
        const done = () => { v.removeEventListener('seeked', done); res(); };
        v.addEventListener('seeked', done); setTimeout(done, 300);
        v.currentTime = v.__t;
      }));
    }
  }
  await Promise.all(waits);
  // make sure anything scrolled into view has its image decoded before the shot
  const vh = window.innerHeight;
  const imgs = [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && !i.complete; });
  if (imgs.length) await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 1500))]);
};

/* Pass 1 (live mode): drive the real page with a frozen clock and save one screen frame per output frame. */
const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(userError(`The site stopped responding while recording (${what}). Try the “Still” page motion for this one, or try again.`)), ms)),
]);

async function captureLive(job, meta, device, scale, fps, frames, scrollSecs, dir) {
  const browser = await getBrowser();
  const dsf = scale === 2 ? device.dsf : Math.max(1, Math.ceil(device.dsf / 2));
  const ctx = await browser.newContext(deviceContextOptions(device, dsf));
  try {
    await guardPrivate(ctx);
    const page = await ctx.newPage();
    await page.clock.install({ time: Date.now() });
    try {
      await page.goto(meta.url, { waitUntil: 'load', timeout: 30_000 });
    } catch (e) {
      throw userError('That site took too long to load while recording. Try again.');
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    // Freeze time here. Videos restart from 0 so a hero/fly-in clip plays from its first frame.
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.evaluate(() => document.querySelectorAll('video').forEach((v) => { try { v.currentTime = 0; } catch { /* ignore */ } }));
    await page.evaluate(PAGE_STEP, 0);

    const dt = 1000 / fps;
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      if (job.cancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      const sec = i / fps;
      const frac = scrollAt(sec, scrollSecs);
      await page.evaluate((f) => {
        const max = Math.max(0, Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight);
        window.scrollTo(0, Math.round(f * Math.min(max, 10000 - window.innerHeight)));
      }, frac);
      await page.waitForTimeout(20);        // real time: lets IntersectionObservers / scroll handlers react
      await withTimeout(page.clock.runFor(dt), 20_000, 'timers');           // virtual time: timers, rAF, GSAP, etc.
      await withTimeout(page.evaluate(PAGE_STEP, dt), 20_000, 'animations'); // CSS animations + <video>
      const buf = await withTimeout(page.screenshot({ type: 'jpeg', quality: 88 }), 20_000, 'screenshot');
      fs.writeFileSync(path.join(dir, String(i).padStart(5, '0') + '.jpg'), buf);
      job.frame = i + 1;
      job.progress = ((i + 1) / frames) * 0.9;
      job.etaSec = Math.max(0, Math.round(((Date.now() - t0) / 1000 / (i + 1)) * (frames - i - 1) * 1.08) + 6);
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}


/* Pass 2 (live mode): one ffmpeg run places the recorded frames into the mockup. No per-frame browser work. */
async function encodeLive(job, opts, F, Q, fps, frames, duration, framesDir, out) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width: F.w, height: F.h }, deviceScaleFactor: Q.scale });
  let rect;
  const scenePng = path.join(framesDir, 'scene.png'), maskPng = path.join(framesDir, 'mask.png');
  try {
    const page = await ctx.newPage();
    await page.goto(composeUrl(opts, duration), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 45_000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.evaluate(() => window.__scene('scene'));
    await page.screenshot({ path: scenePng, type: 'png' });
    rect = await page.evaluate(() => window.__scene('mask'));
    const px = { x: Math.round(rect.x * Q.scale), y: Math.round(rect.y * Q.scale), w: Math.round(rect.w * Q.scale), h: Math.round(rect.h * Q.scale) };
    px.w -= px.w % 2; px.h -= px.h % 2;
    await page.screenshot({ path: maskPng, type: 'png', clip: { x: px.x / Q.scale, y: px.y / Q.scale, width: px.w / Q.scale, height: px.h / Q.scale } });
    rect = px;
  } finally {
    await ctx.close().catch(() => {});
  }

  job.phase = 'composing';
  const filter = `[1:v]scale=${rect.w}:${rect.h}:flags=lanczos,format=rgba[f];[2:v]scale=${rect.w}:${rect.h},format=gray[m];[f][m]alphamerge[fa];` +
    `[0:v][fa]overlay=${rect.x}:${rect.y}:shortest=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`;
  const ff = spawn(FFMPEG, [
    '-y', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    '-loop', '1', '-framerate', String(fps), '-i', scenePng,
    '-framerate', String(fps), '-i', path.join(framesDir, '%05d.jpg'),
    '-loop', '1', '-framerate', String(fps), '-i', maskPng,
    '-filter_complex', filter, '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', opts.quality === '4k' ? 'fast' : 'medium', '-crf', '16', '-movflags', '+faststart',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    out,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d; });
  ff.stdout.on('data', (d) => {
    const m = /frame=(\d+)/g; let x, last = null; const t = String(d);
    while ((x = m.exec(t))) last = Number(x[1]);
    if (last != null) { job.frame = Math.min(frames, last); job.progress = 0.9 + 0.1 * Math.min(1, last / frames); job.etaSec = Math.max(0, Math.round((frames - last) / 60)); }
  });
  await new Promise((resolve, reject) => {
    ff.on('error', (e) => reject(userError(NO_FFMPEG + ' (' + e.code + ')')));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Video encoder failed: ' + ffErr.slice(-300)))));
    job.kill = () => { try { ff.kill('SIGKILL'); } catch { /* ignore */ } };
  });
}

async function runRender(job) {
  const { opts } = job;
  const meta = captures.get(opts.captureId);
  if (!meta) throw userError('That preview expired. Reload the site and try again.');
  if (!FFMPEG) throw userError(NO_FFMPEG);
  const F = FORMATS[opts.format];
  const Q = QUALITIES[opts.quality];
  const fps = opts.fps;
  const device = DEVICES[opts.device];
  const live = opts.motion === 'live';
  const scrollPx = Math.max(0, meta.height - device.viewport.h);
  const { duration, scrollSecs } = timeline(scrollPx, opts.speed);
  const frames = Math.ceil(duration * fps);
  Object.assign(job, { frames, duration, fps, width: F.w * Q.scale, height: F.h * Q.scale, phase: live ? 'capturing' : 'rendering' });

  const framesDir = path.join(DATA, 'frames', job.id);
  const out = path.join(DATA, 'videos', job.id + '.mp4');
  let ctx, ff;
  try {
    if (live) {
      fs.mkdirSync(framesDir, { recursive: true });
      await captureLive(job, meta, device, Q.scale, fps, frames, scrollSecs, framesDir);
      job.frame = 0;
      await encodeLive(job, opts, F, Q, fps, frames, duration, framesDir, out);
      job.file = out; job.size = fs.statSync(out).size;
      return;
    }

    const browser = await getBrowser();
    ctx = await browser.newContext({ viewport: { width: F.w, height: F.h }, deviceScaleFactor: Q.scale });
    const page = await ctx.newPage();
    await page.goto(composeUrl(opts, 0), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 45_000 });

    ff = spawn(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', opts.quality === '4k' ? 'fast' : 'medium',
      '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      out,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d; });
    const ffDone = new Promise((resolve, reject) => {
      ff.on('error', (e) => reject(userError(NO_FFMPEG + ' (' + e.code + ')')));
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Video encoder failed: ' + ffErr.slice(-300)))));
    });
    ff.stdin.on('error', () => {});

    const base = 0, span = 1;
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      if (job.cancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      await page.evaluate((s) => window.__seek(s), i / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      job.frame = i + 1;
      job.progress = base + span * ((i + 1) / frames);
      job.etaSec = Math.max(0, Math.round(((Date.now() - t0) / 1000 / (i + 1)) * (frames - i - 1)));
    }
    job.phase = 'encoding';
    ff.stdin.end();
    await ffDone;
    job.file = out;
    job.size = fs.statSync(out).size;
  } catch (e) {
    try { ff && ff.kill('SIGKILL'); } catch { /* ignore */ }
    fs.rmSync(out, { force: true });
    throw e;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

function enqueue(job) {
  job.status = 'queued';
  queue = queue.then(async () => {
    if (job.cancelled) { job.status = 'cancelled'; return; }
    job.status = 'rendering';
    const t0 = Date.now();
    console.log(`[motionframe] render ${job.id} started (${job.opts.motion}, ${job.opts.quality}, ${job.opts.device}, ${job.opts.format})`);
    try {
      await runRender(job);
      console.log(`[motionframe] render ${job.id} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      job.status = 'done'; job.progress = 1; job.etaSec = 0;
    } catch (e) {
      if (e.cancelled) job.status = 'cancelled';
      else { job.status = 'error'; job.error = e.user ? e.message : 'Rendering failed. ' + String(e.message).split('\n')[0].slice(0, 240); console.error(`[motionframe] render ${job.id} FAILED:`, e && e.stack || e); }
    }
  });
}

/* ------------------------------------------------------------------ http */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/fonts/sans', express.static(path.join(ROOT, 'node_modules/@fontsource/hanken-grotesk/files'), { maxAge: '30d' }));
app.use('/fonts/mono', express.static(path.join(ROOT, 'node_modules/@fontsource/jetbrains-mono/files'), { maxAge: '30d' }));
app.use('/captures', express.static(path.join(DATA, 'captures'), { maxAge: '5m' }));
app.use('/media', express.static(path.join(DATA, 'videos')));
app.use('/frames', express.static(path.join(DATA, 'frames'), { maxAge: 0 }));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (!e.user) console.error(e);
  res.status(e.user ? 400 : 500).json({ error: e.user ? e.message : 'Something went wrong on our side. Please try again.' });
});

app.post('/api/capture', wrap(async (req, res) => {
  const url = await normalizeUrl(req.body.url);
  res.json(await capture(url, req.body.device || 'macbook', !!req.body.fresh));
}));

app.get('/api/capture/:id', (req, res) => {
  const m = captures.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

app.post('/api/render', wrap(async (req, res) => {
  const b = req.body || {};
  if (!captures.has(b.captureId)) throw userError('That preview expired. Reload the site and try again.');
  const fps = Number(b.fps || 30);
  if (!DEVICES[b.device] || !FORMATS[b.format] || !QUALITIES[b.quality] || !SPEEDS[b.speed] || !FPS_OPTIONS.includes(fps)) throw userError('Invalid settings.');
  if (!FFMPEG) throw userError(NO_FFMPEG);
  const motion = MOTIONS[b.motion] ? b.motion : 'live';
  const pending = [...jobs.values()].filter((j) => j.status === 'queued' || j.status === 'rendering').length;
  if (pending >= 4) throw userError('The renderer is busy. Please try again in a minute.');
  const backdrop = b.backdrop === 'custom' || BACKDROPS[b.backdrop] ? b.backdrop : 'aurora';
  const job = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    opts: {
      captureId: b.captureId, device: b.device, format: b.format, quality: b.quality, speed: b.speed, fps, backdrop, motion,
      custom: /^#[0-9a-f]{6}$/i.test(b.custom || '') ? b.custom : '',
    },
    progress: 0, etaSec: null, createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  enqueue(job);
  res.json({ jobId: job.id });
}));

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Unknown job' });
  const ahead = j.status === 'queued' ? [...jobs.values()].filter((x) => x.createdAt < j.createdAt && (x.status === 'queued' || x.status === 'rendering')).length : 0;
  res.json({
    status: j.status, progress: j.progress, etaSec: j.etaSec, error: j.error, size: j.size, duration: j.duration,
    frame: j.frame || 0, frames: j.frames || 0, fps: j.fps, width: j.width, height: j.height, phase: j.phase, ahead,
    videoUrl: j.status === 'done' ? `/media/${j.id}.mp4` : undefined,
  });
});

app.delete('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (j) { j.cancelled = true; try { j.kill && j.kill(); } catch { /* ignore */ } }
  res.json({ ok: true });
});

app.get('/api/download/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done') return res.status(404).send('Not ready');
  const meta = captures.get(j.opts.captureId);
  const name = `motionframe-${(meta?.host || 'site').replace(/[^a-z0-9.-]/gi, '-')}-${j.opts.device}-${j.opts.format.replace(':', 'x')}.mp4`;
  res.download(j.file, name);
});

app.get('/api/health', (_req, res) => res.json({ ok: true, allowPrivate: ALLOW_PRIVATE, encoder: !!FFMPEG }));

// Housekeeping: drop captures/videos older than 2 hours.
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600_000;
  for (const [id, m] of captures) {
    if (m.createdAt < cutoff) { captures.delete(id); for (let i = 0; i < m.strips; i++) fs.rmSync(stripPath(id, i), { force: true }); }
  }
  for (const [id, j] of jobs) if (j.createdAt < cutoff) { jobs.delete(id); if (j.file) fs.rmSync(j.file, { force: true }); }
}, 10 * 60_000).unref();

app.listen(PORT, HOST, () => {
  if (!FFMPEG) console.warn('motionframe: WARNING — no working ffmpeg found; videos can’t be rendered. ' + NO_FFMPEG);
  console.log(`motionframe running → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${ALLOW_PRIVATE ? '' : '  (private addresses blocked)'}`);
});
process.on('unhandledRejection', (e) => console.error('[motionframe] unhandled rejection:', e && e.stack || e));
process.on('uncaughtException', (e) => console.error('[motionframe] uncaught exception:', e && e.stack || e));
const shutdown = async () => { try { (await browserPromise)?.close(); } catch { /* ignore */ } process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
