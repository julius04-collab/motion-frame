// Background music for films: four original tracks synthesised in the browser (no licensing worries)
// plus the user's own uploaded song. Everything renders to one AudioBuffer exactly as long as the film.
// Each built-in track has its own tempo, key and instruments so they sound clearly different.

export const TRACKS = {
  none:      { label: 'None' },
  calm:      { label: 'Calm piano' },
  upbeat:    { label: 'Upbeat' },
  lofi:      { label: 'Lo-fi' },
  cinematic: { label: 'Cinematic' },
};

const SR = 48000;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function noiseBuffer(ctx, secs) {
  const b = ctx.createBuffer(1, Math.ceil(secs * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function reverb(ctx, secs = 2.6, decay = 3) {
  const len = Math.ceil(secs * ctx.sampleRate), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  const conv = ctx.createConvolver(); conv.buffer = b; return conv;
}
function voice(ctx, out, { f, t, type = 'sine', a = 0.01, peak = 0.2, hold = 0, r = 0.4, detune = 0, cutoff = 0, sweepTo = 0, pan = 0 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  let node = o;
  if (cutoff) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(cutoff, t);
    if (sweepTo) lp.frequency.linearRampToValueAtTime(sweepTo, t + a + hold);
    o.connect(lp); node = lp;
  }
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
  node.connect(g); g.connect(out);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
  o.start(t); o.stop(t + a + hold + r + 0.05);
}
// piano-ish: fundamental + harmonics with a fast attack and long natural decay
function piano(ctx, out, f, t, vel = 0.12, pan = 0) {
  voice(ctx, out, { f, t, a: 0.004, peak: vel, r: 2.6, pan });
  voice(ctx, out, { f: f * 2, t, a: 0.003, peak: vel * 0.35, r: 1.2, pan });
  voice(ctx, out, { f: f * 3, t, a: 0.002, peak: vel * 0.12, r: 0.6, pan });
}
function rhodes(ctx, out, f, t, len, vel = 0.06) {
  voice(ctx, out, { f, t, a: 0.01, peak: vel, hold: len * 0.3, r: len * 0.8, detune: -4 });
  voice(ctx, out, { f, t, a: 0.01, peak: vel * 0.6, hold: len * 0.3, r: len * 0.8, detune: 5 });
  voice(ctx, out, { f: f * 4, t, a: 0.002, peak: vel * 0.08, r: 0.25 }); // bell-like tine
}
function kick(ctx, out, t, peak = 0.9, low = 42) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(low, t + 0.12);
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.36);
}
function noiseHit(ctx, out, noise, t, { type = 'highpass', freq = 7000, q = 0.7, peak = 0.12, r = 0.05 }) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + r);
  s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + r + 0.02);
}

function bus(ctx, dryGain, wetGain, verbSecs = 2.6) {
  const master = ctx.createGain(), verb = reverb(ctx, verbSecs), wet = ctx.createGain(), dry = ctx.createGain(), out = ctx.createGain();
  dry.gain.value = dryGain; wet.gain.value = wetGain;
  master.connect(dry); master.connect(verb); verb.connect(wet); dry.connect(out); wet.connect(out); out.connect(ctx.destination);
  return { master, out };
}

