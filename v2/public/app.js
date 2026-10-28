import { DEVICES, FORMATS, QUALITIES, BACKDROPS, SPEEDS, FPS_OPTIONS, LENGTHS } from './shared.js';
import { TRACKS, buildBed, decodeUpload } from './audio.js';
import { drawScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const el = {
  form: $('urlForm'), url: $('url'), go: $('go'), hint: $('urlHint'), recent: $('recent'), warn: $('warn'),
  devices: $('devices'), backdrops: $('backdrops'), formats: $('formats'), speeds: $('speeds'), lengths: $('lengths'), tracks: $('tracks'),
  musicFile: $('musicFile'), musicName: $('musicName'), vol: $('vol'), qualities: $('qualities'), fpsOpts: $('fpsOpts'), push: $('push'),
  status: $('status'), statusText: $('statusText'), exportBtn: $('export'), exportText: $('exportText'), fine: $('fine'),
  stage: $('stage'), canvas: $('canvas'), stageMeta: $('stageMeta'), caption: $('caption'),
  overlay: $('overlay'), ovPhase: $('ovPhase'), ovPct: $('ovPct'), ovBar: $('ovBar'), ovSub: $('ovSub'), ovCancel: $('ovCancel'),
  play: $('play'), icoPlay: $('icoPlay'), icoPause: $('icoPause'), scrub: $('scrub'), time: $('time'),
};

/* ------------------------------------------------------------------ state */
const KEY = 'motionframe.v2';
// Ask the server for a recording this browser can play (H.264 almost everywhere; VP9 for browsers without it).
const REC_CODEC = document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"') ? 'h264' : 'vp9';
const KINDS = ['desktop', 'phone'];
const kindOf = (device) => DEVICES[device].rec;
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
const state = {
  device: DEVICES[saved.device] ? saved.device : 'macbook',
  backdrop: BACKDROPS[saved.backdrop] || saved.backdrop === 'custom' ? saved.backdrop : 'aurora',
  custom: /^#[0-9a-f]{6}$/i.test(saved.custom || '') ? saved.custom : '',
  format: FORMATS[saved.format] ? saved.format : '16:9',
  speed: SPEEDS[saved.speed] ? saved.speed : 'normal',
  length: LENGTHS.includes(saved.length) ? saved.length : 0,
  track: TRACKS[saved.track] ? saved.track : 'none',      // a built-in id, 'none', or 'mine'
  volume: typeof saved.volume === 'number' ? saved.volume : 0.8,
  uploaded: null, uploadName: '',
  quality: QUALITIES[saved.quality] ? saved.quality : '1080p',
  fps: FPS_OPTIONS.includes(saved.fps) ? saved.fps : 30,
  push: saved.push !== false,
  recent: Array.isArray(saved.recent) ? saved.recent.slice(0, 3) : [],
  phase: 'empty',     // for the device on screen: empty | recording | ready | error | exporting
  recs: { desktop: null, phone: null },   // server views of the two recordings
  ready: { desktop: false, phone: false },
  err: '',
  lastUrl: '',
};
const launch = { watermark: true };
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ device: state.device, backdrop: state.backdrop, custom: state.custom, format: state.format, speed: state.speed, length: state.length, track: state.track === 'mine' ? 'none' : state.track, volume: state.volume, quality: state.quality, fps: state.fps, push: state.push, recent: state.recent })); } catch { /* storage blocked */ } };

