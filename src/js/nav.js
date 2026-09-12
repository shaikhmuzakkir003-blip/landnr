/**
 * nav.js — the fixed nav, its light/dark theme and the full-screen menu.
 *
 * The capture hands the engine two hooks:
 *   · `[data-nav-theme-target="dark|light"]` — 11 markers scattered through the
 *     page; whichever one covers the nav decides `[data-nav-theme]` on
 *     `[data-nav-wrap]`, which the page CSS turns into brand/nav colours.
 *   · `[data-nav-ham]` + `[data-nav-m]` — the hamburger and the menu panel.
 *     The panel ships fully built in the HTML (links, image collage, helmet,
 *     socials); it only needs opening.
 */

import { $$, count, isDesktop, on, onFrame, safe, scrollState } from './utils.js';
import { splitPending } from './split-text.js';
import { playAll } from './reveals.js';
import { stopScroll, startScroll } from './smooth-scroll.js';

let nav = null;
let menu = null;
let ham = null;
let menuOpen = false;
let themeTargets = [];

export function initNav() {
  nav = document.querySelector('[data-nav-wrap]');
  menu = document.querySelector('[data-nav-m]');
  ham = document.querySelector('[data-nav-ham]');
  themeTargets = $$('[data-nav-theme-target]');

  markCurrentLinks();
  if (nav) safe('nav:theme', () => onFrame(updateTheme));
  if (ham && menu) safe('nav:menu', initMenu);
  safe('nav:hover-images', initMenuImages);

  count('navThemeTargets', themeTargets.length);
  return { themeTargets: themeTargets.length, menu: Boolean(menu) };
}

/* ------------------------------------------------------------------ *
 * theme
 * ------------------------------------------------------------------ */

let lastTheme = null;

function updateTheme() {
  if (!nav || !themeTargets.length) return;
  const sampleY = navSampleY();
  let chosen = null;

  for (const target of themeTargets) {
    const rect = target.getBoundingClientRect();
    if (!rect.height && Math.abs(rect.top - sampleY) > 4) continue;
    if (rect.top <= sampleY && rect.bottom >= sampleY) chosen = target;
  }

  if (!chosen) {
    // fall back to the nearest marker above the sample line
    let best = -Infinity;
    for (const target of themeTargets) {
      const rect = target.getBoundingClientRect();
      if (rect.top <= sampleY && rect.top > best) {
        best = rect.top;
        chosen = target;
      }
    }
  }

  const theme = chosen?.dataset?.navThemeTarget;
  if (theme && theme !== lastTheme) {
    lastTheme = theme;
    nav.dataset.navTheme = theme;
    document.documentElement.dataset.navTheme = theme;
  }
}

function navSampleY() {
  if (!nav) return 40;
  const rect = nav.getBoundingClientRect();
  return rect.height ? rect.top + rect.height / 2 : 40;
}

/* ------------------------------------------------------------------ *
 * menu
 * ------------------------------------------------------------------ */

function initMenu() {
  on(ham, 'click', (event) => {
    event.preventDefault();
    toggle();
  });

  on(document, 'keydown', (event) => {
    if (event.key === 'Escape' && menuOpen) close();
  });

  for (const link of $$('a', menu)) {
    on(link, 'click', () => close());
  }

  // a click on the backdrop closes too
  const backdrop = menu.querySelector('.nav-menu-bg');
  if (backdrop) on(backdrop, 'click', () => close());

  ham.setAttribute('aria-expanded', 'false');
  ham.setAttribute('aria-controls', 'ln-nav-menu');
  menu.id = menu.id || 'ln-nav-menu';

  on(window, 'resize', () => { if (menuOpen && isDesktop()) keepLayout(); });
}

export function toggle(force) {
  const next = typeof force === 'boolean' ? force : !menuOpen;
  if (next === menuOpen) return;
  if (next) openMenu();
  else close();
}

function openMenu() {
  menuOpen = true;
  keepLayout();
  menu.classList.add('is-open');
  nav.classList.add('is-menu-open');
  document.body.classList.add('ln-menu-open');
  ham.setAttribute('aria-expanded', 'true');
  stopScroll();

  // the menu is display:none / unmeasurable until now, so its text was never split
  requestAnimationFrame(() => {
    const n = splitPending(menu);
    if (n) count('menuSplit', n);
    indexMenuItems();
    playAll(menu);
  });
}

export function close() {
  if (!menuOpen) return;
  menuOpen = false;
  menu.classList.remove('is-open');
  nav.classList.remove('is-menu-open');
  document.body.classList.remove('ln-menu-open');
  ham.setAttribute('aria-expanded', 'false');
  startScroll();
}

export function isOpen() {
  return menuOpen;
}

/** If the published CSS parks the menu at display:none, un-park it. */
function keepLayout() {
  const computed = getComputedStyle(menu);
  if (computed.display === 'none') menu.style.display = 'block';
  if (computed.position === 'static') {
    menu.style.position = 'fixed';
    menu.style.inset = '0';
    menu.style.zIndex = '8000';
  }
}

function indexMenuItems() {
  const items = [
    ...$$('.nav-menu-link-w', menu),
    ...$$('.nav-menu-img-w', menu),
    ...$$('.nav-helmet-rive-w', menu),
    ...$$('.nav-menu-social-w', menu),
  ];
  items.forEach((el, i) => el.style.setProperty('--ln-i', String(i)));
}

/* ------------------------------------------------------------------ *
 * link hover → image collage
 * ------------------------------------------------------------------ */

function initMenuImages() {
  if (!menu) return;
  const links = $$('.nav-menu-link-w', menu);
  const images = $$('[data-nav-img]', menu);
  if (!links.length || !images.length) return;

  links.forEach((link, index) => {
    const image = images.find((img) => img.dataset.navImg === String(index + 1)) || images[index];
    if (!image) return;
    on(link, 'mouseenter', () => {
      images.forEach((img) => img.classList.remove('ln-hover'));
      image.classList.add('ln-hover');
    });
  });
  on(menu, 'mouseleave', () => images.forEach((img) => img.classList.remove('ln-hover')));
}

/* ------------------------------------------------------------------ *
 * w--current — the OFF+BRAND bundle did exactly this on boot
 * ------------------------------------------------------------------ */

function markCurrentLinks() {
  const path = window.location.pathname.replace(/\/index\.html$/, '/') || '/';
  for (const link of $$('a[href]')) {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || /^https?:/.test(href)) continue;
    const normalised = href.replace(/\/index\.html$/, '/') || '/';
    const match = normalised === path
      || (normalised !== '/' && path.startsWith(normalised.replace(/\/$/, '')));
    link.classList.toggle('w--current', match);
    if (match) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

export { scrollState };
