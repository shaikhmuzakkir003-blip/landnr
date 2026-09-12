/**
 * sections.js — the page-specific behaviour that is not text, nav or marquee:
 *
 *   · hero intro + parallax (`data-hero-anim`, `.home-hero-next-race-w`)
 *   · the mobile "tap to lock" hero control (`data-home-swipe-*`)
 *   · the sticky ON TRACK / OFF TRACK diptych (`data-otot-section`)
 *   · the social filmstrip (`data-social-callout`) + video mounts
 *   · the scroll indicator bar
 *
 * Each one measures before it acts: if the geometry the effect needs is not
 * there (mobile stack, missing mount, zero-width row) the effect switches
 * itself off instead of fighting the published CSS.
 */

import {
  $$, brandColor, clamp, count, inv, isTouch, lerp, on, onFrame, safe, scrollState,
} from './utils.js';
import { play, register } from './reveals.js';
import { startScroll, stopScroll } from './smooth-scroll.js';

/** Optional: map a capture stream id to a playable URL to enable video. */
export const streamConfig = {
  // '824804225': 'https://iframe.videodelivery.net/…',
};

export function initSections() {
  safe('hero', initHero);
  safe('swipe', initSwipeControl);
  safe('otot', initOnOffTrack);
  safe('socials', initSocialCards);
  safe('streams', initVideoStreams);
  safe('indicator', initScrollIndicator);
  safe('visor', initVisor);
}

/* ------------------------------------------------------------------ *
 * hero
 * ------------------------------------------------------------------ */

let heroEls = [];
let nextRaceBox = null;

function initHero() {
  heroEls = $$('[data-hero-anim]');
  nextRaceBox = document.querySelector('.home-hero-next-race-w');
  heroEls.forEach((el, i) => {
    el.style.setProperty('--ln-i', String(i));
    el.classList.add('ln-hero-pending');
  });
  if (nextRaceBox) nextRaceBox.classList.add('ln-hero-pending');
  count('heroAnims', heroEls.length);
  onFrame(heroFrame);
}

/** Called by the preloader once the visitor is let in. */
export function playHero() {
  heroEls.forEach((el, i) => {
    setTimeout(() => {
      el.classList.remove('ln-hero-pending');
      el.classList.add('ln-hero-in');
    }, 90 * i);
  });

  if (nextRaceBox) {
    nextRaceBox.style.clipPath = 'inset(0 0 100% 0)';
    requestAnimationFrame(() => {
      nextRaceBox.classList.remove('ln-hero-pending');
      nextRaceBox.classList.add('ln-hero-in');
      nextRaceBox.style.clipPath = 'inset(0 0 0% 0)';
    });
  }

  // everything above the fold reveals with the hero, not on scroll
  const fold = $$('.home-hero [data-anim-high], .home-marquee [data-anim-high], .sticky-track.home-hero [data-ln-reveal]');
  fold.forEach((el, i) => setTimeout(() => play(el), 120 + i * 90));
}

function heroFrame() {
  const track = document.querySelector('.sticky-track.home-hero');
  if (!track || !nextRaceBox) return;
  const rect = track.getBoundingClientRect();
  if (rect.bottom < 0) return;
  const progress = clamp(inv(0, rect.height, -rect.top));
  nextRaceBox.style.setProperty('--ln-hero-fade', String(1 - progress * 0.85));
  nextRaceBox.style.translate = `0 ${(-progress * 26).toFixed(2)}px`;
}

/* ------------------------------------------------------------------ *
 * "tap to lock" hero control (touch only)
 * ------------------------------------------------------------------ */

function initSwipeControl() {
  const wrap = document.querySelector('[data-home-swipe-wrap]');
  const toggle = document.querySelector('[data-home-swipe-toggle]');
  if (!wrap || !toggle) return;
  if (!isTouch()) return;                       // CSS keeps it hidden on desktop
  document.documentElement.classList.add('ln-touch');

  let locked = false;
  on(toggle, 'click', (event) => {
    event.preventDefault();
    locked = !locked;
    wrap.classList.toggle('is-locked', locked);
    toggle.setAttribute('aria-pressed', String(locked));
    if (locked) stopScroll();
    else startScroll();
  });
  count('swipeControls', 1);
}

/* ------------------------------------------------------------------ *
 * sticky ON TRACK / OFF TRACK
 * ------------------------------------------------------------------ */

