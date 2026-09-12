#!/usr/bin/env node
/**
 * test-hero-key.mjs — unit test for the portrait backdrop keying.
 *
 *   node scripts/dev/test-hero-key.mjs
 *
 * The keying runs in the browser, where there is no test runner, and it is
 * exactly the kind of code that fails invisibly (a hole punched through a
 * white sleeve looks fine in a smoke test that never renders a pixel). So
 * this harness installs the DOM shim, swaps in a pixel-backed 2D context, and
 * runs the real keyOutBackground() against a synthetic studio portrait:
 *
 *   · flat light-grey backdrop, connected to every border
 *   · a dark figure in the middle
 *   · an enclosed white disc  (eye-whites / teeth — same colour as the
 *     backdrop, but not connected to it)
 *   · a white sleeve that touches the bottom border, fenced off from the
 *     backdrop by a one-pixel dark outline
 *
 * The key must remove the backdrop and only the backdrop.
 */

import { createDOM } from './dom-shim.mjs';

createDOM('<!doctype html><html><head></head><body></body></html>');

/* ------------------------------------------------------------------ *
 * a 2D context that actually holds pixels
 * ------------------------------------------------------------------ */

function pixelContext(canvas) {
  let buf = new Uint8ClampedArray(0);
  let w = 0;
  let h = 0;
  const ensure = () => {
    if (canvas.width * canvas.height !== w * h) {
      w = canvas.width;
      h = canvas.height;
      buf = new Uint8ClampedArray(w * h * 4);
    }
  };
  return {
    canvas,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    drawImage(img, _dx, _dy, dw, dh) {
      canvas.width = dw;
      canvas.height = dh;
      ensure();
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const sx = Math.min(img.naturalWidth - 1, Math.floor((x / dw) * img.naturalWidth));
          const sy = Math.min(img.naturalHeight - 1, Math.floor((y / dh) * img.naturalHeight));
          const si = (sy * img.naturalWidth + sx) * 4;
          const di = (y * dw + x) * 4;
          buf[di] = img.data[si];
          buf[di + 1] = img.data[si + 1];
          buf[di + 2] = img.data[si + 2];
          buf[di + 3] = img.data[si + 3];
        }
      }
    },
    getImageData(x, y, gw, gh) {
      ensure();
      const data = new Uint8ClampedArray(gw * gh * 4);
      for (let yy = 0; yy < gh; yy++) {
        for (let xx = 0; xx < gw; xx++) {
          const si = ((y + yy) * w + (x + xx)) * 4;
          const di = (yy * gw + xx) * 4;
          data[di] = buf[si];
          data[di + 1] = buf[si + 1];
          data[di + 2] = buf[si + 2];
          data[di + 3] = buf[si + 3];
        }
      }
      return { data, width: gw, height: gh };
    },
    putImageData(image) {
      ensure();
      buf.set(image.data.subarray(0, buf.length));
    },
    _buf: () => buf,
  };
}

const realCreate = document.createElement.bind(document);
document.createElement = (tag) => {
  const node = realCreate(tag);
  if (String(tag).toLowerCase() === 'canvas') {
    // a real canvas hands back the SAME context every time; the keying writes
    // through it and this test has to read back through it
    node.getContext = (kind) => {
      if (kind !== '2d') return null;
      node._ctx ||= pixelContext(node);
      return node._ctx;
    };
  }
  return node;
};

/* ------------------------------------------------------------------ *
 * the synthetic portrait
 * ------------------------------------------------------------------ */

const W = 60;
const H = 80;
const BG = [240, 240, 242];
const FIG = [24, 26, 22];
const WHITE = [248, 248, 250];
const data = new Uint8ClampedArray(W * H * 4);

const set = (x, y, c, a = 255) => {
  const i = (y * W + x) * 4;
  data[i] = c[0];
  data[i + 1] = c[1];
  data[i + 2] = c[2];
  data[i + 3] = a;
};

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, BG);