// one <video> per recording kind, so switching device is instant
const videos = { desktop: $('rec'), phone: document.createElement('video') };
Object.assign(videos.phone, { muted: true, playsInline: true, preload: 'auto', crossOrigin: 'anonymous' }); videos.phone.hidden = true; document.body.appendChild(videos.phone);
const activeKind = () => kindOf(state.device);
const V = () => videos[activeKind()];
const R = () => state.recs[activeKind()];

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
    b.type = 'button'; b.className = cls + (it.cls ? ' ' + it.cls : ''); b.dataset.v = it.value;
    if (!it.action) b.setAttribute('role', 'radio');
    if (it.style) b.style.background = it.style;
    b.innerHTML = it.html || '';
    if (it.title) { b.title = it.title; b.setAttribute('aria-label', it.title); }
    b.addEventListener('click', () => pick(it.value));
    parent.appendChild(b);
  }
  if (!parent.__keys) {
    parent.__keys = true;
    parent.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const btns = [...parent.querySelectorAll('[role=radio]')], vals = btns.map((b) => b.dataset.v);
      const i = vals.indexOf(String(parent.__get())), n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + vals.length) % vals.length;
      e.preventDefault(); btns[n].click(); btns[n].focus();
    });
  }
  parent.__get = get;
  return () => parent.querySelectorAll('[role=radio]').forEach((b) => { const on = b.dataset.v === String(get()); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
}
const syncs = [
  radio(el.devices, Object.entries(DEVICES).map(([k, d]) => ({ value: k, html: `${ICONS[k]}${d.label}` })), () => state.device, (v) => setDevice(v)),
  radio(el.formats, Object.keys(FORMATS).map((k) => ({ value: k, html: k })), () => state.format, (v) => { state.format = v; persist(); sizeCanvas(); refresh(); }),
  radio(el.lengths, LENGTHS.map((n) => ({ value: n, html: n ? `${n}s` : 'Auto' })), () => state.length, (v) => setRecordOpt('length', Number(v))),
  radio(el.speeds, Object.entries(SPEEDS).map(([k, s]) => ({ value: k, html: s.label })), () => state.speed, (v) => setRecordOpt('speed', v)),
  radio(el.qualities, Object.entries(QUALITIES).map(([k, q]) => ({ value: k, html: `${q.label} <small>${q.note}</small>` })), () => state.quality, (v) => setRecordOpt('quality', v)),
  radio(el.fpsOpts, FPS_OPTIONS.map((f) => ({ value: f, html: `${f} fps` })), () => state.fps, (v) => setRecordOpt('fps', Number(v))),
];
// Music chips are rebuilt when a song is uploaded, so "My song" stays selectable next to the built-in tracks.
let syncTracks = () => {};
function renderTracks() {
  const items = Object.entries(TRACKS).map(([k, t]) => ({ value: k, html: t.label }));
  if (state.uploaded) items.push({ value: 'mine', html: `♪ ${escapeHtml(shortName(state.uploadName))}`, cls: 'mine', title: `Your song: ${state.uploadName}` });
  items.push({ value: 'upload', html: state.uploaded ? 'Replace song…' : 'Upload song…', cls: 'add', action: true });
  syncTracks = radio(el.tracks, items, () => state.track, (v) => setTrack(v));
  syncTracks();
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortName = (n) => { const b = n.replace(/\.[a-z0-9]+$/i, ''); return b.length > 22 ? b.slice(0, 21) + '…' : b; };

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

const latestImg = { desktop: null, phone: null };
function frameOpts(source, p) {
  const r = R();
  return {
    format: state.format, device: state.device, backdrop: state.backdrop, custom: state.custom,
    source, host: r ? r.host : '', p: state.push ? p : 0, watermark: launch.watermark,
    placeholder: state.phase === 'recording' ? ['Recording your site…', 'It appears here as it records.'] : state.phase === 'error' ? ['Couldn’t record that site', 'Check the link and try again.'] : undefined,
  };
}
function draw() {
  if (state.phase !== 'exporting') {
    const v = V();
    // a video that is catching up after a device switch: hold the last frame instead of flashing the placeholder
    if (state.phase === 'ready' && v.readyState < 2) { requestAnimationFrame(draw); return; }
    const ready = state.phase === 'ready' && v.readyState >= 2, img = latestImg[activeKind()];
    const src = ready ? v : (state.phase === 'recording' && img && img.complete && img.naturalWidth ? img : null);
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
  const ready = state.phase === 'ready', v = V();
  el.play.disabled = !ready; el.scrub.disabled = !ready;
  const playing = ready && !v.paused;
  el.icoPlay.hidden = playing; el.icoPause.hidden = !playing;
  el.play.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
}
el.play.addEventListener('click', () => { const v = V(); if (v.paused) v.play().catch(() => {}); else v.pause(); });
el.scrub.addEventListener('input', () => { const v = V(); if (v.duration) { v.pause(); v.currentTime = (el.scrub.value / 1000) * v.duration; } });
addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|BUTTON|SUMMARY|A/.test(document.activeElement?.tagName || '') && !el.play.disabled) { e.preventDefault(); el.play.click(); } });

