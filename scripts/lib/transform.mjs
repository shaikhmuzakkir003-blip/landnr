/**
 * transform.mjs — turns the raw capture into the pages this project serves.
 *
 *   source/landonorris-home.html  →  dist/index.html
 *                                →  dist/on-track/index.html
 *                                →  dist/off-track/index.html
 *                                →  dist/calendar/index.html
 *                                →  dist/partnerships/index.html
 *                                →  dist/legal/privacy-policy/index.html
 *                                →  dist/legal/terms-conditions/index.html
 *                                →  dist/404.html
 *
 * The homepage keeps 100% of the original markup, classes and inline CSS
 * embeds (so the published Webflow stylesheet still applies verbatim). Only
 * three things change:
 *
 *   1. third-party tracking / consent / dev-only scripts are stripped,
 *   2. the OFF+BRAND engine bundle is dropped — `lando.itsoffbrand.io`
 *      answers "Access denied - Invalid referrer" to any origin that is not
 *      landonorris.com, so it can never run from a local build. `src/js`
 *      replaces it (see README → "The engine").
 *   3. the local engine stylesheet + module are injected.
 *
 * Sub-pages are derived from the same document: real nav, real footer, real
 * CSS embeds, with the main content swapped for a page that explains itself.
 */

import {
  append,
  findAll,
  find,
  fragment,
  getAttr,
  hasAttr,
  hasClass,
  insertAfter,
  isElement,
  outerHTML,
  parse,
  removeAttr,
  removeNode,
  serialize,
  setAttr,
  textContent,
  walkNodes,
} from './html.mjs';

export const SITE_ORIGIN = 'https://landonorris.com';

/**
 * Scripts that never survive the build: tracking, consent, a dev machine's
 * bundler, and the two bundles on `lando.itsoffbrand.io` — that host answers
 * "Access denied - Invalid referrer" to any origin that is not
 * landonorris.com, so from a local build they can only ever be a 403.
 */
const BLOCKED_SRC = [
  '/avljl2rk9q5p',                        // Google tag first-party proxy
  'lando.itsoffbrand.io',                 // referrer-locked engine host
  'klaviyo.com',                          // email capture
  'iubenda.com',                          // consent banner
  'localhost:6645',                       // a dev machine's bundler
];

/**
 * The engine scripts in the capture. Every one of them points at a host that
 * rejects foreign referrers, so they are all dropped — and, when this build
 * has the vendored mirror (see scripts/vendor/localize.mjs), the one the live
 * site actually runs is put back pointing at the local copy.
 */
export const ENGINE_SRC = [
  'lando.itsoffbrand.io/dev-js/',
  'assets.itsoffbrand.io/lando/dev-js/',
];

/**
 * The two scripts the engine calls into: jQuery and the Webflow runtime
 * (`window.Webflow.destroy()` / `.ready()` run inside the bundle's boot). They
 * are kept, and rewritten to the local mirror when there is one.
 */
export const RUNTIME_SRC = [
  'd3e54v103j8qbb.cloudfront.net',        // jQuery
  '/js/lando-offbrand.',                  // Webflow runtime
];

/** Kept for the checks and the smoke harness: what "the real engine" means. */
export const REMOTE_ENGINE_SRC = [...ENGINE_SRC, ...RUNTIME_SRC];
export const REMOTE_ENGINE_BUNDLE = 'lando.OFF+BRAND';

/** Inline scripts that must not survive the build. */
const BLOCKED_INLINE = [
  'google_tags_first_party',
  'gtag(',
  'removeEditMode',
  '_iub',
];

/** Dev chatter left in the capture by whoever saved it. */
const NOISE_COMMENTS = [
  'last stable',
  'Production (No Gold',
  'Gold',
  '-----------------',
  'klaviyo',
  '_iub',
  'localhost:6645',
  'script defer src=',
  'script async type=',
  'link rel="preload"',
  'as="style"',
];

