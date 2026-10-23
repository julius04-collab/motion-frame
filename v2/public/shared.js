// Shared by the v2 server (recording) and the browser (mockup + export). No DOM / Node APIs here.

export const DEVICES = {
  macbook: { label: 'MacBook', viewport: { w: 1440, h: 900 }, dsf: 2, mobile: false },
  desktop: { label: 'Desktop', viewport: { w: 1600, h: 900 }, dsf: 2, mobile: false },
  phone:   { label: 'Phone',   viewport: { w: 390,  h: 844 }, dsf: 3, mobile: true },
  browser: { label: 'Browser', viewport: { w: 1440, h: 860 }, dsf: 2, mobile: false },
};

export const FORMATS = {
  '16:9': { w: 1920, h: 1080 },
  '1:1':  { w: 1080, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
};

export const QUALITIES = {
  '1080p': { scale: 1, label: '1080p', note: 'Faster' },
  '4k':    { scale: 2, label: '4K',    note: 'Sharper' },
};

export const SPEEDS = {
  slow:   { label: 'Slow',   pxPerSec: 280 },
  normal: { label: 'Normal', pxPerSec: 460 },
  fast:   { label: 'Fast',   pxPerSec: 760 },
};

export const FPS_OPTIONS = [30, 60];
export const HOLD_START = 0.9;
export const HOLD_END = 1.1;

export function easeScroll(t) {
  const s = t * t * t * (t * (t * 6 - 15) + 10);
  return 0.45 * t + 0.55 * s;
}
export function timeline(scrollPx, speed = 'normal') {
  const pps = (SPEEDS[speed] || SPEEDS.normal).pxPerSec;
  const scrollSecs = scrollPx <= 0 ? 0 : Math.min(24, Math.max(3.5, scrollPx / pps));
  return { duration: HOLD_START + scrollSecs + HOLD_END, scrollSecs };
}
export function scrollAt(sec, scrollSecs) {
  if (scrollSecs <= 0) return 0;
  return easeScroll(Math.min(1, Math.max(0, (sec - HOLD_START) / scrollSecs)));
}

// Backdrops as canvas recipes: a base colour plus soft elliptical glows.
// Each glow: [x%, y%, radiusX% of width, radiusY% of height, colour, where it fades out (0–1)]
export const BACKDROPS = {
  aurora: { label: 'Aurora', swatch: 'linear-gradient(135deg,#f6d6c9,#f2dc8d 40%,#d6b3d9 70%,#b9b0e0)', base: '#e7d3c8',
    glows: [[15, 20, 60, 70, '#f3d9a4', 0.6], [85, 12, 55, 60, '#f19a8b', 0.62], [88, 92, 60, 70, '#b8aee3', 0.6], [10, 90, 60, 60, '#cfe0c3', 0.6]] },
  peach: { label: 'Peach', swatch: 'linear-gradient(135deg,#ffd9c7,#ffb59a)', base: '#ffc3a8',
    glows: [[20, 15, 70, 80, '#ffe6d8', 0.65], [85, 90, 70, 80, '#ff9f84', 0.65]] },
  dusk: { label: 'Dusk', swatch: 'linear-gradient(135deg,#7a5cc7,#2a1d57)', base: '#1f1646', dark: true,
    glows: [[80, 10, 60, 70, '#8e6fe0', 0.62], [10, 95, 60, 70, '#3a2a7a', 0.65], [50, 50, 40, 40, '#4d3a96', 0.7]] },
  mist: { label: 'Mist', swatch: 'linear-gradient(135deg,#f4f4f2,#e1e3e6)', base: '#eceeef',
    glows: [[20, 10, 70, 80, '#ffffff', 0.65], [90, 95, 70, 80, '#d9dde3', 0.65]] },
  ocean: { label: 'Ocean', swatch: 'linear-gradient(135deg,#7fd1e8,#2b5fd6)', base: '#4a86e8', dark: true,
    glows: [[15, 15, 60, 70, '#9be3ee', 0.62], [90, 90, 60, 70, '#2f4fe0', 0.65], [60, 40, 50, 50, '#5aa8ee', 0.7]] },
  ink: { label: 'Ink', swatch: 'linear-gradient(135deg,#2a2d34,#0c0d10)', base: '#0f1013', dark: true,
    glows: [[80, 10, 60, 60, '#2b2f3a', 0.65], [10, 95, 60, 60, '#1a1c22', 0.65]] },
};

export function customBackdrop(hex) {
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#e8e4dc';
  return { label: 'Custom', base: c, glows: [[20, 10, 70, 80, 'rgba(255,255,255,0.35)', 0.65], [90, 95, 70, 80, 'rgba(0,0,0,0.22)', 0.65]] };
}
