/**
 * icons.js — the art the capture expects Rive to draw.
 *
 * The live site renders its arrow buttons, hamburger, helmet, signature and
 * circuit graphics from .riv files loaded by the OFF+BRAND bundle. That bundle
 * lives on a referrer-locked host, so this build ships static replacements:
 * hand-drawn SVG for the interface bits and the site's own published artwork
 * for everything else.
 */

export const CDN = 'https://cdn.prod.website-files.com/67b5a02dc5d338960b17a7e9';

export const ART = {
  lnLogo: `${CDN}/67f517cdc5bb460c3c3b8e5b_ln4-LN-logo-svg.svg`,
  signature: `${CDN}/67cecea4e9d311047dcb51e5_ln4-hw-signature2.svg`,
  flags: `${CDN}/680cbcfdbc4bdc0ef619369f_ln-icon-crossed-flags2.svg`,
  helmet: `${CDN}/67d43d6e276c436a378a1da6_ln-360-helm-1.webp`,
  helmetFlat: `${CDN}/67d18655b032045a4dc78e53_ln4-hp-lando-helmet.webp`,
  footerLogo: `${CDN}/67d33eb40292f3a5fef32ed3_ln4-footer-logo-add-c.svg`,
};

/** Button arrow — the `btn-ui / arrow` artboard. */
export function arrowSVG() {
  return `<svg class="ln-arrow-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6.5 17.5 17 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M8.6 7H17v8.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Nav hamburger — the `hamburger` artboard (morphs to a cross via CSS). */
export function burgerSVG() {
  return `<svg class="ln-burger" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect class="ln-b1" x="1" y="1" width="22" height="2" rx="1" fill="currentColor"/>
    <rect class="ln-b2" x="1" y="7" width="22" height="2" rx="1" fill="currentColor"/>
    <rect class="ln-b3" x="1" y="13" width="22" height="2" rx="1" fill="currentColor"/>
  </svg>`;
}

/**
 * Circuit map — the `circuits` artboard in the "Next Race" card.
 * Abstract on purpose: it stands in for whatever round is next.
 */
export function circuitSVG() {
  return `<svg class="ln-circuit" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path class="ln-track-base" d="M24 112C10 96 12 66 32 55c19-10 33 4 49 0 17-4 22-25 42-29 22-4 37 10 35 29-2 18-20 22-26 36-6 15 6 29 25 27 16-2 26-14 30-28"
      stroke="currentColor" stroke-opacity="0.28" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="ln-track-line" d="M24 112C10 96 12 66 32 55c19-10 33 4 49 0 17-4 22-25 42-29 22-4 37 10 35 29-2 18-20 22-26 36-6 15 6 29 25 27 16-2 26-14 30-28"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="24" cy="112" r="4.5" fill="currentColor"/>
    <path d="M18 122h13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/>
  </svg>`;
}

/** A helmet silhouette used where the capture has no placeholder art. */
export function helmetSVG() {
  return `<svg class="ln-helmet-svg" viewBox="0 0 97 50.1" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M48.5 2C22 2 3 16 3 30c0 8 6 14 16 17h58c9-3 17-9 17-17C94 16 75 2 48.5 2Zm0 4c23 0 40 12 40 24 0 5-5 9-12 11H22c-8-2-13-6-13-11C9 18 25 6 48.5 6Z"
      fill="currentColor" fill-opacity="0.9"/>
    <path d="M20 26c8-6 20-9 32-8 9 1 17 4 23 9-9 3-19 5-29 5-10 0-19-2-26-6Z" fill="currentColor" fill-opacity="0.35"/>
  </svg>`;
}

/** Small "LN" monogram, used by the preloader. */
export function monogramSVG() {
  return `<svg viewBox="0 0 120 60" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6 54V6h9v39h22v9H6Z" fill="currentColor"/>
    <path d="M47 54V6h8l20 30V6h9v48h-8L56 24v30h-9Z" fill="currentColor"/>
    <circle cx="103" cy="14" r="7" fill="currentColor" fill-opacity="0.55"/>
  </svg>`;
}

/** An <img> tag for one of the site's own published assets. */
export function assetImage(src, alt = '', className = 'ln-rive-fallback') {
  return `<img class="${className}" src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
}
