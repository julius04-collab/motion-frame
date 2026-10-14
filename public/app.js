import { DEVICES, FORMATS, QUALITIES, BACKDROPS, SPEEDS, MOTIONS, FPS_OPTIONS } from './shared.js';

const $ = (id) => document.getElementById(id);
const el = {
  form: $('urlForm'), url: $('url'), go: $('go'), hint: $('urlHint'), recent: $('recent'),
  devices: $('devices'), backdrops: $('backdrops'), formats: $('formats'), speeds: $('speeds'), motions: $('motions'), warn: $('warn'), qualities: $('qualities'), fpsOpts: $('fpsOpts'),
  status: $('status'), statusText: $('statusText'), generate: $('generate'), generateText: $('generateText'), download: $('download'),
  stage: $('stage'), frame: $('compose'), film: $('film'), stageMeta: $('stageMeta'), caption: $('caption'),
  tabPreview: $('tabPreview'), tabFilm: $('tabFilm'),
  render: $('render'), phase: $('renderPhase'), pct: $('renderPct'), bar: $('renderBar'), sub: $('renderSub'), cancel: $('cancel'),
  play: $('play'), icoPlay: $('icoPlay'), icoPause: $('icoPause'), scrub: $('scrub'), time: $('time'),
};

/* ------------------------------------------------------------------ state */
const saved = (() => { try { return JSON.parse(localStorage.getItem('motionframe.v2') || '{}'); } catch { return {}; } })();
const state = {
  device: DEVICES[saved.device] ? saved.device : 'macbook',
  backdrop: BACKDROPS[saved.backdrop] || saved.backdrop === 'custom' ? saved.backdrop : 'aurora',
  custom: /^#[0-9a-f]{6}$/i.test(saved.custom || '') ? saved.custom : '',
  format: FORMATS[saved.format] ? saved.format : '16:9',
  speed: SPEEDS[saved.speed] ? saved.speed : 'normal',
  motion: MOTIONS[saved.motion] ? saved.motion : 'live',
  quality: QUALITIES[saved.quality] ? saved.quality : '1080p',
  fps: FPS_OPTIONS.includes(saved.fps) ? saved.fps : 30,
  recent: Array.isArray(saved.recent) ? saved.recent.slice(0, 3) : [],
  capture: null,        // { id, host, ... }
  phase: 'empty',       // empty | loading | ready | error
  job: null,            // { id, status, ... }
  film: null,           // { jobId, url }
  duration: 0, playing: true,
};
const persist = () => { try { localStorage.setItem('motionframe.v2', JSON.stringify({ device: state.device, backdrop: state.backdrop, custom: state.custom, format: state.format, speed: state.speed, motion: state.motion, quality: state.quality, fps: state.fps, recent: state.recent })); } catch { /* storage blocked */ } };

/* ------------------------------------------------------------------ option builders */
const ICONS = {
  macbook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="10" rx="1.6"/><path d="M2.5 19h19"/></svg>',
  desktop: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/></svg>',
  phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2.6"/><path d="M11 18h2"/></svg>',
  browser: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.4"/><path d="M3 9h18"/></svg>',
};

function radio(parent, items, getValue, onPick, cls = 'chip') {
  parent.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.setAttribute('role', 'radio'); b.dataset.v = it.value;
    if (it.style) b.style.background = it.style;
    b.innerHTML = it.html || '';
    if (it.title) { b.title = it.title; b.setAttribute('aria-label', it.title); }
    b.addEventListener('click', () => onPick(it.value));
    parent.appendChild(b);
  }
  const sync = () => parent.querySelectorAll('[role=radio]').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.v === String(getValue()))); b.tabIndex = b.dataset.v === String(getValue()) ? 0 : -1; });
  // arrow-key navigation inside a radiogroup
  parent.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const vals = items.map((i) => String(i.value));
    const i = vals.indexOf(String(getValue()));
    const n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + vals.length) % vals.length;
    e.preventDefault(); onPick(items[n].value); parent.querySelector(`[data-v="${vals[n]}"]`)?.focus();
  });
  return sync;
}

const syncs = [];
syncs.push(radio(el.devices, Object.entries(DEVICES).map(([k, d]) => ({ value: k, html: `${ICONS[k]}${d.label}` })), () => state.device, (v) => setDevice(v)));