/**
 * Scripts a sub-page never needs: the engine (there is no `.transition-w` and
 * no Rive art to drive) plus the jQuery/Webflow runtime it calls into.
 */
const SUB_PAGE_DROP = [
  ...ENGINE_SRC,
  '/assets/vendor/engine/',
  'jquery-3.5.1',
  '/js/lando-offbrand.',
];

export const SUB_PAGES = [
  {
    slug: 'on-track',
    path: '/on-track/',
    live: '/on-track/',
    crumb: 'on track',
    title: 'On Track — Lando Norris',
    heading: 'On Track',
    lede: 'Most recent results, career stats and photos from trackside — every grand prix weekend, from karting to the world championship.',
  },
  {
    slug: 'off-track',
    path: '/off-track/',
    live: '/off-track/',
    crumb: 'off track',
    title: 'Off Track — Lando Norris',
    heading: 'Off Track',
    lede: 'Campaigns, shoots and other such promotional materials — the stuff that happens once the visor goes up.',
  },
  {
    slug: 'calendar',
    path: '/calendar/',
    live: '/calendar/',
    crumb: 'calendar',
    title: 'Calendar — Lando Norris',
    heading: 'Calendar',
    lede: 'The full season, round by round: circuits, dates, results and the next race on the schedule.',
  },
  {
    slug: 'partnerships',
    path: '/partnerships/',
    live: '/partnerships/',
    crumb: 'partnerships',
    title: 'Partnerships — Lando Norris',
    heading: 'Partnerships',
    lede: 'Lando is proud to collaborate with a range of partners who share his passion for performance across a range of industries.',
  },
  {
    slug: 'privacy-policy',
    path: '/legal/privacy-policy/',
    live: '/legal/privacy-policy/',
    crumb: 'legal / privacy',
    title: 'Privacy Policy — Lando Norris',
    heading: 'Privacy Policy',
    lede: 'How the live site handles data. This build ships with every analytics, advertising and consent script removed — no cookies are set and nothing is reported anywhere.',
    note: false,
  },
  {
    slug: 'terms-conditions',
    path: '/legal/terms-conditions/',
    live: '/legal/terms-conditions/',
    crumb: 'legal / terms',
    title: 'Terms &amp; Conditions — Lando Norris',
    heading: 'Terms',
    lede: 'The terms that govern the live landonorris.com site.',
    note: false,
  },
];

/* ------------------------------------------------------------------ *
 * Cleaning
 * ------------------------------------------------------------------ */

/**
 * Put the engine back — locally.
 *
 * The capture's <head> asks for `lando.itsoffbrand.io/dev-js/lando.OFF+BRAND
 * .gold-android-fix-03.js`. That host answers "Access denied - Invalid
 * referrer" to any origin that is not landonorris.com, and the bundle's first
 * `await` is `page-transition.riv` from the same host — so on any other domain
 * the promise rejects, the boot function throws, Lenis is never constructed and
 * the page never animates at all. That is the whole of the "no animation" bug.
 *
 * `vendor/` holds a byte-exact mirror of the engine and every file it fetches
 * (Rive art, WebGL hero, WASM runtime), and scripts/vendor/localize.mjs
 * rewrites the bundle's URLs to it. So the tag that goes back into the page is
 * the *same engine*, served from this origin: no referrer check, no CORS, no
 * third party to change its mind.
 *
 * Without the mirror (`npm run build -- --local`, or a checkout that never ran
 * the harvester) no engine tag is inserted at all and src/js/engine.js drives
 * the page on its own.
 */
/** Map a captured CDN URL onto its vendored copy, if this build has one. */
function localise(url, localWebflow) {
  if (!url || !localWebflow) return null;
  if (url.includes('lando-offbrand.shared.5b4e934f7.css')) return localWebflow.css;
  if (url.includes('jquery-3.5.1.min')) return localWebflow.jquery;
  if (url.includes('lando-offbrand.751e0867')) return localWebflow.runtime;
  if (url.includes('lando-offbrand.schunk')) return localWebflow.schunk;
  return null;
}

