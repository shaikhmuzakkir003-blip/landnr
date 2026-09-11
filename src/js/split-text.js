/**
 * split-text.js — the capture's `split-text="lines|chars|lines,chars"` engine.
 *
 * 70 elements ask for it and the page CSS is written around the result:
 * `[split-text] .line` is the reveal mask, `[split-text] .char` is the hover
 * unit, `[data-anim-high] .line` is the highlighted line. This re-implements
 * the classic SplitText algorithm in three batched phases (write → measure →
 * write) so the whole page costs a handful of reflows instead of seventy:
 *
 *   1. wrap every word in .word, leaving the original inline structure —
 *      <strong>, <span class="…"> — exactly where it was;
 *   2. read back where the browser actually wrapped the text;
 *   3. rebuild the element as .line > .ln-line-in, re-creating the original
 *      inline ancestors inside each line so styling survives, then break the
 *      words into .char spans when characters were requested.
 *
 * Whitespace text nodes are preserved verbatim while measuring, so wrapping is
 * identical to the un-split document and authored newlines (the site sets
 * `white-space: pre-line`, e.g. "mclaren f1\nsince 2019") still break lines.
 */

import { $$, count, debounce, isRendered, on, safe } from './utils.js';

const registry = new Map();
const pending = new Set();

export function initSplitText(root = document) {
  const targets = $$('[split-text]', root);
  const records = [];

  for (const el of targets) {
    if (registry.has(el)) continue;
    if (el.closest('[display-none], .display-none')) continue; // hidden by design, never revealed
    // Another engine (the restored OFF+BRAND bundle) may have split this
    // already. Adopt its result instead of nesting a second split inside it.
    if (el.querySelector('.line')) {
      registry.set(el, { el, modes: parseModes(el.getAttribute('split-text')), original: el.innerHTML,
        state: 'idle', atoms: [], groups: null, lines: el.querySelectorAll('.line').length, adopted: true });
      count('splitTextAdopted');
      continue;
    }

    const modes = parseModes(el.getAttribute('split-text'));
    const record = {
      el,
      modes,
      original: el.innerHTML,
      state: 'idle',
      atoms: [],
      groups: null,
      lines: 0,
    };
    registry.set(el, record);

    if (!modes.length) continue;
    if (isRendered(el)) records.push(record);
    else pending.add(record);
  }

  buildRecords(records);
  count('splitText', records.length);
  count('splitTextDeferred', pending.size);

  on(window, 'resize', debounce(() => resplit(), 260));
  return { split: records.length, deferred: pending.size };
}

/** Split elements that were hidden at boot (nav menu, hidden variants…). */
export function splitPending(scope = document) {
  if (!pending.size) return 0;
  const ready = [];
  for (const record of [...pending]) {
    if (scope !== document && !scope.contains(record.el)) continue;
    if (!isRendered(record.el)) continue;
    ready.push(record);
    pending.delete(record);
  }
  if (ready.length) buildRecords(ready);
  return ready.length;
}

export function resplit() {
  const ready = [];
  for (const record of registry.values()) {
    if (!record.modes.length) continue;
    if (!isRendered(record.el)) {
      pending.add(record);
      continue;
    }
    pending.delete(record);
    ready.push(record);
  }
  if (ready.length) buildRecords(ready);
}

export function markState(el, state) {
  const record = registry.get(el);
  if (record) record.state = state;
}

export function getState(el) {
  return registry.get(el)?.state || 'idle';
}

export function lineCount(el) {
  return registry.get(el)?.lines || 0;
}

/* ------------------------------------------------------------------ *
 * three-phase build
 * ------------------------------------------------------------------ */

function buildRecords(records) {
  if (!records.length) return;
  safe('split:wrap', () => records.forEach(wrap));
  safe('split:measure', () => records.forEach(measure));
  safe('split:rebuild', () => records.forEach(rebuild));
}

function parseModes(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s === 'lines' || s === 'chars');
}

/** Phase 1 — reset the markup and wrap words (writes only). */
function wrap(record) {
  const { el, modes, original } = record;
  el.innerHTML = original;
  el.classList.add('ln-split');
  el.classList.toggle('ln-chars', modes.includes('chars'));
  record.atoms = collectAtoms(el);
}

/** Phase 2 — read the browser's own line boxes (reads only). */
function measure(record) {
  if (!record.modes.includes('lines')) {
    record.groups = null;
    return;
  }
  record.groups = groupIntoLines(record.atoms);
}

/** Phase 3 — emit .line/.ln-line-in and, when asked for, .char spans. */
function rebuild(record) {
  const { el, modes, groups } = record;

  if (groups) {
    const frag = document.createDocumentFragment();
    groups.forEach((group, index) => frag.appendChild(renderLine(group, index)));
    el.innerHTML = '';
    el.appendChild(frag);
    record.lines = groups.length;
  }

  if (modes.includes('chars')) charSplit(el);

  el.classList.remove('ln-hidden', 'ln-in', 'ln-done');
  if (record.state !== 'idle') el.classList.add(`ln-${record.state}`);
}

