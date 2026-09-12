/**
 * hero-ash.js — the hero of a site belonging to someone who has never shown
 * his face.
 *
 * Two figures share one spot. Behind: a black mannequin — the stand-in, the
 * honest answer to "what does he look like". In front: the picture he gives
 * the world instead, floating a hand's breadth closer to the camera. Move the
 * pointer over that picture and it comes apart — not a cross-fade, a genuine
 * disintegration: every fragment of the plane has its own noise threshold, and
 * as the dissolve front passes it the fragment is pushed outwards and up on a
 * curl of simplex noise, glowing lime at the boundary, until nothing is left
 * but the mannequin underneath, which turns its faceless head to follow you.
 * Move away and the picture settles back into place.
 *
 * It is real 3D, the way the helmet reveals on the site this one grew from are
 * real 3D: three.js (vendored, byte-exact from npm) drives a subdivided plane
 * carrying the portrait's alpha through a custom vertex/fragment shader, in
 * front of a matte-black ball-jointed figure assembled from primitives — so
 * the site ships nobody else's 3D scan.
 *
 * The portrait:
 *   Drop any flat-background picture at source/ash-hero.png (png/jpg/webp) and
 *   the build copies it to /assets/img/ash-hero.png. The backdrop is keyed out
 *   HERE, at load time, by flood-filling from the image border — which is why
 *   white sleeves and eye-whites survive: they are the same colour as the
 *   backdrop but they are not connected to it. Already-transparent files pass
 *   through untouched.
 *   Until the file exists, a procedurally drawn silhouette stands in, so the
 *   effect is demonstrable from a clean clone.
 *
 * Failure is not silence: no WebGL2, no three.js, or a reduced-motion
 * preference degrades to a layered CSS hero (SVG mannequin, portrait on top,
 * hover lifts the portrait off it) rather than to nothing.
 */

import { note, report } from './utils.js';

const THREE_URL = '/assets/vendor/npm/three/three.module.js';
const PORTRAIT_URLS = [
  '/assets/img/ash-hero.png',
  '/assets/img/ash-hero.webp',
  '/assets/img/ash-hero.jpg',
  '/assets/img/ash-hero.jpeg',
];

const MAX_TEX = 1400;        // keying canvas cap, px on the long side
const KEY_TOLERANCE = 34;    // rgb distance from the backdrop that still counts as backdrop
const KEY_STEP = 6;          // max per-pixel step the fill may cross (the real edges)
const FEATHER_PASSES = 2;    // box-blur passes that soften the cut edge

const EDGE = 0xd2ff00;       // the site's lime — the colour of the dissolve

/* ------------------------------------------------------------------ *
 * entry
 * ------------------------------------------------------------------ */

export async function initHeroAsh() {
  const host = document.querySelector('.home-hero .gl-canvas')
    || document.querySelector('[data-ash-hero]');
  if (!host) return null;                       // sub-pages have no hero

  host.classList.add('ln-ash-host');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const portrait = await makePortrait();

  let THREE = null;
  try {
    THREE = await import(THREE_URL);
  } catch (err) {
    note(`three.js refused to load (${err?.message || err}) — CSS hero`);
  }

  const state = { host, portrait, THREE, reduced, mode: 'webgl' };
  if (!THREE) state.mode = 'css (no three.js)';
  else if (!webgl2()) state.mode = 'css (no WebGL2)';
  else if (reduced) state.mode = 'css (reduced motion)';

  window.lnHero = {
    mode: state.mode,
    source: portrait.source,
    keyed: portrait.keyed,
    progress: () => state.progress ?? 0,
    dispose: () => state.dispose?.(),
  };
  report.hero = { mode: state.mode, source: portrait.source, keyed: portrait.keyed };
  note(`hero: ${state.mode}, portrait from ${portrait.source}`);

  if (state.mode !== 'webgl') {
    state.dispose = cssHero(host, portrait);
    return state;
  }
  state.dispose = webglHero(state);
  return state;
}

function webgl2() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * the portrait: supplied file, keyed; or a drawn stand-in
 * ------------------------------------------------------------------ */