function compose(ctx, id, dur) {
  const noise = noiseBuffer(ctx, 1.5);

  if (id === 'calm') {
    // Calm piano — 66 BPM, D major, I–vi–IV–V, broken-chord piano over a soft pad. No drums.
    const { master } = bus(ctx, 0.75, 0.6, 3.2);
    const prog = [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]];
    const beat = 60 / 66, bar = beat * 4;
    for (let t = 0, i = 0; t < dur; t += bar, i++) {
      const ch = prog[i % 4], arp = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1], ch[2] + 12, ch[1] + 12];
      piano(ctx, master, midi(ch[0] - 24), t, 0.13, -0.2);
      arp.forEach((n, k) => piano(ctx, master, midi(n), t + (k * beat) / 2, 0.075 + (k % 4 === 0 ? 0.02 : 0), k % 2 ? 0.25 : -0.1));
      if (i % 2 === 1) piano(ctx, master, midi(ch[2] + 24), t + beat * 3.5, 0.05, 0.3); // little melody answer
      for (const n of ch) voice(ctx, master, { f: midi(n + 12), t, type: 'triangle', a: 1.4, peak: 0.012, hold: bar - 1.6, r: 1.8, cutoff: 1400 });
    }
  } else if (id === 'upbeat') {
    // Upbeat — 122 BPM, A minor (Am–F–C–G), four-on-the-floor, claps, 16th hats, offbeat chord stabs, pluck hook.
    const { master } = bus(ctx, 0.95, 0.18, 1.6);
    const prog = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], hook = [76, 74, 72, 74, 76, 79, 76, 72];
    const beat = 60 / 122, bar = beat * 4;
    for (let t = 0, i = 0; t < dur; t += bar, i++) {
      const ch = prog[i % 4];
      for (let b = 0; b < 4; b++) {
        const bt = t + b * beat;
        kick(ctx, master, bt, 0.85, 46);
        if (b % 2) { noiseHit(ctx, master, noise, bt, { type: 'bandpass', freq: 1500, q: 0.9, peak: 0.28, r: 0.13 }); noiseHit(ctx, master, noise, bt + 0.012, { type: 'bandpass', freq: 1300, q: 0.9, peak: 0.18, r: 0.1 }); }
        for (let s = 0; s < 4; s++) noiseHit(ctx, master, noise, bt + (s * beat) / 4, { peak: s === 2 ? 0.09 : 0.04, r: s === 2 ? 0.12 : 0.03 });
        voice(ctx, master, { f: midi(ch[0] - 24), t: bt + beat / 2, type: 'sawtooth', a: 0.004, peak: 0.12, hold: beat * 0.3, r: 0.08, cutoff: 520 });
        for (const n of ch) voice(ctx, master, { f: midi(n), t: bt + beat / 2, type: 'sawtooth', a: 0.004, peak: 0.022, hold: 0.06, r: 0.12, cutoff: 2600, pan: (n % 3 - 1) * 0.4 });
      }
      hook.forEach((n, k) => voice(ctx, master, { f: midi(n), t: t + (k * beat) / 2, type: 'square', a: 0.002, peak: 0.035, r: 0.22, cutoff: 3200, pan: 0.15 }));
    }
  } else if (id === 'lofi') {
    // Lo-fi — 76 BPM swung, Dm9–G13–Cmaj9–A7, dusty Rhodes, lazy drums, vinyl crackle, warm low-pass, tape wobble.
    const { master, out } = bus(ctx, 0.9, 0.3, 2);
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 2600;
    master.disconnect(); master.connect(warm); warm.connect(out);
    const prog = [[50, 60, 65, 69, 72], [43, 59, 64, 65, 69], [48, 59, 62, 64, 67], [45, 55, 61, 64, 67]];
    const beat = 60 / 76, bar = beat * 4, swing = beat * 0.16;
    for (let t = 0, i = 0; t < dur; t += bar, i++) {
      const ch = prog[i % 4];
      voice(ctx, master, { f: midi(ch[0] - 12), t, a: 0.02, peak: 0.2, hold: beat * 1.6, r: 0.5 });
      ch.slice(1).forEach((n, k) => { rhodes(ctx, master, midi(n), t + k * 0.022, bar * 0.55); rhodes(ctx, master, midi(n), t + beat * 2.5 + swing + k * 0.02, bar * 0.3, 0.035); });
      kick(ctx, master, t, 0.7, 40); kick(ctx, master, t + beat * 1.5 + swing, 0.45, 40); kick(ctx, master, t + beat * 2.5 + swing, 0.55, 40);
      noiseHit(ctx, master, noise, t + beat, { type: 'bandpass', freq: 1700, q: 0.7, peak: 0.2, r: 0.18 });
      noiseHit(ctx, master, noise, t + beat * 3, { type: 'bandpass', freq: 1700, q: 0.7, peak: 0.2, r: 0.18 });
      for (let h = 0; h < 8; h++) noiseHit(ctx, master, noise, t + (h * beat) / 2 + (h % 2 ? swing : 0), { freq: 6000, peak: h % 2 ? 0.02 : 0.035, r: 0.04 });
    }
    for (let t = 0; t < dur; t += 0.04 + Math.random() * 0.22) noiseHit(ctx, out, noise, t, { type: 'highpass', freq: 2500, peak: 0.012 + Math.random() * 0.025, r: 0.007 });
  } else if (id === 'cinematic') {
    // Cinematic — 60 BPM, C minor (Cm–Ab–Eb–Bb), swelling strings with opening filters, deep booms, high shimmer.
    const { master } = bus(ctx, 0.7, 0.75, 4.2);
    const prog = [[48, 60, 63, 67], [44, 60, 63, 68], [51, 58, 63, 67], [46, 58, 62, 65]];
    const bar = (60 / 60) * 4;
    for (let t = 0, i = 0; t < dur; t += bar, i++) {
      const ch = prog[i % 4];
      for (const n of ch.slice(1)) for (const d of [-9, 0, 9]) voice(ctx, master, { f: midi(n), t, type: 'sawtooth', a: bar * 0.55, peak: 0.011, hold: bar * 0.3, r: bar * 0.5, detune: d, cutoff: 500, sweepTo: 2600, pan: d / 20 });
      voice(ctx, master, { f: midi(ch[0] - 12), t, type: 'sawtooth', a: 0.6, peak: 0.05, hold: bar - 1, r: 1.2, cutoff: 300 });
      if (i % 2 === 0) { // boom
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.2);
        g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.5);
      }
      [0, 1.5, 2.5, 3].forEach((b, k) => voice(ctx, master, { f: midi(ch[(k % 3) + 1] + 24), t: t + b, type: 'triangle', a: 0.02, peak: 0.018, r: 2.2, pan: k % 2 ? 0.5 : -0.5 }));
    }
  }
}

