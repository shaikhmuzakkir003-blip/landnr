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

  /* 1 — homepage ------------------------------------------------------ */
  const stamp = `built ${new Date().toISOString()} · landnr · homepage capture: Last Published Tue Aug 11 2026`;
  // The homepage keeps the real OFF+BRAND engine (assets.itsoffbrand.io has no
  // referrer lock), and src/js/engine.js falls back to the local engine if that
  // bundle does not come up. LANDNR_ENGINE=local / --local builds local-only.
  const remoteEngine = process.env.LANDNR_ENGINE !== 'local' && !args.includes('--local');
  const home = buildHome(sourceHtml, { buildStamp: stamp, remoteEngine });
  log('  engine   ', remoteEngine ? 'OFF+BRAND bundle + local fallback' : 'local only');
  log('  repairs  ', JSON.stringify(home.report.repairs));
  log('  removed  ', `${home.report.scriptsRemoved || 0} scripts, ${home.report.commentsRemoved || 0} comments, ${home.report.embedsRemoved || 0} empty embeds`);

  /* 2 — derived pages ------------------------------------------------- */
  const subs = buildSubPages(home.root, SUB_PAGES);

  /* 3 — assets -------------------------------------------------------- */
  const assets = await collectAssets(join(SRC, 'css'), join(SRC, 'js'));

  /* 4 — checks -------------------------------------------------------- */
  const problems = runChecks({ home, subs, assets, remoteEngine });

  /* 5 — write --------------------------------------------------------- */
  const files = [
    { path: 'index.html', body: home.html },
    ...subs.map(({ def, html }) => ({
      path: def.path.endsWith('.html') ? def.path.replace(/^\//, '') : join(def.path.replace(/^\//, ''), 'index.html'),
      body: html,
    })),
    ...assets.map((a) => ({ path: join('assets', a.rel), body: a.body, binary: a.binary })),
    ...deployConfig(),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    sourceBytes: Buffer.byteLength(sourceHtml),
    pages: files.filter((f) => f.path.endsWith('.html')).map((f) => `/${f.path.replace(/index\.html$/, '')}`),
    assets: assets.map((a) => `/assets/${a.rel}`),
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

  await rm(DIST, { recursive: true, force: true });
  for (const file of files) {
    const dest = join(DIST, file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.body);
  }

  const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.body), 0);
  log(`  pages    ${files.filter((f) => f.path.endsWith('.html')).length}`);
  log(`  assets   ${assets.length} (${kb(assets.reduce((n, a) => n + a.body.length, 0))})`);
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
function runChecks({ home, subs, assets, remoteEngine = true }) {
  const problems = [];
  const { root } = parse(home.html);

  // a) no blocked third parties survived
  for (const script of findAll(root, (n) => isElement(n, 'script'))) {
    const src = getAttr(script, 'src') || '';
    if (/klaviyo|iubenda|googletagmanager|localhost:|lando\.itsoffbrand\.io/.test(src)) {
      problems.push(`blocked script still present: ${src}`);
    }
    if (!remoteEngine && /assets\.itsoffbrand\.io|d3e54v103j8qbb|\/js\/lando-offbrand\./.test(src)) {
      problems.push(`remote engine present in a local-only build: ${src}`);
    }
    const body = script.children.filter((c) => c.type === 'rawtext').map((c) => c.value).join('');
    if (/gtag\(|google_tags_first_party/.test(body)) problems.push('analytics inline script still present');
  }

  // b) the published stylesheet + engine are both wired up
  const links = findAll(root, (n) => isElement(n, 'link')).map((n) => getAttr(n, 'href') || '');
  if (!links.some((h) => h.includes('lando-offbrand.shared'))) problems.push('Webflow stylesheet link is missing');
  if (!links.some((h) => h.endsWith('/assets/css/engine.css'))) problems.push('engine.css is not linked');
  const scripts = findAll(root, (n) => isElement(n, 'script')).map((n) => getAttr(n, 'src') || '');
  if (!scripts.some((s) => s.endsWith('/assets/js/engine.js'))) problems.push('engine.js is not referenced');
  if (remoteEngine) {
    const bundle = findAll(root, (n) => isElement(n, 'script')
      && (getAttr(n, 'src') || '').includes('lando-by-OFF+BRAND.js'));
    if (!bundle.length) problems.push('remote engine bundle is missing from the homepage');
    else if (!getAttr(bundle[0], 'onload')) problems.push('remote engine bundle has no load marker');
    if (!scripts.some((s) => s.includes('transitions-rive-isolate'))) problems.push('transition Rive script is missing');
    if (!scripts.some((s) => s.includes('d3e54v103j8qbb'))) problems.push('jQuery is missing (the Webflow runtime needs it)');
    if (!scripts.some((s) => s.includes('/js/lando-offbrand.'))) problems.push('Webflow runtime is missing');
  }
  for (const { def, html } of subs) {
    if (/itsoffbrand|d3e54v103j8qbb|\/js\/lando-offbrand\./.test(html)) {
      problems.push(`${def.slug}: sub-page should not carry the remote engine`);
    }
  }

  // c) every local asset reference exists in the build
  const assetPaths = new Set(assets.map((a) => `/assets/${a.rel}`));
  for (const ref of [...links, ...scripts]) {
    if (ref.startsWith('/assets/') && !assetPaths.has(ref)) problems.push(`missing asset: ${ref}`);
  }

  // d) every internal link has a page
  const routes = new Set(['/', '/index.html', ...subs.flatMap(({ def }) => [def.path, def.path.replace(/\/$/, '')])]);
  for (const a of findAll(root, (n) => isElement(n, 'a'))) {
    const href = getAttr(a, 'href') || '';
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const clean = href.replace(/\/$/, '') || '/';
    if (!routes.has(clean) && !routes.has(`${clean}/`)) problems.push(`dead internal link: ${href}`);
  }

  // e) structural integrity
  const svgOpen = (home.html.match(/<svg\b/g) || []).length;
  const svgClose = (home.html.match(/<\/svg>/g) || []).length;
  if (svgOpen !== svgClose) problems.push(`unbalanced <svg>: ${svgOpen} open / ${svgClose} close`);

  // f) the preloader must never be able to trap a no-JS visitor
  if (!/<noscript>/.test(home.html)) problems.push('no <noscript> fallback for the preloader');
  if (/data-start="hidden"/.test(home.html)) problems.push('page is still data-start="hidden"');

  // g) sub-pages carry the real chrome
  for (const { def, html } of subs) {
    if (!html.includes('data-nav-wrap')) problems.push(`${def.slug}: nav missing`);
    if (!html.includes('is-footer')) problems.push(`${def.slug}: footer missing`);
    if (/<div[^>]*class="[^"]*\btransition-w\b/.test(html)) problems.push(`${def.slug}: preloader markup should not be present`);
  }

  return [...new Set(problems)];
}
