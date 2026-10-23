import { DEVICES, FORMATS, QUALITIES, BACKDROPS, SPEEDS, FPS_OPTIONS, LENGTHS } from './shared.js';
import { TRACKS, buildBed, decodeUpload } from './audio.js';
import { drawScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const el = {
  form: $('urlForm'), url: $('url'), go: $('go'), hint: $('urlHint'), recent: $('recent'), warn: $('warn'),
  devices: $('devices'), backdrops: $('backdrops'), formats: $('formats'), speeds: $('speeds'), lengths: $('lengths'), tracks: $('tracks'), musicFile: $('musicFile'), musicName: $('musicName'), vol: $('vol'), qualities: $('qualities'), fpsOpts: $('fpsOpts'), push: $('push'),
  status: $('status'), statusText: $('statusText'), exportBtn: $('export'), exportText: $('exportText'), fine: $('fine'),
  stage: $('stage'), canvas: $('canvas'), stageMeta: $('stageMeta'), caption: $('caption'), video: $('rec'),
  overlay: $('overlay'), ovPhase: $('ovPhase'), ovPct: $('ovPct'), ovBar: $('ovBar'), ovSub: $('ovSub'), ovCancel: $('ovCancel'),
  play: $('play'), icoPlay: $('icoPlay'), icoPause: $('icoPause'), scrub: $('scrub'), time: $('time'),
};

/* ------------------------------------------------------------------ state */
const KEY = 'motionframe.v2';
// Ask the server for a recording this browser can play (H.264 almost everywhere; VP9 for browsers without it).
const REC_CODEC = document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"') ? 'h264' : 'vp9';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
const state = {
  device: DEVICES[saved.device] ? saved.device : 'macbook',
  backdrop: BACKDROPS[saved.backdrop] || saved.backdrop === 'custom' ? saved.backdrop : 'aurora',
  custom: /^#[0-9a-f]{6}$/i.test(saved.custom || '') ? saved.custom : '',
  format: FORMATS[saved.format] ? saved.format : '16:9',
  speed: SPEEDS[saved.speed] ? saved.speed : 'normal',
  length: LENGTHS.includes(saved.length) ? saved.length : 0,
  track: TRACKS[saved.track] && saved.track !== 'upload' ? saved.track : 'none',
  volume: typeof saved.volume === 'number' ? saved.volume : 0.8,
  uploaded: null, uploadName: '',
  quality: QUALITIES[saved.quality] ? saved.quality : '1080p',
  fps: FPS_OPTIONS.includes(saved.fps) ? saved.fps : 30,
  push: saved.push !== false,
  recent: Array.isArray(saved.recent) ? saved.recent.slice(0, 3) : [],
  phase: 'empty',     // empty | recording | ready | error | exporting
  rec: null,          // current recording (server view)
  latest: null,       // newest frame while recording
  err: '',
  lastUrl: '',
};
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ device: state.device, backdrop: state.backdrop, custom: state.custom, format: state.format, speed: state.speed, length: state.length, track: state.track, volume: state.volume, quality: state.quality, fps: state.fps, push: state.push, recent: state.recent })); } catch { /* storage blocked */ } };