/* ------------------------------------------------------------------ music */
let ac = null, bedSrc = null, current = null, lastT = 0, bedReq = 0;
const beds = new Map(); // key -> AudioBuffer (cached so switching back is instant)
const audioCtx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
addEventListener('pointerdown', () => { try { audioCtx().resume(); } catch { /* ignore */ } }, { capture: true });
el.vol.value = Math.round(state.volume * 100);

function musicLabel() {
  if (state.track === 'none') return 'No music. Pick a track, or upload your own.';
  if (state.track === 'mine') {
    const film = state.phase === 'ready' ? V().duration : 0, song = state.uploaded ? state.uploaded.duration : 0;
    const len = `${Math.floor(song / 60)}:${String(Math.round(song % 60)).padStart(2, '0')}`;
    return `♪ ${state.uploadName} · ${len}${film && song && song < film ? ` · repeats smoothly to fill ${Math.round(film)}s` : film && song > film ? ` · fades out at ${Math.round(film)}s` : ''}`;
  }
  return `♪ ${TRACKS[state.track].label}, an original track made for your film`;
}
async function setTrack(v) {
  if (v === 'upload') { el.musicFile.click(); return; }
  state.track = v; persist(); refresh(); await updateMusic();
}
el.musicFile.addEventListener('change', async () => {
  const f = el.musicFile.files && el.musicFile.files[0]; el.musicFile.value = '';
  if (!f) return;
  try {
    el.musicName.textContent = 'Reading your audio…';
    state.uploaded = await decodeUpload(f); state.uploadName = f.name; state.track = 'mine';
    for (const k of [...beds.keys()]) if (k.startsWith('mine|')) beds.delete(k); // new song replaces the old one
    renderTracks(); refresh(); await updateMusic();
  } catch { el.musicName.textContent = 'Couldn’t read that file. Try an MP3, M4A or WAV.'; }
});
let volTimer = null;
el.vol.addEventListener('input', () => { state.volume = el.vol.value / 100; persist(); clearTimeout(volTimer); volTimer = setTimeout(updateMusic, 250); });

const bedKeyFor = (track, dur) => `${track}|${dur.toFixed(3)}|${state.volume}|${track === 'mine' ? state.uploadName : ''}`;
async function getBed(track, dur) {
  if (track === 'none' || !dur) return null;
  const key = bedKeyFor(track, dur);
  if (!beds.has(key)) beds.set(key, await buildBed(track, dur, state.volume, state.uploaded).catch(() => null));
  return beds.get(key);
}
// Builds (or reuses) the music for what's on screen and plays it in sync with the preview.
// Every call gets a ticket; only the newest one may change what's playing, so a slow older build can't take over.
async function updateMusic() {
  const ticket = ++bedReq;
  const dur = state.phase === 'ready' ? V().duration : 0;
  if (state.track !== 'none' && dur) el.musicName.textContent = 'Preparing music…';
  const b = await getBed(state.track, dur);
  if (ticket !== bedReq) return;
  current = b;
  el.musicName.textContent = musicLabel();
  if (!V().paused) playBed(); else stopBed();
}
function stopBed() { try { bedSrc && bedSrc.stop(); } catch { /* ignore */ } bedSrc = null; }
function playBed() {
  stopBed();
  if (!current || state.phase !== 'ready') return;
  const c = audioCtx(); if (c.state === 'suspended') c.resume();
  bedSrc = c.createBufferSource(); bedSrc.buffer = current; bedSrc.connect(c.destination);
  bedSrc.start(0, Math.min(current.duration - 0.01, V().currentTime));
}
for (const k of KINDS) {
  const v = videos[k], mine = () => activeKind() === k && state.phase === 'ready';
  v.addEventListener('play', () => { if (mine()) { playBed(); syncPlayer(); } });
  v.addEventListener('pause', () => { if (mine()) { stopBed(); syncPlayer(); } });
  v.addEventListener('seeked', () => { if (mine() && !v.paused) playBed(); });
  v.addEventListener('timeupdate', () => { if (!mine()) return; const t = v.currentTime; if (t + 0.5 < lastT && !v.paused) playBed(); lastT = t; }); // film looped
}