async function makePortrait() {
  let img = null;
  let url = null;
  for (const candidate of PORTRAIT_URLS) {
    img = await loadImage(candidate).catch(() => null);
    if (img) {
      url = candidate;
      break;
    }
  }
  if (!img) {
    return { canvas: placeholderSilhouette(), source: 'procedural stand-in (drop source/ash-hero.png)', keyed: false };
  }
  const { canvas, keyed, alreadyAlpha } = keyOutBackground(img);
  return {
    canvas,
    keyed,
    source: keyed ? `${url} (backdrop keyed out)` : `${url} (already transparent)`,
    alreadyAlpha,
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`no ${url}`));
    img.src = url;
  });
}

/**
 * Remove a flat studio backdrop without touching anything that merely shares
 * its colour. Flood-fill from every border pixel through pixels close to the
 * backdrop colour: eye-whites, teeth and white sleeves are enclosed by the
 * figure, so the fill never reaches them. Then soften the frontier so the cut
 * does not alias against the 3D scene behind it.
 */
export function keyOutBackground(img) {
  const scale = Math.min(1, MAX_TEX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  /* already transparent? then there is nothing to key */
  let clearBorder = 0;
  let border = 0;
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      border++;
      if (d[(y * w + x) * 4 + 3] < 12) clearBorder++;
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      border++;
      if (d[(y * w + x) * 4 + 3] < 12) clearBorder++;
    }
  }
  if (clearBorder / border > 0.5) return { canvas, keyed: false, alreadyAlpha: true };

  /* backdrop colour: median of the border ring */
  const samples = [];
  for (let x = 0; x < w; x += 2) {
    samples.push(px(d, 0, x, w), px(d, h - 1, x, w));
  }
  for (let y = 0; y < h; y += 2) {
    samples.push(px(d, y, 0, w), px(d, y, w - 1, w));
  }
  const bg = [0, 1, 2].map((c) => median(samples.map((s) => s[c])));

  /* Region-grow from the border. Two limits, because connectivity alone is
     not enough: a white sleeve cropped by the bottom frame IS connected to
     the border, and it is nearly the backdrop's colour.
       · global — stay within KEY_TOLERANCE of the backdrop colour, which
         lets a vignetted or shaded studio sweep clear;
       · local  — never cross a step of more than a few levels between one
         pixel and the pixel the fill came from. Backdrops vary smoothly;
         the boundary between backdrop and subject does not. That is what
         keeps the sleeve.
     Seeds come only from long contiguous runs of backdrop on each border,
     so the short run where a cropped subject meets the frame never starts a
     fill of its own. */
  const tol2 = KEY_TOLERANCE * KEY_TOLERANCE * 3;
  const step2 = KEY_STEP * KEY_STEP * 3;
  const dist2 = (i, r, g, b) => {
    const dr = d[i * 4] - r;
    const dg = d[i * 4 + 1] - g;
    const db = d[i * 4 + 2] - b;
    return dr * dr + dg * dg + db * db;
  };
  const near = (i) => dist2(i, bg[0], bg[1], bg[2]) < tol2;

  const seen = new Uint8Array(w * h);
  const cut = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => {
    if (!seen[i]) {
      seen[i] = 1;
      stack[sp++] = i;
    }
  };
  const minRun = Math.max(8, Math.round(0.15 * Math.min(w, h)));
  const seedRun = (indices) => {
    let run = [];
    const flush = () => {
      if (run.length >= minRun) for (const i of run) push(i);
      run = [];
    };
    for (const i of indices) {
      if (near(i)) run.push(i);
      else flush();
    }
    flush();
  };
  const rowAt = (y) => Array.from({ length: w }, (_, x) => y * w + x);
  const colAt = (x) => Array.from({ length: h }, (_, y) => y * w + x);
  seedRun(rowAt(0));
  seedRun(rowAt(h - 1));
  seedRun(colAt(0));
  seedRun(colAt(w - 1));

  while (sp) {
    const i = stack[--sp];
    if (!near(i)) continue;
    cut[i] = 1;
    const x = i % w;
    const y = (i - x) / w;
    const ri = d[i * 4];
    const gi = d[i * 4 + 1];
    const bi = d[i * 4 + 2];
    const grow = (j) => {
      if (seen[j]) return;
      if (dist2(j, ri, gi, bi) >= step2) return;
      push(j);
    };
    if (x > 0) grow(i - 1);
    if (x < w - 1) grow(i + 1);
    if (y > 0) grow(i - w);
    if (y < h - 1) grow(i + w);
  }

  for (let i = 0; i < w * h; i++) if (cut[i]) d[i * 4 + 3] = 0;

  /* soften the frontier: box-blur the alpha channel a couple of passes */
  let alpha = new Uint8ClampedArray(w * h);
  let next = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = d[i * 4 + 3];
  for (let pass = 0; pass < FEATHER_PASSES; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += alpha[yy * w + xx];
            n++;
          }
        }
        next[i] = sum / n;
      }
    }
    [alpha, next] = [next, alpha];
  }
  for (let i = 0; i < w * h; i++) d[i * 4 + 3] = alpha[i];

  ctx.putImageData(image, 0, 0);
  return { canvas, keyed: true, alreadyAlpha: false };
}