const bdItems = Object.entries(BACKDROPS).map(([k, b]) => ({ value: k, style: b.swatch, title: b.label }));
const syncBd = radio(el.backdrops, bdItems, () => state.backdrop, (v) => setBackdrop(v), 'sw');
// custom colour swatch
const customSw = document.createElement('button');
customSw.type = 'button'; customSw.className = 'sw custom'; customSw.setAttribute('role', 'radio'); customSw.dataset.v = 'custom'; customSw.title = 'Custom colour'; customSw.setAttribute('aria-label', 'Custom colour');
customSw.innerHTML = '<span class="plus">+</span><input type="color" aria-label="Pick a custom backdrop colour" tabindex="-1">';
el.backdrops.appendChild(customSw);
const colorInput = customSw.querySelector('input');
colorInput.value = state.custom || '#e8c9a8';
colorInput.addEventListener('input', () => { state.custom = colorInput.value; state.backdrop = 'custom'; applyBackdropUI(); pushConfig(); persist(); });
customSw.addEventListener('click', (e) => { if (e.target !== colorInput) { if (state.custom) { setBackdrop('custom'); } colorInput.click(); } });
const swName = document.createElement('p'); swName.className = 'swname'; el.backdrops.after(swName);
function applyBackdropUI() {
  syncBd();
  customSw.setAttribute('aria-checked', String(state.backdrop === 'custom'));
  customSw.classList.toggle('has', !!state.custom);
  if (state.custom) customSw.style.setProperty('--c', state.custom);
  swName.textContent = state.backdrop === 'custom' ? `Custom · ${state.custom}` : BACKDROPS[state.backdrop].label;
}

syncs.push(radio(el.formats, Object.keys(FORMATS).map((k) => ({ value: k, html: k })), () => state.format, (v) => setFormat(v)));
syncs.push(radio(el.motions, Object.entries(MOTIONS).map(([k, m]) => ({ value: k, html: `${m.label} <small>${m.note}</small>` })), () => state.motion, (v) => setOpt('motion', v)));
syncs.push(radio(el.speeds, Object.entries(SPEEDS).map(([k, s]) => ({ value: k, html: s.label })), () => state.speed, (v) => setOpt('speed', v)));
syncs.push(radio(el.qualities, Object.entries(QUALITIES).map(([k, q]) => ({ value: k, html: `${q.label} <small>${q.note}</small>` })), () => state.quality, (v) => setOpt('quality', v)));
syncs.push(radio(el.fpsOpts, FPS_OPTIONS.map((f) => ({ value: f, html: `${f} fps` })), () => state.fps, (v) => setOpt('fps', Number(v))));

/* ------------------------------------------------------------------ iframe bridge */
let frameReady = false, queued = null;
const post = (m) => el.frame.contentWindow?.postMessage({ source: 'motionframe-app', ...m }, '*');
function pushConfig(extra = {}) {
  const config = {
    device: state.device, bg: state.backdrop, custom: state.custom, format: state.format, speed: state.speed,
    state: state.phase === 'ready' ? 'ready' : state.phase === 'loading' ? 'loading' : state.phase === 'error' ? 'error' : 'empty',
    shot: state.phase === 'ready' && state.capture ? state.capture.id : '',
    message: '', ...extra,
  };
  if (!frameReady) { queued = config; return; }
  post({ type: 'config', config });
}

addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.source !== 'motionframe' || e.source !== el.frame.contentWindow) return;
  if (m.type === 'hello') { frameReady = true; pushConfig(queued || {}); queued = null; }
  if (m.type === 'info') { state.duration = m.duration; state.playing = m.playing; syncPlayer(); }
  if (m.type === 'tick') {
    el.scrub.value = Math.round(m.p * 1000);
    el.scrub.style.setProperty('--p', (m.p * 100).toFixed(1) + '%');
    el.time.textContent = `${(m.p * state.duration).toFixed(1)} / ${state.duration.toFixed(1)}s`;
  }
});

