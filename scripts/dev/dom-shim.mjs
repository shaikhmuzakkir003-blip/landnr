/**
 * dom-shim.mjs — a just-enough DOM for running the browser engine in Node.
 *
 * The sandbox has no browser and no npm, so `npm run smoke` boots
 * `src/js/engine.js` against the *built* HTML using this shim. It is not a
 * browser: it implements the slice of DOM the engine actually touches
 * (see the API list at the bottom of `createDOM`) plus a fake layout pass, so
 * selectors, class juggling, split-text measurement and the frame loop can be
 * exercised end to end. Anything the engine asks for that is missing throws —
 * which is the point: a missing API here is a browser API the engine assumes.
 *
 * The layout model is a simple inline-flow approximation: block elements start
 * a new line, inline boxes advance a cursor and wrap at `viewport.width`, text
 * is measured at ~8.6px per character. That is enough for split-text's line
 * grouping and for the scroll-progress maths to produce believable numbers.
 */

import { parse, fragment as parseFragment, VOID_ELEMENTS, RAW_TEXT_ELEMENTS } from '../lib/html.mjs';

/* html.mjs keeps attributes as [{name, value}] (so the build can round-trip
   them exactly); the DOM wants a plain map, so the shim normalises on the way
   in and serialises on the way out. */