const px = (d, y, x, w) => {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2]];
};

const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return v[v.length >> 1] ?? 0;
};

/**
 * The stand-in: a graphite bust — cap, spikes, shoulders — with a lime rim,
 * drawn so the effect is testable before anyone's real portrait exists.
 */
export function placeholderSilhouette() {
  const w = 900;
  const h = 1080;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');

  const body = () => {
    x.beginPath();
    /* shoulders and torso */
    x.moveTo(150, 1080);
    x.bezierCurveTo(160, 830, 250, 760, 330, 735);
    /* neck */
    x.lineTo(392, 700);
    x.lineTo(392, 640);
    /* jaw, face front, brow under the cap */
    x.bezierCurveTo(330, 610, 300, 540, 300, 460);
    x.bezierCurveTo(300, 330, 360, 260, 450, 260);
    x.bezierCurveTo(540, 260, 600, 330, 600, 460);
    x.bezierCurveTo(600, 540, 570, 610, 508, 640);
    x.lineTo(508, 700);
    x.lineTo(570, 735);
    x.bezierCurveTo(650, 760, 740, 830, 750, 1080);
    x.closePath();
  };

  const cap = () => {
    x.beginPath();
    x.moveTo(268, 430);
    x.bezierCurveTo(250, 250, 340, 160, 450, 160);
    x.bezierCurveTo(560, 160, 650, 250, 632, 430);
    x.bezierCurveTo(560, 396, 340, 396, 268, 430);
    x.closePath();
    /* brim */
    x.moveTo(268, 430);
    x.bezierCurveTo(180, 420, 150, 452, 148, 470);
    x.bezierCurveTo(240, 486, 330, 470, 350, 452);
    x.closePath();
  };

  const spikes = () => {
    x.beginPath();
    const pts = [
      [268, 452], [212, 470], [258, 500], [196, 540], [262, 556],
      [226, 610], [292, 606], [280, 668], [338, 640],
    ];
    x.moveTo(pts[0][0], pts[0][1]);
    for (const [sx, sy] of pts.slice(1)) x.lineTo(sx, sy);
    x.lineTo(330, 500);
    x.closePath();
    x.moveTo(632, 452);
    const mirror = pts.slice(1).map(([sx, sy]) => [900 - sx, sy]);
    for (const [sx, sy] of mirror) x.lineTo(sx, sy);
    x.lineTo(570, 500);
    x.closePath();
  };

  const fill = (g0, g1) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, g0);
    g.addColorStop(1, g1);
    return g;
  };

  x.lineJoin = 'round';
  for (const [path, g0, g1] of [
    [body, '#20241d', '#0d0f0c'],
    [spikes, '#181b16', '#0b0d0a'],
    [cap, '#2a2f24', '#12140f'],
  ]) {
    path();
    x.fillStyle = fill(g0, g1);
    x.fill();
    x.strokeStyle = 'rgba(210,255,0,0.55)';
    x.lineWidth = 5;
    x.stroke();
  }
  return c;
}

/* ------------------------------------------------------------------ *
 * the 3D hero
 * ------------------------------------------------------------------ */