function initOnOffTrack() {
  const track = document.querySelector('[data-otot-section]');
  if (!track) return;
  const columns = $$('.otot-home-text-col', track);
  const images = $$('.otot-home-img-w', track);
  if (columns.length < 2) return;

  columns.forEach((column, i) => column.classList.toggle('ln-active', i === 0));
  images.forEach((image, i) => image.classList.toggle('ln-active', i === 0));
  let lastPhase = -1;

  onFrame(() => {
    const rect = track.getBoundingClientRect();
    if (rect.bottom < -200 || rect.top > innerHeight + 200) return;
    const progress = clamp(inv(0, Math.max(1, rect.height - innerHeight * 0.6), -rect.top));
    const phase = progress < 0.5 ? 0 : 1;
    if (phase === lastPhase) return;
    lastPhase = phase;
    columns.forEach((column, i) => column.classList.toggle('ln-active', i === phase));
    images.forEach((image, i) => image.classList.toggle('ln-active', i === phase));
  });

  count('ototPhases', 2);
}

/* ------------------------------------------------------------------ *
 * social filmstrip
 * ------------------------------------------------------------------ */

function initSocialCards() {
  const wrap = document.querySelector('[data-social-callout="wrap"]');
  if (!wrap) return;

  const cards = $$('.callout-socials-card-w', wrap);
  cards.forEach((card, i) => card.style.setProperty('--ln-i', String(i)));

  let overflow = 0;
  let dragOffset = 0;

  const measure = () => {
    const inner = cards.reduce((total, card) => total + card.getBoundingClientRect().width, 0);
    overflow = Math.max(0, inner + (cards.length - 1) * 8 - wrap.clientWidth);
    wrap.style.overflow = overflow > 4 ? 'hidden' : '';
  };

  measure();
  on(window, 'resize', measure);
  window.addEventListener('load', () => setTimeout(measure, 300));

  // drag to explore the strip
  let dragging = false;
  let startX = 0;
  let startOffset = 0;

  on(wrap, 'pointerdown', (event) => {
    if (overflow <= 4) return;
    dragging = true;
    startX = event.clientX;
    startOffset = dragOffset;
    wrap.classList.add('ln-dragging');
    wrap.setPointerCapture?.(event.pointerId);
  });
  on(wrap, 'pointermove', (event) => {
    if (!dragging) return;
    dragOffset = clamp(startOffset + (event.clientX - startX), -overflow, 0);
  });
  const endDrag = () => { dragging = false; wrap.classList.remove('ln-dragging'); };
  on(wrap, 'pointerup', endDrag);
  on(wrap, 'pointercancel', endDrag);

  onFrame(() => {
    if (overflow <= 4) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;
    const progress = clamp(inv(innerHeight, -rect.height, rect.top));
    const driven = -progress * overflow * 0.85;
    wrap.style.transform = `translate3d(${(driven + dragOffset).toFixed(2)}px, 0, 0)`;
  });

  count('socialCards', cards.length);
}

/* ------------------------------------------------------------------ *
 * video mounts — posters by default, real players when configured
 * ------------------------------------------------------------------ */

function initVideoStreams() {
  const mounts = $$('[data-video-stream]');
  let playable = 0;

  for (const mount of mounts) {
    const id = (mount.dataset.streamUrl || '').trim();
    const src = streamConfig[id];
    if (!src) continue;

    const params = new URLSearchParams({
      muted: mount.dataset.streamMuted !== 'false' ? 'true' : 'false',
      loop: mount.dataset.streamLoop !== 'false' ? 'true' : 'false',
      autoplay: mount.dataset.streamAutoplay !== 'false' ? 'true' : 'false',
    });
    const wrapper = document.createElement('div');
    wrapper.className = 'iframe-wrapper';
    wrapper.innerHTML = `<iframe src="${src}?${params}" allow="autoplay; fullscreen" allowfullscreen loading="lazy" title="Lando Norris"></iframe>`;
    mount.appendChild(wrapper);
    playable++;
  }

  count('videoMounts', mounts.length);
  count('videoPlayable', playable);
}

/* ------------------------------------------------------------------ *
 * scroll indicator
 * ------------------------------------------------------------------ */

function initScrollIndicator() {
  const bar = document.querySelector('.scroll-indicator-bar');
  const wrap = document.querySelector('.scroll-indicator');
  if (!bar || !wrap) return;

  const rect = bar.getBoundingClientRect();
  const horizontal = rect.width > rect.height * 1.5;
  bar.style.transformOrigin = horizontal ? '0% 50%' : '50% 0%';

  let last = -1;
  onFrame(() => {
    const progress = clamp(scrollState.progress);
    const value = Math.round(progress * 200) / 200;
    if (value === last) return;
    last = value;
    bar.style.transform = horizontal ? `scaleX(${value})` : `scaleY(${value})`;
    wrap.style.opacity = progress > 0.985 ? '0' : '';
  });
  count('scrollIndicator', 1);
}

/* ------------------------------------------------------------------ *
 * the store section's visor strip
 * ------------------------------------------------------------------ */

function initVisor() {
  const visor = document.querySelector('[data-exe-visor]');
  if (!visor) return;
  register(visor, { kind: 'reveal' });
  visor.setAttribute('data-ln-reveal', '');
  count('visors', 1);
}

export { brandColor, lerp };