function engineTag(src) {
  return `<script defer src="${src}"`
    + ` onload="window.__lnRemote={loaded:1}"`
    + ` onerror="window.__lnRemote={failed:1}"></script>`;
}

export function cleanDocument(root, report = {}, { engineSrc = null, localWebflow = null } = {}) {
  const bump = (key, by = 1) => { report[key] = (report[key] || 0) + by; };

  // Scripts -------------------------------------------------------------
  for (const script of findAll(root, (n) => isElement(n, 'script'))) {
    const src = getAttr(script, 'src') || '';
    const body = script.children.filter((c) => c.type === 'rawtext').map((c) => c.value).join('');

    if (BLOCKED_INLINE.some((needle) => body.includes(needle))) {
      removeNode(root, script);
      bump('scriptsRemoved');
      continue;
    }

    // The engine itself: drop the referrer-locked original, and put the local
    // mirror in its place — once, in the position the capture had it.
    if (ENGINE_SRC.some((needle) => src.includes(needle))) {
      if (engineSrc && !report.engine) {
        insertAfter(root, script, fragment(engineTag(engineSrc)));
        report.engine = { original: src, served: engineSrc };
        bump('engineLocalised');
      } else {
        bump('engineDuplicatesDropped');
      }
      removeNode(root, script);
      bump('scriptsRemoved');
      continue;
    }

    // jQuery + the Webflow runtime: keep, but serve them from the mirror when
    // there is one, so the page has no third-party dependency left.
    const runtime = RUNTIME_SRC.find((needle) => src.includes(needle));
    if (runtime) {
      const local = localise(src, localWebflow);
      if (local) {
        setAttr(script, 'src', local);
        removeAttr(script, 'integrity');
        bump('runtimeLocalised');
      }
      continue;
    }

    if (BLOCKED_SRC.some((needle) => src.includes(needle))) {
      removeNode(root, script);
      bump('scriptsRemoved');
      continue;
    }
  }

  // The published stylesheet: same treatment -----------------------------
  for (const link of findAll(root, (n) => isElement(n, 'link'))) {
    const href = getAttr(link, 'href') || '';
    if (!href.includes('lando-offbrand.shared')) continue;
    const local = localise(href, localWebflow);
    if (local) {
      setAttr(link, 'href', local);
      removeAttr(link, 'integrity');
      bump('stylesheetLocalised');
    }
  }

  // The commented-out ladder of alternative engine builds, and the isolated
  // transition script parked inside a .js__embed, are dev leftovers: the
  // engine this page runs is the one wired up above.
  for (const div of findAll(root, (n) => isElement(n) && hasClass(n, 'js__embed'))) {
    if ((div.children || []).some((c) => c.type === 'comment'
      && (c.value || '').includes('transitions-rive-isolate.js'))) {
      removeNode(root, div);
      bump('embedsRemoved');
    }
  }

  // Comments ------------------------------------------------------------
  for (const comment of findAll(root, (n) => n.type === 'comment')) {
    const value = comment.value || '';
    if (NOISE_COMMENTS.some((needle) => value.includes(needle))) {
      removeNode(root, comment);
      bump('commentsRemoved');
    }
  }

  // Empty embed wrappers that only ever held a commented-out script -----
  for (const div of findAll(root, (n) => isElement(n, 'div') && hasClass(n, 'js__embed'))) {
    if (!textContent(div)) {
      removeNode(root, div);
      bump('embedsRemoved');
    }
  }

  // Webflow editor leftovers -------------------------------------------
  const body = find(root, (n) => isElement(n, 'body'));
  if (body) removeAttr(body, 'data-edit');

  // The page starts hidden until the (now absent) engine reveals it -----
  for (const node of findAll(root, (n) => isElement(n) && hasAttr(n, 'data-start'))) {
    removeAttr(node, 'data-start');
    bump('dataStartRemoved');
  }

  return report;
}

