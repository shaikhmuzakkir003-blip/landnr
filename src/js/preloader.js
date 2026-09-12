/**
 * preloader.js — the `.transition-w` overlay the capture ships with.
 *
 * On the live site that overlay is a Rive animation ending in a "Load Norris"
 * button; the page itself waits behind it (`data-start="hidden"`). The Rive
 * file cannot be fetched from this origin, so the overlay becomes a real
 * loader: it tracks actual asset progress, arms the button the capture already
 * contains, and then hands the page over to the hero intro.
 *
 * It can never trap anyone: repeat visits in the same session skip the wait,
 * an unresponsive asset list auto-enters after a few seconds, and the inline
 * failsafe in index.html force-shows the page if this module never runs.
 */

import { $, count, note, on } from './utils.js';

const AUTO_ENTER_MS = 4200;     // after the loader is armed
const HARD_ENTER_MS = 8000;     // no matter what
const SESSION_KEY = 'ln-entered';

export function initPreloader({ onEnter }) {
  const overlay = $('.transition-w');
  if (!overlay) {
    onEnter?.();
    return { present: false };
  }

  const button = overlay.querySelector('.transition-btn a') || overlay.querySelector('a');
  const returning = sessionStorage.getItem(SESSION_KEY) === '1';

  const art = overlay.querySelector('.ln-preloader-art') || buildArt(overlay);
  if (art.parentElement !== overlay) overlay.insertBefore(art, overlay.firstChild);

  const meter = document.createElement('div');
  meter.className = 'ln-preloader-meter';
  meter.innerHTML = '<span></span>';
  const label = document.createElement('div');
  label.className = 'ln-preloader-count';
  label.textContent = 'loading 0%';

  const anchor = button?.closest('.transition-btn') || null;
  if (anchor) overlay.insertBefore(meter, anchor);
  else overlay.appendChild(meter);
  overlay.insertBefore(label, meter.nextSibling);

  const bar = meter.firstElementChild;
  let progress = 0;
  let armed = false;
  let entered = false;
  let autoTimer = null;
  let hardTimer = null;

  const setProgress = (value) => {
    progress = Math.max(progress, Math.min(1, value));
    bar.style.width = `${(progress * 100).toFixed(1)}%`;
    label.textContent = progress >= 1
      ? (returning ? 'welcome back' : 'ready when you are')
      : `loading ${Math.round(progress * 100)}%`;
    if (progress >= 1 && !armed) arm();
  };

  const arm = () => {
    armed = true;
    overlay.classList.add('is-armed');
    if (button) {
      button.setAttribute('aria-busy', 'false');
      button.dataset.lnEnter = 'true';
    }
    if (returning) {
      enter();
      return;
    }
    autoTimer = setTimeout(enter, AUTO_ENTER_MS);
  };

  const enter = () => {
    if (entered) return;
    entered = true;
    clearTimeout(autoTimer);
    clearTimeout(hardTimer);
    sessionStorage.setItem(SESSION_KEY, '1');
    setProgress(1);
    overlay.classList.add('is-done');
    count('preloader', 1);
    setTimeout(() => {
      overlay.style.display = 'none';
      onEnter?.();
    }, 720);
  };

  if (button) {
    on(button, 'click', (event) => {
      event.preventDefault();
      if (!armed) { setProgress(1); return; }
      enter();
    });
  }
  on(overlay, 'keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && armed) enter();
  });

  hardTimer = setTimeout(() => {
    if (!entered) {
      note('preloader: hard timeout, entering');
      enter();
    }
  }, HARD_ENTER_MS);

  trackAssets(setProgress);
  if (returning) setProgress(1);

  return { present: true, returning };
}

/** Asset progress with a time-based floor so it can never stall. */
function trackAssets(setProgress) {
  const images = Array.from(document.images || []);
  const total = images.length || 1;
  const started = performance.now();
  let last = 0;

  const push = (value) => {
    if (value <= last) return;
    last = value;
    setProgress(value);
  };

  const loop = () => {
    const assets = images.filter((img) => img.complete).length / total;
    const time = Math.min(0.92, (performance.now() - started) / 2600);
    push(Math.max(assets, time));
    if (last < 1) requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
  window.addEventListener('load', () => push(1), { once: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => push(Math.max(last, 0.85))).catch(() => {});
  }
}

function buildArt(overlay) {
  const art = document.createElement('div');
  art.className = 'ln-preloader-art';
  art.innerHTML = `<svg viewBox="0 0 120 60" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6 54V6h9v39h22v9H6Z" fill="currentColor"/>
    <path d="M47 54V6h8l20 30V6h9v48h-8L56 24v30h-9Z" fill="currentColor"/>
    <circle cx="103" cy="14" r="7" fill="currentColor" fill-opacity="0.55"/>
  </svg>`;
  overlay.appendChild(art);
  return art;
}

export { $ };
