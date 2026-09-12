/**
 * reveals.js — scroll-triggered entrances.
 *
 * Two families:
 *   · `[data-anim-high="right, lime, 200"]` — the capture's own hook.
 *     direction, highlight colour and delay are read straight out of the
 *     attribute and handed to CSS as custom properties; the lines themselves
 *     come from split-text.js.
 *   · `[data-ln-reveal]` — this build's hook, tagged onto image groups the
 *     original animated through the (unavailable) Rive/WebGL layer.
 *
 * Nothing is hidden unless JavaScript is running: every rule lives behind
 * `html.ln-js`, and a missing IntersectionObserver reveals everything at once.
 */

import { $$, count, reducedMotion, safe } from './utils.js';
import { lineCount as splitLineCount, markState } from './split-text.js';

const HIGHLIGHT_SELECTOR = '[data-anim-high]';

const SWEEP_COLORS = {
  lime: 'var(--ln-lime)',
  'lime-off': 'var(--ln-lime-off)',
  'dark-green-tint-1': 'var(--ln-tint-1)',
  'dark-green-tint-2': 'var(--ln-tint-2)',
  white: 'var(--ln-white)',
  'green-off-white-2': 'var(--color--green-off-white-2, rgba(207, 227, 212, 0.55))',
};

let observer = null;
const watched = new Map();

export function initReveals() {
  const supportsIO = 'IntersectionObserver' in window;

  if (supportsIO) {
    observer = new IntersectionObserver(onIntersect, {
      threshold: [0, 0.15, 0.4],
      rootMargin: '0px 0px -6% 0px',
    });
  }

  const highlights = $$(HIGHLIGHT_SELECTOR);
  for (const el of highlights) prepareHighlight(el);
  count('animHigh', highlights.length);

  tagReveals();

  if (!supportsIO) {
    for (const [el] of watched) play(el);
    return { highlights: highlights.length, observer: false };
  }
  for (const [el] of watched) observer.observe(el);
  return { highlights: highlights.length, observer: true };
}

/** Elements that should animate in but carry no data-anim-high hook. */
export function tagReveals() {
  const groups = [
    ['.exe-cta-img-w', 60],
    ['.callout-socials-card-w', 70],
    ['.horizontal-item-w', 0],
    ['.otot-home-end-img-w', 0],
    ['.marquee-signature-w', 0],
    ['.footer-bg-helmet-w', 0],
    ['.home-collab-rive-w', 0],
  ];
  let tagged = 0;
  for (const [selector, stagger] of groups) {
    const items = $$(selector);
    items.forEach((el, i) => {
      if (el.hasAttribute('data-ln-reveal')) return;
      el.setAttribute('data-ln-reveal', '');
      el.style.setProperty('--ln-i', String(stagger ? i : Math.min(i, 12)));
      register(el, { kind: 'reveal' });
      tagged++;
    });
  }
  for (const el of $$('.helmet-grid-item-w')) {
    el.style.setProperty('--ln-i', String(Math.min([...el.parentElement.children].indexOf(el), 15)));
    register(el, { kind: 'grid' });
    tagged++;
  }
  count('revealTagged', tagged);
  return tagged;
}

export function register(el, meta = {}) {
  if (watched.has(el)) return;
  watched.set(el, { played: false, ...meta });
  if (observer) observer.observe(el);
}

function prepareHighlight(el) {
  const raw = el.getAttribute('data-anim-high') || '';
  const [dir, color, delay] = raw.split(',').map((part) => (part || '').trim());

  el.style.setProperty('--ln-sweep', SWEEP_COLORS[color] || 'transparent');
  el.style.setProperty('--ln-sweep-origin', dir === 'left' ? 'right center' : 'left center');
  el.style.setProperty('--ln-delay', /^\d+$/.test(delay || '') ? `${delay}ms` : '0ms');
  el.dataset.lnDir = dir || 'right';

  register(el, { kind: 'high' });

  // Hide only what can actually be animated: it must be split into lines and
  // it must be on screen (or about to be).
  if (reducedMotion()) return;
  if (!el.classList.contains('ln-split')) return;
  if (!el.querySelector('.line') && !el.querySelector('.char')) return;
  el.classList.add('ln-hidden');
  markState(el, 'hidden');
}

function onIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target;
    if (entry.intersectionRatio < 0.08 && el.getBoundingClientRect().height > innerHeight * 0.9) continue;
    play(el);
  }
}

/** Run an element's entrance now (used by the intro + the observer). */
export function play(el) {
  const meta = watched.get(el);
  if (!meta || meta.played) return;
  meta.played = true;
  if (observer) observer.unobserve(el);

  safe('reveal', () => {
    if (meta.kind === 'high') playHighlight(el);
    else {
      el.classList.add('ln-in');
      if (meta.kind === 'grid') el.classList.add('ln-in');
    }
  });
}

function playHighlight(el) {
  const lines = splitLineCount(el) || el.querySelectorAll('.line').length || 1;
  const delay = parseInt(el.style.getPropertyValue('--ln-delay') || '0', 10) || 0;
  const chars = el.classList.contains('ln-chars');

  el.classList.remove('ln-hidden');
  // force a style flush so the transition actually runs
  void el.offsetWidth;
  el.classList.add('ln-in');
  markState(el, 'in');

  const total = delay + (chars ? 500 + lines * 22 : 950) + lines * 70 + 120;
  setTimeout(() => {
    el.classList.add('ln-done');
    markState(el, 'done');
  }, Math.min(total, 4000));
}

/** Play everything inside a subtree immediately (hero intro, menu open…). */
export function playAll(scope = document) {
  for (const [el] of watched) {
    if (scope.contains(el)) play(el);
  }
}

/** Re-arm elements after a re-split so they can play again. */
export function rearm(el) {
  const meta = watched.get(el);
  if (!meta) return;
  meta.played = false;
  el.classList.remove('ln-in', 'ln-done');
  el.classList.add('ln-hidden');
  markState(el, 'hidden');
  if (observer) observer.observe(el);
}
