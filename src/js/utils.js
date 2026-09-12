/**
 * utils.js — shared helpers, one rAF loop, one scroll model.
 * Everything in the engine is defensive: a failure in one module must never
 * leave the page hidden or unscrollable.
 */

export const doc = document;
export const docEl = document.documentElement;
export const body = document.body;

export const $ = (sel, root = doc) => root.querySelector(sel);
export const $$ = (sel, root = doc) => Array.from(root.querySelectorAll(sel));

export const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b - a === 0 ? 0 : clamp((v - a) / (b - a)));
export const mapRange = (v, a, b, c, d) => lerp(c, d, inv(a, b, v));
export const round = (v, p = 1000) => Math.round(v * p) / p;

export const isTouch = () => matchMedia('(hover: none), (pointer: coarse)').matches;
export const isFinePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => motionQuery.matches;

/** Breakpoints mirror the ones the capture declares in its CSS embeds. */
export function breakpoint() {
  const w = innerWidth;
  if (w <= 479) return 'm';
  if (w <= 767) return 'ml';
  if (w <= 991) return 't';
  return 'd';
}
export const isDesktop = () => breakpoint() === 'd';

/* ------------------------------------------------------------------ *
 * brand colours — resolved from the published stylesheet at runtime
 * ------------------------------------------------------------------ */

const FALLBACK_COLORS = {
  lime: '#d2ff00',
  'lime-off': '#e9ffc2',
  'dark-green': '#13251c',
  'dark-green-tint-1': '#2f4c3c',
  'dark-green-tint-1-low': 'rgba(47, 76, 60, 0.45)',
  'dark-green-tint-2': '#47695a',
  black: '#101400',
  white: '#fdfdf5',
  'grey-1': '#b9bdb0',
  'grey-2': '#7e8377',
  'grey-on-track': '#8b9184',
  'green-off-white-2': '#cfe3d4',
};

const rootStyle = getComputedStyle(docEl);

export function cssVar(name, fallback = '') {
  const value = rootStyle.getPropertyValue(name).trim();
  return value || fallback;
}

/** Resolve a colour token name ("dark-green-tint-1") to a css color string. */
export function brandColor(name, fallback = '#13251c') {
  const key = String(name || '').trim();
  if (!key) return fallback;
  const fromVar = cssVar(`--color--${key}`);
  return fromVar || FALLBACK_COLORS[key] || fallback;
}

export function parseColor(input) {
  const value = String(input || '').trim();
  if (!value) return { r: 19, g: 37, b: 28, a: 1 };
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const int = parseInt(hex, 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a: 1 };
  }
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
  }
  // named colour / var() that we could not resolve: ask the browser
  const probe = doc.createElement('span');
  probe.style.color = value;
  probe.style.display = 'none';
  body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return parseColor(computed === value ? '#13251c' : computed);
}

export function mixColor(a, b, t) {
  const ca = typeof a === 'string' ? parseColor(a) : a;
  const cb = typeof b === 'string' ? parseColor(b) : b;
  const r = Math.round(lerp(ca.r, cb.r, t));
  const g = Math.round(lerp(ca.g, cb.g, t));
  const bl = Math.round(lerp(ca.b, cb.b, t));
  const al = round(lerp(ca.a ?? 1, cb.a ?? 1, t), 1000);
  return `rgba(${r}, ${g}, ${bl}, ${al})`;
}

/* ------------------------------------------------------------------ *
 * one rAF loop for everything
 * ------------------------------------------------------------------ */

const frameCallbacks = new Set();
let frameRunning = false;
let lastTime = performance.now();

export function onFrame(fn) {
  frameCallbacks.add(fn);
  startLoop();
  return () => frameCallbacks.delete(fn);
}

export function startLoop() {
  if (frameRunning) return;
  frameRunning = true;
  lastTime = performance.now();
  requestAnimationFrame(tick);
}

function tick(now) {
  const dt = Math.min(64, now - lastTime) / 1000; // seconds, clamped for tab-outs
  lastTime = now;
  updateScroll();
  for (const fn of frameCallbacks) {
    try {
      fn({ time: now, dt, scroll: scrollState });
    } catch (err) {
      console.error('[landnr] frame callback failed', err);
      frameCallbacks.delete(fn);
    }
  }
  if (frameCallbacks.size || scrollState.settled === false) requestAnimationFrame(tick);
  else frameRunning = false;
}

/** Keep the loop alive while something is animating. */
export function keepAlive(ms = 400) {
  scrollState.settled = false;
  clearTimeout(keepAlive.t);
  keepAlive.t = setTimeout(() => { scrollState.settled = true; }, ms);
}

/* ------------------------------------------------------------------ *
 * scroll model
 * ------------------------------------------------------------------ */

export const scrollState = {
  y: 0,
  prevY: 0,
  velocity: 0,      // px per second, signed
  direction: 1,     // 1 down, -1 up
  max: 1,
  progress: 0,      // 0..1 of the document
  settled: true,
};

function updateScroll() {
  const y = window.scrollY || window.pageYOffset || 0;
  const max = Math.max(1, doc.documentElement.scrollHeight - innerHeight);
  const dt = 1 / 60;
  const delta = y - scrollState.y;
  scrollState.prevY = scrollState.y;
  scrollState.y = y;
  scrollState.max = max;
  scrollState.progress = clamp(y / max);
  scrollState.velocity = lerp(scrollState.velocity, delta / dt, 0.25);
  scrollState.direction = delta > 0.5 ? 1 : delta < -0.5 ? -1 : scrollState.direction;
  if (Math.abs(delta) > 0.5) keepAlive(240);
}

/** Normalised scroll progress through an element (0 = enters, 1 = leaves). */
export function elementProgress(el, { start = 'top bottom', end = 'bottom top' } = {}) {
  const rect = el.getBoundingClientRect();
  const from = parsePosition(start, rect);
  const to = parsePosition(end, rect);
  return clamp(inv(from, to, 0));
}

function parsePosition(expr, rect) {
  // supports the two-token form the capture uses: "top bottom", "top center"…
  const [elPart, viewPart] = String(expr).trim().split(/\s+/);
  const view = { top: 0, center: innerHeight / 2, bottom: innerHeight }[viewPart] ?? innerHeight;
  const point = { top: rect.top, center: rect.top + rect.height / 2, bottom: rect.bottom }[elPart] ?? rect.top;
  return point - view;
}

/* ------------------------------------------------------------------ *
 * misc DOM helpers
 * ------------------------------------------------------------------ */

export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export function debounce(fn, wait = 150) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function afterTransition(el, ms, fn) {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}

/** True when the element currently takes part in layout (measurable). */
export function isRendered(el) {
  if (!el || !el.isConnected) return false;
  if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
  return Boolean(el.getClientRects().length);
}

export function setIndex(list, prop = '--ln-i') {
  list.forEach((el, i) => el.style.setProperty(prop, String(i)));
}

/** Guard a whole feature: never let one module take the page down. */
export function safe(name, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[landnr] ${name} failed`, err);
    report.errors.push(`${name}: ${err.message}`);
    return null;
  }
}

/** Build telemetry so `npm run build` output and the console stay honest. */
export const report = {
  startedAt: Date.now(),
  errors: [],
  notes: [],
  counts: {},
};

export function note(message) {
  report.notes.push(message);
  console.info(`[landnr] ${message}`);
}

export function count(key, by = 1) {
  report.counts[key] = (report.counts[key] || 0) + by;
}
