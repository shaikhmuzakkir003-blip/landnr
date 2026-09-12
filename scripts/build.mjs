#!/usr/bin/env node
/**
 * build.mjs — compiles `source/` + `src/` into `dist/`.
 *
 *   node scripts/build.mjs            # write dist/
 *   node scripts/build.mjs --check    # build in memory, run the checks, write nothing
 *
 * Zero dependencies: the HTML work lives in scripts/lib, the assets are plain
 * files that get copied across untouched.
 */

import { mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, serialize, findAll, isElement, getAttr, hasClass } from './lib/html.mjs';
import { buildHome, buildSubPages, SUB_PAGES, SITE_ORIGIN } from './lib/transform.mjs';
import { collectVendor, localWebflowPaths, vendorAvailable, ENGINE_DIST, DISABLE_LANDO_GL } from './vendor/localize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SOURCE = join(ROOT, 'source', 'landonorris-home.html');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const QUIET = args.includes('--quiet');

const log = (...msg) => { if (!QUIET) console.log(...msg); };

main().catch((err) => {
  console.error('\n✖ build failed:', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});

async function main() {
  const started = Date.now();
  if (!existsSync(SOURCE)) {
    throw new Error(`missing raw capture: ${relative(ROOT, SOURCE)}`);
  }
  const sourceHtml = await readFile(SOURCE, 'utf8');

  log('landnr build');
  log('  source   ', relative(ROOT, SOURCE), `(${kb(sourceHtml.length)})`);

  /* 1 — the real engine, vendored ------------------------------------- */
  // LANDNR_ENGINE=local / --local ships without it: src/js/engine.js then
  // drives the page on its own. Otherwise the homepage runs the genuine
  // OFF+BRAND bundle out of vendor/, same-origin, with every Rive file, every
  // WebGL asset and the Rive WASM served from here as well.
  const wantsEngine = process.env.LANDNR_ENGINE !== 'local' && !args.includes('--local');
  const vendor = wantsEngine ? await collectVendor() : { files: [], engine: null, hits: {} };
  if (wantsEngine && !vendorAvailable()) {
    log('  engine    vendor/ is empty — harvest it with scripts/vendor/fetch.sh');
    log('            (or run the vendor-offbrand-assets workflow) to get the real');
    log('            OFF+BRAND engine; building with the local engine instead');
  }
  const engineSrc = vendor.engine || null;
  const localWebflow = engineSrc ? prefixPaths(localWebflowPaths(vendor.files)) : null;
  log('  engine   ', engineSrc
    ? `OFF+BRAND, vendored (${vendor.files.length} files, ${kb(vendor.files.reduce((n, f) => n + f.body.length, 0))}) + local fallback`
    : 'local only');
  if (Object.keys(vendor.hits || {}).length) {
    log('  rewired  ', Object.entries(vendor.hits).map(([k, n]) => `${n}× ${k}`).join(', '));
  }

  /* 2 — homepage ------------------------------------------------------ */
  const stamp = `built ${new Date().toISOString()} · landnr · homepage capture: Last Published Tue Aug 11 2026`;
  const home = buildHome(sourceHtml, { buildStamp: stamp, engineSrc, localWebflow });
  log('  repairs  ', JSON.stringify(home.report.repairs));
  const content = home.report.content || {};
  log('  content  ', `${content.swapped ?? 0} strings swapped`
    + (content.missed?.length ? ` · ${content.missed.length} MISSED: ${content.missed.join(' | ')}` : ''));
  log('  removed  ', `${home.report.scriptsRemoved || 0} scripts, ${home.report.commentsRemoved || 0} comments, ${home.report.embedsRemoved || 0} empty embeds`);

  /* 3 — derived pages ------------------------------------------------- */
  const subs = buildSubPages(home.root, SUB_PAGES);

  /* 4 — assets -------------------------------------------------------- */
  const assets = await collectAssets(join(SRC, 'css'), join(SRC, 'js'));

  /* 4b — the hero portrait -------------------------------------------- *
   * Drop any flat-background picture at source/ash-hero.png (or .webp /
   * .jpg) and it ships verbatim; src/js/hero-ash.js keys the backdrop out
   * in the browser. With nothing there the hero draws its own stand-in. */
  const portraits = [];
  for (const name of ['ash-hero.png', 'ash-hero.webp', 'ash-hero.jpg', 'ash-hero.jpeg']) {
    const at = join(ROOT, 'source', name);
    if (existsSync(at)) portraits.push({ path: join('assets', 'img', name), body: await readFile(at), binary: true });
  }
  log('  portrait ', portraits.length
    ? `${portraits.map((f) => f.path).join(', ')} (${(portraits[0].body.length / 1024).toFixed(0)} kB)`
    : 'none dropped in — the hero draws its stand-in');

  /* 5 — checks -------------------------------------------------------- */
  const problems = runChecks({ home, subs, assets, vendor, engineSrc });

  /* 6 — write --------------------------------------------------------- */
  const files = [
    { path: 'index.html', body: home.html },
    ...subs.map(({ def, html }) => ({
      path: def.path.endsWith('.html') ? def.path.replace(/^\//, '') : join(def.path.replace(/^\//, ''), 'index.html'),
      body: html,
    })),
    ...assets.map((a) => ({ path: join('assets', a.rel), body: a.body, binary: a.binary })),
    ...portraits,
    ...vendor.files,
    ...deployConfig(),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    sourceBytes: Buffer.byteLength(sourceHtml),
    pages: files.filter((f) => f.path.endsWith('.html')).map((f) => `/${f.path.replace(/index\.html$/, '')}`),
    assets: assets.map((a) => `/assets/${a.rel}`),
    engine: engineSrc ? {
      served: engineSrc,
      original: home.report.engine?.original || null,
      vendoredFiles: vendor.files.length,
      vendoredBytes: vendor.files.reduce((n, f) => n + f.body.length, 0),
      urlRewrites: vendor.hits,
    } : { served: null, mode: 'local-js-only' },
    repairs: home.report.repairs,
    removed: {
      scripts: home.report.scriptsRemoved || 0,
      comments: home.report.commentsRemoved || 0,
      emptyEmbeds: home.report.embedsRemoved || 0,
    },
    problems,
  };
  files.push({ path: 'build-report.json', body: JSON.stringify(report, null, 2) });

  if (CHECK) {
    log('  --check  ', problems.length ? `${problems.length} problem(s)` : 'clean');
    problems.forEach((p) => log(`     · ${p}`));
    if (problems.length) process.exit(1);
    log(`  ok in ${Date.now() - started}ms (nothing written)`);
    return;
  }

  // A dev server serving straight out of dist/ holds file handles, so the
  // occasional ENOTEMPTY is expected: retry rather than fail the build.
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await rm(DIST, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 }); break; }
    catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  for (const file of files) {
    const dest = join(DIST, file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.body);
  }

  const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.body), 0);
  log(`  pages    ${files.filter((f) => f.path.endsWith('.html')).length}`);
  log(`  assets   ${assets.length} (${kb(assets.reduce((n, a) => n + a.body.length, 0))})`);
  log(`  vendor   ${vendor.files.length} files (${kb(vendor.files.reduce((n, f) => n + f.body.length, 0))})`);
  log(`  output   dist/ (${kb(bytes)})`);
  if (problems.length) {
    log(`  warnings ${problems.length}`);
    problems.forEach((p) => log(`     · ${p}`));
  }
  log(`  done in ${Date.now() - started}ms`);
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