// When an uploaded song is shorter than the film, repeat it with a smooth crossfade at each seam
// (instead of a hard restart).
function loopWithCrossfade(src, dur) {
  const sr = src.sampleRate, need = Math.ceil(dur * sr), ch = src.numberOfChannels;
  if (src.length >= need) return src;
  const xf = Math.min(Math.floor(1.5 * sr), Math.floor(src.length / 4)); // 1.5 s crossfade (shorter for tiny clips)
  const step = src.length - xf;
  const out = new AudioBuffer({ numberOfChannels: ch, length: need, sampleRate: sr });
  for (let c = 0; c < ch; c++) {
    const s = src.getChannelData(c), o = out.getChannelData(c);
    for (let start = 0, k = 0; start < need; start += step, k++) {
      for (let i = 0; i < src.length && start + i < need; i++) {
        let g = 1;
        if (k > 0 && i < xf) g = i / xf;                                          // fade this copy in
        if (start + step < need && i >= step) g *= 1 - (i - step) / xf;                           // fade out under the next copy (sums to 1, no volume bump)
        o[start + i] += s[i] * g;
      }
    }
  }
  return out;
}

// Fades + volume, and loops the source when the film is longer than the track.
async function finish(source, dur, volume) {
  source = loopWithCrossfade(source, dur);
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = source;
  const fadeIn = Math.min(0.6, dur / 4), fadeOut = Math.min(1.8, dur / 3);
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(volume, fadeIn);
  g.gain.setValueAtTime(volume, Math.max(fadeIn, dur - fadeOut));
  g.gain.linearRampToValueAtTime(0, dur);
  s.connect(g); g.connect(ctx.destination); s.start(0);
  return ctx.startRendering();
}

export async function decodeUpload(file) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  try { return await ac.decodeAudioData(await file.arrayBuffer()); } finally { ac.close?.(); }
}

// id: a built-in track id or 'mine' (the uploaded song); returns an AudioBuffer exactly `dur` seconds long, or null for none.
export async function buildBed(id, dur, volume = 0.8, uploaded = null) {
  if (id === 'none' || !dur) return null;
  if (id === 'mine' || id === 'upload') return uploaded ? finish(uploaded, dur, volume) : null;
  if (!TRACKS[id]) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil((dur + 2) * SR), SR);
  compose(ctx, id, dur + 2);
  const raw = await ctx.startRendering();
  // even out loudness between tracks (calm is naturally quieter than upbeat)
  let peak = 0, sum = 0, n = 0;
  for (let c = 0; c < raw.numberOfChannels; c++) { const d = raw.getChannelData(c); for (let i = 0; i < d.length; i += 4) { const a = Math.abs(d[i]); peak = Math.max(peak, a); sum += a * a; n++; } }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const norm = rms > 0 ? Math.min(0.09 / rms, 0.8 / peak, 6) : 1; // match loudness, never clip
  return finish(raw, dur, volume * norm);
}