/* ------------------------------------------------------------------ option pickers */
const ICONS = {
  macbook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="10" rx="1.6"/><path d="M2.5 19h19"/></svg>',
  desktop: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/></svg>',
  phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2.6"/><path d="M11 18h2"/></svg>',
  browser: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.4"/><path d="M3 9h18"/></svg>',
};
function radio(parent, items, get, pick, cls = 'chip') {
  parent.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.setAttribute('role', 'radio'); b.dataset.v = it.value;
    if (it.style) b.style.background = it.style;
    b.innerHTML = it.html || '';
    if (it.title) { b.title = it.title; b.setAttribute('aria-label', it.title); }
    b.addEventListener('click', () => pick(it.value));
    parent.appendChild(b);
  }
  parent.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const vals = items.map((i) => String(i.value)), i = vals.indexOf(String(get()));
    const n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + vals.length) % vals.length;
    e.preventDefault(); pick(items[n].value); parent.querySelector(`[data-v="${vals[n]}"]`)?.focus();
  });
  return () => parent.querySelectorAll('[role=radio]').forEach((b) => { const on = b.dataset.v === String(get()); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
}
const syncs = [
  radio(el.devices, Object.entries(DEVICES).map(([k, d]) => ({ value: k, html: `${ICONS[k]}${d.label}` })), () => state.device, (v) => setRecordOpt('device', v)),
  radio(el.formats, Object.keys(FORMATS).map((k) => ({ value: k, html: k })), () => state.format, (v) => { state.format = v; persist(); sizeCanvas(); refresh(); }),
  radio(el.lengths, LENGTHS.map((n) => ({ value: n, html: n ? `${n}s` : 'Auto' })), () => state.length, (v) => setRecordOpt('length', Number(v))),
  radio(el.tracks, Object.entries(TRACKS).map(([k, t]) => ({ value: k, html: t.label })), () => state.track, (v) => setTrack(v)),
  radio(el.speeds, Object.entries(SPEEDS).map(([k, s]) => ({ value: k, html: s.label })), () => state.speed, (v) => setRecordOpt('speed', v)),
  radio(el.qualities, Object.entries(QUALITIES).map(([k, q]) => ({ value: k, html: `${q.label} <small>${q.note}</small>` })), () => state.quality, (v) => setRecordOpt('quality', v)),
  radio(el.fpsOpts, FPS_OPTIONS.map((f) => ({ value: f, html: `${f} fps` })), () => state.fps, (v) => setRecordOpt('fps', Number(v))),
];
const syncBd = radio(el.backdrops, Object.entries(BACKDROPS).map(([k, b]) => ({ value: k, style: b.swatch, title: b.label })), () => state.backdrop, (v) => { state.backdrop = v; persist(); refresh(); }, 'sw');
const customSw = document.createElement('button');
customSw.type = 'button'; customSw.className = 'sw custom'; customSw.setAttribute('role', 'radio'); customSw.dataset.v = 'custom'; customSw.title = 'Custom colour';
customSw.innerHTML = '<span class="plus">+</span><input type="color" aria-label="Pick a custom backdrop colour" tabindex="-1">';
el.backdrops.appendChild(customSw);
const colorInput = customSw.querySelector('input');
colorInput.value = state.custom || '#e8c9a8';
colorInput.addEventListener('input', () => { state.custom = colorInput.value; state.backdrop = 'custom'; persist(); refresh(); });
customSw.addEventListener('click', (e) => { if (e.target !== colorInput) { if (state.custom) { state.backdrop = 'custom'; refresh(); } colorInput.click(); } });
const swName = document.createElement('p'); swName.className = 'swname'; el.backdrops.after(swName);
el.push.checked = state.push;
el.push.addEventListener('change', () => { state.push = el.push.checked; persist(); });

/* ------------------------------------------------------------------ canvas preview */
const ctx = el.canvas.getContext('2d');
function sizeCanvas() {
  const F = FORMATS[state.format];
  el.stage.style.aspectRatio = `${F.w} / ${F.h}`;
  el.stage.style.setProperty('--ar', (F.w / F.h).toFixed(4));
  const cssW = el.stage.clientWidth || 800;
  const w = Math.min(F.w, Math.round(cssW * Math.min(2, devicePixelRatio || 1)));
  el.canvas.width = w; el.canvas.height = Math.round((w * F.h) / F.w);
}
addEventListener('resize', sizeCanvas);

let latestImg = null;
function frameOpts(source, p) {
  return {
    format: state.format, device: state.device, backdrop: state.backdrop, custom: state.custom,
    source, host: state.rec ? state.rec.host : '', p: state.push ? p : 0,
    placeholder: state.phase === 'recording' ? ['Recording your site…', 'It appears here as it records.'] : state.phase === 'error' ? ['Couldn’t record that site', 'Check the link and try again.'] : undefined,
  };
}
function draw() {
  if (state.phase !== 'exporting') {
    const v = el.video, ready = state.phase === 'ready' && v.readyState >= 2;
    const src = ready ? v : (state.phase === 'recording' && latestImg && latestImg.complete && latestImg.naturalWidth ? latestImg : null);
    const p = ready && v.duration ? v.currentTime / v.duration : 0;
    drawScene(ctx, el.canvas.width, el.canvas.height, frameOpts(src, p));
    if (ready && v.duration) {
      el.scrub.value = Math.round(p * 1000); el.scrub.style.setProperty('--p', (p * 100).toFixed(1) + '%');
      el.time.textContent = `${v.currentTime.toFixed(1)} / ${v.duration.toFixed(1)}s`;
    }
  }
  requestAnimationFrame(draw);
}

/* ------------------------------------------------------------------ player */
function syncPlayer() {
  const ready = state.phase === 'ready';
  el.play.disabled = !ready; el.scrub.disabled = !ready;
  const playing = ready && !el.video.paused;
  el.icoPlay.hidden = playing; el.icoPause.hidden = !playing;
  el.play.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
}
el.play.addEventListener('click', () => { if (el.video.paused) el.video.play().catch(() => {}); else el.video.pause(); });
el.video.addEventListener('play', syncPlayer); el.video.addEventListener('pause', syncPlayer);
el.scrub.addEventListener('input', () => { if (el.video.duration) { el.video.pause(); el.video.currentTime = (el.scrub.value / 1000) * el.video.duration; } });
addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|BUTTON|SUMMARY|A/.test(document.activeElement?.tagName || '') && !el.play.disabled) { e.preventDefault(); el.play.click(); } });