/**
 * Netlify response headers, written into the publish directory.
 *
 * `Referrer-Policy: no-referrer` is not cosmetic: the restored OFF+BRAND
 * bundle and every `.riv` file it fetches are served from hosts that reject
 * foreign referrers, and sending none is the only lever a browser offers.
 * `no-cache` everywhere because nothing in dist/ is content-hashed — a stale
 * asset here would mean a stale engine.
 *
 * Routes need no redirects: they are directories with an index.html, which
 * Netlify's pretty URLs serve at /on-track, and dist/404.html is picked up
 * automatically as the custom 404.
 */
function deployConfig() {
  return [
    {
      path: '_headers',
      body: [
        '/*',
        '  Referrer-Policy: no-referrer',
        '  X-Content-Type-Options: nosniff',
        '  Cache-Control: no-cache',
        '',
      ].join('\n'),
    },
  ];
}

function kb(n) { return `${(n / 1024).toFixed(1)} kB`; }

/** dist paths → page-absolute URLs. */
function prefixPaths(paths) {
  const out = {};
  for (const [key, value] of Object.entries(paths)) out[key] = value ? `/${value}` : null;
  return out;
}

async function collectAssets(...dirs) {
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of await walk(dir)) {
      const rel = relative(SRC, entry).split(sep).join('/');
      out.push({ rel, body: await readFile(entry, 'utf8') });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function walk(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

/**
 * Sanity checks that keep the build honest. Each one looks at the *generated*
 * document, not the source, so a regression in the transform shows up here.
 */
function runChecks({ home, subs, assets, vendor, engineSrc }) {
  const problems = [];
  const { root } = parse(home.html);
  const scripts = findAll(root, (n) => isElement(n, 'script')).map((n) => getAttr(n, 'src') || '');
  const links = findAll(root, (n) => isElement(n, 'link')).map((n) => getAttr(n, 'href') || '');
  const vendorPaths = new Set((vendor.files || []).map((f) => `/${f.path}`));

  // a) no blocked third parties survived
  for (const script of findAll(root, (n) => isElement(n, 'script'))) {
    const src = getAttr(script, 'src') || '';
    if (/klaviyo|iubenda|googletagmanager|localhost:|itsoffbrand\.io/.test(src)) {
      problems.push(`blocked or referrer-locked script still present: ${src}`);
    }
    const body = script.children.filter((c) => c.type === 'rawtext').map((c) => c.value).join('');
    if (/gtag\(|google_tags_first_party/.test(body)) problems.push('analytics inline script still present');
  }

  // b) the engine -------------------------------------------------------
  if (engineSrc) {
    const tag = findAll(root, (n) => isElement(n, 'script') && getAttr(n, 'src') === engineSrc);
    if (!tag.length) problems.push(`the vendored engine is not wired up: ${engineSrc}`);
    else if (!getAttr(tag[0], 'onload')) problems.push('engine tag has no load marker (src/js/engine.js needs it)');
    if (!vendorPaths.has(engineSrc)) problems.push(`engine file missing from the build: ${engineSrc}`);

    // the whole point of vendoring: the bundle must not reach off-origin for
    // anything it needs to boot
    const code = (vendor.files || []).find((f) => `/${f.path}` === engineSrc)?.body?.toString('utf8') || '';
    for (const host of ['https://lando.itsoffbrand.io', 'https://assets.itsoffbrand.io', 'https://unpkg.com/', 'https://cdn.jsdelivr.net/npm/']) {
      if (code.includes(host)) problems.push(`vendored engine still calls out to ${host}`);
    }
    // The gl/ entries only matter when the engine's WebGL layer is live; with
    // it switched off those URLs are unreachable code paths (see localize.mjs).
    const mustShip = [
      '/assets/vendor/offbrand/lando.itsoffbrand.io/rive/page-transition.riv',
      '/assets/vendor/offbrand/assets.itsoffbrand.io/lando/rive/reef.riv',
      '/assets/vendor/offbrand/assets.itsoffbrand.io/lando/rive/btn-ui.riv',
      '/assets/vendor/npm/rive.wasm',
    ];
    if (!DISABLE_LANDO_GL) mustShip.push(
      '/assets/vendor/offbrand/lando.itsoffbrand.io/gl/models/helmet-21.glb',
      '/assets/vendor/offbrand/lando.itsoffbrand.io/gl/draco/draco_decoder.wasm',
    );
    for (const must of mustShip) {
      if (!vendorPaths.has(must)) problems.push(`engine asset missing from the build: ${must}`);
    }
    // every mirror URL the bundle now asks for should resolve to a file we ship
    for (const ref of new Set(code.match(/"\/assets\/vendor\/[^"]+"/g) || [])) {
      const url = ref.slice(1, -1);
      if (vendorPaths.has(url)) continue;
      if (DISABLE_LANDO_GL && url.includes('/lando.itsoffbrand.io/gl')) continue;
      // base URLs are concatenated with a file name at runtime
      if (!vendor.files.some((f) => `/${f.path}`.startsWith(url))) {
        problems.push(`vendored engine asks for a file that is not in the build: ${url}`);
      }
    }
  } else if (scripts.some((src) => src.includes('/assets/vendor/engine/'))) {
    problems.push('local-only build still references the vendored engine');
  }

  // the two scripts the engine calls into (jQuery + the Webflow runtime)
  if (!scripts.some((src) => src.includes('jquery-3.5.1'))) problems.push('jQuery is missing (the Webflow runtime needs it)');
  if (!scripts.some((src) => src.includes('/js/lando-offbrand.'))) problems.push('Webflow runtime is missing');

  // c) the published stylesheet + local engine are both wired up
  if (!links.some((h) => h.includes('lando-offbrand.shared'))) problems.push('Webflow stylesheet link is missing');
  if (!links.some((h) => h.endsWith('/assets/css/engine.css'))) problems.push('engine.css is not linked');
  if (!scripts.some((s) => s.endsWith('/assets/js/engine.js'))) problems.push('engine.js is not referenced');

  for (const { def, html } of subs) {
    if (/itsoffbrand|\/assets\/vendor\/engine\//.test(html)) {
      problems.push(`${def.slug}: sub-page should not carry the OFF+BRAND engine`);
    }
  }

  // d) every local asset reference exists in the build
  const assetPaths = new Set([...assets.map((a) => `/assets/${a.rel}`), ...vendorPaths]);
  for (const ref of [...links, ...scripts]) {
    if (ref.startsWith('/assets/') && !assetPaths.has(ref)) problems.push(`missing asset: ${ref}`);
  }

  // e) every internal link has a page
  const routes = new Set(['/', '/index.html', ...subs.flatMap(({ def }) => [def.path, def.path.replace(/\/$/, '')])]);
  for (const a of findAll(root, (n) => isElement(n, 'a'))) {
    const href = getAttr(a, 'href') || '';
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const clean = href.replace(/\/$/, '') || '/';
    if (!routes.has(clean) && !routes.has(`${clean}/`)) problems.push(`dead internal link: ${href}`);
  }

  // f) structural integrity
  const svgOpen = (home.html.match(/<svg\b/g) || []).length;
  const svgClose = (home.html.match(/<\/svg>/g) || []).length;
  if (svgOpen !== svgClose) problems.push(`unbalanced <svg>: ${svgOpen} open / ${svgClose} close`);

  // g) the preloader must never be able to trap a no-JS visitor
  if (!/<noscript>/.test(home.html)) problems.push('no <noscript> fallback for the preloader');
  if (/data-start="hidden"/.test(home.html)) problems.push('page is still data-start="hidden"');

  // h) sub-pages carry the real chrome
  for (const { def, html } of subs) {
    if (!html.includes('data-nav-wrap')) problems.push(`${def.slug}: nav missing`);
    if (!html.includes('is-footer')) problems.push(`${def.slug}: footer missing`);
    if (/<div[^>]*class="[^"]*\btransition-w\b/.test(html)) problems.push(`${def.slug}: preloader markup should not be present`);
  }

  return [...new Set(problems)];
}
