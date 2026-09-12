/**
 * engine.js — boot order for the local engine.
 *
 * The capture was designed around OFF+BRAND's bundle: it hides the page,
 * splits the type, mounts Rive art, drives a WebGL wash, pins a horizontal
 * section and runs the nav. The build vendors that bundle and everything it
 * fetches, so on the homepage it is the real engine that runs — and this
 * module is what drives the page when it cannot (a --local build, a sub-page,
 * a browser that refused the bundle). Order matters:
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
import { initDiagnostics } from './diagnostics.js';

const VERSION = '2.0.0';
const startedAt = performance.now();

/* ------------------------------------------------------------------ *
 * Which engine drives this page?
 *
 * The homepage ships the genuine OFF+BRAND bundle, vendored into
 * /assets/vendor/ by the build so that every file it fetches — the page
 * transition Rive, the seven artboards, the WebGL hero, the Rive WASM — comes
 * from this origin. Its boot is a chain of awaits:
 *
 *     await pageTransitionRive()          ← rejects if page-transition.riv 404s
 *     await Promise.all([webGL(), allRiveLoaded()])
 *     then construct Lenis and hand the page to GSAP
 *
 * which is why a single refused request used to leave the whole site static:
 * the chain threw before Lenis existed, and this module had already stood down
 * because the <script> had merely *loaded*. So the decision is no longer
 * "did the file arrive" but "is the engine actually driving":
 *
 *   window.landoGL  → the bundle evaluated (set while it runs, synchronously)
 *   window.lenis    → it finished booting and owns the scroll
 *
 * Until `window.lenis` exists, nothing here touches the DOM, so a late
 * takeover by the local engine cannot collide with a half-built real one.
 * ------------------------------------------------------------------ */
const EVALUATED_BY_MS = 4000;    // no landoGL by now ⇒ the bundle threw on load
const BOOTED_BY_MS = 45000;      // the WebGL hero is ~5 MB on a cold cache
const POLL_MS = 150;
const NUDGE_AFTER_MS = 2500;     // when to start unblocking their Rive handshake
const NUDGE_EVERY_MS = 1500;

/** Set by exposeApi(); used to surface a failure on screen. */
let diagnosticsApi = null;

/** Their Lenis instance — the moment this exists, the real engine is driving. */
const realEngineUp = () => Boolean(window.lenis);
/** Their GL config object — created while the bundle evaluates. */
const realEngineEvaluating = () => Boolean(window.landoGL);

if (window.__lnRemote?.loaded) waitForRealEngine();
else boot();

function waitForRealEngine() {
  docEl.classList.remove('ln-js');
  docEl.classList.add('ln-remote');
  report.remote = { loaded: true, at: Math.round(performance.now()) };
  note('OFF+BRAND bundle is in the page — waiting for it to take the scroll');

  exposeApi();
  banner();

  const started = performance.now();
  let lastNudge = 0;

  const poll = setInterval(() => {
    const waited = performance.now() - started;

    if (realEngineUp()) {
      clearInterval(poll);
      handOver(waited);
      return;
    }

    /* Their Rive loader counts artboards down and fires `allriveloaded` at
       zero — errors decrement the counter too, so a missing artboard cannot
       wedge it. But if the loader never ran at all, the boot chain waits
       forever on an event nobody will send. Send it. */
    if (!window.loadingComplete && waited > NUDGE_AFTER_MS && waited - lastNudge > NUDGE_EVERY_MS) {
      lastNudge = waited;
      window.dispatchEvent(new CustomEvent('allriveloaded'));
      note('nudged the Rive handshake (allriveloaded)');
    }

    if (!realEngineEvaluating() && waited > EVALUATED_BY_MS) {
      giveUp('loaded but never evaluated');
      return;
    }
    if (waited > BOOTED_BY_MS) {
      giveUp('never finished booting');
    }
  }, POLL_MS);

  function giveUp(reason) {
    clearInterval(poll);
    if (realEngineUp()) { handOver(performance.now() - started); return; }
    report.remote.rescued = true;
    report.remote.reason = reason;
    note(`real engine ${reason} — local engine taking over`);
    docEl.classList.remove('ln-remote');
    boot();
    // Something the build expected to work did not. Say so on screen rather
    // than leaving a visitor wondering why the site feels flat.
    diagnosticsApi?.show?.();
  }
}

/** The real engine has the page. Stay out of its way, and report when the
 *  intro overlay it is driving has finally lifted. */
function handOver(waited) {
  report.remote.alive = true;
  report.remote.bootMs = Math.round(waited);
  docEl.classList.add('ln-remote-live');
  note(`OFF+BRAND engine is driving (booted in ${Math.round(waited)}ms)`);
  console.info('[landnr] the real OFF+BRAND engine owns this page');

  // Not ln:ready yet: the Rive intro is still on screen and only the visitor
  // (or their "Load Norris" click) ends it. The inline failsafe knows the
  // difference — it checks window.landoGL before it touches anything.
  const started = performance.now();
  const watch = setInterval(() => {
    if (!overlayCovering()) {
      clearInterval(watch);
      docEl.classList.add('ln-ready');
      report.remote.revealedAt = Math.round(performance.now() - startedAt);
      window.dispatchEvent(new CustomEvent('ln:ready', { detail: { remote: true } }));
      note('intro overlay lifted — page is live');
      return;
    }
    if (performance.now() - started > 180000) clearInterval(watch);
  }, 400);
}

/** True while `.transition-w` still paints over the whole viewport. */
function overlayCovering() {
  const el = doc.querySelector('.transition-w');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  if (r.width < window.innerWidth - 2 || r.height < window.innerHeight - 2) return false;
  const s = window.getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
}

function boot() {
  if (realEngineUp()) { handOver(performance.now() - startedAt); return; }
  docEl.classList.add('ln-js');
  docEl.classList.remove('ln-remote');
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
  const diagnostics = safe('diagnostics', () => initDiagnostics({ report, version: VERSION }));
  diagnosticsApi = diagnostics;
  window.landnr = {
    version: VERSION,
    report,
    /** `landnr.diagnostics()` — or load the page with ?engine — for the
     *  on-screen readout of which engine is driving and what was refused. */
    diagnostics: diagnostics?.show || (() => {}),
    hideDiagnostics: diagnostics?.hide || (() => {}),
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
    `%c homepage markup, type and colour from the published capture · engine ${VERSION}`
    + `${docEl.classList.contains('ln-remote-live') ? ' (standing by behind OFF+BRAND)'
      : docEl.classList.contains('ln-remote') ? ' (waiting on OFF+BRAND)' : ' (driving)'}`
    + ' · window.landnr for the API',
    subtle,
  );
}