/* ------------------------------------------------------------------ music */
let ac = null, bed = null, bedKey = '', bedSrc = null, lastT = 0;
const audioCtx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
addEventListener('pointerdown', () => { try { audioCtx().resume(); } catch { /* ignore */ } }, { capture: true });
el.vol.value = Math.round(state.volume * 100);
function musicLabel() {
  if (state.track === 'none') return 'No music. Pick a track, or upload your own.';
  if (state.track === 'upload') return state.uploadName ? `♪ ${state.uploadName}` : 'Choose an audio file…';
  return `♪ ${TRACKS[state.track].label}, an original track made for your film`;
}
async function setTrack(v) {
  if (v === 'upload') { el.musicFile.click(); return; }
  state.track = v; persist(); refresh(); await rebuildBed();
}
el.musicFile.addEventListener('change', async () => {
  const f = el.musicFile.files && el.musicFile.files[0]; el.musicFile.value = '';
  if (!f) return;
  try {
    el.musicName.textContent = 'Reading your audio…';
    state.uploaded = await decodeUpload(f); state.uploadName = f.name; state.track = 'upload';
    refresh(); await rebuildBed();
  } catch { state.uploaded = null; el.musicName.textContent = 'Couldn’t read that file. Try an MP3, M4A or WAV.'; }
});
let volTimer = null;
el.vol.addEventListener('input', () => { state.volume = el.vol.value / 100; persist(); clearTimeout(volTimer); volTimer = setTimeout(rebuildBed, 250); });
async function rebuildBed() {
  const dur = state.phase === 'ready' || state.phase === 'exporting' ? el.video.duration : 0;
  const key = `${state.track}|${dur}|${state.volume}|${state.uploadName}`;
  if (key === bedKey) return;
  bedKey = key;
  bed = dur && state.track !== 'none' ? await buildBed(state.track, dur, state.volume, state.uploaded).catch(() => null) : null;
  if (key === bedKey) { el.musicName.textContent = musicLabel(); if (!el.video.paused) playBed(); else stopBed(); }
}
function stopBed() { try { bedSrc && bedSrc.stop(); } catch { /* ignore */ } bedSrc = null; }
function playBed() {
  stopBed();
  if (!bed || state.phase !== 'ready') return;
  const c = audioCtx(); if (c.state === 'suspended') c.resume();
  bedSrc = c.createBufferSource(); bedSrc.buffer = bed; bedSrc.connect(c.destination);
  bedSrc.start(0, Math.min(bed.duration - 0.01, el.video.currentTime));
}
el.video.addEventListener('play', playBed);
el.video.addEventListener('pause', stopBed);
el.video.addEventListener('seeked', () => { if (!el.video.paused) playBed(); });
el.video.addEventListener('timeupdate', () => { const t = el.video.currentTime; if (t + 0.5 < lastT && !el.video.paused) playBed(); lastT = t; }); // film looped

