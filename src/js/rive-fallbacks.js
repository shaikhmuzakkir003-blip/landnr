/**
 * rive-fallbacks.js — replace every <canvas data-rive-*> with static art.
 *
 * The capture mounts 17 Rive canvases. Their .riv files are delivered by the
 * referrer-locked OFF+BRAND bundle, so none of them can run here. Where the
 * designers left a `data-rive-placeholder` (they did for the helmet and the
 * footer signature) we simply reveal it; everywhere else we inject SVG from
 * icons.js. Layout never changes: the mount keeps its box, the art fills it.
 */

import { $$, count, isRendered, note } from './utils.js';
import { ART, arrowSVG, assetImage, burgerSVG, circuitSVG, helmetSVG, monogramSVG } from './icons.js';

const CANVAS_SELECTOR = [
  'canvas[data-rive-object]',
  'canvas[data-rive-primary]',
  'canvas[data-rive-ln4]',
  'canvas[data-rive-nav-object]',
  'canvas[data-rive-nav-hamburger]',
  'canvas[data-rive-mob-landscape]',
  'canvas[data-rive-nav-hamburger]',
].join(',');

export function initRiveFallbacks(root = document) {
  const canvases = $$(CANVAS_SELECTOR, root);
  let replaced = 0;
  let revealed = 0;

  for (const canvas of canvases) {
    const mount = canvas.parentElement;
    if (!mount) continue;

    // 1 · the designers shipped a placeholder next to this canvas
    if (hasPlaceholder(canvas)) {
      mount.classList.add('ln-canvas-hidden');
      canvas.remove();
      revealed++;
      continue;
    }

    const art = artFor(canvas);
    if (!art) {
      canvas.remove();
      continue;
    }
    canvas.insertAdjacentHTML('afterend', art);
    canvas.remove();
    replaced++;
  }

  count('riveReplaced', replaced);
  count('rivePlaceholders', revealed);
  if (replaced || revealed) {
    note(`rive fallbacks: ${replaced} drawn, ${revealed} placeholders revealed`);
  }
  return { replaced, revealed };
}

/** A placeholder is a sibling (or cousin) carrying data-rive-placeholder. */
function hasPlaceholder(canvas) {
  const mount = canvas.parentElement;
  const scope = mount?.parentElement || mount;
  if (!scope) return false;
  const placeholder = scope.querySelector('[data-rive-placeholder]');
  if (!placeholder || placeholder === canvas) return false;
  // only trust it when it actually holds art
  return Boolean(placeholder.querySelector('svg, img') || placeholder.tagName === 'IMG' || placeholder.tagName === 'SVG');
}

function artFor(canvas) {
  const file = canvas.dataset.riveFile || '';
  const artboard = canvas.dataset.riveArtboard || '';

  if (canvas.hasAttribute('data-rive-nav-hamburger')) return burgerSVG();
  if (canvas.hasAttribute('data-rive-ln4')) return assetImage(ART.lnLogo, 'LN', 'ln-nav-wordmark');
  if (canvas.hasAttribute('data-rive-primary')) return `<div class="ln-preloader-art">${monogramSVG()}</div>`;
  if (canvas.hasAttribute('data-rive-mob-landscape')) return '';

  if (file === 'btn-ui' || artboard === 'arrow') return arrowSVG();
  if (file === 'circuits' || artboard === 'circuits') return circuitSVG();
  if (file === 'signature' || artboard === 'signature') return assetImage(ART.signature, "Lando's signature");
  if (file === 'reef') return helmetSVG();
  if (file === 'phrases') return assetImage(ART.flags, '');

  return '';
}

/** The preloader builds its own art; keep this here so it stays in one place. */
export function preloaderArt() {
  return monogramSVG();
}

export { isRendered };