/* ------------------------------------------------------------------ *
 * Asset injection
 * ------------------------------------------------------------------ */

/**
 * `ln-js` is the switch that turns on every local-engine CSS rule (preloader
 * art, reveal masks, split-text hiding). It has to be on before first paint,
 * or a local-only build flashes un-animated content — but it must NOT be on
 * when the real engine is in the page, because its preloader rules hide the
 * Rive canvas the genuine intro animates into. So the tag depends on the
 * build: engine.js adds the class itself when it decides to drive.
 */
const HEAD_BOOT_LOCAL = `<script>document.documentElement.classList.add('ln-js');</script>`;
const HEAD_BOOT_REAL = `<script>document.documentElement.classList.add('ln-waiting');</script>`;

const NOSCRIPT = `<noscript><style>
.transition-w{display:none !important}
.page-w,.main-w{opacity:1 !important;visibility:visible !important;transform:none !important}
[split-text]{white-space:normal}
</style></noscript>`;

const FAILSAFE = `<script>
/* If the engine never boots (blocked module, JS error, slow device) the page
   must not stay behind the preloader. Pure safety net — no behaviour. */
(function () {
  var html = document.documentElement;

  /* The real OFF+BRAND engine leaves these on window as it comes up:
     landoGL the moment the bundle evaluates, loadingComplete when its Rive
     art is in, lenis when it is actually driving the page. When it is alive
     the intro overlay on screen is the design — a Rive animation that ends in
     a "Load Norris" button — not a trap, so the failsafe waits instead of
     tearing it down. */
  function realEngine() {
    return !!(window.landoGL || window.lenis || window.loadingComplete);
  }

  var timer = setTimeout(check, 12000);
  var waited = 0;
  function check() {
    if (html.classList.contains('ln-ready')) return;
    if (realEngine() && waited < 30000) { waited += 3000; timer = setTimeout(check, 3000); return; }
    html.classList.add('ln-failsafe');
  }

  window.addEventListener('ln:ready', function () { clearTimeout(timer); });
  /* the engine is alive: all that is left is the preloader handing over */
  window.addEventListener('ln:booted', function () {
    clearTimeout(timer);
    timer = setTimeout(check, 6000);
  });
  window.addEventListener('error', function () {
    setTimeout(function () {
      if (!html.classList.contains('ln-ready') && !realEngine()) html.classList.add('ln-failsafe');
    }, 1200);
  });

  /* Anti-trap, independent of every stylesheet and every engine. If a
     full-screen overlay is still covering the viewport after the grace
     period, hide it with inline styles and reveal the page. Last line of
     defence for the cases a class-based failsafe cannot reach: engine.css
     never arriving, engine.js throwing, or an engine stalling on art that
     never loads while its overlay sits on top of everything. The real engine
     gets a longer grace period, because its overlay is meant to be there
     until the visitor clicks through it. */
  var grace = 9;
  var guard = setInterval(function () {
    if (realEngine() && grace < 30) grace = 30;
    var w = document.querySelector('.transition-w');
    if (!w || !covers(w)) { clearInterval(guard); return; }
    if (grace-- > 0) return;
    clearInterval(guard);
    w.style.display = 'none';
    reveal('.page-w');
    reveal('.main-w');
  }, 1000);

  function covers(el) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    if (r.width < window.innerWidth - 2 || r.height < window.innerHeight - 2) return false;
    var s = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (!s) return true;
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
  }
  function reveal(sel) {
    var el = document.querySelector(sel);
    if (!el) return;
    el.style.opacity = '1';
    el.style.visibility = 'visible';
    el.style.transform = 'none';
  }
}());
</script>`;

const ENGINE_TAG = `<script type="module" src="/assets/js/engine.js"></script>`;