function webglHero(state) {
  const { host, portrait, THREE } = state;
  const canvas = document.createElement('canvas');
  canvas.className = 'ln-ash-canvas';
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0.1, 6.6);

  scene.add(new THREE.HemisphereLight(0x39402f, 0x060607, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2.6, 3.2, 4.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(EDGE, 1.0);
  rim.position.set(-3.4, 2.2, -3.6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x7f8ea3, 0.3);
  fill.position.set(-2.4, -0.6, 3.2);
  scene.add(fill);

  const mannequin = buildMannequin(THREE);
  scene.add(mannequin);
  scene.add(buildGroundShadow(THREE));

  const character = buildCharacter(THREE, portrait.canvas);
  character.position.set(0, 0.86, 0.55);
  scene.add(character);

  /* ---- interaction state ---- */
  const pointer = { x: 0, y: 0, inside: false, touch: false, on: false };
  let progress = 0;
  let time = 0;
  let running = true;
  let rect = null;
  let rectDirty = true;

  const refreshRect = () => {
    rect = canvas.getBoundingClientRect();
    rectDirty = false;
  };
  const markRect = () => {
    rectDirty = true;
  };

  const toNdc = (cx, cy) => {
    if (rectDirty || !rect) refreshRect();
    if (!rect || !rect.width || !rect.height) return null;
    return [((cx - rect.left) / rect.width) * 2 - 1, -(((cy - rect.top) / rect.height) * 2 - 1)];
  };

  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const box = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const updateBox = () => {
    const geo = character.geometry;
    const p = geo.parameters;
    const half = [
      [-p.width / 2, p.height / 2], [p.width / 2, p.height / 2],
      [p.width / 2, -p.height / 2], [-p.width / 2, -p.height / 2],
    ];
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    half.forEach(([lx, ly], i) => {
      corners[i].set(lx, ly, 0).applyMatrix4(character.matrixWorld).project(camera);
      x0 = Math.min(x0, corners[i].x);
      x1 = Math.max(x1, corners[i].x);
      y0 = Math.min(y0, corners[i].y);
      y1 = Math.max(y1, corners[i].y);
    });
    box.x0 = x0;
    box.x1 = x1;
    box.y0 = y0;
    box.y1 = y1;
  };

  const onMove = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.touch = e.pointerType === 'touch';
    pointer.inside = true;
  };
  const onLeave = () => {
    pointer.inside = false;
  };
  const onDown = (e) => {
    if (e.pointerType !== 'touch') return;
    const ndc = toNdc(e.clientX, e.clientY);
    if (ndc && insideBox(ndc)) pointer.on = !pointer.on;
  };

  const insideBox = ([nx, ny]) => {
    const pad = 0.08;
    return nx > box.x0 - pad && nx < box.x1 + pad && ny > box.y0 - pad && ny < box.y1 + pad;
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('scroll', markRect, { passive: true });
  window.addEventListener('resize', markRect);

  const io = new IntersectionObserver(([entry]) => {
    running = entry.isIntersecting;
  }, { threshold: 0.02 });
  io.observe(host);

  /* ---- sizing ---- */
  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    /* keep the whole figure in frame on narrow screens */
    const fov = (camera.fov * Math.PI) / 180;
    const need = 3.9;
    const byHeight = need / (2 * Math.tan(fov / 2));
    const byWidth = (need * 0.62) / (2 * Math.tan(fov / 2) * camera.aspect);
    camera.position.z = Math.max(byHeight, byWidth);
    camera.updateProjectionMatrix();
    markRect();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  /* ---- the loop ---- */
  const uni = character.material.uniforms;
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -character.position.z);
  const hit = new THREE.Vector3();
  let raf = 0;
  let last = performance.now();

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!running || document.hidden) return;
    time += dt;

    character.updateMatrixWorld();
    camera.updateMatrixWorld();
    updateBox();

    const ndc = pointer.inside ? toNdc(pointer.x, pointer.y) : null;
    const hovering = pointer.touch ? pointer.on : Boolean(ndc) && insideBox(ndc);
    const target = hovering ? 1 : 0;
    progress += (target - progress) * (1 - Math.exp(-dt * 4.2));
    if (progress < 0.001) progress = 0;
    state.progress = progress;

    uni.uProgress.value = progress;
    uni.uTime.value = time;
    uni.uPointerStrength.value = hovering ? 0.55 : 0;

    if (ndc) {
      ray.setFromCamera({ x: ndc[0], y: ndc[1] }, camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        const local = character.worldToLocal(hit.clone());
        uni.uPointer.value.set(local.x, local.y);
      }
    }

    /* the mannequin: still as a statue until the picture starts to go, then
       it turns, slowly, to look at whatever is looking at it */
    const look = Math.max(0, (progress - 0.25) / 0.75);
    const wantY = ndc ? ndc[0] * 0.34 * look : 0;
    mannequin.rotation.y += (wantY + Math.sin(time * 0.5) * 0.015 - mannequin.rotation.y) * (1 - Math.exp(-dt * 3));
    mannequin.position.y = Math.sin(time * 0.9) * 0.008;
    rim.intensity = 1.0 + look * 1.3;

    /* the picture breathes a little while it is whole */
    character.position.y = 0.86 + Math.sin(time * 1.1) * 0.012 * (1 - progress);
    character.rotation.z = Math.sin(time * 0.7) * 0.004 * (1 - progress);

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return function dispose() {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('scroll', markRect);
    window.removeEventListener('resize', markRect);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    renderer.dispose();
    canvas.remove();
  };
}

