/**
 * horizontal.js — the pinned "is-horizontal-track" section.
 *
 * Markup from the capture:
 *
 *   <section data-horizontal-section data-h-color-from="dark-green"
 *            data-h-color-to="white" data-gl-change-track …>
 *     <div class="horizontal-pin-wrap">
 *       <div class="horizontal-pin-spacer">      ← we give it the pin height
 *         <div class="horizontal-pin-sticky">    ← position: sticky; top: 0
 *           <div class="horizontal-track">       ← we translate this on X
 *
 * Scroll distance = how far the track is wider than the viewport. While the
 * sticky element is pinned we convert vertical scroll into horizontal
 * movement, and blend the section's background from `data-h-color-from` to
 * `data-h-color-to` across the same range.
 */

import { $, clamp, count, debounce, isDesktop, mixColor, brandColor, on, onFrame } from './utils.js';

let section = null;
let spacer = null;
let sticky = null;
let track = null;
let distance = 0;
let startAt = 0;
let active = false;
let fromColor = null;
let toColor = null;

export function initHorizontal() {
  section = $('[data-horizontal-section]');
  if (!section) return { active: false, reason: 'no section' };

  spacer = section.querySelector('.horizontal-pin-spacer');
  sticky = section.querySelector('.horizontal-pin-sticky');
  track = section.querySelector('.horizontal-track');
  if (!spacer || !sticky || !track) return { active: false, reason: 'missing pin markup' };

  fromColor = brandColor(section.dataset.hColorFrom || 'dark-green');
  toColor = brandColor(section.dataset.hColorTo || 'white');

  measure();
  onFrame(update);
  on(window, 'resize', debounce(() => { measure(); }, 200));
  window.addEventListener('load', () => setTimeout(measure, 300));
  if (document.fonts?.ready) document.fonts.ready.then(() => measure()).catch(() => {});

  count('horizontalPins', active ? 1 : 0);
  return { active, distance: Math.round(distance) };
}

function measure() {
  // clear first so measurements are not polluted by our own inline styles
  reset();

  if (!isDesktop()) {
    active = false;
    return;
  }

  const stickyStyle = getComputedStyle(sticky);
  if (stickyStyle.position !== 'sticky') {
    sticky.style.position = 'sticky';
    sticky.style.top = '0';
  }
  if (stickyStyle.overflow !== 'hidden') sticky.style.overflow = 'hidden';

  const viewport = sticky.clientWidth || window.innerWidth;
  const trackWidth = track.scrollWidth;
  distance = Math.max(0, trackWidth - viewport);

  if (distance < 24) {
    active = false;
    return;
  }

  const pinHeight = sticky.offsetHeight || window.innerHeight;
  spacer.style.height = `${Math.round(pinHeight + distance)}px`;
  sticky.style.height = `${pinHeight}px`;
  track.style.willChange = 'transform';

  active = true;
  startAt = spacer.getBoundingClientRect().top + window.scrollY;
}

function reset() {
  if (spacer) spacer.style.height = '';
  if (sticky) sticky.style.height = '';
  if (track) track.style.transform = '';
  if (section) section.style.backgroundColor = '';
}

function update() {
  if (!active) return;

  const progress = clamp((window.scrollY - startAt) / distance);
  track.style.transform = `translate3d(${(-progress * distance).toFixed(2)}px, 0, 0)`;

  if (fromColor && toColor) {
    section.style.backgroundColor = mixColor(fromColor, toColor, progress);
  }

  section.dataset.lnHorizontalProgress = progress.toFixed(3);
}

export function isActive() {
  return active;
}

export function progress() {
  if (!active) return 0;
  return clamp((window.scrollY - startAt) / distance);
}

export { $ };