/* ------------------------------------------------------------------ status */
function setStatus(kind, text) { el.status.dataset.s = kind; el.statusText.textContent = text; }
const DEFAULT_HINT = 'Press Enter. We record your site once (desktop and phone), then you can restyle it instantly.';
function setHint(text, err = false) { el.hint.textContent = text; el.hint.classList.toggle('err', err); el.url.classList.toggle('bad', err); }

function refresh() {
  syncs.forEach((s) => s()); syncBd(); syncTracks();
  customSw.setAttribute('aria-checked', String(state.backdrop === 'custom'));
  customSw.classList.toggle('has', !!state.custom);
  if (state.custom) customSw.style.setProperty('--c', state.custom);
  if (el.musicName.textContent !== 'Preparing music…' && el.musicName.textContent !== 'Reading your audio…') el.musicName.textContent = musicLabel();
  swName.textContent = state.backdrop === 'custom' ? `Custom · ${state.custom}` : BACKDROPS[state.backdrop].label;
  const F = FORMATS[state.format], q = QUALITIES[state.quality];
  el.stageMeta.textContent = `${F.w * q.scale} × ${F.h * q.scale} · ${q.label}${state.fps === 60 ? ' · 60fps' : ''}`;
  el.exportBtn.disabled = state.phase !== 'ready';
  el.exportText.textContent = state.phase === 'exporting' ? 'Exporting…' : `Download ${q.label} MP4`;
  if (state.err) setStatus('error', state.err);
  else if (state.phase === 'ready') {
    const other = KINDS.find((k) => k !== activeKind()), o = state.recs[other];
    const bg = o && o.state !== 'done' && o.state !== 'error' ? ` · ${other} version ${Math.round((o.progress || 0) * 100)}%` : '';
    setStatus('ready', `Ready · ${R().duration.toFixed(1)}s film of ${R().host}${bg}`);
  } else if (state.phase === 'empty') setStatus('idle', 'Paste a link to begin');
  syncPlayer();
}

/* ------------------------------------------------------------------ recording (desktop + phone together) */
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

// Device switch: same recording → instant. Other recording → instant if it's done, otherwise show its progress.
function setDevice(v) {
  if (v === state.device || state.phase === 'exporting') return;
  const before = activeKind(), wasPlaying = state.phase === 'ready' && !V().paused, t = V().currentTime;
  state.device = v; persist();
  if (activeKind() !== before) {
    videos[before].pause(); stopBed();
    if (state.lastUrl) {
      updatePhase();
      if (state.phase === 'ready') { const nv = V(); if (nv.duration) nv.currentTime = t < nv.duration - 0.5 ? t : 0; if (wasPlaying || nv.paused) nv.play().catch(() => {}); updateMusic(); }
    }
  }
  refresh();
}

function updatePhase() {
  if (state.phase === 'exporting') return;
  const r = R(), k = activeKind();
  if (!state.lastUrl) { state.phase = 'empty'; hideOverlay(); return; }
  if (r && r.state === 'error') { state.phase = 'error'; state.err = r.error || 'Recording failed.'; hideOverlay(); setHint(state.err, true); return; }
  if (r && r.state === 'done' && state.ready[k]) { state.phase = 'ready'; hideOverlay(); return; }
  state.phase = 'recording'; showOverlay(r || { state: 'queued', progress: 0 });
}

