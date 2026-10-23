// Background music for films: three original tracks synthesised in the browser (no licensing worries)
// plus "upload your own". Everything renders to one AudioBuffer exactly as long as the film, with fades.

export const TRACKS = {
  none:   { label: 'None' },
  calm:   { label: 'Calm' },
  upbeat: { label: 'Upbeat' },
  lofi:   { label: 'Lo-fi' },
  upload: { label: 'Upload…' },
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
function env(g, t, a, peak, hold, r) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
}
function tone(ctx, out, { f, t, type = 'sine', a = 0.01, peak = 0.2, hold = 0, r = 0.4, detune = 0, cutoff = 0 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  let node = o;
  if (cutoff) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; o.connect(lp); node = lp; }
  node.connect(g); g.connect(out); env(g, t, a, peak, hold, r);
  o.start(t); o.stop(t + a + hold + r + 0.05);
}
function kick(ctx, out, t, peak = 0.9) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.35);
}
function noiseHit(ctx, out, noise, t, { type = 'highpass', freq = 7000, q = 0.7, peak = 0.12, r = 0.05 }) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + r);
  s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + r + 0.02);
}

// chord voicings (MIDI), looped
const PROG_BRIGHT = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]];   // Cmaj7 Am7 Fmaj7 G7
const PROG_LOFI = [[62, 65, 69, 72, 76], [55, 59, 62, 65, 69], [60, 64, 67, 71, 74], [57, 60, 64, 67, 71]]; // Dm9 G9 Cmaj9 Am9

function compose(ctx, id, dur) {
  const master = ctx.createGain(); master.gain.value = 0.8;
  const verb = reverb(ctx), wet = ctx.createGain(), dry = ctx.createGain();
  master.connect(dry); master.connect(verb); verb.connect(wet);
  const out = ctx.createGain(); dry.connect(out); wet.connect(out); out.connect(ctx.destination);
  const noise = noiseBuffer(ctx, 1.5);

  if (id === 'calm') {
    dry.gain.value = 0.7; wet.gain.value = 0.55;
    const bar = 60 / 70 * 4;
    for (let t = 0, i = 0; t < dur; t += bar, i++) {
      const ch = PROG_BRIGHT[i % 4];
      for (const n of ch) for (const d of [-7, 7]) tone(ctx, master, { f: midi(n), t, type: 'triangle', a: 1.1, peak: 0.035, hold: bar - 1.4, r: 1.6, detune: d, cutoff: 1600 });
      tone(ctx, master, { f: midi(ch[0] - 24), t, a: 0.6, peak: 0.12, hold: bar - 1, r: 1.2 });
      // sparse bell melody
      [0, 1.5, 2.5].forEach((b, k) => tone(ctx, master, { f: midi(ch[(k + i) % 4] + 12), t: t + (b * bar) / 4, a: 0.005, peak: 0.05, r: 1.6 }));
    }
  } else if (id === 'upbeat') {
    dry.gain.value = 0.9; wet.gain.value = 0.25;
    const beat = 60 / 112, bar = beat * 4;
    for (let t = 0, i = 0; t < dur; t += bar, i++) {
      const ch = PROG_BRIGHT[i % 4];
      for (let b = 0; b < 4; b++) {
        const bt = t + b * beat;
        kick(ctx, master, bt, 0.7);
        noiseHit(ctx, master, noise, bt + beat / 2, { peak: 0.07 });
        tone(ctx, master, { f: midi(ch[0] - 24), t: bt, type: 'sine', a: 0.005, peak: 0.22, hold: beat * 0.5, r: 0.15 });
        for (let s = 0; s < 2; s++) tone(ctx, master, { f: midi(ch[(b * 2 + s) % 4] + 12), t: bt + (s * beat) / 2, type: 'square', a: 0.003, peak: 0.03, r: 0.22, cutoff: 2400 });
      }
      for (const n of ch) tone(ctx, master, { f: midi(n), t, type: 'sawtooth', a: 0.25, peak: 0.012, hold: bar - 0.5, r: 0.4, cutoff: 1200 });
    }
  } else if (id === 'lofi') {
    dry.gain.value = 0.85; wet.gain.value = 0.35;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 3200;
    master.disconnect(); master.connect(warm); warm.connect(dry); warm.connect(verb);
    const beat = 60 / 78, bar = beat * 4;
    for (let t = 0, i = 0; t < dur; t += bar, i++) {
      const ch = PROG_LOFI[i % 4];
      ch.forEach((n, k) => { tone(ctx, master, { f: midi(n), t: t + k * 0.018, a: 0.01, peak: 0.05, hold: 0.2, r: bar * 0.7 }); tone(ctx, master, { f: midi(n) * 2, t: t + k * 0.018, a: 0.005, peak: 0.008, r: 0.6 }); });
      tone(ctx, master, { f: midi(ch[0] - 24), t, a: 0.02, peak: 0.16, hold: beat * 1.5, r: 0.4 });
      kick(ctx, master, t, 0.6); kick(ctx, master, t + beat * 2.5, 0.45);
      noiseHit(ctx, master, noise, t + beat, { type: 'bandpass', freq: 1800, q: 0.8, peak: 0.16, r: 0.16 });
      noiseHit(ctx, master, noise, t + beat * 3, { type: 'bandpass', freq: 1800, q: 0.8, peak: 0.16, r: 0.16 });
      for (let h = 0; h < 8; h++) noiseHit(ctx, master, noise, t + (h * beat) / 2 + (h % 2 ? 0.03 : 0), { peak: 0.025, r: 0.04 });
    }
    // vinyl crackle
    for (let t = 0; t < dur; t += 0.05 + Math.random() * 0.25) noiseHit(ctx, out, noise, t, { type: 'highpass', freq: 2500, peak: 0.01 + Math.random() * 0.02, r: 0.008 });
  }
}

// Fades + volume, and loops the source when the film is longer than the track.
async function finish(source, dur, volume) {
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = source; s.loop = true;
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

// id: 'calm' | 'upbeat' | 'lofi' | 'upload' ; returns an AudioBuffer exactly `dur` seconds long, or null for none.
export async function buildBed(id, dur, volume = 0.8, uploaded = null) {
  if (id === 'none' || !dur) return null;
  if (id === 'upload') return uploaded ? finish(uploaded, dur, volume) : null;
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