/* ------------------------------------------------------------------ status */
function setStatus(kind, text) { el.status.dataset.s = kind; el.statusText.textContent = text; }
const DEFAULT_HINT = 'Press Enter. We record your live site once, then you can restyle it instantly.';
function setHint(text, err = false) { el.hint.textContent = text; el.hint.classList.toggle('err', err); el.url.classList.toggle('bad', err); }

function refresh() {
  syncs.forEach((s) => s()); syncBd();
  customSw.setAttribute('aria-checked', String(state.backdrop === 'custom'));
  customSw.classList.toggle('has', !!state.custom);
  if (state.custom) customSw.style.setProperty('--c', state.custom);
  el.musicName.textContent = musicLabel();
  swName.textContent = state.backdrop === 'custom' ? `Custom · ${state.custom}` : BACKDROPS[state.backdrop].label;
  const F = FORMATS[state.format], q = QUALITIES[state.quality];
  el.stageMeta.textContent = `${F.w * q.scale} × ${F.h * q.scale} · ${q.label}${state.fps === 60 ? ' · 60fps' : ''}`;
  el.exportBtn.disabled = state.phase !== 'ready';
  el.exportText.textContent = state.phase === 'exporting' ? 'Exporting…' : `Download ${q.label} MP4`;
  if (state.err) setStatus('error', state.err);
  else if (state.phase === 'ready') setStatus('ready', `Ready · ${state.rec.duration.toFixed(1)}s film of ${state.rec.host}`);
  else if (state.phase === 'empty') setStatus('idle', 'Paste a link to begin');
  syncPlayer();
}

/* ------------------------------------------------------------------ recording */
async function api(path, opts) {
  let r;
  try { r = await fetch(path, opts && { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) }); }
  catch { throw new Error('Lost connection to the motionframe server. Check that it’s still running.'); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || `The server didn’t respond properly (HTTP ${r.status}). Check the terminal where motionframe is running.`);
  return j || {};
}

let pollTimer = null, token = 0;
function setRecordOpt(k, v) {
  if (state[k] === v) return;
  state[k] = v; persist(); refresh();
  if (state.lastUrl && state.phase !== 'exporting') startRecording(state.lastUrl);
}

