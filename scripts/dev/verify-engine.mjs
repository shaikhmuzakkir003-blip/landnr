#!/usr/bin/env node
/**
 * verify-engine.mjs — prove the real OFF+BRAND engine can actually run here.
 *
 *   node scripts/dev/verify-engine.mjs [--base=http://127.0.0.1:4173]
 *   npm run verify
 *
 * The page froze for one reason: the bundle's boot chain awaited a file that
 * its host refused to serve. So this harness does not trust the build report —
 * it reads the *built* bundle, derives every asset the engine will ask for
 * (Rive artboards, the page transition, the Rive WASM — and, when the engine's
 * own WebGL layer is switched on, its models, textures, HDRIs and decoders),
 * requests each one over HTTP, and fails if any of them is missing, empty or
 * served with the wrong content type.
 *
 * It also walks this project's own module graph and checks the vendored
 * three.js the local hero imports, so nothing the page needs is a guess.
 *
 * It also fails if the bundle still contains a cross-origin URL for anything it
 * needs to boot — the whole point of vendoring is that there is none.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DISABLE_LANDO_GL } from '../vendor/localize.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = resolve(ROOT, 'dist');
const base = (process.argv.find((a) => a.startsWith('--base='))?.split('=')[1]
  || process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');

const problems = [];
const rows = [];

const html = await read('index.html');
const engineSrc = /<script[^>]*\bsrc="([^"]*vendor\/engine\/[^"]+)"/.exec(html)?.[1];
if (!engineSrc) fail('the homepage does not load a vendored engine');
const engine = engineSrc ? await read(engineSrc.replace(/^\//, '')) : '';

/* ------------------------------------------------------------------ *
 * 1 — every asset the bundle will request
 * ------------------------------------------------------------------ */

const glBase = literal(/"(\/assets\/vendor\/[^"]*lando\.itsoffbrand\.io\/gl)"/);
// Two Rive bases: the seven artboards live under assets.itsoffbrand.io/lando/
// rive/, the page transition under lando.itsoffbrand.io/rive/. Both mirrored.
const riveBases = [...engine.matchAll(/"(\/assets\/vendor\/[^"]*\/rive\/)"/g)].map((m) => m[1]);
const wasmFiles = [...engine.matchAll(/"(\/assets\/vendor\/npm\/[^"]*\.wasm)"/g)].map((m) => m[1]);
if (!glBase && !DISABLE_LANDO_GL) fail('no local WebGL base in the bundle — the rewrite did not run');
if (!riveBases.length) fail('no local Rive base in the bundle — the rewrite did not run');
if (!wasmFiles.length) fail('no local Rive WASM path in the bundle — the rewrite did not run');

const ASSET = /\.(riv|glb|hdr|wasm|webp|ktx2|json|js)$/;
const wanted = new Map();   // url → why

const rivFiles = ['page-transition.riv', ...strings().filter((v) => /^[a-z0-9-]+\.riv$/i.test(v))];
for (const file of rivFiles) {
  for (const riveBase of riveBases) {
    add(`${riveBase}${file}`, file === 'page-transition.riv'
      ? 'the page transition — the await that froze the whole site'
      : 'Rive artboard');
  }
}
for (const path of templatePaths()) {
  for (const format of ['webp', 'ktx2']) {
    const expanded = path.replace(/\$\{[A-Za-z_$][\w$]*\}/g, format);
    if (!ASSET.test(expanded)) continue;
    add(expanded.startsWith('/') && !expanded.startsWith('/assets/') ? `${glBase}${expanded}` : expanded,
      `WebGL asset (${format === 'webp' ? 'desktop' : 'mobile'})`);
  }
}
for (const path of strings().filter((s) => s.startsWith('/') && ASSET.test(s) && !s.includes('${'))) {
  add(path.startsWith('/assets/') ? path : `${glBase}${path}`, 'WebGL asset');
}
for (const file of wasmFiles) add(file, 'Rive WASM runtime (@rive-app/canvas-lite 2.26.4)');

/* ------------------------------------------------------------------ *
 * 1b — vendored three.js, and this project's own module graph
 * ------------------------------------------------------------------ */

const npmDir = resolve(DIST, 'assets/vendor/npm');
if (existsSync(npmDir)) {
  for (const pkg of await readdir(npmDir)) {
    if (!pkg.startsWith('three@')) continue;
    for (const file of await readdir(resolve(npmDir, pkg))) {
      if (!file.endsWith('.js')) continue;
      add(`/assets/vendor/npm/${pkg}/${file}`, `vendored ${pkg} — the local hero's 3D`);
    }
  }
}

/* every relative import in our own modules has to resolve over HTTP too */
const jsDir = resolve(DIST, 'assets/js');
if (existsSync(jsDir)) {
  for (const file of await readdir(jsDir)) {
    if (!file.endsWith('.js')) continue;
    const code = await readFile(resolve(jsDir, file), 'utf8');
    for (const m of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      add(resolveImport(`/assets/js/${file}`, m[1]), `imported by ${file}`);
    }
  }
}