export function injectAssets(root, { stylesheet = '/assets/css/engine.css', buildStamp, realEngine = false } = {}) {
  const head = find(root, (n) => isElement(n, 'head'));
  const body = find(root, (n) => isElement(n, 'body'));
  if (!head || !body) throw new Error('document is missing <head>/<body>');

  // Nothing in this build needs a referrer any more — the engine and its art
  // are same-origin — but the page still pulls photography from the Webflow
  // CDN, so keep the origin to ourselves.
  append(head, fragment('<meta name="referrer" content="no-referrer">'));

  append(head, fragment(
    `<link rel="stylesheet" href="${stylesheet}">`
    + (realEngine ? HEAD_BOOT_REAL : HEAD_BOOT_LOCAL)
    + NOSCRIPT
    + (buildStamp ? `<!-- ${buildStamp} -->` : ''),
  ));
  append(body, fragment(FAILSAFE + ENGINE_TAG));
  return root;
}

/* ------------------------------------------------------------------ *
 * Homepage
 * ------------------------------------------------------------------ */

export function buildHome(sourceHtml, opts = {}) {
  const { root, repairs } = parse(sourceHtml);
  const report = { repairs: summarizeRepairs(repairs) };
  const engineSrc = opts.engineSrc || null;
  cleanDocument(root, report, {
    engineSrc,
    localWebflow: opts.localWebflow || null,
  });
  injectAssets(root, { ...opts, realEngine: Boolean(engineSrc) });
  return { root, html: serialize(root), report };
}