async function startRecording(raw) {
  const my = ++token;
  clearTimeout(pollTimer);
  for (const k of KINDS) {
    const r = state.recs[k];
    if (r && r.state !== 'done') fetch(`/api/record/${r.id}`, { method: 'DELETE' }).catch(() => {});
    videos[k].pause(); videos[k].removeAttribute('src'); videos[k].load();
    state.recs[k] = null; state.ready[k] = false; latestImg[k] = null;
  }
  stopBed(); current = null;
  state.err = ''; state.lastUrl = raw;
  el.go.classList.add('busy'); setHint(DEFAULT_HINT);
  updatePhase(); refresh();
  // The device on screen is recorded first; the other one follows right behind it in the same queue.
  const order = [activeKind(), ...KINDS.filter((k) => k !== activeKind())];
  try {
    for (const k of order) {
      const rec = await api('/api/record', { method: 'POST', body: { url: raw, kind: k, speed: state.speed, length: state.length, quality: state.quality, fps: state.fps, codec: REC_CODEC } });
      if (my !== token) return;
      state.recs[k] = rec;
      if (rec.state === 'done') loadKind(k, my); // already recorded earlier with these settings: no waiting
      if (k === order[0]) { remember(rec.url); el.url.value = rec.url.replace(/^https:\/\//, '').replace(/\/$/, ''); }
    }
    poll(my);
  } catch (e) { if (my === token) fail(e.message); }
}

async function poll(my) {
  try {
    for (const k of KINDS) {
      const cur = state.recs[k];
      if (!cur || cur.state === 'done' || cur.state === 'error' || cur.state === 'cancelled') continue;
      const r = await api(`/api/record/${cur.id}`);
      if (my !== token) return;
      state.recs[k] = r;
      if (r.state === 'done') loadKind(k, my);
      else if (r.state === 'recording' && r.frame && k === activeKind()) {
        const img = new Image(); img.onload = () => { if (my === token) latestImg[k] = img; }; img.src = `/api/record/${r.id}/latest.jpg?t=${Date.now()}`;
      }
    }
  } catch (e) { if (my === token) return fail(e.message); }
  updatePhase(); refresh();
  const pending = KINDS.some((k) => { const r = state.recs[k]; return r && !['done', 'error', 'cancelled'].includes(r.state); });
  if (pending) pollTimer = setTimeout(() => poll(my), 700);
  else el.go.classList.remove('busy');
}

function loadKind(k, my) {
  const r = state.recs[k], v = videos[k];
  v.src = r.videoUrl; v.loop = true;
  v.addEventListener('loadeddata', () => {
    if (my !== token) return;
    state.ready[k] = true; latestImg[k] = null;
    if (k === activeKind()) {
      updatePhase();
      setHint(r.truncated ? `Very long page — filming the first ${r.pageHeight.toLocaleString()}px of ${r.fullHeight.toLocaleString()}px.` : (r.title ? `Recorded “${r.title.slice(0, 60)}”. Backdrop, format and music changes are instant.` : DEFAULT_HINT));
      v.play().catch(() => {});
      updateMusic();
    }
    refresh();
  }, { once: true });
  v.load();
}

function fail(msg) {
  state.phase = 'error'; state.err = msg; hideOverlay(); el.go.classList.remove('busy');
  setHint(msg, true); refresh();
}

const fmtEta = (s) => (s == null ? '' : s < 60 ? `${Math.max(1, s)}s left` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s left`);
function showOverlay(r) {
  el.overlay.hidden = false; el.overlay.classList.add('peek');
  const pct = Math.round((r.progress || 0) * 100), which = activeKind() === 'phone' ? 'phone' : 'desktop';
  el.ovPct.textContent = pct; el.ovBar.style.width = pct + '%';
  if (r.state === 'queued') { el.ovPhase.textContent = `Up next · ${which} version`; el.ovSub.textContent = r.ahead ? `Recording the other version first · ${r.ahead} ahead` : 'Starting the recorder…'; }
  else if (r.phase === 'loading' || !r.frames) { el.ovPhase.textContent = `Opening your site · ${which}`; el.ovSub.textContent = 'Loading the page and its videos…'; }
  else if (r.phase === 'encoding') { el.ovPhase.textContent = 'Finishing'; el.ovSub.textContent = 'Preparing the preview…'; }
  else { el.ovPhase.textContent = `Recording your site · ${which}`; el.ovSub.textContent = `Frame ${r.frame} of ${r.frames}${r.frame > 4 && r.etaSec != null ? ' · ' + fmtEta(r.etaSec) : ''}`; }
  setStatus('busy', r.state === 'queued' ? `Waiting for the ${which} recording…` : `Recording ${which} ${pct}%`);
}
function hideOverlay() { el.overlay.hidden = true; }
el.ovCancel.addEventListener('click', () => {
  if (state.phase === 'exporting') { exportCancel = true; return; }
  token++; clearTimeout(pollTimer);
  for (const k of KINDS) { const r = state.recs[k]; if (r && r.state !== 'done') fetch(`/api/record/${r.id}`, { method: 'DELETE' }).catch(() => {}); state.recs[k] = null; state.ready[k] = false; }
  state.lastUrl = ''; state.phase = 'empty'; hideOverlay(); el.go.classList.remove('busy'); refresh();
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
  const L = buf.getChannelData(0), Rt = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, N = 4800;
  for (let i = 0; i < buf.length; i += N) {
    const n = Math.min(N, buf.length - i), data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0); data.set(Rt.subarray(i, i + n), n);
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
  const name = `motionframe-${(R().host || 'site').replace(/[^a-z0-9.-]/gi, '-')}-${state.device}-${state.format.replace(':', 'x')}.${ext}`;
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
  const W = F.w * q.scale, H = F.h * q.scale, fps = state.fps, v = V();
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
      // music: the same track you hear in the preview, rendered to exactly the film's length
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
          const done = (i + 1) / frames, secs = (performance.now() - t0) / 1000;
          exportProgress(Math.round(done * 100), `Frame ${i + 1} of ${frames} · ${fmtEta(Math.round((secs / done) * (1 - done)))}`);
          drawScene(ctx, el.canvas.width, el.canvas.height, frameOpts(v, i / Math.max(1, frames - 1)));
        }
      }
      await enc.flush(); enc.close();
      if (aud) { exportProgress(100, 'Adding music…'); await encodeAudio(filmBed, muxer, aud.cfg); }
      muxer.finalize();
      const name = saveBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'mp4');
      setHint(`Saved ${name} (${(muxer.target.buffer.byteLength / 1048576).toFixed(1)} MB)${aud ? ' with music' : ''}${mux === 'vp9' ? ' — VP9, since this browser can’t make H.264. Use Chrome or Safari for the most compatible file.' : '.'}`);
    } else {
      // Older browsers: record the canvas in real time (WebM, no music).
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

// for automated checks: what is actually playing right now
window.__mfDebug = () => ({ track: state.track, phase: state.phase, device: state.device, kind: activeKind(), ready: { ...state.ready }, playingBedSecs: bedSrc && bedSrc.buffer ? bedSrc.buffer.duration : 0, currentIsCached: [...beds.entries()].find(([, b]) => b === current)?.[0] || null });

/* ------------------------------------------------------------------ boot */
fetch('/api/health').then((r) => r.json()).then((h) => {
  if (h) {
    launch.watermark = h.watermark !== false;
    if (h.waitlistUrl) { const w = $('waitlist'); w.href = h.waitlistUrl; w.hidden = false; }
    if (h.feedbackUrl) { const f = $('feedback'); f.href = h.feedbackUrl; f.textContent = `Feedback → ${h.feedbackLabel || 'us'}`; }
    if (!launch.watermark) document.querySelector('.beta-note').innerHTML = '<b>Free while in beta.</b>';
  }
  if (h && h.encoder === false) { el.warn.hidden = false; el.warn.textContent = 'Heads up: the recorder’s video encoder (ffmpeg) isn’t working on this computer. Run “npm install” again, or install ffmpeg, then restart.'; }
}).catch(() => {});
if (!('VideoEncoder' in window)) el.fine.textContent = 'Your browser can’t export MP4 directly, so downloads will be WebM. Chrome or Edge on a computer export MP4.';
renderTracks(); sizeCanvas(); renderRecent(); refresh();
requestAnimationFrame(draw);
document.fonts?.ready.then(() => refresh());
// Arriving from the landing page with a link (?url=…): fill it in and start recording straight away.
const fromLanding = new URLSearchParams(location.search).get('url');
if (fromLanding) {
  history.replaceState(null, '', location.pathname);
  el.url.value = fromLanding; startRecording(fromLanding);
} else el.url.focus();
