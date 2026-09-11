/**
 * engine.js — boot order for the local engine.
 *
 * The capture was designed around OFF+BRAND's bundle: it hides the page,
 * splits the type, mounts Rive art, drives a WebGL wash, pins a horizontal
 * section and runs the nav. That bundle lives on a referrer-locked host, so
 * this module is the replacement. Order matters:
 *
 *   1. browser hints the original bundle set (.is-safari / .is-iphone)
 *   2. Rive stand-ins           — changes the DOM before anything measures
 *   3. split text               — needs a settled DOM
 *   4. reveals                  — hides what it will later animate
 *   5. nav / marquee / horizontal / ambient / sections
 *   6. smooth scroll            — last, once layout is final
 *   7. preloader                — hands over to the hero intro
 *
 * Every step is wrapped: a failure is logged, recorded in `window.landnr`
 * and the page is force-revealed rather than left behind an overlay.
 */

import { count, doc, docEl, note, report, safe } from './utils.js';
import { initRiveFallbacks } from './rive-fallbacks.js';
import { initSplitText, splitPending } from './split-text.js';
import { initReveals } from './reveals.js';
import { initNav, close as closeMenu, toggle as toggleMenu } from './nav.js';
import { initMarquees, pauseMarquees } from './marquee.js';
import { initHorizontal } from './horizontal.js';
import { initAmbient, refreshAmbient } from './ambient.js';
import { initSections, playHero, streamConfig } from './sections.js';
import { initSmoothScroll, disable as disableSmoothScroll, scrollTo } from './smooth-scroll.js';
import { initPreloader } from './preloader.js';

const VERSION = '1.0.0';
const startedAt = performance.now();

boot();

function boot() {
  detectBrowser();

  safe('rive-fallbacks', () => initRiveFallbacks(doc));
  safe('split-text', () => initSplitText(doc));
  safe('reveals', () => initReveals());
  safe('nav', () => initNav());
  safe('marquees', () => initMarquees());
  safe('horizontal', () => initHorizontal());
  safe('ambient', () => initAmbient());
  safe('sections', () => initSections());
  safe('smooth-scroll', () => initSmoothScroll());

  safe('preloader', () => initPreloader({ onEnter }));

  // the menu is display:none at boot, so its text could not be split then
  window.addEventListener('load', () => {
    safe('deferred-split', () => splitPending(doc));
    safe('post-load-measure', () => { refreshAmbient(); });
  }, { once: true });

  exposeApi();
  banner();

  // tells the inline failsafe in the HTML that the engine is alive, so it can
  // stop counting "nothing happened" and start counting "the loader stalled"
  window.dispatchEvent(new CustomEvent('ln:booted', { detail: { version: VERSION } }));

  if (report.errors.length) {
    docEl.classList.add('ln-failsafe');
    note(`engine finished with ${report.errors.length} error(s) — failsafe applied`);
  }
}

function onEnter() {
  docEl.classList.add('ln-ready');
  safe('hero-intro', () => playHero());
  window.dispatchEvent(new CustomEvent('ln:ready', { detail: { ms: Math.round(performance.now() - startedAt) } }));
  report.bootMs = Math.round(performance.now() - startedAt);
  console.info(`[landnr] ready in ${report.bootMs}ms`, report.counts);
}

/** The original bundle did both of these; the page CSS depends on them. */
function detectBrowser() {
  const ua = navigator.userAgent;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isIphone = /iPhone/i.test(ua);
  if (isSafari) docEl.classList.add('is-safari');
  if (isIphone) docEl.classList.add('is-iphone');
  count('browserHints', (isSafari ? 1 : 0) + (isIphone ? 1 : 0));
}

function exposeApi() {
  window.landnr = {
    version: VERSION,
    report,
    scrollTo,
    openMenu: () => toggleMenu(true),
    closeMenu,
    toggleMenu,
    pauseMarquees,
    refreshAmbient,
    splitPending,
    disableSmoothScroll,
    streamConfig,
    /** Re-run the intro (handy when tweaking timings). */
    replay: () => {
      docEl.classList.remove('ln-ready');
      playHero();
    },
  };
}

function banner() {
  const subtle = 'color:#8fa795;font:400 1em/1.4 ui-monospace,SFMono-Regular,Menlo,monospace';
  console.log(
    '%c LANDO NORRIS %c rebuilt locally ',
    'background:#d2ff00;color:#101400;font:700 1em/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:.4em .6em',
    'background:#13251c;color:#d2ff00;font:400 1em/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:.4em .6em',
  );
  console.log(
    `%c homepage markup, type and colour from the published capture · engine ${VERSION} · window.landnr for the API`,
    subtle,
  );
}