/* ------------------------------------------------------------------ player */
function syncPlayer() {
  const filmMode = !el.film.hidden;
  el.icoPlay.hidden = state.playing || filmMode; el.icoPause.hidden = !state.playing || filmMode;
  el.play.setAttribute('aria-label', state.playing ? 'Pause preview' : 'Play preview');
  const off = state.phase !== 'ready' && !filmMode;
  el.play.disabled = off; el.scrub.disabled = off;
}
el.play.addEventListener('click', () => {
  if (!el.film.hidden) return el.film.paused ? el.film.play() : el.film.pause();
  state.playing = !state.playing; post({ type: state.playing ? 'play' : 'pause' }); syncPlayer();
});
el.scrub.addEventListener('input', () => {
  if (!el.film.hidden) { if (el.film.duration) el.film.currentTime = (el.scrub.value / 1000) * el.film.duration; return; }
  state.playing = false; post({ type: 'seek', p: el.scrub.value / 1000 }); syncPlayer();
  el.scrub.style.setProperty('--p', (el.scrub.value / 10) + '%');
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/INPUT|BUTTON|SUMMARY|A/.test(document.activeElement?.tagName || '') && !el.play.disabled) { e.preventDefault(); el.play.click(); }
});
// film playback keeps the same scrubber
el.film.addEventListener('timeupdate', () => {
  if (el.film.hidden || !el.film.duration) return;
  const p = el.film.currentTime / el.film.duration;
  el.scrub.value = Math.round(p * 1000); el.scrub.style.setProperty('--p', (p * 100).toFixed(1) + '%');
  el.time.textContent = `${el.film.currentTime.toFixed(1)} / ${el.film.duration.toFixed(1)}s`;
});
el.film.addEventListener('play', () => { state.playing = true; syncPlayer(); });
el.film.addEventListener('pause', () => { state.playing = false; syncPlayer(); });

/* ------------------------------------------------------------------ status + buttons */
function setStatus(kind, text) { el.status.dataset.s = kind; el.statusText.textContent = text; }
function setHint(text, err = false) { el.hint.textContent = text; el.hint.classList.toggle('err', err); el.url.classList.toggle('bad', err); }
const DEFAULT_HINT = 'Press Enter to preview the site here, then generate a clean mockup-only video. No screen sharing needed.';

function refreshControls() {
  const q = QUALITIES[state.quality];
  const rendering = state.job && ['queued', 'rendering'].includes(state.job.status);
  el.generateText.textContent = rendering ? 'Rendering…' : `Generate ${q.label} video`;
  el.generate.disabled = state.phase !== 'ready' || rendering;
  const F = FORMATS[state.format];
  el.stageMeta.textContent = `${F.w * q.scale} × ${F.h * q.scale} · ${q.label}${state.fps === 60 ? ' · 60fps' : ''}`;
  const hasFilm = !!state.film;
  el.download.classList.toggle('disabled', !hasFilm);
  el.download.setAttribute('aria-disabled', String(!hasFilm));
  el.download.tabIndex = hasFilm ? 0 : -1;
  if (hasFilm) { el.download.href = `/api/download/${state.film.jobId}`; } else el.download.removeAttribute('href');
  el.stage.style.aspectRatio = `${F.w} / ${F.h}`;
  el.stage.style.setProperty('--ar', (F.w / F.h).toFixed(4));
  if (state.phase === 'ready' && !rendering && !state.film) setStatus('ready', `Ready to generate in ${q.label}`);
  if (state.phase === 'ready' && state.film && !rendering) setStatus('done', 'Film ready — download it or tweak and re-render');
  if (el.film.hidden) el.caption.textContent = state.motion === 'live' ? 'This preview shows the layout. Animations, background video and sticky headers are recorded live when you generate the film.' : 'Still mode scrolls a screenshot of the page. Switch to Live to include animations and video.';
  syncs.forEach((s) => s()); applyBackdropUI(); syncPlayer();
}

/* ------------------------------------------------------------------ option setters */
function invalidateFilm() {
  if (!state.film) return;
  state.film = null; el.film.pause(); el.film.removeAttribute('src'); el.film.load();
  showTab('preview'); el.tabFilm.hidden = true;
}
function setBackdrop(v) { state.backdrop = v; pushConfig(); persist(); invalidateFilm(); refreshControls(); }
function setFormat(v) { state.format = v; pushConfig(); persist(); invalidateFilm(); refreshControls(); }
function setOpt(k, v) { state[k] = v; persist(); if (k === 'speed') { pushConfig(); } invalidateFilm(); refreshControls(); }
function setDevice(v) {
  if (v === state.device) return;
  state.device = v; persist(); invalidateFilm();
  if (state.capture || state.phase === 'ready' || state.phase === 'error') loadSite({ keepHint: true }); else { pushConfig(); refreshControls(); }
}
// colour picks also invalidate
colorInput.addEventListener('input', invalidateFilm);