/* figure: a column down the middle, wider at the shoulders */
for (let y = 10; y < H; y++) {
  const half = y < 30 ? 8 : 16;
  for (let x = W / 2 - half; x < W / 2 + half; x++) set(x, y, FIG);
}
/* enclosed white disc (the eye-whites): same colour as the backdrop */
for (let y = 18; y <= 24; y++) {
  for (let x = 26; x <= 33; x++) {
    if ((x - 29.5) ** 2 + (y - 21) ** 2 <= 9) set(x, y, WHITE);
  }
}
/* white sleeve touching the bottom border, fenced by a dark outline */
for (let y = 60; y < H; y++) {
  for (let x = 16; x <= 24; x++) set(x, y, x === 16 || x === 24 || y === 60 ? FIG : WHITE);
}

const img = { naturalWidth: W, naturalHeight: H, data };

/* ------------------------------------------------------------------ *
 * run it
 * ------------------------------------------------------------------ */

const { keyOutBackground } = await import('../../src/js/hero-ash.js');
const { canvas, keyed } = keyOutBackground(img);
const ctx = canvas.getContext('2d');
const out = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
const cw = canvas.width;
const alpha = (x, y) => out[(y * cw + x) * 4 + 3];

const checks = [];
const expect = (name, actual, want) => checks.push([name, actual, want, actual === want]);

expect('reported as keyed', keyed, true);
expect('top-left backdrop gone', alpha(0, 0) < 40, true);
expect('top-right backdrop gone', alpha(cw - 1, 0) < 40, true);
expect('mid-left backdrop gone', alpha(0, 40) < 40, true);
expect('figure body kept', alpha(30, 50) > 200, true);
expect('enclosed white disc kept', alpha(29, 21) > 200, true);
expect('sleeve interior kept', alpha(20, 72) > 200, true);
expect('sleeve outline kept', alpha(16, 72) > 200, true);

/* the cut edge must be soft, not a hard 255→0 step */
let soft = 0;
for (let y = 12; y < 60; y++) {
  for (let x = 10; x < 50; x++) {
    const a = alpha(x, y);
    if (a > 20 && a < 235) soft++;
  }
}
checks.push(['feathered edge pixels exist', soft > 0, true, soft > 0]);

/* scenario two: the same portrait on a vignetted sweep — the backdrop darkens
   by five levels towards the corners, which a step-limited fill must still
   clear end to end */
const vig = new Uint8ClampedArray(data);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const isFig = data[(y * W + x) * 4] !== BG[0] || data[(y * W + x) * 4 + 2] !== BG[2];
    if (isFig) continue;
    const t = Math.hypot(x - W / 2, y - H / 2) / Math.hypot(W / 2, H / 2);
    const drop = Math.round(t * 5);
    const i = (y * W + x) * 4;
    vig[i] -= drop;
    vig[i + 1] -= drop;
    vig[i + 2] -= drop;
  }
}
const vigOut = keyOutBackground({ naturalWidth: W, naturalHeight: H, data: vig });
const vctx = vigOut.canvas.getContext('2d');
const vdata = vctx.getImageData(0, 0, vigOut.canvas.width, vigOut.canvas.height).data;
const vAlpha = (x, y) => vdata[(y * vigOut.canvas.width + x) * 4 + 3];
checks.push(['vignette: corner cleared', vAlpha(1, 1) < 40, true, vAlpha(1, 1) < 40]);
checks.push(['vignette: mid-edge cleared', vAlpha(0, 40) < 40, true, vAlpha(0, 40) < 40]);
checks.push(['vignette: figure kept', vAlpha(30, 50) > 200, true, vAlpha(30, 50) > 200]);
checks.push(['vignette: sleeve kept', vAlpha(20, 72) > 200, true, vAlpha(20, 72) > 200]);

let failed = 0;
console.log('\nkey-out · synthetic studio portrait\n');
for (const [name, actual, want, ok] of checks) {
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(30)} ${actual}${ok ? '' : ` (wanted ${want})`}`);
}
console.log(failed ? `\n✖ ${failed} check(s) failed\n` : '\n✓ the backdrop goes and only the backdrop goes\n');
process.exit(failed ? 1 : 0);
