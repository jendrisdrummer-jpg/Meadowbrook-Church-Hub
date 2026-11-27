// WCAG contrast helpers for the church brand colour (pure functions; no DOM).
// Surfaces mirror the tokens in app.css: --sel is the hardest background text sits on.
export const SURFACES = { light: '#ece4d6', dark: '#332d26' };
export const MIN_TEXT = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// app.css: dark mode shows links in the accent mixed 60% with white.
export const darkAccentText = (hex) => toHex(rgb(hex).map((v) => v * 0.6 + 255 * 0.4));

export function hexToHsl(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0), f(8), f(4)].map((v) => v * 255));
}

// The three readings that matter, each with its ratio.
export function checkBrand(hex) {
  const r = {
    button: contrast('#ffffff', hex),
    light: contrast(hex, SURFACES.light),
    dark: contrast(darkAccentText(hex), SURFACES.dark),
  };
  return { ...r, ok: r.button >= MIN_TEXT && r.light >= MIN_TEXT && r.dark >= MIN_TEXT };
}

// Nearest shade (same hue and saturation, lightness adjusted) that passes every check, or null.
export function suggestShade(hex) {
  if (!HEX.test(hex)) return null;
  const [h, s, l] = hexToHsl(hex);
  for (let step = 0; step <= 100; step++) {
    for (const dir of [-1, 1]) {
      const nl = l + (dir * step) / 100;
      if (nl < 0 || nl > 1) continue;
      const c = hslToHex(h, s, nl);
      if (checkBrand(c).ok) return c;
    }
  }
  return null;
}

// Plain-English warnings for the Settings page; empty when the colour is fine.
export function brandWarnings(hex) {
  if (!HEX.test(hex)) return [];
  const c = checkBrand(hex), out = [];
  if (c.button < MIN_TEXT) out.push('White text on this colour is hard to read.');
  if (c.light < MIN_TEXT) out.push('Links in this colour are hard to read on the light theme.');
  if (c.dark < MIN_TEXT) out.push('Links in this colour are hard to read on the dark theme.');
  return out;
}