/* ------------------------------------------------------------------ *
 * the mannequin — matte black, ball-jointed, faceless on purpose
 * ------------------------------------------------------------------ */

function buildMannequin(THREE) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.5, metalness: 0.12 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.3, metalness: 0.32 });

  const put = (mesh) => {
    g.add(mesh);
    return mesh;
  };
  const ball = (r, x, y, z, sy = 1) => {
    const m = put(new THREE.Mesh(new THREE.SphereGeometry(r, 22, 16), joint));
    m.position.set(x, y, z);
    m.scale.y = sy;
    return m;
  };
  const bone = (rTop, rBottom, len, x, y, z, rz = 0) => {
    const m = put(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, 18, 1), shell));
    m.position.set(x, y, z);
    m.rotation.z = rz;
    return m;
  };
  /* torso: a lathe profile, hips to shoulders, flattened front-to-back */
  const profile = [
    [0.03, -0.34], [0.20, -0.30], [0.245, -0.12], [0.205, 0.08],
    [0.245, 0.30], [0.285, 0.52], [0.25, 0.66], [0.11, 0.73], [0.03, 0.75],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = put(new THREE.Mesh(new THREE.LatheGeometry(profile, 40), shell));
  torso.scale.z = 0.62;

  ball(0.235, 0, -0.30, 0, 0.78);                    // pelvis
  bone(0.085, 0.10, 0.22, 0, 0.85, 0);              // neck

  const head = put(new THREE.Mesh(new THREE.SphereGeometry(0.215, 32, 24), shell));
  head.position.set(0, 1.16, 0);
  head.scale.set(0.86, 1.08, 0.94);                 // an egg. no face. the point.

  for (const s of [-1, 1]) {
    ball(0.095, 0.285 * s, 0.62, 0);                 // shoulder
    bone(0.075, 0.06, 0.46, 0.335 * s, 0.40, 0, -0.10 * s);   // upper arm
    ball(0.062, 0.36 * s, 0.17, 0);                  // elbow
    bone(0.058, 0.045, 0.44, 0.385 * s, -0.06, 0.02, -0.06 * s); // forearm
    ball(0.05, 0.40 * s, -0.29, 0.03, 1.25);         // hand
    bone(0.115, 0.085, 0.74, 0.13 * s, -0.62, 0, 0.03 * s);   // thigh
    ball(0.075, 0.145 * s, -0.99, 0);                // knee
    bone(0.075, 0.05, 0.72, 0.15 * s, -1.35, 0.01, -0.01 * s); // shin
    ball(0.05, 0.152 * s, -1.70, 0);                 // ankle
    const foot = put(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.30), shell));
    foot.position.set(0.152 * s, -1.745, 0.07);
  }

  /* a display base, because a mannequin that stands on nothing reads as a
     floating prop rather than a stand-in */
  const base = put(new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.05, 40), joint));
  base.position.y = -1.80;

  return g;
}

function buildGroundShadow(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 8, 128, 128, 120);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.83;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * the character: the portrait as a dissolving plane
 * ------------------------------------------------------------------ */

