#!/usr/bin/env node
/**
 * server.mjs — zero-dependency static server for the built site.
 *
 *   node server.mjs              # serve dist/ (builds first if needed)
 *   node server.mjs --watch      # rebuild on changes to source/, src/, scripts/
 *   PORT=8080 node server.mjs
 *
 * It binds 0.0.0.0 so the page works through a proxy/preview host, sends
 * permissive CORS headers, never caches HTML during development and falls
 * back to dist/404.html for unknown routes.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, 'dist');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 4173);
const WATCH = process.argv.includes('--watch');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.riv': 'application/octet-stream',
  '.mp4': 'video/mp4',
  // the vendored OFF+BRAND engine: WebAssembly, glTF and the textures it
  // decodes. Wrong types here mean a silent WebGL/Rive failure in the browser.
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'image/vnd.radiance',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
};

buildIfNeeded();

const server = createServer(handle);
server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  landnr · serving ${DIST}`);
  console.log(`  ➜  http://${shown}:${PORT}/\n`);
});

if (WATCH) {
  let timer = null;
  for (const dir of ['source', 'src', 'scripts']) {
    const target = resolve(here, dir);
    if (!existsSync(target)) continue;
    watch(target, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log('  ↻ change detected, rebuilding…');
        buildIfNeeded(true);
      }, 120);
    });
  }
}

function buildIfNeeded(force = false) {
  if (!force && existsSync(join(DIST, 'index.html'))) return;
  const res = spawnSync(process.execPath, [join(here, 'scripts', 'build.mjs'), force ? '' : '--quiet']
    .filter(Boolean), { stdio: 'inherit', cwd: here });
  if (res.status !== 0) {
    console.error('  ✖ build failed — serving whatever is already in dist/');
  }
}

async function handle(req, res) {
  const started = Date.now();
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'text/plain; charset=utf-8', Buffer.from('Bad request'));
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', Buffer.from('Method not allowed'));
  }

  const file = resolveFile(pathname);
  if (!file) return notFound(req, res, pathname, started);

  const type = MIME[extname(file.path).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Content-Length': file.size,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': type.startsWith('text/html') ? 'no-cache, must-revalidate' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    return res.end();
  }

  res.writeHead(200, headers);
  createReadStream(file.path).pipe(res);
  logLine(req, pathname, 200, file.size, Date.now() - started);
}

function resolveFile(pathname) {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const base = join(DIST, safe);
  if (!base.startsWith(DIST + sep) && base !== DIST) return null;

  const candidates = [];
  if (existsSync(base) && statSync(base).isDirectory()) {
    candidates.push(join(base, 'index.html'));
  } else {
    candidates.push(base);
    if (!extname(base)) {
      candidates.push(join(base, 'index.html'));
      candidates.push(`${base}.html`);
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { path: candidate, size: statSync(candidate).size };
    }
  }
  return null;
}

/**
 * The vendored engine probes both Rive mirrors for every artboard, so a normal
 * page load produces a handful of deliberate 404s. Those are asset requests,
 * not navigations: answer them with a small text body instead of the 100 kB
 * HTML 404 page, so loaders never see markup and the log stays readable.
 */
function isAssetRequest(req, pathname) {
  if (pathname.startsWith('/assets/')) return true;
  const ext = extname(pathname).toLowerCase();
  if (ext && ext !== '.html' && MIME[ext]) return true;
  return !String(req.headers.accept || '').includes('text/html');
}

async function notFound(req, res, pathname, started) {
  if (isAssetRequest(req, pathname)) {
    const body = Buffer.from(`404 — ${decodeURIComponent(pathname)}\n`);
    send(res, 404, 'text/plain; charset=utf-8', body);
    logLine(req, pathname, 404, body.length, Date.now() - started);
    return;
  }
  const fallback = join(DIST, '404.html');
  if (existsSync(fallback)) {
    const body = await readFile(fallback);
    res.writeHead(404, {
      'Content-Type': MIME['.html'],
      'Content-Length': body.length,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    if (req.method !== 'HEAD') res.end(body);
    else res.end();
    logLine(req, pathname, 404, body.length, Date.now() - started);
    return;
  }
  send(res, 404, 'text/plain; charset=utf-8', Buffer.from(`404 — ${pathname}\n\nRun: npm run build`));
  logLine(req, pathname, 404, 0, Date.now() - started);
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function logLine(req, pathname, code, size, ms) {
  const colour = code === 200 ? '\x1b[32m' : code === 404 ? '\x1b[33m' : '\x1b[31m';
  console.log(`  ${colour}${code}\x1b[0m ${req.method} ${pathname} · ${(size / 1024).toFixed(1)} kB · ${ms}ms`);
}

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
