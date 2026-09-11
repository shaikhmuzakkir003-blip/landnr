/**
 * marquee.js — the two marquees the capture declares.
 *
 * Both use the same contract:
 *
 *   <div data-marquee-duplicate="4" data-marquee-direction="right"
 *        data-marquee-speed="40" data-marquee-status="normal"
 *        data-marquee-scroll-direction-target>
 *     <div data-marquee-scroll-target>          ← this is what we translate
 *       <div data-marquee-collection-target>    ← one set of items
 *
 * `duplicate` says how many copies of the collection should exist, `speed` is
 * the drift in px/s, and `scroll-direction-target` means "the page's scroll
 * velocity pushes the marquee", which is what makes it feel attached to the
 * rest of the site. They pause when off-screen.
 */

import { $$, clamp, count, debounce, on, onFrame, scrollState } from './utils.js';

const marquees = [];

export function initMarquees() {
  const roots = $$('[data-marquee-duplicate]');

  for (const root of roots) {
    const scrollEl = root.querySelector('[data-marquee-scroll-target]');
    const collection = root.querySelector('[data-marquee-collection-target]');
    if (!scrollEl || !collection) continue;

    const copies = Math.max(2, parseInt(root.dataset.marqueeDuplicate, 10) || 2);
    const direction = (root.dataset.marqueeDirection || 'left').trim() === 'right' ? 1 : -1;
    const speed = (parseFloat(root.dataset.marqueeSpeed) || 30) * 1.6;
    const reactsToScroll = root.hasAttribute('data-marquee-scroll-direction-target');

    // lay the copies out side by side
    if (getComputedStyle(scrollEl).display === 'block') scrollEl.style.display = 'flex';
    scrollEl.style.flexWrap = 'nowrap';
    scrollEl.style.willChange = 'transform';

    for (let i = 1; i < copies; i++) {
      const clone = collection.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.dataset.lnClone = String(i);
      scrollEl.appendChild(clone);
    }

    const state = {
      root,
      scrollEl,
      collection,
      direction,
      speed,
      reactsToScroll,
      unit: 0,
      x: direction === 1 ? -1 : 0, // right-to-left starts flush, left-to-right starts one unit back
      visible: true,
      paused: false,
    };
    state.x = direction === 1 ? -measure(state) : 0;
    marquees.push(state);
  }

  if (!marquees.length) return { count: 0 };

  measureAll();
  onFrame(update);
  on(window, 'resize', debounce(measureAll, 200));
  window.addEventListener('load', () => setTimeout(measureAll, 200));
  if (document.fonts?.ready) document.fonts.ready.then(() => measureAll()).catch(() => {});

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const state = marquees.find((m) => m.root === entry.target);
        if (!state) continue;
        state.visible = entry.isIntersecting;
        state.root.dataset.marqueeStatus = entry.isIntersecting ? 'normal' : 'paused';
      }
    }, { rootMargin: '120px' });
    marquees.forEach((state) => io.observe(state.root));
  }

  count('marquees', marquees.length);
  return { count: marquees.length };
}

function measure(state) {
  const rect = state.collection.getBoundingClientRect();
  state.unit = Math.max(1, rect.width);
  return state.unit;
}

function measureAll() {
  for (const state of marquees) {
    measure(state);
    state.x = clamp(state.x, -state.unit, 0);
    apply(state);
  }
}

function update({ dt }) {
  for (const state of marquees) {
    if (!state.visible || state.paused) continue;

    let velocity = state.direction * state.speed;
    if (state.reactsToScroll) {
      // page scroll nudges the strip; scrolling up pushes it the other way
      const boost = clamp(scrollState.velocity * 0.22, -260, 260);
      velocity += boost;
    }

    state.x += velocity * dt;
    if (state.x <= -state.unit) state.x += state.unit;
    if (state.x > 0) state.x -= state.unit;
    apply(state);
  }
}

function apply(state) {
  state.scrollEl.style.transform = `translate3d(${state.x.toFixed(2)}px, 0, 0)`;
}

export function pauseMarquees(paused = true) {
  marquees.forEach((state) => { state.paused = paused; });
}