/**
 * One document-order pass collecting text nodes and leaf elements, then
 * turning each word into a `.word` span. Order is implicit: the atoms are
 * pushed in traversal order, so no re-sorting (and no O(n²)) is needed.
 */
function collectAtoms(el) {
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) nodes.push({ kind: 'text', node });
    else if (isLeafElement(node)) nodes.push({ kind: 'leaf', node });
    node = walker.nextNode();
  }

  const atoms = [];
  for (const entry of nodes) {
    if (entry.kind === 'leaf') {
      const leaf = entry.node;
      if (!leaf.isConnected) continue;
      atoms.push({ node: leaf, path: pathOf(leaf.parentElement, el), spaceBefore: false });
      continue;
    }

    const textNode = entry.node;
    const parent = textNode.parentNode;
    if (!parent) continue;
    const path = pathOf(parent, el);
    const frag = document.createDocumentFragment();
    const re = /(\s+)|(\S+)/g;
    let spaceBefore = false;
    let match;
    while ((match = re.exec(textNode.nodeValue)) !== null) {
      if (match[1]) {
        spaceBefore = true;
        frag.appendChild(document.createTextNode(match[1]));
        continue;
      }
      const word = document.createElement('span');
      word.className = 'word';
      word.textContent = match[2];
      frag.appendChild(word);
      atoms.push({ node: word, path, spaceBefore });
      spaceBefore = false;
    }
    parent.replaceChild(frag, textNode);
  }
  return atoms;
}

function isLeafElement(node) {
  const tag = node.tagName?.toLowerCase();
  if (tag === 'br') return true;
  if (!tag || node.children.length) return false;
  return ['img', 'svg', 'canvas', 'picture', 'video', 'iframe'].includes(tag);
}

function pathOf(parent, root) {
  const path = [];
  let current = parent;
  while (current && current !== root) {
    path.unshift(current);
    current = current.parentElement;
  }
  return path;
}

function groupIntoLines(atoms) {
  const groups = [];
  let current = null;
  let lastTop = null;

  for (const atom of atoms) {
    if (atom.node.tagName === 'BR') {
      current = null;
      lastTop = null;
      continue;
    }
    const rect = atom.node.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      if (current) current.atoms.push(atom); // invisible: keep the flow intact
      continue;
    }
    const top = Math.round(rect.top * 10) / 10;
    if (!current || lastTop === null || Math.abs(top - lastTop) > 2) {
      current = { atoms: [], top };
      groups.push(current);
    }
    current.atoms.push(atom);
    lastTop = top;
  }

  return groups.filter((group) => group.atoms.length);
}

function renderLine(group, index) {
  const line = document.createElement('span');
  line.className = 'line';
  line.style.setProperty('--ln-i', String(index));

  const inner = document.createElement('span');
  inner.className = 'ln-line-in';
  line.appendChild(inner);

  const stack = [];
  let target = inner;

  const sync = (path) => {
    let depth = 0;
    while (depth < stack.length && depth < path.length && stack[depth].source === path[depth]) depth++;
    while (stack.length > depth) {
      stack.pop();
      target = stack.length ? stack[stack.length - 1].clone : inner;
    }
    for (let i = stack.length; i < path.length; i++) {
      const clone = path[i].cloneNode(false);
      clone.removeAttribute('id');
      clone.removeAttribute('split-text');
      clone.removeAttribute('data-anim-high');
      clone.removeAttribute('data-oval-scroll');
      target.appendChild(clone);
      stack.push({ source: path[i], clone });
      target = clone;
    }
  };

  group.atoms.forEach((atom, i) => {
    sync(atom.path);
    if (i > 0 && atom.spaceBefore) target.appendChild(document.createTextNode(' '));
    target.appendChild(atom.node);
  });

  return line;
}

/** Turn every `.word` into `.char` spans (called after lines are built). */
export function charSplit(el) {
  const words = el.querySelectorAll('.word');
  words.forEach((word) => {
    if (word.querySelector('.char')) return;
    const text = word.textContent;
    if (!text) return;
    word.textContent = '';
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = ch;
      word.appendChild(span);
    }
  });
  indexChars(el);
}

function indexChars(el) {
  const lines = el.querySelectorAll('.line');
  if (lines.length) {
    lines.forEach((line) => {
      line.querySelectorAll('.char').forEach((char, i) => char.style.setProperty('--ln-i', String(i)));
    });
    return;
  }
  el.querySelectorAll('.char').forEach((char, i) => char.style.setProperty('--ln-i', String(i % 20)));
}
