/**
 * smooth-scroll.js — a Lenis-style scroller in ~120 lines.
 *
 * The real site smooths scrolling with Lenis and the published CSS already
 * carries Lenis' hooks (`html.lenis`, `.lenis-smooth`, `.lenis-top`), so this
 * drives the same classes. It is deliberately conservative:
 *
 *   · mouse/trackpad only — touch keeps native scrolling (and native inertia);
 *   · disabled entirely for prefers-reduced-motion;
 *   · anything scrollable inside the page (a draggable card row, an overflow
 *     container) wins over the smooth scroller;
 *   · any error, or any scroll this module did not cause, resynchronises the
 *     target with the real scroll offset, so the page can never be stranded.
 */

import { clamp, count, isTouch, lerp, note, on, onFrame, reducedMotion } from './utils.js';

const LERP_SPEED = 7.5;      // higher = snappier
const WHEEL_SCALE = 1;       // 1:1 with the browser's own wheel delta
const EPSILON = 0.4;

let enabled = false;
let locked = false;
let target = 0;
let current = 0;
let applying = false;
let detachWheel = null;

export function initSmoothScroll() {
  // The real OFF+BRAND engine drives the scroll with Lenis. If it came up
  // after we started booting, it wins — two smooth scrollers is a fight.
  if (window.lenis) return finish('the OFF+BRAND engine owns the scroll');
  if (reducedMotion()) return finish('reduced-motion');
  if (isTouch()) return finish('touch device');
  if (!('scrollTo' in window)) return finish('no scrollTo');

  enabled = true;
  target = current = window.scrollY || 0;

  document.documentElement.classList.add('lenis', 'lenis-smooth');
  detachWheel = on(window, 'wheel', onWheel, { passive: false });
  on(window, 'scroll', onNativeScroll, { passive: true });
  on(window, 'resize', () => { target = clamp(target, 0, maxScroll()); });
  onFrame(step);
  updateEdgeClasses();

  note('smooth scroll: on');
  return finish('enabled');

  function finish(reason) {
    count('smoothScroll', enabled ? 1 : 0);
    return { enabled, reason };
  }
}

function maxScroll() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function onWheel(event) {
  if (!enabled || locked) {
    if (locked) event.preventDefault();
    return;
  }
  if (isInsideScrollable(event.target)) return;
  if (event.ctrlKey) return; // let the browser zoom

  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  const delta = (event.deltaY || 0) * unit * WHEEL_SCALE;
  if (!delta) return;

  const next = clamp(target + delta, 0, maxScroll());
  // at the very edges, hand control back to the browser (rubber-band, address bar…)
  if ((next === target) && (delta < 0 ? current <= 0 : current >= maxScroll())) return;

  event.preventDefault();
  target = next;
}

/** Respect nested scrollers and anything the page marks as lenis-proof. */
function isInsideScrollable(node) {
  let el = node instanceof Element ? node : node?.parentElement;
  while (el && el !== document.body) {
    if (el.hasAttribute?.('data-lenis-prevent')) return true;
    const style = getComputedStyle(el);
    const scrollableY = /(auto|scroll)/.test(style.overflowY);
    if (scrollableY && el.scrollHeight > el.clientHeight + 1) return true;
    el = el.parentElement;
  }
  return false;
}

function onNativeScroll() {
  updateEdgeClasses();
  if (applying) return;
  const y = window.scrollY || 0;
  if (Math.abs(y - current) > 1.5) {
    // someone else scrolled (keyboard, anchor, browser UI) — follow them
    current = target = y;
  }
}

function step({ dt }) {
  if (!enabled) return;
  const distance = target - current;
  if (Math.abs(distance) < EPSILON) {
    if (current !== target) {
      current = target;
      write();
    }
    return;
  }
  current += distance * Math.min(1, dt * LERP_SPEED);
  write();
}

function write() {
  applying = true;
  window.scrollTo(0, current);
  requestAnimationFrame(() => { applying = false; });
}

function updateEdgeClasses() {
  const html = document.documentElement;
  const y = window.scrollY || 0;
  html.classList.toggle('lenis-top', y <= 4);
  html.classList.toggle('lenis-bottom', y >= maxScroll() - 4);
}

/* ------------------------------------------------------------------ *
 * public controls
 * ------------------------------------------------------------------ */

export function stopScroll() {
  locked = true;
  document.documentElement.classList.add('lenis-stopped');
}

export function startScroll() {
  locked = false;
  document.documentElement.classList.remove('lenis-stopped');
  target = current = window.scrollY || 0;
}

export function scrollTo(y, { immediate = false } = {}) {
  const value = clamp(y, 0, maxScroll());
  if (!enabled || immediate) {
    window.scrollTo(0, value);
    current = target = value;
    return;
  }
  target = value;
}

export function disable() {
  if (!enabled) return;
  enabled = false;
  locked = false;
  document.documentElement.classList.remove('lenis', 'lenis-smooth', 'lenis-stopped');
  if (detachWheel) detachWheel();
  detachWheel = null;
  note('smooth scroll: disabled');
}

export function isEnabled() {
  return enabled;
}

export function isLocked() {
  return locked;
}

/** Smooth-scroll to an in-page anchor (the nav's "#" links). */
export function bindAnchors(scope = document) {
  for (const link of scope.querySelectorAll('a[href^="#"]')) {
    const id = link.getAttribute('href').slice(1);
    if (!id) continue;
    const target_ = document.getElementById(id);
    if (!target_) continue;
    on(link, 'click', (event) => {
      event.preventDefault();
      scrollTo(target_.getBoundingClientRect().top + window.scrollY, {});
    });
  }
}

export { lerp };
