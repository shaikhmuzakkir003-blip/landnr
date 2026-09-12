/**
 * ambient.js — the stand-in for the site's WebGL layer.
 *
 * The capture mounts three GL surfaces:
 *   · `[data-gl="head"]`       the hero
 *   · `[data-gl="carousel"]`   the "message from lando" band under the hero
 *   · `[data-gl="background"]` the page-wide wash
 * plus `data-gl-change-from / -to / -track` on two sections, which tell the
 * renderer to blend between two colour stops as the section travels through
 * the viewport. The real shaders are inside the referrer-locked bundle, so
 * this paints the same idea with 2D canvas: soft drifting light fields in the
 * brand palette, blended by scroll, rendered at reduced resolution (they are
 * gradients — upscaling is invisible) with film grain added in CSS.
 *
 * Everything is adaptive: a mount with no box is skipped, an off-screen mount
 * stops drawing, and prefers-reduced-motion gets a single static frame.
 */

import { $$, brandColor, clamp, count, debounce, lerp, mixColor, note, on, onFrame, parseColor, reducedMotion } from './utils.js';

const RENDER_SCALE = 0.55;   // internal resolution multiplier
const MAX_DPR = 1.5;

const fields = [];
let grainInjected = false;

export function initAmbient() {
  injectGrain();

  addField('[data-gl="background"]', {
    name: 'background',
    blobs: 4,
    intensity: 0.55,
    scale: 1.25,
    palette: () => pagePalette(),
  });

  addField('[data-gl="head"]', {
    name: 'hero',
    blobs: 4,
    intensity: 0.9,
    scale: 1,
    pointer: true,
    palette: () => [brandColor('dark-green'), brandColor('dark-green-tint-1'), brandColor('lime', '#d2ff00')],
  });

  addField('[data-gl="carousel"]', {
    name: 'carousel',
    blobs: 3,
    intensity: 0.6,
    scale: 1.1,
    palette: () => carouselPalette(),
  });

  if (!fields.length) {
    note('ambient: no usable GL mounts');
    return { fields: 0 };
  }

  on(window, 'resize', debounce(refreshAmbient, 200));
  onFrame(frame);
  if (reducedMotion()) fields.forEach((f) => f.draw(0.016, true));
  count('ambientFields', fields.length);
  return { fields: fields.map((f) => f.name) };
}

function addField(selector, config) {
  const mount = document.querySelector(selector);
  if (!mount) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'ln-gl';
  canvas.setAttribute('aria-hidden', 'true');
  mount.appendChild(canvas);

  const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!context) {
    canvas.remove();
    return;
  }

  const field = {
    ...config,
    mount,
    canvas,
    ctx: context,
    draw: drawField,
    width: 0,
    height: 0,
    visible: false,
    measured: false,
    time: Math.random() * 40,
    colors: config.palette().map(parseColor),
    targetColors: null,
    pointer: { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 },
    seeds: Array.from({ length: config.blobs }, (_, i) => ({
      phase: (i / config.blobs) * Math.PI * 2 + Math.random(),
      speed: 0.05 + Math.random() * 0.07,
      radius: (0.42 + Math.random() * 0.4) * (config.scale || 1),
      orbit: 0.16 + Math.random() * 0.22,
    })),
  };

  resizeField(field);
  observe(field);
  if (config.pointer) bindPointer(field);
  fields.push(field);
}

function observe(field) {
  if (!('IntersectionObserver' in window)) {
    field.visible = true;
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) field.visible = entry.isIntersecting;
  }, { rootMargin: '80px' });
  io.observe(field.mount);
}

function bindPointer(field) {
  window.addEventListener('pointermove', (event) => {
    field.pointer.tx = event.clientX / window.innerWidth;
    field.pointer.ty = event.clientY / window.innerHeight;
  }, { passive: true });
}

function resizeField(field) {
  const rect = field.mount.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * RENDER_SCALE;
  const width = Math.max(2, Math.round(rect.width * dpr));
  const height = Math.max(2, Math.round(rect.height * dpr));
  if (width === field.width && height === field.height) return true;
  field.width = width;
  field.height = height;
  field.canvas.width = width;
  field.canvas.height = height;
  field.measured = true;
  return true;
}

/* ------------------------------------------------------------------ *
 * palettes driven by scroll
 * ------------------------------------------------------------------ */

function pagePalette() {
  const theme = document.documentElement.dataset.navTheme || 'light';
  const base = theme === 'dark' ? brandColor('dark-green') : brandColor('white', '#fdfdf5');
  const accent = theme === 'dark' ? brandColor('dark-green-tint-1') : brandColor('dark-green-tint-1-low', '#c9d6cd');
  const spark = theme === 'dark' ? brandColor('lime', '#d2ff00') : brandColor('lime-off', '#e9ffc2');
  return blendWithTracks([base, accent, spark]);
}

