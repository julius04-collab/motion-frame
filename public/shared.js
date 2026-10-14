// Shared by the server (capture/render) and the browser (UI + composition).
// Keep this file free of DOM / Node APIs.

export const DEVICES = {
  macbook: { label: 'MacBook', viewport: { w: 1440, h: 900 }, dsf: 2, mobile: false, note: '1440 × 900' },
  desktop: { label: 'Desktop', viewport: { w: 1600, h: 900 }, dsf: 1.5, mobile: false, note: '1600 × 900' },
  phone:   { label: 'Phone',   viewport: { w: 390,  h: 844 }, dsf: 3, mobile: true,  note: '390 × 844' },
  browser: { label: 'Browser', viewport: { w: 1440, h: 860 }, dsf: 2, mobile: false, note: '1440 × 860' },
};

export const FORMATS = {
  '16:9': { w: 1920, h: 1080, ar: 16 / 9 },
  '1:1':  { w: 1080, h: 1080, ar: 1 },
  '9:16': { w: 1080, h: 1920, ar: 9 / 16 },
};

// 1080p = 1x, 4K = 2x device scale on the same logical stage.
export const QUALITIES = {
  '1080p': { scale: 1, label: '1080p', note: 'Fast' },
  '4k':    { scale: 2, label: '4K',    note: 'Slower' },
};

export const SPEEDS = {
  slow:   { label: 'Slow',   pxPerSec: 280 },
  normal: { label: 'Normal', pxPerSec: 460 },
  fast:   { label: 'Fast',   pxPerSec: 760 },
};

// Live = record the real page (animations, background video, sticky headers). Still = scroll a screenshot (fastest).
export const MOTIONS = {
  live:  { label: 'Live',  note: 'Animations & video' },
  still: { label: 'Still', note: 'Fastest' },
};

export const FPS = 30;
export const FPS_OPTIONS = [30, 60];
export const HOLD_START = 0.9; // seconds parked at the top
export const HOLD_END = 1.1;   // seconds parked at the bottom

export const BACKDROPS = {
  aurora: {
    label: 'Aurora',
    swatch: 'linear-gradient(135deg,#f6d6c9,#f2dc8d 40%,#d6b3d9 70%,#b9b0e0)',
    css: `radial-gradient(60% 70% at 15% 20%, #f3d9a4 0%, transparent 60%),
          radial-gradient(55% 60% at 85% 12%, #f19a8b 0%, transparent 62%),
          radial-gradient(60% 70% at 88% 92%, #b8aee3 0%, transparent 60%),
          radial-gradient(60% 60% at 10% 90%, #cfe0c3 0%, transparent 60%),
          #e7d3c8`,
    dark: false,
  },
  peach: {
    label: 'Peach',
    swatch: 'linear-gradient(135deg,#ffd9c7,#ffb59a)',
    css: `radial-gradient(70% 80% at 20% 15%, #ffe6d8 0%, transparent 65%),
          radial-gradient(70% 80% at 85% 90%, #ff9f84 0%, transparent 65%),
          #ffc3a8`,
    dark: false,
  },
  dusk: {
    label: 'Dusk',
    swatch: 'linear-gradient(135deg,#7a5cc7,#2a1d57)',
    css: `radial-gradient(60% 70% at 80% 10%, #8e6fe0 0%, transparent 62%),
          radial-gradient(60% 70% at 10% 95%, #3a2a7a 0%, transparent 65%),
          radial-gradient(40% 40% at 50% 50%, #4d3a96 0%, transparent 70%),
          #1f1646`,
    dark: true,
  },
  mist: {
    label: 'Mist',
    swatch: 'linear-gradient(135deg,#f4f4f2,#e1e3e6)',
    css: `radial-gradient(70% 80% at 20% 10%, #ffffff 0%, transparent 65%),
          radial-gradient(70% 80% at 90% 95%, #d9dde3 0%, transparent 65%),
          #eceeef`,
    dark: false,
  },
  ocean: {
    label: 'Ocean',
    swatch: 'linear-gradient(135deg,#7fd1e8,#2b5fd6)',
    css: `radial-gradient(60% 70% at 15% 15%, #9be3ee 0%, transparent 62%),
          radial-gradient(60% 70% at 90% 90%, #2f4fe0 0%, transparent 65%),
          radial-gradient(50% 50% at 60% 40%, #5aa8ee 0%, transparent 70%),
          #4a86e8`,
    dark: true,
  },
  ink: {
    label: 'Ink',
    swatch: 'linear-gradient(135deg,#2a2d34,#0c0d10)',
    css: `radial-gradient(60% 60% at 80% 10%, #2b2f3a 0%, transparent 65%),
          radial-gradient(60% 60% at 10% 95%, #1a1c22 0%, transparent 65%),
          #0f1013`,
    dark: true,
  },
};

export function customBackdrop(hex) {
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#e8e4dc';
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  const dark = (0.299 * r + 0.587 * g + 0.114 * b) < 120;
  return {
    label: 'Custom',
    css: `radial-gradient(70% 80% at 20% 10%, rgba(255,255,255,.35) 0%, transparent 65%),
          radial-gradient(70% 80% at 90% 95%, rgba(0,0,0,.22) 0%, transparent 65%), ${c}`,
    dark,
  };
}

export function resolveBackdrop(id, custom) {
  if (id === 'custom') return customBackdrop(custom);
  return BACKDROPS[id] || BACKDROPS.aurora;
}

// Smooth ease with a lively middle so long pages don't feel like a rocket launch.
export function easeScroll(t) {
  const s = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
  return 0.45 * t + 0.55 * s;
}

// Timeline: hold -> scroll -> hold. Returns { duration, scrollSecs }.
export function timeline(scrollPx, speed = 'normal') {
  const pps = (SPEEDS[speed] || SPEEDS.normal).pxPerSec;
  const scrollSecs = scrollPx <= 0 ? 0 : Math.min(18, Math.max(3.5, scrollPx / pps));
  const duration = HOLD_START + scrollSecs + HOLD_END;
  return { duration, scrollSecs };
}

// Offset (0..1 of scrollable distance) at time `sec`.
export function scrollAt(sec, scrollSecs) {
  if (scrollSecs <= 0) return 0;
  const t = (sec - HOLD_START) / scrollSecs;
  return easeScroll(Math.min(1, Math.max(0, t)));
}
