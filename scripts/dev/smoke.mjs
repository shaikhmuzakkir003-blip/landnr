/**
 * smoke.mjs — boot the real engine against the real build, in Node.
 *
 *   node scripts/dev/smoke.mjs [--scenario=desktop|mobile|touch|reduced|narrow]
 *
 * It cannot prove the site looks right (there is no browser here), but it does
 * prove the expensive things: every module imports, every selector resolves,
 * the frame loop runs, split-text really produces .line/.word/.char markup,
 * reveals reach a done state, the preloader hands over, and nothing throws.
 * Failures are collected and printed as a checklist with a non-zero exit.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDOM } from './dom-shim.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const scenario = (process.argv.find((a) => a.startsWith('--scenario=')) || '--scenario=desktop').split('=')[1];

const SCENARIOS = {
  desktop: { width: 1440, height: 900 },
  wide: { width: 1920, height: 1080 },
  narrow: { width: 1024, height: 768 },
  tablet: { width: 820, height: 1100 },
  mobile: { width: 390, height: 844, touch: true },
  touch: { width: 1280, height: 800, touch: true },
  reduced: { width: 1440, height: 900, reducedMotion: true },
};

const SCENARIO_OPTIONS = { remote: { width: 1440, height: 900 }, 'remote-happy': { width: 1440, height: 900 } };
const options = SCENARIOS[scenario] || SCENARIO_OPTIONS[scenario] || SCENARIOS.desktop;
const remoteMode = scenario === 'remote' || scenario === 'remote-happy';
const happy = scenario === 'remote-happy';
const problems = [];

const check = (label, actual, test) => {
  const ok = typeof test === 'function' ? test(actual) : actual === test;
  if (!ok) problems.push(`${label}: got ${JSON.stringify(actual)}`);
  return ok;
};
const logs = { error: [], warn: [], info: [] };

for (const level of ['error', 'warn', 'info']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    logs[level].push(args.map(String).join(' '));
    if (level === 'error') original(...args);
  };
}

const html = await readFile(resolve(ROOT, 'dist/index.html'), 'utf8');
const dom = createDOM(html, options);
const { window } = dom;

// In the browser the restored OFF+BRAND bundle is a defer script, so it has
// already reported success or failure by the time the engine module runs.
let remoteReady = 0;
if (remoteMode) {
  window.__lnRemote = { loaded: 1 };
  window.addEventListener('ln:ready', () => { remoteReady += 1; });
  if (happy) {
    // simulate the bundle actually coming up: Lenis exists and its page
    // transition has consumed the overlay
    window.lenis = { scroll: () => {} };
    const w = window.document.querySelector('.transition-w');
    if (w && w.parentNode) w.parentNode.removeChild(w);
  }
}

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */

const startedAt = Date.now();
await import('../../src/js/engine.js');
dom.frames(3);
dom.intersect();
dom.frames(5);

const report = window.landnr?.report;
if (!report) problems.push('window.landnr was never exposed — engine.js did not finish booting');

/* ------------------------------------------------------------------ *
 * remote hand-over: the genuine OFF+BRAND bundle loaded, so ours must
 * stand down — and take over again if that bundle never comes up
 * ------------------------------------------------------------------ */