/** Resolve a module specifier the way a browser would, against its own URL. */
function resolveImport(fromUrl, spec) {
  if (/^[a-z@]/i.test(spec) && !spec.startsWith('.')) return null; // bare: an import map's business
  if (spec.startsWith('/')) return spec;
  const parts = fromUrl.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}


/* ------------------------------------------------------------------ *
 * 2 — request them
 * ------------------------------------------------------------------ */

const TYPES = {
  riv: 'application/octet-stream', wasm: 'application/wasm', glb: 'model/gltf-binary',
  hdr: 'image/vnd.radiance', webp: 'image/webp', ktx2: 'image/ktx2', json: 'application/json',
  js: 'text/javascript', css: 'text/css',
};

const served = new Map();
for (const [url, why] of wanted) {
  const res = await get(url);
  served.set(url, Boolean(res?.ok) && Number(res?.headers.get('content-length') || 0) > 0);
  const ext = url.split('.').pop().toLowerCase();
  if (!res) {
    if (!url.endsWith('.riv')) problems.push(`404/refused ${url} — ${why}`);
    rows.push(['·', url, 'not on this mirror', why]);
    continue;
  }
  const type = res.headers.get('content-type') || '';
  const bytes = Number(res.headers.get('content-length') || 0);
  const wrongType = TYPES[ext] && !type.includes(TYPES[ext]) && !type.includes('octet-stream');
  // A .riv only has to exist under one of the two mirrored bases; the
  // "no mirror serves …" check below is what fails the run for those.
  const riv = url.endsWith('.riv');
  const good = res.ok && bytes > 0 && !wrongType;
  if (!good && !riv) {
    problems.push(!res.ok ? `${res.status} ${url} — ${why}`
      : !bytes ? `empty ${url} — ${why}`
        : `wrong content-type for ${url}: ${type} (expected ${TYPES[ext]})`);
  }
  rows.push([good ? '✓' : riv ? '·' : '✗', url, `${(bytes / 1024).toFixed(0)} kB ${type.split(';')[0]}`, why]);
}

/* every .riv must be served by at least one of the mirrored bases */
for (const file of rivFiles) {
  if (![...served.keys()].some((u) => u.endsWith(`/${file}`) && served.get(u))) {
    problems.push(`no mirror serves ${file}`);
  }
}

/* ------------------------------------------------------------------ *
 * 3 — the page's own critical files, and nothing cross-origin left
 * ------------------------------------------------------------------ */

for (const url of [
  '/', '/assets/js/engine.js', '/assets/css/engine.css',
  ...[...html.matchAll(/<(?:script|link)[^>]*\b(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]),
]) {
  const res = await get(url);
  if (!res?.ok) problems.push(`${res?.status || 'no response'} ${url}`);
}

for (const host of ['https://lando.itsoffbrand.io', 'https://assets.itsoffbrand.io',
  'https://unpkg.com/', 'https://cdn.jsdelivr.net/npm/']) {
  if (engine.includes(host)) problems.push(`the built engine still calls out to ${host}`);
}

/* ------------------------------------------------------------------ *
 * report
 * ------------------------------------------------------------------ */

console.log(`\nverify · ${base}`);
console.log(`  engine   ${engineSrc}`);
console.log(`  assets   ${wanted.size} derived from the built bundle\n`);
for (const [mark, url, meta, why] of rows) {
  console.log(`  ${mark} ${url.replace('/assets/vendor/', '')}`);
  console.log(`      ${meta} · ${why}`);
}
if (problems.length) {
  console.log(`\n✖ ${problems.length} problem(s):`);
  for (const p of problems) console.log(`   · ${p}`);
  process.exit(1);
}
console.log(`\n✓ every asset the engine asks for is served from this origin`);

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function literal(re) { return re.exec(engine)?.[1] || null; }

/** Plain double-quoted string literals. */
function strings() {
  return [...engine.matchAll(/"([^"\n]{2,200})"/g)].map((m) => m[1]);
}

/** Template literals that look like asset paths (`/textures/head/${iQ}/x.${iQ}`). */
function templatePaths() {
  return [...engine.matchAll(/`([^`\n]{2,200})`/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith('/') && s.includes('${') && ASSET.test(s.replace(/\$\{[^}]*\}/g, 'webp')));
}

function add(url, why) {
  if (!url || url.includes('undefined')) return;
  // With the engine's WebGL layer switched off (DISABLE_LANDO_GL) those URLs
  // are unreachable code paths inside the bundle — verifying them would only
  // assert that Lando Norris's head scan still ships with somebody else's site.
  if (DISABLE_LANDO_GL && url.includes('/lando.itsoffbrand.io/gl')) return;
  if (!wanted.has(url)) wanted.set(url, why);
}

async function get(path) {
  try {
    const res = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, { method: 'GET' });
    await res.arrayBuffer().catch(() => null);
    return res;
  } catch { return null; }
}

async function read(path) {
  const file = resolve(DIST, path);
  if (!existsSync(file)) return '';
  return readFile(file, 'utf8');
}

function fail(message) { problems.push(message); }