async function startRecording(raw) {
  const my = ++token;
  clearTimeout(pollTimer);
  if (state.rec && state.rec.state !== 'done') fetch(`/api/record/${state.rec.id}`, { method: 'DELETE' }).catch(() => {});
  el.video.pause(); el.video.removeAttribute('src'); el.video.load(); stopBed(); bed = null; bedKey = '';
  latestImg = null; state.err = ''; state.phase = 'recording'; state.lastUrl = raw;
  el.go.classList.add('busy'); setHint(DEFAULT_HINT);
  showOverlay({ state: 'queued', progress: 0 }); setStatus('busy', 'Recording your site…'); refresh();
  try {
    const rec = await api('/api/record', { method: 'POST', body: { url: raw, device: state.device, speed: state.speed, length: state.length, quality: state.quality, fps: state.fps, codec: REC_CODEC } });
    if (my !== token) return;
    state.rec = rec; remember(rec.url);
    el.url.value = rec.url.replace(/^https:\/\//, '').replace(/\/$/, '');
    poll(my);
  } catch (e) { if (my === token) fail(e.message); }
}

async function poll(my) {
  try {
    const r = await api(`/api/record/${state.rec.id}`);
    if (my !== token) return;
    state.rec = r;
    if (r.state === 'done') return loaded(my);
    if (r.state === 'error') return fail(r.error || 'Recording failed.');
    if (r.state === 'cancelled') return;
    showOverlay(r);
    if (r.state === 'recording' && r.frame) { const img = new Image(); img.onload = () => { if (my === token) latestImg = img; }; img.src = `/api/record/${r.id}/latest.jpg?t=${Date.now()}`; }
  } catch (e) { if (my === token) return fail(e.message); }
  pollTimer = setTimeout(() => poll(my), 700);
}

function loaded(my) {
  const r = state.rec;
  el.video.src = r.videoUrl; el.video.loop = true;
  el.video.addEventListener('loadeddata', () => {
    if (my !== token) return;
    state.phase = 'ready'; latestImg = null; hideOverlay(); el.go.classList.remove('busy');
    setHint(r.truncated ? `Very long page — filming the first ${r.pageHeight.toLocaleString()}px of ${r.fullHeight.toLocaleString()}px.` : (r.title ? `Recorded “${r.title.slice(0, 60)}”. Change backdrop or format freely — it’s instant.` : DEFAULT_HINT));
    el.video.play().catch(() => {});
    refresh(); bedKey = ''; rebuildBed();
  }, { once: true });
  el.video.load();
}

function fail(msg) {
  state.phase = 'error'; state.err = msg; hideOverlay(); el.go.classList.remove('busy');
  setHint(msg, true); refresh();
}

const fmtEta = (s) => (s == null ? '' : s < 60 ? `${Math.max(1, s)}s left` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s left`);
function showOverlay(r) {
  el.overlay.hidden = false; el.overlay.classList.add('peek');
  const pct = Math.round((r.progress || 0) * 100);
  el.ovPct.textContent = pct; el.ovBar.style.width = pct + '%';
  if (r.state === 'queued') { el.ovPhase.textContent = 'In queue'; el.ovSub.textContent = r.ahead ? `${r.ahead} ahead of you…` : 'Starting the recorder…'; }
  else if (r.phase === 'loading' || !r.frames) { el.ovPhase.textContent = 'Opening your site'; el.ovSub.textContent = 'Loading the page and its videos…'; }
  else if (r.phase === 'encoding') { el.ovPhase.textContent = 'Finishing'; el.ovSub.textContent = 'Preparing the preview…'; }
  else { el.ovPhase.textContent = 'Recording your site'; el.ovSub.textContent = `Frame ${r.frame} of ${r.frames}${r.frame > 4 && r.etaSec != null ? ' · ' + fmtEta(r.etaSec) : ''}`; }
  setStatus('busy', r.state === 'queued' ? 'Waiting for the recorder…' : `Recording ${pct}%`);
}
function hideOverlay() { el.overlay.hidden = true; }
el.ovCancel.addEventListener('click', () => {
  if (state.phase === 'exporting') { exportCancel = true; return; }
  token++; clearTimeout(pollTimer);
  if (state.rec) fetch(`/api/record/${state.rec.id}`, { method: 'DELETE' }).catch(() => {});
  state.phase = 'empty'; state.rec = null; hideOverlay(); el.go.classList.remove('busy'); refresh();
});

function remember(url) { state.recent = [url, ...state.recent.filter((u) => u !== url)].slice(0, 3); persist(); renderRecent(); }
function renderRecent() {
  el.recent.innerHTML = '';
  if (!state.recent.length) return;
  const l = document.createElement('span'); l.className = 'lbl'; l.textContent = 'Recent'; el.recent.appendChild(l);
  for (const u of state.recent) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = u.replace(/^https?:\/\//, '').replace(/\/$/, ''); b.title = u;
    b.addEventListener('click', () => { el.url.value = u; startRecording(u); });
    el.recent.appendChild(b);
  }
}
el.form.addEventListener('submit', (e) => { e.preventDefault(); const v = el.url.value.trim(); if (!v) { setHint('Paste a website link first.', true); return; } startRecording(v); });
el.url.addEventListener('input', () => { if (el.url.classList.contains('bad')) setHint(DEFAULT_HINT); });

/* ------------------------------------------------------------------ export (in the browser) */
let exportCancel = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function seek(v, t) {
  return new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done); v.currentTime = t;
  });
}
async function pickAudio() {
  if (!('AudioEncoder' in window)) return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* next */ }
  }
  return null;
}
async function encodeAudio(buf, muxer, cfg) {
  let err = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { err = e; } });
  enc.configure(cfg);
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, N = 4800;
  for (let i = 0; i < buf.length; i += N) {
    const n = Math.min(N, buf.length - i), data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / buf.sampleRate) * 1e6), data });
    enc.encode(ad); ad.close();
    if (err) throw err;
  }
  await enc.flush(); enc.close();
  if (err) throw err;
}
async function pickCodec(W, H, fps, bitrate) {
  // H.264 first (plays everywhere, what X/LinkedIn want); VP9-in-MP4 as a fallback for browsers without an H.264 encoder.
  for (const [codec, mux] of [['avc1.640034', 'avc'], ['avc1.640033', 'avc'], ['avc1.64002a', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42e034', 'avc'], ['vp09.00.51.08', 'vp9'], ['vp09.00.41.08', 'vp9']]) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps, ...(mux === 'avc' ? { avc: { format: 'avc' } } : {}) };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* try next */ }
  }
  return null;
}
function saveBlob(blob, ext) {
  const name = `motionframe-${(state.rec.host || 'site').replace(/[^a-z0-9.-]/gi, '-')}-${state.device}-${state.format.replace(':', 'x')}.${ext}`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  return name;
}
function exportProgress(pct, sub) {
  el.overlay.hidden = false; el.overlay.classList.remove('peek'); el.ovPhase.textContent = 'Exporting your film'; el.ovPct.textContent = pct; el.ovBar.style.width = pct + '%'; el.ovSub.textContent = sub;
  setStatus('busy', `Exporting ${pct}%`);
}

el.exportBtn.addEventListener('click', async () => {
  if (state.phase !== 'ready') return;
  const F = FORMATS[state.format], q = QUALITIES[state.quality];
  const W = F.w * q.scale, H = F.h * q.scale, fps = state.fps, v = el.video;
  const frames = Math.max(1, Math.round(v.duration * fps));
  state.phase = 'exporting'; exportCancel = false; state.err = ''; refresh();
  v.pause(); v.loop = false; stopBed();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c2 = cv.getContext('2d');
  const t0 = performance.now();
  try {
    if ('VideoEncoder' in window) {
      const { Muxer, ArrayBufferTarget } = await import('/vendor/mp4-muxer.mjs');
      const picked = await pickCodec(W, H, fps, Math.round(W * H * fps * 0.14));
      if (!picked) throw new Error('This browser can’t encode video at this size. Try 1080p, or Chrome on a computer.');
      const { cfg, mux } = picked;
      // music: rendered to exactly the film's length, encoded alongside the video
      const filmBed = state.track !== 'none' ? await buildBed(state.track, frames / fps, state.volume, state.uploaded).catch(() => null) : null;
      const aud = filmBed ? await pickAudio() : null;
      if (filmBed && !aud) state.err = 'Your browser can’t add audio to the video, so this export is silent. Chrome or Edge on a computer can.';
      const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: mux, width: W, height: H, frameRate: fps }, ...(aud ? { audio: { codec: aud.mux, numberOfChannels: 2, sampleRate: 48000 } } : {}), fastStart: 'in-memory' });
      let encErr = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
      enc.configure(cfg);
      for (let i = 0; i < frames; i++) {
        if (exportCancel) throw new Error('cancelled');
        if (encErr) throw encErr;
        await seek(v, Math.min(v.duration - 0.001, (i + 0.5) / fps));
        drawScene(c2, W, H, frameOpts(v, i / Math.max(1, frames - 1)));
        const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close();
        while (enc.encodeQueueSize > 6) await wait(4);
        if (i % 5 === 0 || i === frames - 1) {
          const done = (i + 1) / frames, el2 = (performance.now() - t0) / 1000;
          exportProgress(Math.round(done * 100), `Frame ${i + 1} of ${frames} · ${fmtEta(Math.round((el2 / done) * (1 - done)))}`);
          drawScene(ctx, el.canvas.width, el.canvas.height, frameOpts(v, i / Math.max(1, frames - 1)));
        }
      }
      await enc.flush(); enc.close();
      if (aud) { exportProgress(100, 'Adding music…'); await encodeAudio(filmBed, muxer, aud.cfg); }
      muxer.finalize();
      const name = saveBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'mp4');
      setHint(`Saved ${name} (${(muxer.target.buffer.byteLength / 1048576).toFixed(1)} MB)${aud ? ' with music' : ''}${mux === 'vp9' ? ' — VP9, since this browser can’t make H.264. Use Chrome or Safari for the most compatible file.' : '.'}`);
    } else {
      // Older browsers: record the canvas in real time (WebM).
      const stream = cv.captureStream(fps);
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm', videoBitsPerSecond: Math.round(W * H * fps * 0.14) });
      const parts = []; mr.ondataavailable = (e) => e.data.size && parts.push(e.data);
      const stopped = new Promise((r) => { mr.onstop = r; });
      await seek(v, 0); mr.start(); await v.play();
      await new Promise((res) => {
        const tick = () => {
          if (exportCancel || v.ended || v.currentTime >= v.duration - 0.02) return res();
          drawScene(c2, W, H, frameOpts(v, v.currentTime / v.duration));
          exportProgress(Math.round((v.currentTime / v.duration) * 100), 'Recording the film in real time (your browser has no MP4 encoder)…');
          requestAnimationFrame(tick);
        };
        tick();
      });
      mr.stop(); await stopped; v.pause();
      if (exportCancel) throw new Error('cancelled');
      const name = saveBlob(new Blob(parts, { type: 'video/webm' }), 'webm');
      setHint(`Saved ${name}. Your browser can’t make MP4, so this is WebM${state.track !== 'none' ? ' (without music)' : ''}.`);
    }
  } catch (e) {
    if (e.message !== 'cancelled') state.err = 'Export failed: ' + (e.message || e);
  } finally {
    hideOverlay(); state.phase = 'ready'; v.loop = true; v.play().catch(() => {}); refresh();
  }
});

/* ------------------------------------------------------------------ boot */
fetch('/api/health').then((r) => r.json()).then((h) => {
  if (h && h.encoder === false) { el.warn.hidden = false; el.warn.textContent = 'Heads up: the recorder’s video encoder (ffmpeg) isn’t working on this computer. Run “npm install” again, or install ffmpeg, then restart.'; }
}).catch(() => {});
if (!('VideoEncoder' in window)) el.fine.textContent = 'Your browser can’t export MP4 directly, so downloads will be WebM. Chrome or Edge on a computer export MP4.';
sizeCanvas(); renderRecent(); refresh();
requestAnimationFrame(draw);
document.fonts?.ready.then(() => refresh());
el.url.focus();