if (remoteMode) {
  const root = dom.document.documentElement;
  check('remote: ln-remote set', root.classList.contains('ln-remote'), true);
  check('remote: ln-js removed, our CSS stands down', root.classList.contains('ln-js'), false);
  check('remote: our split-text did not run', report.counts.splitText ?? 0, 0);
  check('remote: our preloader did not run', report.counts.preloaderDone ?? 0, 0);
  check('remote: original rive canvases intact', dom.count('canvas[data-rive-object]'), (n) => n > 10);
  check('remote: original split-text markup intact', dom.count('[split-text]'), (n) => n > 60);
  if (happy) {
    await new Promise((r) => setTimeout(r, 600)); // one real-time watchdog tick
    check('remote-happy: watchdog confirmed the page visible', remoteReady, 1);
    check('remote-happy: remote engine alive', report.remote.alive, true);
    check('remote-happy: failsafe not applied', root.classList.contains('ln-failsafe'), false);
  } else {
    check('remote: failsafe stays armed until the page proves visible', remoteReady, 0);
  }
  check('remote: api exposed', typeof window.landnr.report, 'object');

  // Advance the clock past both deadlines (12s rescue, 16s forced reveal).
  // The shim drives performance.now() from frames() but setInterval is the
  // real timer, so the watchdog then gets real time to tick.
  dom.frames(900, 20); // ~18s of clock
  await new Promise((r) => setTimeout(r, 500));
  dom.frames(12);
  dom.intersect();

  if (happy) {
    check('remote-happy: no rescue — their engine keeps the page', report.remote.rescued, undefined);
    check('remote-happy: no forced reveal needed', report.remote.forcedReveal, undefined);
    check('remote-happy: local engine stayed out', report.counts.splitText ?? 0, 0);
    check('remote-happy: ln-js still removed', dom.document.documentElement.classList.contains('ln-js'), false);
  } else {
    check('remote: watchdog took over', report.remote.rescued, true);
    check('remote: ln-js restored after rescue', dom.document.documentElement.classList.contains('ln-js'), true);
    check('remote: local engine then split the text', dom.count('.line'), (n) => n > 30);
    // the rescued preloader enters on real-time timers — HARD_ENTER_MS (8s)
    // worst case, plus the 720ms exit before onEnter fires ln:ready
    await new Promise((r) => setTimeout(r, 9200));
    dom.frames(60, 16);
    dom.intersect();
    dom.frames(30, 16);
    check('remote: ln:ready fired after the rescue', remoteReady >= 1, true);
  }

  console.log(`\nsmoke · remote hand-over + watchdog rescue in ${Date.now() - startedAt}ms`);
  console.log(`   clock at rescue        ${Math.round(window.performance.now())}ms`);
  console.log(`   split .line            ${dom.count('.line')}   (after the rescue)`);
  console.log(`   split .char            ${dom.count('.char')}`);
  console.log(`   [split-text]           ${dom.count('[split-text]')}`);
  console.log(`   rive canvases          ${dom.count('canvas[data-rive-object]')}`);
  if (problems.length) {
    console.log(`\n   ✗ ${problems.length} problem(s):`);
    for (const problem of problems) console.log(`     - ${problem}`);
    process.exitCode = 1;
  } else console.log('\n   ✓ no problems');
  dom.restore();
  process.exit(process.exitCode || 0);
}

/* ------------------------------------------------------------------ *
 * scroll through the whole page, letting observers fire
 * ------------------------------------------------------------------ */

const total = Math.max(4000, dom.documentHeight());
for (let y = 0; y <= total; y += 700) {
  dom.scroll(y);
  dom.intersect();
  dom.frames(4);
}
dom.scroll(0);
dom.frames(6);
dom.intersect();
dom.frames(6);

/* ------------------------------------------------------------------ *
 * preloader → hero handover
 * ------------------------------------------------------------------ */

const overlay = dom.document.querySelector('.transition-w');
window.dispatchEvent(new window.Event('load'));
dom.frames(120, 60); // ~7s of clock: the loader's own timers use performance.now()
await new Promise((r) => setTimeout(r, 40));
dom.frames(60, 60);
await new Promise((r) => setTimeout(r, 900));
dom.frames(20);

const button = dom.document.querySelector('.transition-btn a');
if (button) dom.click(button);
dom.frames(20);
await new Promise((r) => setTimeout(r, 900));
dom.frames(20);

/* ------------------------------------------------------------------ *
 * interactions
 * ------------------------------------------------------------------ */

const burger = dom.document.querySelector('[data-nav-ham]');
if (burger) { dom.click(burger); dom.frames(4); }
window.landnr?.splitPending?.(dom.document);
dom.frames(4);
if (burger) { dom.click(burger); dom.frames(4); }

for (const link of dom.select('.nav-menu-link-w').slice(0, 3)) dom.click(link);
dom.frames(2);

const strip = dom.document.querySelector('[data-social-callout="wrap"]');
if (strip) {
  dom.click(strip, {});
  window.dispatchEvent({ type: 'pointerdown', clientX: 400, bubbles: true });
  dom.frames(2);
}

dom.resize(options.width === 1440 ? 900 : 1440, 800);
dom.frames(6);
dom.resize(options.width, options.height);
dom.frames(6);

/* ------------------------------------------------------------------ *
 * assertions
 * ------------------------------------------------------------------ */