const NOISE = /* glsl */ `
vec3 lnMod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 lnMod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 lnPermute(vec4 x){return lnMod289(((x*34.0)+1.0)*x);}
vec4 lnTaylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float lnNoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=lnMod289(i);
  vec4 p=lnPermute(lnPermute(lnPermute(
      i.z+vec4(0.0,i1.z,i2.z,1.0))
    + i.y+vec4(0.0,i1.y,i2.y,1.0))
    + i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=lnTaylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

function buildCharacter(THREE, source) {
  const tex = new THREE.CanvasTexture(source);
  tex.colorSpace = THREE.NoColorSpace;   // the PNG is sRGB; the shader passes it straight through
  tex.anisotropy = 4;

  const aspect = source.width / source.height;
  const H = 2.15;
  const W = H * aspect;
  const segY = Math.max(96, Math.min(240, Math.round(source.height / 6)));
  const segX = Math.max(72, Math.round(segY * aspect));

  const uniforms = {
    uMap: { value: tex },
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector2(9, 9) },
    uPointerStrength: { value: 0 },
    uRadius: { value: 0.85 },
    uScatter: { value: 1.15 },
    uEdge: { value: new THREE.Color(EDGE) },
    uOpacity: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uProgress;
      uniform float uTime;
      uniform float uPointerStrength;
      uniform float uRadius;
      uniform float uScatter;
      uniform vec2  uPointer;
      varying vec2  vUv;
      varying float vGone;
      ${NOISE}
      void main() {
        vUv = uv;
        vec3 pos = position;

        /* every fragment owns a threshold: coarse grain for the big tear,
           fine grain so the silhouette edge crumbles first */
        float coarse = lnNoise(vec3(position.xy * 1.7, 3.1)) * 0.5 + 0.5;
        float fine   = lnNoise(vec3(position.xy * 6.5, 11.7)) * 0.5 + 0.5;
        float mine   = mix(coarse, fine, 0.38);

        /* the cursor carves a hole of its own, ahead of the global front */
        float d    = length(position.xy - uPointer);
        float prox = 1.0 - smoothstep(0.0, uRadius, d);
        float cut  = clamp(uProgress * 1.18 + prox * uPointerStrength, 0.0, 1.35);

        /* 0 while the fragment is still here, 1 once it has left; the span
           between is the glowing tear */
        vGone = clamp((cut - mine) * 3.2, 0.0, 1.0);

        /* leave on a curl of noise, biased up and towards the camera, like
           ash off a burn */
        vec3 dir = normalize(vec3(
          lnNoise(vec3(position.xy * 2.3, 4.4)),
          lnNoise(vec3(position.xy * 2.3, 9.2)) * 0.7 + 0.62,
          0.5 + 0.5 * fine
        ));
        pos += dir * vGone * vGone * uScatter;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3  uEdge;
      uniform float uOpacity;
      varying vec2  vUv;
      varying float vGone;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.02) discard;

        float alpha = tex.a * (1.0 - smoothstep(0.05, 0.30, vGone)) * uOpacity;
        if (alpha < 0.012) discard;

        /* the boundary between here and gone burns lime for a moment */
        float burn = smoothstep(0.0, 0.45, vGone) * (1.0 - smoothstep(0.45, 0.95, vGone));
        vec3 col = tex.rgb + uEdge * burn * 1.5;

        gl_FragColor = vec4(col, alpha);
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H, segX, segY), material);
  mesh.renderOrder = 2;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * no WebGL: a layered CSS hero, same idea, no shaders
 * ------------------------------------------------------------------ */

function cssHero(host, portrait) {
  host.classList.add('ln-ash-css');
  const wrap = document.createElement('div');
  wrap.className = 'ln-ash-css-wrap';
  wrap.innerHTML = MANNEQUIN_SVG;
  const img = document.createElement('img');
  img.alt = '';
  img.src = portrait.canvas.toDataURL('image/png');
  img.className = 'ln-ash-css-portrait';
  wrap.appendChild(img);
  host.appendChild(wrap);
  return () => wrap.remove();
}

const MANNEQUIN_SVG = `<svg class="ln-ash-css-mannequin" viewBox="0 0 200 520" aria-hidden="true">
  <g fill="#0b0c0d">
    <ellipse cx="100" cy="52" rx="26" ry="33"/>
    <rect x="90" y="78" width="20" height="22" rx="8"/>
    <path d="M62 104 q38 -14 76 0 q22 40 14 96 q-6 44 -10 74 h-84 q-4 -30 -10 -74 q-8 -56 14 -96z"/>
    <rect x="34" y="108" width="20" height="120" rx="10" transform="rotate(8 44 108)"/>
    <rect x="146" y="108" width="20" height="120" rx="10" transform="rotate(-8 156 108)"/>
    <rect x="70" y="268" width="24" height="150" rx="12"/>
    <rect x="106" y="268" width="24" height="150" rx="12"/>
    <rect x="64" y="414" width="32" height="16" rx="8"/>
    <rect x="104" y="414" width="32" height="16" rx="8"/>
    <ellipse cx="100" cy="452" rx="52" ry="10" fill="#111318"/>
  </g>
</svg>`;