function normalizeAttrs(attrs) {
  if (!Array.isArray(attrs)) return attrs || {};
  const out = {};
  for (const entry of attrs) {
    if (!entry || !entry.name) continue;
    const name = String(entry.name).toLowerCase();
    if (!(name in out)) out[name] = entry.value === undefined || entry.value === null ? '' : String(entry.value);
  }
  return out;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function shimSerialize(nodes) {
  let out = '';
  for (const node of nodes || []) {
    if (node.type === 'text') { out += node.value ?? ''; continue; }
    if (node.type === 'rawtext') { out += node.value ?? ''; continue; }
    if (node.type === 'comment') { out += `<!--${node.value ?? ''}-->`; continue; }
    if (node.type !== 'element') continue;
    const attrs = Object.entries(node.attrs || {})
      .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`))
      .join('');
    out += `<${node.tag}${attrs}>`;
    if (VOID_ELEMENTS.has(node.tag)) continue;
    out += shimSerialize(node._kids || []);
    out += `</${node.tag}>`;
  }
  return out;
}

const BLOCK_TAGS = new Set([
  'html', 'body', 'div', 'section', 'main', 'header', 'footer', 'nav', 'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'figure', 'figcaption',
  'article', 'aside', 'form', 'blockquote', 'pre', 'table', 'tr', 'td', 'th',
  'dl', 'dt', 'dd', 'fieldset', 'details', 'summary', 'picture', 'source',
]);

const CHAR_WIDTH = 8.6;
const LINE_HEIGHT = 26;
const BLOCK_GAP = 4;

/* ------------------------------------------------------------------ *
 * selection
 * ------------------------------------------------------------------ */

function parseSimple(text) {
  const out = { tag: null, id: null, classes: [], attrs: [], pseudo: [] };
  const re = /([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([^\]]+)\]|:([\w-]+)(\(([^)]*)\))?/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) out.tag = m[1] === '*' ? null : m[1].toLowerCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) out.attrs.push(parseAttr(m[4]));
    else if (m[5]) out.pseudo.push({ name: m[5], arg: m[7] });
  }
  return out;
}

function parseAttr(text) {
  const m = /^([\w-]+)\s*(\^=|\$=|\*=|~=|\|=|=)?\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))?$/.exec(text.trim());
  if (!m) return { name: text.trim(), op: null, value: null };
  return {
    name: m[1],
    op: m[2] || null,
    value: m[3] ?? m[4] ?? m[5] ?? null,
  };
}

function attrMatches(node, { name, op, value }) {
  const actual = node.attrs[name];
  const present = actual !== undefined && actual !== null;
  if (!op) return present || actual === '';
  if (!present) return false;
  const haystack = String(actual ?? '');
  switch (op) {
    case '=': return haystack === value;
    case '^=': return haystack.startsWith(value);
    case '$=': return haystack.endsWith(value);
    case '*=': return haystack.includes(value);
    case '~=': return haystack.split(/\s+/).includes(value);
    case '|=': return haystack === value || haystack.startsWith(`${value}-`);
    default: return present;
  }
}

function matchSimple(node, sel) {
  if (node.type !== 'element') return false;
  if (sel.tag && node.tag !== sel.tag) return false;
  if (sel.id && node.attrs.id !== sel.id) return false;
  const classes = (node.attrs.class || '').split(/\s+/).filter(Boolean);
  for (const c of sel.classes) if (!classes.includes(c)) return false;
  for (const a of sel.attrs) if (!attrMatches(node, a)) return false;
  for (const p of sel.pseudo) {
    if (p.name === 'not') {
      const inner = splitGroups(p.arg || '').map(parseCompound);
      if (inner.some((group) => matchCompound(node, group))) return false;
      continue;
    }
    if (p.name === 'first-child') {
      const siblings = elementsOf(node.parentNode);
      if (siblings[0] !== node) return false;
      continue;
    }
    if (p.name === 'last-child') {
      const siblings = elementsOf(node.parentNode);
      if (siblings[siblings.length - 1] !== node) return false;
      continue;
    }
    // hover/focus/active etc. never match in a static tree
    return false;
  }
  return true;
}

function matchCompound(node, parts) {
  return parts.every((p) => matchSimple(node, p));
}

function parseCompound(group) {
  // returns [{combinator, parts}]
  const tokens = group.trim().split(/\s*(>)\s*|\s+/).filter((t) => t !== undefined && t !== '');
  const out = [];
  let combinator = 'descendant';
  for (const token of tokens) {
    if (token === '>') { combinator = 'child'; continue; }
    const parts = token.match(/(?:[a-zA-Z*][\w-]*)?(?:#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?)*/g)
      .filter(Boolean);
    const parsed = (parts.length ? parts : [token]).map(parseSimple);
    out.push({ combinator: out.length ? combinator : 'descendant', parts: parsed });
    combinator = 'descendant';
  }
  return out;
}

function splitGroups(selector) {
  const groups = [];
  let depth = 0;
  let current = '';
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { groups.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) groups.push(current);
  return groups.map((g) => g.trim()).filter(Boolean);
}

function selectAll(scope, selector) {
  const results = new Set();
  for (const group of splitGroups(selector)) {
    const chain = parseCompound(group);
    if (!chain.length) continue;
    const last = chain[chain.length - 1];
    for (const node of descendants(scope)) {
      if (!matchCompound(node, last.parts)) continue;
      if (matchesChain(node, chain.slice(0, -1), scope)) results.add(node);
    }
  }
  return [...results];
}

function matchesChain(node, chain, scope) {
  let current = node;
  for (let i = chain.length - 1; i >= 0; i--) {
    const step = chain[i];
    if (step.combinator === 'child') {
      current = current.parentNode;
      if (!current || current === scope && i > 0) return false;
      if (!current || !matchCompound(current, step.parts)) return false;
    } else {
      let found = null;
      let ancestor = current.parentNode;
      while (ancestor && ancestor !== scope.parentNode) {
        if (matchCompound(ancestor, step.parts)) { found = ancestor; break; }
        ancestor = ancestor.parentNode;
      }
      if (!found) return false;
      current = found;
    }
  }
  return true;
}

function elementsOf(node) {
  return (node?.children || []).filter((c) => c.type === 'element');
}

function* descendants(node) {
  for (const child of node.children || []) {
    if (child.type === 'element') {
      yield child;
      yield* descendants(child);
    }
  }
}

/* ------------------------------------------------------------------ *
 * layout
 * ------------------------------------------------------------------ */

function createLayout(doc, viewport, state) {
  const rects = new Map();
  let dirty = true;

  const invalidate = () => { dirty = true; };

  // The shim has no stylesheet, so the two things CSS would decide — which
  // containers are horizontal flex rows, and how wide their items are — are
  // declared here instead. Without this the pinned horizontal section measures
  // exactly one viewport wide and switches itself off.
  const rows = new Set(viewport.rowClasses || ['horizontal-track']);
  const rowItemWidth = viewport.rowItemWidth ?? Math.round(viewport.width * 0.8);
  const isRow = (node) => (node.attrs?.class || '').split(/\s+/).some((c) => rows.has(c));

  const displayOf = (node) => {
    const inline = node.style?.display;
    if (inline === 'none') return 'none';
    if (inline === 'block' || inline === 'flex' || inline === 'grid') return inline;
    if (inline === 'inline' || inline === 'inline-block') return inline;
    return BLOCK_TAGS.has(node.tag) ? 'block' : 'inline';
  };

  function relayout() {
    rects.clear();
    const flow = { x: 0, y: 0, origin: 0, limit: viewport.width };
    walk(doc.body || doc.documentElement, flow);
    dirty = false;
  }

  function walk(node, flow) {
    const display = displayOf(node);
    if (display === 'none') {
      rects.set(node, box(0, 0, 0, 0));
      for (const child of node.children) if (child.type === 'element') walk(child, { x: 0, y: 0 });
      return box(0, 0, 0, 0);
    }

    const origin = flow.origin ?? 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hasContent = false;

    if (isRow(node)) return walkRow(node, flow);

    if (display === 'block' || display === 'flex' || display === 'grid') {
      flow.x = origin;
    }

    for (const child of node.children) {
      if (child.type === 'text' || child.type === 'rawtext') {
        const r = layoutText(child.value, flow, child.type === 'rawtext');
        if (r.width || r.height) { hasContent = true; minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); }
        rects.set(child, r);
        continue;
      }
      if (child.type === 'comment') continue;
      const r = walk(child, flow);
      if (r.width || r.height) { hasContent = true; minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); }
    }

    const isBlockish = display === 'block' || display === 'flex' || display === 'grid';
    let rect;
    if (hasContent && isBlockish) {
      // CSS block boxes fill their containing block; content that overflows
      // (the 14 000px horizontal track) does not widen them. Getting this
      // right is what makes clientWidth vs scrollWidth mean anything.
      const available = Math.max(0, (flow.limit ?? viewport.width) - origin);
      rect = box(origin, minY, available, maxY - minY);
    } else if (hasContent) {
      rect = box(minX, minY, maxX - minX, maxY - minY);
    } else if (isBlockish) {
      rect = box(origin, flow.y, Math.max(0, (flow.limit ?? viewport.width) - origin), LINE_HEIGHT);
      flow.y += LINE_HEIGHT + BLOCK_GAP;
    } else {
      rect = box(flow.x, flow.y, 0, LINE_HEIGHT);
    }

    rects.set(node, rect);

    if (isBlockish) {
      flow.x = origin;
      flow.y = Math.max(flow.y, rect.bottom + BLOCK_GAP);
    }
    return rect;
  }

  /** A declared flex row: children sit side by side, each `rowItemWidth` wide. */
  function walkRow(node, flow) {
    const origin = flow.origin ?? 0;
    let x = Math.max(flow.x, origin);
    const top = flow.y;
    let bottom = top;
    for (const child of node._kids || []) {
      if (child.type !== 'element') continue;
      const childFlow = { x, y: top, origin: x, limit: x + rowItemWidth };
      const r = walk(child, childFlow);
      const width = Math.max(r.width, rowItemWidth);
      const rect = box(x, top, width, Math.max(r.height, LINE_HEIGHT));
      rects.set(child, rect);
      x += width + 24;
      bottom = Math.max(bottom, childFlow.y, rect.bottom);
    }
    const rect = box(origin, top, Math.max(0, x - 24 - origin), bottom - top);
    rects.set(node, rect);
    flow.x = x;
    flow.y = bottom + BLOCK_GAP;
    return rect;
  }

  function layoutText(value, flow, hidden) {
    if (hidden || !value || !value.trim()) return box(flow.x, flow.y, 0, 0);
    // collapse the way a browser does, but keep authored newlines as breaks
    let x = flow.x;
    let y = flow.y;
    let minX = x;
    let minY = y;
    let maxX = x;
    let maxY = y + LINE_HEIGHT;
    for (const chunk of value.split(/(\s+)/)) {
      if (!chunk) continue;
      if (/^\s+$/.test(chunk)) {
        if (chunk.includes('\n')) { x = 0; y += LINE_HEIGHT; minY = Math.min(minY, y); maxY = y + LINE_HEIGHT; minX = 0; }
        else x += CHAR_WIDTH * 0.45;
        continue;
      }
      const w = chunk.length * CHAR_WIDTH;
      const limit = flow.limit ?? viewport.width;
      if (x + w > limit && x > (flow.origin ?? 0)) { x = flow.origin ?? 0; y += LINE_HEIGHT; minY = Math.min(minY, y); maxY = y + LINE_HEIGHT; }
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + w);
      x += w;
    }
    flow.x = x;
    flow.y = y;
    return box(minX, minY, Math.max(0, maxX - minX), Math.max(LINE_HEIGHT, maxY - minY));
  }

  return {
    invalidate,
    rect(node) {
      if (dirty) relayout();
      const r = rects.get(node);
      if (!r) return box(0, 0, 0, 0);
      // getBoundingClientRect is viewport-relative: document space minus scroll
      return state.fixed.has(node) ? r : box(r.left, r.top - state.scrollY(), r.width, r.height);
    },
    get height() {
      if (dirty) relayout();
      let max = 0;
      for (const r of rects.values()) max = Math.max(max, r.bottom);
      return max;
    },
  };
}

function box(left, top, width, height) {
  return {
    x: left, y: top, left, top, width, height,
    right: left + width, bottom: top + height,
    toJSON() { return { left, top, width, height }; },
  };
}

/* ------------------------------------------------------------------ *
 * the DOM itself
 * ------------------------------------------------------------------ */

export function createDOM(html, options = {}) {
  const viewport = {
    width: options.width ?? 1440,
    height: options.height ?? 900,
    touch: options.touch ?? false,
    reducedMotion: options.reducedMotion ?? false,
  };

  const { root } = parse(html);
  const listeners = new Map();
  const rafQueue = [];
  const ioCallbacks = [];
  let clock = 0;

  const doc = {
    type: 'document',
    nodeType: 9,
    children: root.children,
    attrs: {},
    tagName: '#document',
    nodeName: '#document',
    readyState: 'complete',
    hidden: false,
    title: 'Lando Norris',
    fonts: { ready: Promise.resolve(), status: 'loaded' },
    location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
  };
  doc.childNodes = doc.children;
  doc.parentNode = null;
  doc.parentElement = null;

  // `position: fixed` elements the published CSS pins (nav, preloader,
  // scroll indicator, GL wash) — they do not move when the page scrolls.
  const fixed = new Set();
  const state = { scrollY: () => window.scrollY || 0, fixed };
  const layout = createLayout(doc, viewport, state);

  /* ---------------- node enhancement ---------------- */

  function enhance(node, parent) {
    // Nodes get re-parented constantly (appendChild, replaceChild, fragments).
    // Enhancing twice would rebuild `_kids` from the `children` getter, which
    // only holds elements — every text node would vanish. So: enhance once.
    if (node._enhanced) {
      node.parentNode = parent || null;
      node.parentElement = parent && parent.type === 'element' ? parent : null;
      return node;
    }
    node._enhanced = true;
    node.parentNode = parent || null;
    node.parentElement = parent && parent.type === 'element' ? parent : null;
    node.ownerDocument = doc;

    if (node.type === 'text' || node.type === 'rawtext') {
      node.nodeType = 3;
      node.nodeName = '#text';
      node.tagName = undefined;
      Object.defineProperty(node, 'nodeValue', {
        get: () => node.value,
        set: (v) => { node.value = String(v); layout.invalidate(); },
        configurable: true,
      });
      Object.defineProperty(node, 'data', { get: () => node.value, configurable: true });
      Object.defineProperty(node, 'textContent', {
        get: () => node.value,
        set: (v) => { node.value = String(v); layout.invalidate(); },
        configurable: true,
      });
      Object.defineProperty(node, 'children', { get: () => [], configurable: true });
      Object.defineProperty(node, 'childNodes', { get: () => [], configurable: true });
      Object.defineProperty(node, 'isConnected', { get: () => isConnected(node), configurable: true });
      node.parentNode = parent;
      node.parentElement = parent?.type === 'element' ? parent : null;
      node.cloneNode = () => { const c = { type: node.type, value: node.value }; enhance(c, null); return c; };
      node.remove = () => removeChild(parent, node);
      return node;
    }

    if (node.type === 'comment') {
      node.nodeType = 8;
      node.nodeName = '#comment';
      Object.defineProperty(node, 'children', { get: () => [], configurable: true });
      Object.defineProperty(node, 'childNodes', { get: () => [], configurable: true });
      node.remove = () => removeChild(parent, node);
      return node;
    }

    node.nodeType = 1;
    node.nodeName = node.tagName = (node.tag || 'div').toUpperCase();
    node.attrs = normalizeAttrs(node.attrs);

    // the raw child array (elements + text + comments) lives on `_kids`;
    // `children` and `childNodes` become DOM-correct views over it
    const kids = node.children || [];
    Object.defineProperty(node, '_kids', { value: kids, writable: true, configurable: true });
    Object.defineProperty(node, 'childNodes', { get: () => kids, configurable: true });
    Object.defineProperty(node, 'children', {
      get: () => kids.filter((c) => c.type === 'element'),
      set(list) { kids.length = 0; kids.push(...list); },
      configurable: true,
    });

    for (const child of kids) enhance(child, node);

    Object.defineProperty(node, 'isConnected', { get: () => isConnected(node), configurable: true });
    Object.defineProperty(node, 'firstElementChild', { get: () => node.children[0] || null, configurable: true });
    Object.defineProperty(node, 'lastElementChild', { get: () => node.children[node.children.length - 1] || null, configurable: true });
    Object.defineProperty(node, 'firstChild', { get: () => node._kids[0] || null, configurable: true });
    Object.defineProperty(node, 'nextSibling', { get: () => siblingOf(node, 1), configurable: true });
    Object.defineProperty(node, 'previousSibling', { get: () => siblingOf(node, -1), configurable: true });
    Object.defineProperty(node, 'nextElementSibling', { get: () => elementSiblingOf(node, 1), configurable: true });
    Object.defineProperty(node, 'previousElementSibling', { get: () => elementSiblingOf(node, -1), configurable: true });
    Object.defineProperty(node, 'id', {
      get: () => node.attrs.id || '',
      set: (v) => { node.attrs.id = v; },
      configurable: true,
    });
    Object.defineProperty(node, 'className', {
      get: () => node.attrs.class || '',
      set: (v) => { node.attrs.class = String(v); },
      configurable: true,
    });
    Object.defineProperty(node, 'href', {
      get: () => node.attrs.href || '',
      set: (v) => { node.attrs.href = v; },
      configurable: true,
    });
    Object.defineProperty(node, 'src', {
      get: () => node.attrs.src || '',
      set: (v) => { node.attrs.src = v; },
      configurable: true,
    });
    Object.defineProperty(node, 'alt', { get: () => node.attrs.alt || '', set: (v) => { node.attrs.alt = v; }, configurable: true });

    node.classList = createClassList(node);
    node.style = createStyle(node, layout);
    node.dataset = createDataset(node);

    node.getAttribute = (name) => (name in node.attrs ? node.attrs[name] : null);
    node.setAttribute = (name, value) => { node.attrs[name] = String(value); layout.invalidate(); };
    node.hasAttribute = (name) => name in node.attrs;
    node.removeAttribute = (name) => { delete node.attrs[name]; layout.invalidate(); };
    node.toggleAttribute = (name, force) => {
      const want = force === undefined ? !(name in node.attrs) : Boolean(force);
      if (want) node.attrs[name] = '';
      else delete node.attrs[name];
      return want;
    };

    node.appendChild = (child) => appendNodes(node, [child]);
    node.append = (...kids) => appendNodes(node, kids);
    node.insertBefore = (child, ref) => {
      const list = node._kids;
      const index = ref ? list.indexOf(ref) : -1;
      const additions = flatten(child);
      if (index < 0) list.push(...additions);
      else list.splice(index, 0, ...additions);
      additions.forEach((n) => enhance(n, node));
      layout.invalidate();
      return child;
    };
    node.replaceChild = (fresh, old) => {
      const list = node._kids;
      const index = list.indexOf(old);
      const additions = flatten(fresh);
      if (index >= 0) list.splice(index, 1, ...additions);
      else list.push(...additions);
      additions.forEach((n) => enhance(n, node));
      old.parentNode = null;
      layout.invalidate();
      return old;
    };
    node.removeChild = (child) => removeChild(node, child);
    node.remove = () => removeChild(node.parentNode, node);
    node.contains = (other) => {
      let current = other;
      while (current) { if (current === node) return true; current = current.parentNode; }
      return false;
    };
    node.cloneNode = (deep = false) => {
      const copy = {
        type: node.type,
        tag: node.tag,
        rawTagName: node.rawTagName,
        attrs: { ...node.attrs },
        children: deep ? node._kids.map((c) => (c.cloneNode ? c.cloneNode(true) : { ...c })) : [],
      };
      if (node.selfClosed) copy.selfClosed = true;
      copy._enhanced = false;
      for (const child of copy.children) child._enhanced = false;
      return enhance(copy, null);
    };

    Object.defineProperty(node, 'innerHTML', {
      get: () => shimSerialize(node._kids),
      set: (value) => {
        if (node.tag === 'script' || node.tag === 'style') {
          node._kids.length = 0;
          node._kids.push(enhance({ type: 'rawtext', value: String(value) }, node));
          return;
        }
        const parsed = parseFragment(String(value)).map((n) => enhance(n, null));
        node._kids.length = 0;
        node._kids.push(...parsed);
        parsed.forEach((n) => enhance(n, node));
        layout.invalidate();
      },
      configurable: true,
    });
    Object.defineProperty(node, 'outerHTML', {
      get: () => shimSerialize([node]),
      configurable: true,
    });
    Object.defineProperty(node, 'textContent', {
      get: () => node._kids.map(textOf).join(''),
      set: (value) => {
        node._kids.length = 0;
        if (String(value) !== '') node._kids.push(enhance({ type: 'text', value: String(value) }, node));
        layout.invalidate();
      },
      configurable: true,
    });
    node.insertAdjacentHTML = (position, value) => {
      const nodes = parseFragment(String(value)).map((n) => enhance(n, null));
      if (position === 'beforeend') appendNodes(node, nodes);
      else if (position === 'afterbegin') node.insertBefore(nodes[0], node._kids[0]);
      else if (position === 'beforebegin') node.parentNode?.insertBefore(nodes[0], node);
      else if (position === 'afterend') node.parentNode?.insertBefore(nodes[0], node.nextSibling);
    };

    node.querySelector = (sel) => selectAll(node, sel)[0] || null;
    node.querySelectorAll = (sel) => selectAll(node, sel);
    node.getElementsByTagName = (tag) => [...descendants(node)].filter((n) => n.tag === tag.toLowerCase());
    node.getElementsByClassName = (name) => [...descendants(node)].filter((n) => (n.attrs.class || '').split(/\s+/).includes(name));
    node.matches = (sel) => matchSimpleChain(node, sel);
    node.closest = (sel) => {
      let current = node;
      while (current && current.type === 'element') {
        if (matchSimpleChain(current, sel)) return current;
        current = current.parentNode;
      }
      return null;
    };

    node.getBoundingClientRect = () => layout.rect(node);
    node.getClientRects = () => { const r = layout.rect(node); return r.width || r.height ? [r] : []; };
    node.checkVisibility = () => visibleChain(node);
    Object.defineProperty(node, 'offsetWidth', { get: () => Math.round(layout.rect(node).width), configurable: true });
    Object.defineProperty(node, 'offsetHeight', { get: () => Math.round(layout.rect(node).height), configurable: true });
    Object.defineProperty(node, 'offsetTop', { get: () => Math.round(layout.rect(node).top), configurable: true });
    Object.defineProperty(node, 'offsetLeft', { get: () => Math.round(layout.rect(node).left), configurable: true });
    Object.defineProperty(node, 'clientWidth', { get: () => Math.round(layout.rect(node).width), configurable: true });
    Object.defineProperty(node, 'clientHeight', { get: () => Math.round(layout.rect(node).height), configurable: true });
    Object.defineProperty(node, 'scrollWidth', {
      get() {
        let max = 0;
        for (const child of descendants(node)) max = Math.max(max, layout.rect(child).right);
        return Math.max(Math.round(max), Math.round(layout.rect(node).width));
      },
      configurable: true,
    });
    Object.defineProperty(node, 'scrollHeight', {
      get() {
        let max = 0;
        for (const child of descendants(node)) max = Math.max(max, layout.rect(child).bottom);
        return Math.max(Math.round(max), Math.round(layout.rect(node).height));
      },
      configurable: true,
    });
    node.scrollTop = 0;
    node.scrollLeft = 0;
    node.scrollTo = () => {};
    node.scrollIntoView = () => {};
    node.focus = () => { doc.activeElement = node; };
    node.blur = () => { doc.activeElement = null; };
    node.click = () => dispatch(node, 'click', {});
    node.setPointerCapture = () => {};
    node.releasePointerCapture = () => {};
    node.animate = () => ({ cancel() {}, finish() {}, onfinish: null });
    node.getAnimations = () => [];
    node.getContext = () => createContext2D(node);

    node.addEventListener = (type, handler) => {
      if (!listeners.has(node)) listeners.set(node, new Map());
      const map = listeners.get(node);
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(handler);
    };
    node.removeEventListener = (type, handler) => listeners.get(node)?.get(type)?.delete(handler);
    node.dispatchEvent = (event) => dispatch(node, event.type, event);

    return node;
  }

  /* ---------------- helpers ---------------- */

  function textOf(node) {
    if (node.type === 'text' || node.type === 'rawtext') return node.value || '';
    if (node.type === 'comment') return '';
    return (node._kids || node.children || []).map(textOf).join('');
  }

  function flatten(node) {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (node?.type === 'fragment') return node._kids.flatMap(flatten);
    return [node];
  }

  function appendNodes(parent, kids) {
    const additions = flatten(kids);
    parent._kids.push(...additions);
    additions.forEach((n) => enhance(n, parent));
    layout.invalidate();
    return additions[0] || null;
  }

  function removeChild(parent, child) {
    if (!parent) return child;
    const list = parent._kids || parent.children;
    const index = list.indexOf(child);
    if (index >= 0) list.splice(index, 1);
    child.parentNode = null;
    child.parentElement = null;
    layout.invalidate();
    return child;
  }

  function siblingOf(node, delta) {
    const list = node.parentNode?._kids || [];
    return list[list.indexOf(node) + delta] || null;
  }

  function elementSiblingOf(node, delta) {
    const list = node.parentNode?.children || [];
    return list[list.indexOf(node) + delta] || null;
  }

  function isConnected(node) {
    let current = node;
    while (current?.parentNode) current = current.parentNode;
    return current === doc || current === doc.documentElement;
  }

  function visibleChain(node) {
    let current = node;
    while (current && current.type === 'element') {
      if (current.style?.display === 'none' || current.style?.visibility === 'hidden') return false;
      current = current.parentNode;
    }
    return true;
  }

  function matchSimpleChain(node, selector) {
    return splitGroups(selector).some((group) => {
      const chain = parseCompound(group);
      const last = chain[chain.length - 1];
      return last && matchCompound(node, last.parts);
    });
  }

  function dispatch(target, type, init = {}) {
    const event = {
      type,
      target,
      currentTarget: target,
      bubbles: init.bubbles !== false,
      cancelable: true,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.propagationStopped = true; },
      ...init,
    };
    let node = target;
    while (node) {
      const handlers = listeners.get(node)?.get(type);
      if (handlers) for (const handler of [...handlers]) handler.call(node, event);
      if (event.propagationStopped || !event.bubbles) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }

  /* ---------------- class / style / dataset ---------------- */

  function createClassList(node) {
    const list = () => (node.attrs.class || '').split(/\s+/).filter(Boolean);
    const write = (next) => {
      const value = next.join(' ');
      if (value) node.attrs.class = value;
      else delete node.attrs.class;
    };
    return {
      get length() { return list().length; },
      get value() { return node.attrs.class || ''; },
      item: (i) => list()[i] ?? null,
      contains: (name) => list().includes(name),
      add: (...names) => { const next = list(); for (const n of names) if (n && !next.includes(n)) next.push(n); write(next); },
      remove: (...names) => write(list().filter((n) => !names.includes(n))),
      toggle: (name, force) => {
        const has = list().includes(name);
        const want = force === undefined ? !has : Boolean(force);
        if (want && !has) list().push(name);
        write(want ? [...new Set([...list(), name])] : list().filter((n) => n !== name));
        return want;
      },
      replace: (from, to) => write(list().map((n) => (n === from ? to : n))),
      forEach: (fn) => list().forEach(fn),
      [Symbol.iterator]: () => list()[Symbol.iterator](),
    };
  }

  function createStyle(node, layoutRef) {
    const props = new Map();
    const apply = () => layoutRef.invalidate();
    const style = {
      setProperty(name, value) { props.set(name, String(value)); apply(); },
      removeProperty(name) { props.delete(name); apply(); },
      getPropertyValue(name) { return props.get(name) ?? node.attrs.style?.match(new RegExp(`${name}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? ''; },
      get cssText() { return [...props].map(([k, v]) => `${k}: ${v};`).join(' '); },
      set cssText(value) {
        props.clear();
        for (const decl of String(value).split(';')) {
          const [k, ...rest] = decl.split(':');
          if (k && rest.length) props.set(k.trim(), rest.join(':').trim());
        }
        apply();
      },
    };
    for (const name of [
      'display', 'position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'opacity',
      'visibility', 'overflow', 'overflowX', 'overflowY', 'transform', 'translate', 'scale',
      'rotate', 'color', 'backgroundColor', 'clipPath', 'pointerEvents', 'zIndex', 'whiteSpace',
      'transition', 'willChange', 'flexWrap', 'transformOrigin', 'filter', 'mixBlendMode',
    ]) {
      const dashed = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      Object.defineProperty(style, name, {
        get: () => props.get(dashed) ?? '',
        set: (v) => { props.set(dashed, String(v)); apply(); },
        enumerable: true,
        configurable: true,
      });
    }
    // parse an authored style attribute once
    if (node.attrs.style) style.cssText = node.attrs.style;
    return style;
  }

  function createDataset(node) {
    const key = (name) => `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        const value = node.attrs[key(prop)];
        return value === undefined ? undefined : value;
      },
      set(_t, prop, value) { node.attrs[key(prop)] = String(value); return true; },
      has(_t, prop) { return key(prop) in node.attrs; },
      deleteProperty(_t, prop) { delete node.attrs[key(prop)]; return true; },
      ownKeys() {
        return Object.keys(node.attrs)
          .filter((a) => a.startsWith('data-'))
          .map((a) => a.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
      },
      getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
    });
  }

  function createContext2D(canvas) {
    const gradient = { addColorStop() {} };
    const noop = () => {};
    return {
      canvas,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#000',
      globalAlpha: 1,
      lineWidth: 1,
      font: '10px sans-serif',
      save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop,
      fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
      drawImage: noop, fillText: noop, strokeText: noop,
      setLineDash: noop, getLineDash: () => [],
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      createPattern: () => null,
      measureText: (text) => ({ width: String(text).length * CHAR_WIDTH }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
      putImageData: noop,
    };
  }

  /* ---------------- document ---------------- */

  doc.tag = '#document';
  enhance(doc, null);
  doc.nodeType = 9;
  doc.documentElement = [...descendants(doc)].find((n) => n.tag === 'html') || null;
  doc.head = doc.documentElement?.querySelector('head') || null;
  doc.body = doc.documentElement?.querySelector('body') || null;
  doc.activeElement = doc.body;

  // Elements the published stylesheet pins or hides. The shim cannot read that
  // stylesheet, so the harness declares the two facts the engine relies on:
  //   · the nav, preloader, scroll indicator and GL washes are position:fixed;
  //   · the nav menu is display:none until the burger opens it.
  for (const selector of options.fixed ?? ['[data-nav-wrap]', '.transition-w', '.scroll-indicator', '.gl-background', '.gl-wrap']) {
    for (const node of selectAll(doc, selector)) fixed.add(node);
  }
  for (const selector of options.hidden ?? ['[data-nav-m]']) {
    for (const node of selectAll(doc, selector)) node.style.display = 'none';
  }

  doc.createElement = (tag) => enhance({ type: 'element', tag: String(tag).toLowerCase(), attrs: {}, children: [] }, null);
  doc.createTextNode = (value) => enhance({ type: 'text', value: String(value) }, null);
  doc.createComment = (value) => enhance({ type: 'comment', value: String(value) }, null);
  doc.createDocumentFragment = () => {
    const frag = enhance({ type: 'element', tag: '#fragment', attrs: {}, children: [] }, null);
    frag.type = 'fragment';
    frag.nodeType = 11;
    return frag;
  };
  doc.querySelector = (sel) => selectAll(doc, sel)[0] || null;
  doc.querySelectorAll = (sel) => selectAll(doc, sel);
  doc.getElementById = (id) => [...descendants(doc)].find((n) => n.attrs.id === id) || null;
  doc.getElementsByTagName = (tag) => [...descendants(doc)].filter((n) => n.tag === String(tag).toLowerCase());
  doc.getElementsByClassName = (name) => [...descendants(doc)].filter((n) => (n.attrs.class || '').split(/\s+/).includes(name));
  Object.defineProperty(doc, 'images', {
    get: () => [...descendants(doc)].filter((n) => n.tag === 'img').map((img) => ({ ...img, complete: true })),
    configurable: true,
  });
  Object.defineProperty(doc, 'title', {
    get: () => doc.querySelector('title')?.textContent || '',
    set: (v) => { const t = doc.querySelector('title'); if (t) t.textContent = v; },
    configurable: true,
  });
  doc.createTreeWalker = (rootNode, whatToShow = -1) => createTreeWalker(rootNode, whatToShow);
  doc.addEventListener = (type, handler) => node_on(doc, type, handler);
  doc.removeEventListener = (type, handler) => listeners.get(doc)?.get(type)?.delete(handler);
  doc.dispatchEvent = (event) => dispatch(doc, event.type, event);
  doc.elementFromPoint = () => null;
  doc.exitFullscreen = () => Promise.resolve();

  function node_on(target, type, handler) {
    if (!listeners.has(target)) listeners.set(target, new Map());
    const map = listeners.get(target);
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(handler);
  }

  function createTreeWalker(rootNode, whatToShow) {
    const SHOW_ELEMENT = 1;
    const SHOW_TEXT = 4;
    const order = [];
    (function collect(node) {
      for (const child of node._kids || node.children || []) {
        const isText = child.type === 'text';
        const isElement = child.type === 'element';
        const wanted = (isText && (whatToShow & SHOW_TEXT)) || (isElement && (whatToShow & SHOW_ELEMENT));
        if (wanted) order.push(child);
        if (isElement) collect(child);
      }
    }(rootNode));
    let index = -1;
    return {
      currentNode: rootNode,
      nextNode() { index++; this.currentNode = order[index] || null; return this.currentNode; },
      previousNode() { index--; this.currentNode = order[index] || null; return this.currentNode; },
    };
  }

  /* ---------------- window ---------------- */

  const window = {
    document: doc,
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    devicePixelRatio: 2,
    scrollX: 0,
    pageYOffset: 0,
    location: doc.location,
    navigator: {
      userAgent: viewport.touch
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      maxTouchPoints: viewport.touch ? 5 : 0,
      platform: viewport.touch ? 'iPhone' : 'MacIntel',
    },
    performance: { now: () => clock },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame() {},
    setTimeout: (fn, ms = 0, ...args) => setTimeout(fn, ms, ...args),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (fn, ms, ...args) => setInterval(fn, ms, ...args),
    clearInterval: (t) => clearInterval(t),
    scrollTo(x, y) {
      const value = typeof x === 'object' ? x.top : y;
      window.scrollY = value || 0;
      dispatch(window, 'scroll', {});
    },
    scrollBy(_x, dy) { window.scrollTo(0, window.scrollY + (dy || 0)); },
    matchMedia(query) { return { matches: mediaMatches(query, viewport), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; },
    getComputedStyle(node) { return computedStyle(node, viewport); },
    addEventListener(type, handler) { node_on(window, type, handler); },
    removeEventListener(type, handler) { listeners.get(window)?.get(type)?.delete(handler); },
    dispatchEvent(event) { return dispatch(window, event.type, event); },
    IntersectionObserver: class {
      constructor(callback, opts) { this.callback = callback; this.opts = opts; this.targets = []; ioCallbacks.push(this); }
      observe(target) { this.targets.push(target); }
      unobserve(target) { this.targets = this.targets.filter((t) => t !== target); }
      disconnect() { this.targets = []; }
      takeRecords() { return []; }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    CustomEvent: class {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail ?? null; this.bubbles = init.bubbles ?? false; }
    },
    Event: class { constructor(type) { this.type = type; } },
    URLSearchParams,
    URL,
    console,
    Math,
    Date,
    Promise,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    RegExp,
    Error,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    fetch: () => Promise.reject(new Error('network disabled in smoke test')),
  };
  let scrollYValue = 0;
  Object.defineProperty(window, 'scrollY', {
    get: () => scrollYValue,
    set: (v) => { scrollYValue = Number(v) || 0; window.pageYOffset = scrollYValue; },
    configurable: true,
    enumerable: true,
  });
  state.scrollY = () => scrollYValue;

  window.window = window;
  window.self = window;
  window.top = window;
  window.parent = window;
  window.globalThis = window;

  function createStorage() {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    };
  }

  function mediaMatches(query, vp) {
    return splitGroups(query.replace(/and\s+/g, ' and ')).some((group) => {
      return group.split(/\s+and\s+/).every((part) => {
        const m = /^\(?\s*([\w-]+)\s*(?::\s*([^)]+))?\)?$/.exec(part.trim());
        if (!m) return true;
        const feature = m[1];
        const value = (m[2] || '').trim();
        switch (feature) {
          case 'min-width': return vp.width >= px(value);
          case 'max-width': return vp.width <= px(value);
          case 'hover': return value === 'hover' ? !vp.touch : vp.touch;
          case 'pointer': return value === 'fine' ? !vp.touch : vp.touch;
          case 'prefers-reduced-motion': return value === 'reduce' ? vp.reducedMotion : !vp.reducedMotion;
          case 'orientation': return value === 'portrait' ? vp.height >= vp.width : vp.width > vp.height;
          case 'prefers-color-scheme': return true;
          default: return true;
        }
      });
    });
  }

  function computedStyle(node, vp) {
    const style = node.style || {};
    const display = style.display || (BLOCK_TAGS.has(node.tag?.toLowerCase()) ? 'block' : 'inline');
    const values = {
      display,
      position: style.position || 'static',
      overflow: style.overflow || 'visible',
      overflowX: style.overflowX || style.overflow || 'visible',
      overflowY: style.overflowY || style.overflow || 'visible',
      opacity: style.opacity || '1',
      visibility: style.visibility || 'visible',
      'pointer-events': style.pointerEvents || 'auto',
      transform: style.transform || 'none',
      'white-space': style.whiteSpace || 'normal',
      color: style.color || 'rgb(253, 253, 245)',
      'background-color': style.backgroundColor || 'rgba(0, 0, 0, 0)',
      'z-index': style.zIndex || 'auto',
      width: `${Math.round(layout.rect(node).width)}px`,
      height: `${Math.round(layout.rect(node).height)}px`,
    };
    return {
      ...values,
      getPropertyValue(name) {
        if (name.startsWith('--')) return style.getPropertyValue?.(name) || '';
        return values[name] ?? values[name.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`)] ?? '';
      },
    };
  }

  /* ---------------- install globals ---------------- */

  const globals = {
    window, document: doc, navigator: window.navigator, location: window.location,
    innerWidth: viewport.width, innerHeight: viewport.height, devicePixelRatio: 2,
    get scrollY() { return window.scrollY; },
    set scrollY(v) { window.scrollY = v; },
    scrollX: 0, pageYOffset: 0,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    matchMedia: window.matchMedia,
    getComputedStyle: window.getComputedStyle,
    addEventListener: window.addEventListener,
    removeEventListener: window.removeEventListener,
    dispatchEvent: window.dispatchEvent,
    scrollTo: window.scrollTo,
    IntersectionObserver: window.IntersectionObserver,
    ResizeObserver: window.ResizeObserver,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    performance: window.performance,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_NODE: 9, DOCUMENT_FRAGMENT_NODE: 11 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, SHOW_COMMENT: 128, FILTER_ACCEPT: 1 },
    Element: class {},
    HTMLElement: class {},
    SVGElement: class {},
    Image: class { constructor() { this.complete = true; } },
  };

  const previous = {};
  for (const [key, value] of Object.entries(globals)) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    // some Node globals (navigator, performance) are getter-only — define, don't assign
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true, enumerable: true });
  }

  return {
    window,
    document: doc,
    viewport,
    layout,
    /** Advance the rAF loop; each frame is `step` ms of clock. */
    frames(count = 1, step = 16.7) {
      for (let i = 0; i < count; i++) {
        clock += step;
        const batch = rafQueue.splice(0, rafQueue.length);
        for (const fn of batch) {
          try { fn(clock); } catch (err) { console.error('[smoke] rAF threw', err); }
        }
      }
    },
    /** Deliver IntersectionObserver entries — everything is "in view". */
    intersect(all = true) {
      for (const io of ioCallbacks) {
        const entries = io.targets.map((target) => ({
          target,
          isIntersecting: all,
          intersectionRatio: all ? 1 : 0,
          boundingClientRect: layout.rect(target),
          intersectionRect: layout.rect(target),
          rootBounds: null,
          time: clock,
        }));
        if (entries.length) io.callback(entries, io);
      }
    },
    scroll(y) {
      window.scrollY = y;
      window.pageYOffset = y;
      dispatch(window, 'scroll', {});
      this.frames(1);
    },
    click(node, init = {}) { return dispatch(node, 'click', init); },
    wheel(node, deltaY, init = {}) { return dispatch(node, 'wheel', { deltaY, deltaMode: 0, ...init }); },
    resize(width, height) {
      if (width) { window.innerWidth = width; globalThis.innerWidth = width; viewport.width = width; }
      if (height) { window.innerHeight = height; globalThis.innerHeight = height; viewport.height = height; }
      layout.invalidate();
      dispatch(window, 'resize', {});
      this.frames(2);
    },
    emit(type, init = {}) { dispatch(window, type, init); },
    restore() {
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
    count(selector) { return selectAll(doc, selector).length; },
    select(selector) { return selectAll(doc, selector); },
    serializeNode(node) { return shimSerialize([node]); },
    documentHeight: () => layout.height,
  };
}
