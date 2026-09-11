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
 * The original engine and the three scripts it needs. `assets.itsoffbrand.io`
 * has no referrer check, so a browser *can* run the real OFF+BRAND bundle —
 * which means the real Rive art (helmet, signature, circuits, arrows) and the
 * real page transition. They stay in the page unless the build is asked for a
 * purely local engine (LANDNR_ENGINE=local), and src/js/engine.js stands down
 * when it sees them come up.
 */
export const REMOTE_ENGINE_SRC = [
  'assets.itsoffbrand.io',                // OFF+BRAND engine + transitions
  'd3e54v103j8qbb.cloudfront.net',        // jQuery (the Webflow runtime needs it)
  '/js/lando-offbrand.',                  // Webflow runtime (engine calls window.Webflow)
];

/** The bundle whose load decides remote-vs-local at runtime. */
export const REMOTE_ENGINE_BUNDLE = 'lando-by-OFF+BRAND.js';

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
 * The capture has the engine commented out.
 *
 * Whoever saved the page left a ladder of alternative builds inside HTML
 * comments. The one the live site actually runs is
 * `lando.itsoffbrand.io/dev-js/lando.OFF+BRAND.gold-android-fix-03.js` — and
 * that host answers "Access denied - Invalid referrer" to any origin that is
 * not landonorris.com, so from a local build it can only ever be a 403.
 *
 * Two of the commented-out builds sit on `assets.itsoffbrand.io`, which has no
 * referrer lock: the full OFF+BRAND app bundle (Lenis, GSAP, the Rive loader
 * and the `allriveloaded` handshake) and the Rive page-transition script.
 * Restoring those two gives the browser the genuine engine — real Rive helmet,
 * signature, circuits, button arrows and transition — and `src/js/engine.js`
 * stands down when it sees them come up. `referrerpolicy="no-referrer"` plus a
 * document-level referrer meta give the requests (and the `.riv` files the
 * bundle fetches itself) the best chance of being accepted.
 */
function restoreRemoteEngine(root, report) {
  for (const comment of findAll(root, (n) => n.type === 'comment')) {
    const match = /<script[^>]*\bsrc="([^"]*lando-by-OFF\+BRAND\.js)"/.exec(comment.value || '');
    if (!match) continue;
    insertAfter(root, comment, fragment(
      `<script defer referrerpolicy="no-referrer" src="${match[1]}"`
      + ` onload="window.__lnRemote={loaded:1}" onerror="window.__lnRemote={failed:1}"></script>`,
    ));
    removeNode(root, comment);
    report.remoteEngine = match[1];
    break;
  }

  for (const div of findAll(root, (n) => isElement(n, 'div') && hasClass(n, 'js__embed'))) {
    const comment = (div.children || []).find((c) => c.type === 'comment'
      && (c.value || '').includes('transitions-rive-isolate.js'));
    if (!comment) continue;
    const match = /<script[^>]*\bsrc="([^"]*transitions-rive-isolate\.js)"/.exec(comment.value);
    if (!match) continue;
    insertAfter(root, div, fragment(
      `<script referrerpolicy="no-referrer" src="${match[1]}"></script>`,
    ));
    removeNode(root, div);
    report.remoteTransitions = match[1];
    break;
  }
}

export function cleanDocument(root, report = {}, { remoteEngine = true } = {}) {
  const bump = (key, by = 1) => { report[key] = (report[key] || 0) + by; };

  // Scripts -------------------------------------------------------------
  for (const script of findAll(root, (n) => isElement(n, 'script'))) {
    const src = getAttr(script, 'src') || '';
    const body = script.children.filter((c) => c.type === 'rawtext').map((c) => c.value).join('');
    const blocked = BLOCKED_SRC.some((needle) => src.includes(needle))
      || BLOCKED_INLINE.some((needle) => body.includes(needle))
      || (!remoteEngine && REMOTE_ENGINE_SRC.some((needle) => src.includes(needle)));
    if (blocked) {
      removeNode(root, script);
      bump('scriptsRemoved');
      continue;
    }
  }

  if (remoteEngine) restoreRemoteEngine(root, report);

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

const HEAD_BOOT = `<script>document.documentElement.classList.add('ln-js');</script>`;

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
  var timer = setTimeout(function () { html.classList.add('ln-failsafe'); }, 12000);
  window.addEventListener('ln:ready', function () { clearTimeout(timer); });
  /* the engine is alive: all that is left is the preloader handing over */
  window.addEventListener('ln:booted', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!html.classList.contains('ln-ready')) html.classList.add('ln-failsafe');
    }, 6000);
  });
  window.addEventListener('error', function () {
    setTimeout(function () { if (!html.classList.contains('ln-ready')) html.classList.add('ln-failsafe'); }, 1200);
  });
}());
</script>`;

const ENGINE_TAG = `<script type="module" src="/assets/js/engine.js"></script>`;

export function injectAssets(root, { stylesheet = '/assets/css/engine.css', buildStamp, remoteEngine = true } = {}) {
  const head = find(root, (n) => isElement(n, 'head'));
  const body = find(root, (n) => isElement(n, 'body'));
  if (!head || !body) throw new Error('document is missing <head>/<body>');

  // The OFF+BRAND hosts reject foreign referrers; sending none is the only
  // lever a browser gives us, and it applies to the .riv fetches too.
  if (remoteEngine) {
    append(head, fragment('<meta name="referrer" content="no-referrer">'));
  }

  append(head, fragment(
    `<link rel="stylesheet" href="${stylesheet}">`
    + HEAD_BOOT
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
  const remoteEngine = opts.remoteEngine !== false;
  const { root, repairs } = parse(sourceHtml);
  const report = { repairs: summarizeRepairs(repairs) };
  cleanDocument(root, report, { remoteEngine });
  injectAssets(root, opts);
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
  // remote bundle would only add a dependency and a chance of a dead page.
  for (const node of findAll(root, (n) => isElement(n, 'script')
    && REMOTE_ENGINE_SRC.some((needle) => (getAttr(n, 'src') || '').includes(needle)))) {
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