/* ------------------------------------------------------------------ tabs */
function showTab(which) {
  const film = which === 'film' && state.film;
  el.tabPreview.classList.toggle('on', !film); el.tabFilm.classList.toggle('on', !!film);
  el.tabPreview.setAttribute('aria-selected', String(!film)); el.tabFilm.setAttribute('aria-selected', String(!!film));
  el.film.hidden = !film; el.frame.style.visibility = film ? 'hidden' : '';
  if (film) { el.film.currentTime = 0; el.play.disabled = false; el.scrub.disabled = false; }
  else el.film.pause();
  el.caption.textContent = film ? 'This is the exact file you’ll download.' : (state.motion === 'live' ? 'This preview shows the layout. Animations, background video and sticky headers are recorded live when you generate the film.' : 'Still mode scrolls a screenshot of the page. Switch to Live to include animations and video.');
  syncPlayer();
}
el.tabPreview.addEventListener('click', () => showTab('preview'));
el.tabFilm.addEventListener('click', () => showTab('film'));

/* ------------------------------------------------------------------ load site */
let loadToken = 0;
async function api(path, opts) {
  const r = await fetch(path, opts && { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
  return j;
}

async function loadSite({ fresh = false, keepHint = false } = {}) {
  const raw = el.url.value.trim();
  if (!raw) { setHint('Paste a website link first.', true); el.url.focus(); return; }
  const token = ++loadToken;
  cancelJob();
  invalidateFilm();
  state.phase = 'loading'; state.capture = null;
  el.go.classList.add('busy'); el.go.disabled = true;
  if (!keepHint) setHint(DEFAULT_HINT);
  setStatus('busy', 'Loading your site…'); refreshControls();
  pushConfig({ state: 'loading', shot: '', message: 'Rendering this site at the selected device size…' });
  try {
    const meta = await api('/api/capture', { method: 'POST', body: { url: raw, device: state.device, fresh } });
    if (token !== loadToken) return;
    state.capture = meta; state.phase = 'ready';
    el.url.value = meta.url.replace(/^https:\/\//, '').replace(/\/$/, '');
    remember(meta.url);
    pushConfig();
    setHint(meta.truncated
      ? `Long page — filming the first ${meta.height.toLocaleString()}px of ${meta.fullHeight.toLocaleString()}px to keep the video a sensible length.`
      : (meta.title ? `Loaded “${meta.title.slice(0, 60)}”.` : DEFAULT_HINT));
    if (meta.status >= 400 && meta.status !== 401) setHint(`The site answered with HTTP ${meta.status}; what you see is what it showed.`, false);
  } catch (e) {
    if (token !== loadToken) return;
    state.phase = 'error';
    setHint(e.message, true); setStatus('error', 'Couldn’t load that site');
    pushConfig({ state: 'error', shot: '', message: e.message });
  } finally {
    if (token === loadToken) { el.go.classList.remove('busy'); el.go.disabled = false; refreshControls(); }
  }
}

function remember(url) {
  const short = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  state.recent = [url, ...state.recent.filter((u) => u !== url)].slice(0, 3); persist(); renderRecent();
  void short;
}
function renderRecent() {
  el.recent.innerHTML = '';
  if (!state.recent.length) return;
  const l = document.createElement('span'); l.className = 'lbl'; l.textContent = 'Recent'; el.recent.appendChild(l);
  for (const u of state.recent) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = u.replace(/^https?:\/\//, '').replace(/\/$/, ''); b.title = u;
    b.addEventListener('click', () => { el.url.value = u; loadSite(); });
    el.recent.appendChild(b);
  }
}

el.form.addEventListener('submit', (e) => { e.preventDefault(); loadSite({ fresh: !!state.capture && el.url.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '') === state.capture.url.replace(/^https?:\/\//, '').replace(/\/$/, '') }); });
el.url.addEventListener('input', () => { if (el.url.classList.contains('bad')) setHint(DEFAULT_HINT); });
el.url.addEventListener('paste', () => setTimeout(() => { const v = el.url.value.trim(); if (/^(https?:\/\/)?[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) loadSite(); }, 0));

/* ------------------------------------------------------------------ render */
let pollTimer = null;
function cancelJob() {
  clearTimeout(pollTimer);
  if (state.job && ['queued', 'rendering'].includes(state.job.status)) fetch(`/api/jobs/${state.job.id}`, { method: 'DELETE' }).catch(() => {});
  state.job = null; el.render.hidden = true;
}

el.generate.addEventListener('click', async () => {
  if (!state.capture) return;
  invalidateFilm();
  el.generate.disabled = true;
  try {
    const { jobId } = await api('/api/render', { method: 'POST', body: {
      captureId: state.capture.id, device: state.device, format: state.format, quality: state.quality, speed: state.speed, fps: state.fps,
      backdrop: state.backdrop, custom: state.custom, motion: state.motion,
    } });
    state.job = { id: jobId, status: 'queued' };
    el.render.hidden = false; updateRender({ status: 'queued', progress: 0, ahead: 0 });
    state.playing = false; post({ type: 'pause' });
    poll();
  } catch (e) {
    setStatus('error', e.message); setTimeout(refreshControls, 4000);
  }
  refreshControls();
});

let lastFrame = -1, lastFrameAt = Date.now();
const fmtEta = (s) => (s == null ? '' : s < 60 ? `${Math.max(1, s)}s left` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s left`);
function updateRender(j) {
  const pct = Math.round((j.progress || 0) * 100);
  el.pct.textContent = pct; el.bar.style.width = pct + '%';
  const count = j.frames ? `Frame ${j.frame} of ${j.frames}${j.etaSec != null && j.frame > 4 ? ' · ' + fmtEta(j.etaSec) : ''}` : 'Preparing…';
  if (j.frame === lastFrame) { if (Date.now() - lastFrameAt > 25000) el.sub.textContent = 'This site is heavy, still working… You can cancel and try “Still” motion for a quick version.'; } else { lastFrame = j.frame; lastFrameAt = Date.now(); }
  if (j.status === 'queued') { el.phase.textContent = 'In queue'; el.sub.textContent = j.ahead ? `${j.ahead} ahead of you…` : 'Starting the renderer…'; }
  else if (j.phase === 'encoding') { el.phase.textContent = 'Encoding'; el.sub.textContent = 'Finishing your MP4…'; }
  else if (j.phase === 'capturing') { el.phase.textContent = 'Step 1 of 2 · Recording your site'; el.sub.textContent = count; }
  else if (j.phase === 'composing') { el.phase.textContent = 'Step 2 of 2 · Building your MP4'; el.sub.textContent = count; }
  else { el.phase.textContent = 'Rendering'; el.sub.textContent = count; }
  setStatus('busy', j.status === 'queued' ? 'Waiting for the renderer…' : `Rendering ${pct}%`);
}

async function poll() {
  const job = state.job; if (!job) return;
  try {
    const j = await api(`/api/jobs/${job.id}`);
    if (state.job !== job) return;
    job.status = j.status;
    if (j.status === 'done') return finish(job, j);
    if (j.status === 'error') throw new Error(j.error || 'Rendering failed.');
    if (j.status === 'cancelled') { el.render.hidden = true; state.job = null; refreshControls(); return; }
    updateRender(j);
  } catch (e) {
    if (state.job !== job) return;
    el.render.hidden = true; state.job = null; refreshControls();
    setStatus('error', e.message); setTimeout(refreshControls, 6000); return;
  }
  pollTimer = setTimeout(poll, 600);
}

function finish(job, j) {
  state.job = null; el.render.hidden = true;
  state.film = { jobId: job.id, url: j.videoUrl, size: j.size, duration: j.duration };
  el.film.src = j.videoUrl;
  el.tabFilm.hidden = false;
  refreshControls(); showTab('film');
  el.statusText.textContent = `Film ready · ${(j.size / 1048576).toFixed(1)} MB · ${j.duration.toFixed(1)}s`;
  el.film.play().catch(() => {});
}

el.cancel.addEventListener('click', () => { cancelJob(); refreshControls(); });

/* ------------------------------------------------------------------ boot */
state.phase = 'empty';
renderRecent(); refreshControls();
setStatus('idle', 'Paste a link to begin');
el.url.focus();

fetch('/api/health').then((r) => r.json()).then((h) => {
  if (h && h.encoder === false) {
    el.warn.hidden = false;
    el.warn.textContent = 'Heads up: the video encoder (ffmpeg) isn’t working on this computer, so videos can’t be rendered yet. Run “npm install” again, or install ffmpeg from ffmpeg.org and add it to your PATH, then restart motionframe.';
  }
}).catch(() => {});
