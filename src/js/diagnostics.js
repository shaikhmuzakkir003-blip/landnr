/**
 * diagnostics.js — a small on-screen readout of what is actually driving the
 * page.
 *
 * "I can't see any animation" has exactly two possible answers: the engine
 * never came up, or it came up and something it needed was refused. This panel
 * says which, in the browser, without a console:
 *
 *   /?engine            show it
 *   landnr.diagnostics()  show it from the console
 *   Escape              hide it
 *
 * It reads only public state — the globals the OFF+BRAND bundle leaves behind
 * (`landoGL`, `lenis`, `loadingComplete`, `loadedRiveFiles`, `canvas.riveInstance`),
 * this build's own report, and the resource timing buffer, which is how a
 * refused `.riv`/`.glb` shows up as a red line instead of a silent freeze.
 */

import { $, doc, docEl, on } from './utils.js';

let panel = null;
let timer = null;

export function initDiagnostics({ report, version }) {
  const wanted = /[?&]engine\b/.test(location.search) || /[?&]debug\b/.test(location.search);
  on(doc, 'keydown', (e) => {
    if (e.key !== 'Escape' || !panel) return;
    hide();
  });
  if (wanted) show();
  return {
    show,
    hide,
    get visible() { return Boolean(panel); },
  };

  function show() {
    if (!panel) build();
    panel.hidden = false;
    clearInterval(timer);
    render({ report, version });
    timer = setInterval(() => render({ report, version }), 500);
  }

  function hide() {
    clearInterval(timer);
    if (panel) panel.hidden = true;
  }
}

function build() {
  panel = doc.createElement('div');
  panel.className = 'ln-diagnostics';
  panel.setAttribute('role', 'status');
  panel.innerHTML = `
    <div class="ln-dx-head"><span>engine</span><button type="button" aria-label="Close">×</button></div>
    <div class="ln-dx-body"></div>`;
  panel.querySelector('button').addEventListener('click', () => {
    panel.hidden = true;
    clearInterval(timer);
  });
  doc.body.appendChild(panel);
}

function render({ report, version }) {
  const body = panel.querySelector('.ln-dx-body');
  if (!body) return;
  body.innerHTML = [
    row('local engine', `v${version}`),
    row('driver', driver()),
    row('bundle', bundleState()),
    row('rive art', riveState()),
    row('webgl', glState()),
    row('scroll', scrollState()),
    row('page', pageState()),
    ...localRows(report),
    ...failedRequests(),
  ].join('');
}

function driver() {
  if (window.lenis) return ['the real OFF+BRAND engine', 'ok'];
  if (docEl.classList.contains('ln-remote')) return ['waiting on the OFF+BRAND engine…', 'warn'];
  if (docEl.classList.contains('ln-js')) return ['the local engine', 'ok'];
  return ['nothing yet', 'warn'];
}

function bundleState() {
  const tag = window.__lnRemote;
  if (!tag) return ['not in this page', 'muted'];
  if (tag.failed) return ['the script tag failed to load', 'bad'];
  const bits = [];
  bits.push(tag.loaded ? 'loaded' : 'loading');
  bits.push(window.landoGL ? 'evaluated' : 'not evaluated');
  bits.push(window.lenis ? 'driving' : 'not driving');
  return [bits.join(' · '), window.lenis ? 'ok' : 'warn'];
}

function riveState() {
  const canvases = Array.from(doc.querySelectorAll('canvas'));
  const live = canvases.filter((c) => c.riveInstance).length;
  const total = canvases.length;
  const done = window.loadingComplete ? 'handshake complete' : 'handshake open';
  const files = Array.isArray(window.loadedRiveFiles)
    ? window.loadedRiveFiles.length
    : (window.loadedRiveFiles ? Object.keys(window.loadedRiveFiles).length : 0);
  return [`${live}/${total} canvases live · ${files} files · ${done}`, live ? 'ok' : 'warn'];
}

function glState() {
  const canvas = $('.gl-background canvas, canvas.gl');
  const classes = Array.from(docEl.classList).filter((c) => c.startsWith('gl'));
  if (window.landoGL?.fallback) return ['WebGL 2 unavailable — fallback', 'warn'];
  if (!canvas) {
    return [classes.length ? `no canvas yet (${classes.join(', ')})` : 'no canvas', 'muted'];
  }
  const r = canvas.getBoundingClientRect();
  return [`canvas ${Math.round(r.width)}×${Math.round(r.height)}${classes.length ? ` · ${classes.join(', ')}` : ''}`, 'ok'];
}

function scrollState() {
  const lenis = window.lenis;
  if (lenis && typeof lenis.scroll === 'number') {
    return [`lenis · ${Math.round(lenis.scroll)} of ${Math.round(lenis.limit || 0)} · ${lenis.isScrolling || 'idle'}`, 'ok'];
  }
  return [`native · y=${Math.round(window.scrollY || 0)}`, 'muted'];
}

function pageState() {
  const overlay = $('.transition-w');
  const covering = overlay && overlay.getBoundingClientRect().height > window.innerHeight - 2
    && getComputedStyle(overlay).display !== 'none';
  const hidden = doc.querySelector('.page-w');
  const opacity = hidden ? getComputedStyle(hidden).opacity : '1';
  return [
    `intro ${covering ? 'on screen' : 'lifted'} · page opacity ${opacity}`
    + `${docEl.classList.contains('ln-failsafe') ? ' · FAILSAFE' : ''}`,
    covering ? 'warn' : 'ok',
  ];
}

function localRows(report) {
  if (!report || docEl.classList.contains('ln-remote-live')) return [];
  const counts = report.counts || {};
  const keys = Object.keys(counts).filter((k) => counts[k]);
  const rows = [row('local modules', keys.length
    ? keys.map((k) => `${k} ${counts[k]}`).join(' · ')
    : 'none ran', keys.length ? 'ok' : 'warn')];
  if (report.errors?.length) {
    rows.push(row('errors', report.errors.map((e) => `${e.step}: ${e.message}`).join(' | '), 'bad'));
  }
  return rows;
}

/** Anything the page asked for and did not get — the usual reason a site that
 *  should animate does not. */
function failedRequests() {
  if (!window.performance?.getEntriesByType) return [];
  const bad = [];
  for (const entry of performance.getEntriesByType('resource')) {
    const status = entry.responseStatus;
    const empty = entry.transferSize === 0 && entry.decodedBodySize === 0
      && !entry.name.startsWith('data:');
    if ((status && status >= 400) || (status === undefined && empty && entry.duration < 60000)) {
      bad.push(shortName(entry.name) + (status ? ` → ${status}` : ' → empty'));
    }
  }
  if (!bad.length) return [];
  return [row('refused', '', 'bad')].concat(bad.slice(0, 6).map((n) => row('', n, 'bad')));
}

function shortName(url) {
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin ? u.pathname : u.hostname + u.pathname;
  } catch { return url.slice(0, 60); }
}

function row(label, value, state = 'muted') {
  return `<div class="ln-dx-row is-${state}">`
    + `<span class="ln-dx-k">${label}</span>`
    + `<span class="ln-dx-v">${value}</span></div>`;
}