function summarizeRepairs(repairs) {
  const out = {};
  for (const r of repairs) {
    const key = `${r.kind}:${r.tag}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Sub-pages (derived from the cleaned home document)
 * ------------------------------------------------------------------ */

export function buildSubPages(homeRoot, pages = SUB_PAGES) {
  const built = [];
  for (const def of pages) {
    const root = cloneNode(homeRoot);
    composeSubPage(root, def);
    built.push({ def, html: serialize(root) });
  }
  // 404
  const notFound = cloneNode(homeRoot);
  composeSubPage(notFound, {
    slug: '404',
    path: '/404/',
    crumb: 'error 404',
    title: 'Page not found — Lando Norris',
    heading: 'Off circuit',
    lede: 'That route is not on this build’s map — the project is generated from a single homepage capture, so only the pages linked in the nav exist locally.',
    live: '',
  });
  built.push({ def: { slug: '404', path: '/404.html' }, html: serialize(notFound) });
  return built;
}

function composeSubPage(root, def) {
  const html = find(root, (n) => isElement(n, 'html'));
  if (html) setAttr(html, 'data-wf-page-sub', def.slug);

  // Head metadata -------------------------------------------------------
  const title = find(root, (n) => isElement(n, 'title'));
  if (title) { title.children = [{ type: 'text', value: def.title.replace(/&amp;/g, '&') }]; }
  for (const meta of findAll(root, (n) => isElement(n, 'meta'))) {
    const name = (getAttr(meta, 'name') || getAttr(meta, 'property') || '').toLowerCase();
    if (name === 'description' || name === 'og:description' || name === 'twitter:description') {
      setAttr(meta, 'content', def.lede);
    }
    if (name === 'og:title' || name === 'twitter:title') setAttr(meta, 'content', def.title.replace(/&amp;/g, '&'));
  }
  append(find(root, (n) => isElement(n, 'head')), fragment(
    `<link rel="canonical" href="${SITE_ORIGIN}${def.path || '/'}">`,
  ));

  // No preloader / no hero-only chrome on sub-pages ---------------------
  for (const node of findAll(root, (n) => isElement(n, 'div')
    && (hasClass(n, 'transition-w') || hasClass(n, 'mob-landscape-block') || hasClass(n, 'scroll-indicator')))) {
    removeNode(root, node);
  }

  // Sub-pages always run the local engine: they have no `.transition-w` for
  // the OFF+BRAND transition to drive and no Rive art of their own, so the
  // engine bundle would only add 1.3 MB and a chance of a dead page.
  for (const node of findAll(root, (n) => isElement(n, 'script')
    && SUB_PAGE_DROP.some((needle) => (getAttr(n, 'src') || '').includes(needle)))) {
    removeNode(root, node);
  }

  // Swap the main content, keep the tail (footer + gl layers) -----------
  const taxi = find(root, (n) => isElement(n, 'div') && hasClass(n, 'taxi-w'));
  if (!taxi) throw new Error('could not find .taxi-w in the home document');
  if (hasAttr(taxi, 'data-page')) setAttr(taxi, 'data-page', def.slug);

  const tail = [];
  for (const child of [...taxi.children]) {
    const isFooter = isElement(child, 'section') && hasClass(child, 'is-footer');
    const isGl = isElement(child, 'div') && (hasClass(child, 'gl-wrap') || hasClass(child, 'gl-background'));
    if (isFooter || isGl) tail.push(child);
  }
  const stub = fragment(stubMarkup(def))[0];
  taxi.children = [stub, ...tail];

  const body = find(root, (n) => isElement(n, 'body'));
  if (body) setAttr(body, 'class', `${getAttr(body, 'class') || ''} ln-subpage ln-page-${def.slug}`.trim());
}

function stubMarkup(def) {
  const live = def.live
    ? `<a data-theme="lime" data-anim="text-hover" data-btn-rive-hover="" data-btn-rive-rotate="false" href="${SITE_ORIGIN}${def.live}" target="_blank" rel="noopener" class="btn-w w-inline-block">
         <div class="btn-inner">
           <div class="btn-inner-text-w"><div split-text="chars" class="btn-text">Open the live page</div></div>
           <div class="btn-icon-w"><div class="btn-rive-w w-embed"><canvas data-rive-object data-rive-file="btn-ui" data-rive-artboard="arrow" data-rive-state-machine="arrow" data-rive-hover="false" data-rive-fit="contain"></canvas></div></div>
         </div>
       </a>`
    : '';

  const note = def.note === false
    ? ''
    : `<div class="ln-note">
         <div class="ln-note-label"><div class="text-eyebrow">build note</div></div>
         <p class="text-body-sm-mona">Only the homepage was captured in <code>source/landonorris-home.html</code>, so this route is a stand-in built from the same nav, footer, type scale and colour tokens as the real site. Everything you can see on the homepage — hero, horizontal track, on/off track, helmet hall of fame, store, partners, socials and footer — is the real thing.</p>
       </div>`;

  return `<section class="s ln-stub" data-nav-theme-target="dark">
    <div class="c ln-stub-c">
      <div class="ln-stub-head">
        <div class="eyebrow-w">
          <div data-anim-high="right, lime" split-text="lines" class="text-eyebrow">landonorris.com / ${def.crumb}</div>
        </div>
        <h1 data-anim-high="right, lime-off" split-text="lines" class="text-impact-lg-mona ln-stub-title">${def.heading}</h1>
      </div>
      <div class="ln-stub-body">
        <p data-anim-high="right, dark-green-tint-1, 200" split-text="lines" class="text-body-reg-mona ln-stub-lede">${def.lede}</p>
        ${note}
        <div class="ln-stub-actions">
          ${live}
          <a data-anim="text-hover" href="/" class="btn-w ln-btn-ghost w-inline-block">
            <div class="btn-inner">
              <div class="btn-inner-text-w"><div split-text="chars" class="btn-text">Back to home</div></div>
            </div>
          </a>
        </div>
      </div>
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

export function cloneNode(node) {
  if (Array.isArray(node)) return node.map(cloneNode);
  if (!node || typeof node !== 'object') return node;
  const out = { ...node };
  if (node.attrs) out.attrs = node.attrs.map((a) => ({ ...a }));
  if (node.children) out.children = node.children.map(cloneNode);
  return out;
}

/** Serialise a subtree (used by the report / debugging). */
export function toHTML(node) {
  return outerHTML(node);
}

export { findAll, find, isElement, hasClass, getAttr, walkNodes };