function carouselPalette() {
  const section = document.querySelector('[data-gl-change-to]');
  const to = (section?.dataset?.glChangeTo || '').split(',').map((s) => s.trim()).filter(Boolean);
  const base = to[0] ? brandColor(to[0], '#fdfdf5') : brandColor('white', '#fdfdf5');
  const accent = to[1] ? brandColor(to[1], '#2f4c3c') : brandColor('dark-green-tint-1');
  return [base, accent, brandColor('lime-off', '#e9ffc2')];
}

/** Sections carrying data-gl-change-track blend the page wash mid-scroll. */
function blendWithTracks(colors) {
  const tracks = $$('[data-gl-change-track]');
  for (const track of tracks) {
    const rect = track.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const span = rect.height + window.innerHeight;
    const progress = clamp((window.innerHeight - rect.top) / span);
    const from = (track.dataset.glChangeFrom || '').split(',').map((s) => s.trim());
    const to = (track.dataset.glChangeTo || '').split(',').map((s) => s.trim());
    if (!from.length || !to.length) continue;
    return colors.map((color, i) => {
      const a = brandColor(from[i] || from[0]);
      const b = brandColor(to[i] || to[0]);
      return mixColor(color, mixColor(a, b, progress), 0.75);
    });
  }
  return colors;
}

/* ------------------------------------------------------------------ *
 * render
 * ------------------------------------------------------------------ */

function frame({ dt }) {
  for (const field of fields) {
    if (!field.visible) continue;
    if (!field.measured && !resizeField(field)) continue;

    // follow the palette the page is asking for
    const wanted = field.palette().map(parseColor);
    field.colors = field.colors.map((color, i) => mixColorObj(color, wanted[i % wanted.length], clamp(dt * 1.6, 0, 1)));

    field.time += dt;
    if (field.pointer) {
      field.pointer.x = lerp(field.pointer.x, field.pointer.tx, clamp(dt * 2.4, 0, 1));
      field.pointer.y = lerp(field.pointer.y, field.pointer.ty, clamp(dt * 2.4, 0, 1));
    }
    field.draw(dt);
    if (reducedMotion()) field.visible = false; // one frame is enough
  }
}

function mixColorObj(a, b, t) {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
    a: lerp(a.a ?? 1, b.a ?? 1, t),
  };
}

function drawField(dt, force = false) {
  const { ctx, width, height, colors, seeds, time, intensity } = this;
  if (!width || !height) return;

  const base = colors[0] || { r: 19, g: 37, b: 28, a: 1 };
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(${base.r}, ${base.g}, ${base.b}, 1)`;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = 'lighter';
  seeds.forEach((seed, i) => {
    const color = colors[(i + 1) % colors.length] || base;
    const angle = time * seed.speed + seed.phase;
    const px = (0.5 + Math.cos(angle) * seed.orbit) * width;
    const py = (0.5 + Math.sin(angle * 0.85) * seed.orbit * 1.25) * height;

    let ox = 0;
    let oy = 0;
    if (this.pointer) {
      ox = (this.pointer.x - 0.5) * width * 0.16 * (i % 2 ? -1 : 1);
      oy = (this.pointer.y - 0.5) * height * 0.12 * (i % 2 ? -1 : 1);
    }

    const radius = Math.max(width, height) * seed.radius * 0.6;
    const alpha = (i === colors.length - 1 ? intensity * 0.22 : intensity * 0.5) * (color.a ?? 1);
    const gradient = ctx.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, radius);
    gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`);
    gradient.addColorStop(0.55, `rgba(${color.r}, ${color.g}, ${color.b}, ${(alpha * 0.28).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  });

  // a slow horizontal light streak — the only overtly "racing" gesture
  if (intensity > 0.6) {
    const spark = colors[colors.length - 1] || base;
    const sweep = ((time * 0.06) % 1.4) - 0.2;
    const y = sweep * height;
    const gradient = ctx.createLinearGradient(0, y - height * 0.08, 0, y + height * 0.08);
    gradient.addColorStop(0, `rgba(${spark.r}, ${spark.g}, ${spark.b}, 0)`);
    gradient.addColorStop(0.5, `rgba(${spark.r}, ${spark.g}, ${spark.b}, ${(intensity * 0.05).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${spark.r}, ${spark.g}, ${spark.b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y - height * 0.08, width, height * 0.16);
  }

  ctx.globalCompositeOperation = 'source-over';
}

/* ------------------------------------------------------------------ *
 * grain — cheap in CSS, expensive on canvas
 * ------------------------------------------------------------------ */

function injectGrain() {
  if (grainInjected) return;
  grainInjected = true;
  const layer = document.createElement('div');
  layer.className = 'ln-grain';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
}

export function refreshAmbient() {
  fields.forEach((field) => { field.measured = false; });
}