const counts = {
  'split .line': dom.count('.line'),
  'split .word': dom.count('.word'),
  'split .char': dom.count('.char'),
  '[split-text]': dom.count('[split-text]'),
  'reveal targets': dom.count('[data-ln-reveal]'),
  'reveal done': dom.count('.ln-done'),
  'reveal in': dom.count('.ln-in'),
  'reveal hidden': dom.count('.ln-hidden'),
  'marquee clones': dom.count('[data-ln-clone]'),
  'rive fallbacks': dom.count('.ln-rive-fallback, .ln-arrow-svg, .ln-circuit, .ln-burger, .ln-helmet-svg, .ln-preloader-art'),
  'rive canvases left': dom.count('canvas[data-rive-object]'),
  'gl canvases': dom.count('.ln-gl'),
  'grain layer': dom.count('.ln-grain'),
  'hero anims': dom.count('.ln-hero-in'),
  'preloader armed': dom.count('.transition-w.is-armed'),
  'preloader done': dom.count('.transition-w.is-done'),
  'ln-ready': dom.document.documentElement.classList.contains('ln-ready') ? 1 : 0,
  'nav theme': dom.document.documentElement.getAttribute('data-nav-theme') || '(none)',
  'current links': dom.count('.w--current'),
  'otot active': dom.count('.otot-home-text-col.ln-active'),
  'burger svg': dom.count('.ln-burger'),
  'wordmark': dom.count('.ln-nav-wordmark'),
};

check('split-text produced lines', counts['split .line'], (n) => n > 30);
check('split-text produced words', counts['split .word'], (n) => n > 200);
check('reveals reached done/in', counts['reveal done'] + counts['reveal in'], (n) => n > 10);
check('rive canvases replaced', counts['rive canvases left'], 0);
check('rive fallbacks injected', counts['rive fallbacks'], (n) => n >= 12);
check('rive placeholders revealed', report?.counts?.rivePlaceholders ?? 0, (n) => n >= 4);
check('chars split', counts['split .char'], (n) => n > 60);
check('marquee duplicated', counts['marquee clones'], (n) => n >= 2);
check('ambient mounted', counts['gl canvases'], (n) => n >= 1);
check('preloader armed', counts['preloader armed'], 1);
check('preloader exited', counts['preloader done'], 1);
check('overlay hidden', overlay?.style.display, 'none');
check('html.ln-ready set', counts['ln-ready'], 1);
check('nav theme resolved', counts['nav theme'], (t) => t === 'dark' || t === 'light');
check('hero intro played', counts['hero anims'], (n) => n >= 4);
check('otot has an active column', counts['otot active'], (n) => n >= 1);
check('menu split deferred then built', dom.count('.nav-menu-w .line'), (n) => n > 0);

if (report) {
  if (report.errors.length) problems.push(`engine reported errors: ${report.errors.join(' | ')}`);
  counts['boot ms'] = report.bootMs;
}

const horizontalSpacer = dom.document.querySelector('.horizontal-pin-spacer');
const horizontalTrack = dom.document.querySelector('.horizontal-track');
if (horizontalSpacer && options.width >= 992) {
  check('horizontal spacer has height', horizontalSpacer.style.height, (h) => /^\d+px$/.test(h));
  check('horizontal track transformed', horizontalTrack?.style.transform || '', (t) => t.includes('translate3d'));
}

const marqueeScroll = dom.document.querySelector('[data-marquee-scroll-target]');
check('marquee translated', marqueeScroll?.style.transform || '', (t) => t.includes('translate3d'));

const indicator = dom.document.querySelector('.scroll-indicator-bar');
check('scroll indicator scaled', indicator?.style.transform || '', (t) => /scale/.test(t));

/* ------------------------------------------------------------------ *
 * report
 * ------------------------------------------------------------------ */

const ms = Date.now() - startedAt;
console.log(`\nsmoke · ${scenario} (${options.width}×${options.height}${options.touch ? ', touch' : ''}${options.reducedMotion ? ', reduced-motion' : ''}) in ${ms}ms`);
for (const [label, value] of Object.entries(counts)) {
  console.log(`   ${String(label).padEnd(22)} ${value}`);
}
if (report?.counts) {
  console.log('   engine counts:');
  for (const [label, value] of Object.entries(report.counts)) {
    console.log(`     ${String(label).padEnd(20)} ${value}`);
  }
}
if (logs.error.length) {
  console.log(`   console.error × ${logs.error.length}:`);
  for (const line of logs.error.slice(0, 8)) console.log(`     ! ${line.slice(0, 220)}`);
}
if (logs.info.length) {
  console.log(`   notes: ${logs.info.length}`);
  for (const line of logs.info.slice(0, 6)) console.log(`     · ${line}`);
}

if (problems.length) {
  console.log(`\n   ✗ ${problems.length} problem(s):`);
  for (const problem of problems) console.log(`     - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\n   ✓ no problems');
}

dom.restore();
process.exit(process.exitCode || 0);
