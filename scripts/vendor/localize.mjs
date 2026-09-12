/**
 * localize.mjs — make the *real* OFF+BRAND engine runnable from this build.
 *
 * The capture points the page at three hosts:
 *
 *   lando.itsoffbrand.io   the live engine bundle, the WebGL hero, the page
 *                          transition Rive — answers "Access denied - Invalid
 *                          referrer" to every origin that is not
 *                          landonorris.com, so from any other domain the
 *                          engine's very first `await` rejects and *nothing*
 *                          on the page ever animates.
 *   assets.itsoffbrand.io  the seven Rive artboards.
 *   unpkg / jsdelivr       the Rive WASM runtime (@rive-app/canvas-lite).
 *
 * `vendor/` is a byte-exact mirror of all of it (scripts/vendor/fetch.sh
 * harvests it; the Wayback Machine is the second source). This module copies
 * that mirror into `dist/assets/vendor/` and rewrites the handful of URL
 * literals inside the engine bundle so every request it makes is same-origin.
 *
 * Nothing is patched except URLs — the engine that runs is the engine the
 * live site runs.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const VENDOR_ROOT = resolve(here, '..', '..', 'vendor');
export const OFFBRAND = join(VENDOR_ROOT, 'offbrand');

/** The bundle the live site runs, per the capture's <head>. */
export const ENGINE_FILE = 'lando.itsoffbrand.io/dev-js/lando.OFF+BRAND.gold-android-fix-03.js';
export const ENGINE_SRC = join(OFFBRAND, ENGINE_FILE);

/** Where things land inside dist/ (and therefore in the page). */
export const VENDOR_BASE = 'assets/vendor';
export const ENGINE_DIST = `${VENDOR_BASE}/engine/lando-engine.js`;
export const MIRROR_DIST = `${VENDOR_BASE}/offbrand`;
export const NPM_DIST = `${VENDOR_BASE}/npm`;

/**
 * Hosts the mirror stands in for. Order matters: the two npm CDNs first, so
 * the Rive WASM lands in the npm mirror rather than the offbrand one.
 */
const HOST_REWRITES = [
  ['https://cdn.jsdelivr.net/npm/', `/${NPM_DIST}/`],
  ['https://unpkg.com/', `/${NPM_DIST}/`],
  ['https://lando.itsoffbrand.io/', `/${MIRROR_DIST}/lando.itsoffbrand.io/`],
  ['https://assets.itsoffbrand.io/', `/${MIRROR_DIST}/assets.itsoffbrand.io/`],
];

/**
 * The Rive runtime builds its WASM address by concatenating its own
 * package.json name and version. Flatten that to a fixed local path so the
 * build does not depend on how the bundle spells the package.
 */
const WASM_REWRITES = [
  [/"https:\/\/unpkg\.com\/"\.concat\((\w+)\.name,"@"\)\.concat\(\1\.version,"\/(rive(?:_fallback)?\.wasm)"\)/g,
    (_, __, file) => `"/${NPM_DIST}/${file}"`],
  [/"https:\/\/cdn\.jsdelivr\.net\/npm\/"\.concat\((\w+)\.name,"@"\)\.concat\(\1\.version,"\/(rive(?:_fallback)?\.wasm)"\)/g,
    (_, __, file) => `"/${NPM_DIST}/${file}"`],
];

/** Mirror subtrees that ship. Everything else in vendor/ is a spare copy. */
const SHIP = [
  'lando.itsoffbrand.io/gl',
  'lando.itsoffbrand.io/rive',
  'assets.itsoffbrand.io/lando/rive',
  'cdn.prod.website-files.com',
  'd3e54v103j8qbb.cloudfront.net',
];

/** Suffixes worth shipping from the Webflow/jQuery mirror. */
const SHIP_EXT = ['.css', '.js', '.woff2', '.woff'];

export function vendorAvailable() {
  return existsSync(ENGINE_SRC);
}

/** Rewrite the engine's remote URLs. Returns { code, hits } for the report. */
export function localizeEngine(code) {
  const hits = {};
  let out = code;

  for (const [pattern, replacement] of WASM_REWRITES) {
    out = out.replace(pattern, (...args) => {
      const key = `rive ${args[2]}`;
      hits[key] = (hits[key] || 0) + 1;
      return replacement(...args);
    });
  }

  for (const [from, to] of HOST_REWRITES) {
    const parts = out.split(from);
    if (parts.length > 1) {
      hits[from] = parts.length - 1;
      out = parts.join(to);
    }
  }

  return { code: out, hits };
}

/**
 * Every file the build should write under dist/assets/vendor/, as
 * { path, body } with body a Buffer (most of this is binary).
 */
export async function collectVendor() {
  if (!vendorAvailable()) return { files: [], engine: null, hits: {} };

  const files = [];

  // 1 — the engine, with its URLs pointed at the mirror
  const raw = await readFile(ENGINE_SRC, 'utf8');
  const { code, hits } = localizeEngine(raw);
  files.push({ path: ENGINE_DIST, body: Buffer.from(code, 'utf8') });

  // 2 — the mirrored hosts
  for (const sub of SHIP) {
    const root = join(OFFBRAND, sub);
    if (!existsSync(root)) continue;
    for (const entry of await walk(root)) {
      const rel = relative(OFFBRAND, entry).split(sep).join('/');
      const isWebflow = sub.startsWith('cdn.prod') || sub.startsWith('d3e54v');
      if (isWebflow && !SHIP_EXT.some((ext) => rel.toLowerCase().endsWith(ext))) continue;
      files.push({ path: `${MIRROR_DIST}/${rel}`, body: await readFile(entry) });
    }
  }

  // 3 — the Rive WASM, at the flat path the rewrite above produces and at the
  //     package path the un-rewritten bundle would have asked unpkg for
  const npmRoot = join(VENDOR_ROOT, 'npm');
  if (existsSync(npmRoot)) {
    for (const entry of await walk(npmRoot)) {
      const rel = relative(npmRoot, entry).split(sep).join('/');
      const body = await readFile(entry);
      files.push({ path: `${NPM_DIST}/${rel}`, body });
      const base = rel.split('/').pop();
      if (base.endsWith('.wasm') && !files.some((f) => f.path === `${NPM_DIST}/${base}`)) {
        files.push({ path: `${NPM_DIST}/${base}`, body });
      }
    }
  }

  return { files, engine: `/${ENGINE_DIST}`, hits };
}

/** The stylesheet / runtime URLs the page should use instead of the CDN. */
export function localWebflowPaths(files) {
  const bySuffix = (needle) => files.find((f) => f.path.includes(needle))?.path || null;
  return {
    css: bySuffix('css/lando-offbrand.shared.5b4e934f7.css'),
    jquery: bySuffix('jquery-3.5.1.min'),
    runtime: bySuffix('js/lando-offbrand.751e0867'),
    schunk: bySuffix('js/lando-offbrand.schunk'),
  };
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out.sort();
}
