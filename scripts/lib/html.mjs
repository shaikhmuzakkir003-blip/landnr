/**
 * html.mjs — a tiny, dependency-free HTML tokenizer / tree builder / serializer.
 *
 * It exists for one reason: the raw capture in `source/landonorris-home.html`
 * was saved through a pretty-printer that (a) re-indented every text node and
 * (b) silently dropped 32 `</svg>` closing tags. Both break the live page:
 *
 *   (a) the site sets `[split-text] { white-space: pre-line }`, so the
 *       formatter's newlines inside headings/paragraphs turn into real line
 *       breaks and shred the typography;
 *   (b) an unclosed <svg> swallows the rest of the helmet grid.
 *
 * This module re-parses the capture, applies the same "implied end tag"
 * repair a browser would, un-prettifies the whitespace back to Webflow's
 * published form, and serializes it again so the transform step can edit a
 * real tree instead of fighting regexes.
 */

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr',
  'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is raw text (never parsed as markup). */
export const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea']);

/**
 * Minimal implied-end-tag table: opening `tag` closes any of these when they
 * are the innermost open element. The capture is well formed apart from the
 * SVGs, but this keeps the builder honest if the source is ever re-exported.
 */
const IMPLIED_END = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  option: ['option'],
  optgroup: ['option', 'optgroup'],
  tr: ['td', 'th', 'tr'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  thead: ['td', 'th', 'tr'],
  tbody: ['td', 'th', 'tr', 'thead', 'tbody'],
};

const PUNCTUATION = new Set([',', '.', ';', ':', '!', '?', ')', ']', '}', '’', '”', '›', '»', '%']);

const ATTR_RE = /([^\s/>=]+)(\s*=\s*)?("([^"]*)"|'([^']*)'|([^\s"'=<>`]*))?/gs;

/* ------------------------------------------------------------------ *
 * Tokenizer (hand-written scanner: quotes and comments are respected)
 * ------------------------------------------------------------------ */

export function tokenize(html) {
  const tokens = [];
  const len = html.length;
  let i = 0;
  let textStart = 0;

  const flushText = (end) => {
    if (end > textStart) tokens.push({ type: 'text', value: html.slice(textStart, end) });
  };

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    // Comment ------------------------------------------------------------
    if (html.startsWith('<!--', lt)) {
      const endComment = html.indexOf('-->', lt + 4);
      const stop = endComment === -1 ? len : endComment + 3;
      flushText(lt);
      tokens.push({ type: 'comment', value: html.slice(lt + 4, endComment === -1 ? len : endComment) });
      i = stop;
      textStart = i;
      continue;
    }

    // Doctype / bogus comment -------------------------------------------
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const gt = html.indexOf('>', lt);
      const stop = gt === -1 ? len : gt + 1;
      flushText(lt);
      tokens.push({ type: 'bogus', raw: html.slice(lt, stop) });
      i = stop;
      textStart = i;
      continue;
    }

    // Tag -----------------------------------------------------------------
    const after = html[lt + 1];
    const isClose = after === '/';
    const nameStart = isClose ? lt + 2 : lt + 1;
    if (!/[a-zA-Z]/.test(html[nameStart] || '')) {
      i = lt + 1; // a literal "<" in text
      continue;
    }

    const tag = scanTag(html, lt);
    if (!tag) {
      i = lt + 1;
      continue;
    }

    flushText(lt);
    const nameMatch = /^<\/?\s*([a-zA-Z][^\s/>]*)/.exec(tag.raw);
    const rawName = nameMatch ? nameMatch[1] : '';
    const tagName = rawName.toLowerCase();

    if (isClose) {
      tokens.push({ type: 'close', tag: tagName, rawTagName: rawName, raw: tag.raw });
    } else {
      const attrs = parseAttrs(tag.attrText);
      const token = {
        type: 'open',
        tag: tagName,
        rawTagName: rawName,
        attrs,
        selfClosing: tag.selfClosing,
        raw: tag.raw,
      };
      tokens.push(token);

      if (RAW_TEXT_ELEMENTS.has(tagName) && !tag.selfClosing) {
        const closeRe = new RegExp(`</${escapeRe(tagName)}\\s*>`, 'gi');
        closeRe.lastIndex = tag.end;
        const cm = closeRe.exec(html);
        const bodyEnd = cm ? cm.index : len;
        tokens.push({ type: 'rawtext', value: html.slice(tag.end, bodyEnd) });
        if (cm) {
          tokens.push({ type: 'close', tag: tagName, rawTagName: tagName, raw: cm[0] });
          i = cm.index + cm[0].length;
        } else {
          i = len;
        }
        textStart = i;
        continue;
      }
    }

    i = tag.end;
    textStart = i;
  }

  flushText(len);
  return tokens;
}

/** Scan a tag starting at `start` ("<"), honouring quoted attribute values. */
function scanTag(html, start) {
  let i = start + 1;
  let quote = null;
  while (i < html.length) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      const raw = html.slice(start, i + 1);
      const inner = html.slice(start + 1, i);
      const selfClosing = /\/\s*$/.test(inner);
      const attrText = inner
        .replace(/^\/?[a-zA-Z][^\s/>]*/, '')
        .replace(/\/\s*$/, '');
      return { raw, end: i + 1, selfClosing, attrText };
    }
    i++;
  }
  return null;
}

function parseAttrs(text) {
  const out = [];
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(text)) !== null) {
    if (!m[0].trim()) continue;
    const name = m[1];
    if (!name || name === '/' || name.startsWith('/')) continue;
    const hasValue = Boolean(m[2]);
    let value = null;
    if (hasValue) {
      value = m[3] !== undefined ? m[3].slice(1, -1) : (m[4] ?? m[5] ?? '');
    }
    out.push({ name, value });
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ *
 * Tree builder (with browser-style repair)
 * ------------------------------------------------------------------ */

export function parse(html) {
  const tokens = tokenize(html);
  const root = { type: 'root', children: [] };
  const stack = [root];
  const repairs = [];
  const current = () => stack[stack.length - 1];

  for (const token of tokens) {
    if (token.type === 'text') {
      if (token.value) current().children.push({ type: 'text', value: token.value });
      continue;
    }
    if (token.type === 'comment') {
      current().children.push({ type: 'comment', value: token.value });
      continue;
    }
    if (token.type === 'bogus') {
      current().children.push({ type: 'text', value: token.raw });
      continue;
    }
    if (token.type === 'rawtext') {
      current().children.push({ type: 'rawtext', value: token.value });
      continue;
    }
    if (token.type === 'open') {
      const node = {
        type: 'element',
        tag: token.tag,
        rawTagName: token.rawTagName,
        attrs: token.attrs,
        children: [],
      };
      const implied = IMPLIED_END[node.tag];
      if (implied) {
        while (stack.length > 1 && implied.includes(current().tag)) {
          repairs.push({ kind: 'implied-end', tag: current().tag });
          stack.pop();
        }
      }
      current().children.push(node);

      const isVoid = VOID_ELEMENTS.has(node.tag);
      const inSvg = stack.some((n) => n.tag === 'svg');
      if (isVoid) continue;                       // <img>, <br>, … never nest
      if (token.selfClosing && inSvg) {           // <path/>, <g/> … are real in SVG
        node.selfClosed = true;
        continue;
      }
      // In HTML a stray "/" is ignored by browsers, so `<div/>` still nests.
      stack.push(node);
      continue;
    }
    if (token.type === 'close') {
      const tag = token.tag;
      if (VOID_ELEMENTS.has(tag)) continue;
      let idx = -1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) { idx = k; break; }
      }
      if (idx === -1) {
        repairs.push({ kind: 'stray-close', tag });
        continue;
      }
      for (let k = stack.length - 1; k > idx; k--) {
        repairs.push({ kind: 'auto-close', tag: stack[k].tag, closedBy: tag });
      }
      stack.length = idx;
    }
  }

  while (stack.length > 1) {
    repairs.push({ kind: 'unclosed-at-eof', tag: stack[stack.length - 1].tag });
    stack.pop();
  }

  return { root, repairs };
}

/* ------------------------------------------------------------------ *
 * Whitespace normalisation ("un-prettify")
 * ------------------------------------------------------------------ */

/**
 * Collapse the formatter's "newline + indentation" runs back to what Webflow
 * publishes, while preserving intentional bare newlines (the site uses
 * `white-space: pre-line`, e.g. "mclaren f1\nsince 2019").
 */
export function normalizeWhitespace(value, bounds = { lead: false, trail: false }) {
  if (!/\s/.test(value)) return value;
  let out = '';
  let last = 0;
  const re = /\s+/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    const run = m[0];
    const runStart = m.index;
    const runEnd = m.index + run.length;
    out += value.slice(last, runStart);
    out += collapseRun(run, {
      atStart: runStart === 0 && bounds.lead,
      atEnd: runEnd === value.length && bounds.trail,
      prev: runStart === 0 ? '>' : value[runStart - 1],
      next: runEnd === value.length ? '<' : (value[runEnd] ?? ''),
    });
    last = runEnd;
  }
  out += value.slice(last);
  return out;
}

function collapseRun(run, { atStart, atEnd, prev, next }) {
  if (!run.includes('\n')) return ' ';
  // Whitespace-only text node sitting between two tags: pure indentation.
  if (atStart && atEnd) return '';
  // A bare newline with no indentation is authored content (`white-space: pre-line`).
  if (!/[ \t]/.test(run) && !atStart && !atEnd) return '\n';
  // The formatter wrapped a long line: restore the single space it replaced,
  // unless the break landed next to punctuation ("fight</span>\n." → "fight</span>.").
  if (atStart) return PUNCTUATION.has(next) ? '' : ' ';
  if (atEnd) return PUNCTUATION.has(prev) ? '' : ' ';
  return PUNCTUATION.has(next) ? '' : ' ';
}

/* ------------------------------------------------------------------ *
 * Serializer
 * ------------------------------------------------------------------ */

export function serialize(root, opts = {}) {
  const normalize = opts.normalize !== false;
  const parts = [];

  const enter = (node, ctx) => {
    if (node.type === 'text') {
      const value = normalize
        ? normalizeWhitespace(node.value, { lead: ctx.prevIsTag, trail: ctx.nextIsTag })
        : node.value;
      if (value) parts.push(escapeText(value, ctx.inSvg));
      return;
    }
    if (node.type === 'comment') {
      parts.push(`<!--${node.value}-->`);
      return;
    }
    if (node.type === 'rawtext') {
      parts.push(node.value);
      return;
    }
    if (node.type === 'element') parts.push(openTag(node));
  };

  const leave = (node) => {
    if (node.type === 'element' && !VOID_ELEMENTS.has(node.tag) && !node.selfClosed) {
      parts.push(`</${node.rawTagName || node.tag}>`);
    }
  };

  walk(root.children, { isRoot: true, inSvg: false }, enter, leave);

  let html = parts.join('');
  if (opts.breaks !== false) {
    html = html
      .replace(/<\/head>/i, '</head>\n')
      .replace(/(<body\b[^>]*>)/i, '$1\n')
      .replace(/<\/body>/i, '\n</body>');
  }
  return html;
}

function escapeText(value, inSvg) {
  if (inSvg) return value;
  return value.replace(/<(?![a-zA-Z!/])/g, '&lt;');
}

function openTag(node) {
  const attrs = node.attrs
    .map((a) => (a.value === null ? ` ${a.name}` : ` ${a.name}="${a.value}"`))
    .join('');
  const slash = node.selfClosed ? '/' : '';
  return `<${node.rawTagName || node.tag}${attrs}${slash}>`;
}

function walk(children, parentCtx, enter, leave) {
  children.forEach((node, i) => {
    const prev = children[i - 1];
    const next = children[i + 1];
    const ctx = {
      prevIsTag: parentCtx.isRoot ? i === 0 : !prev || prev.type !== 'text',
      nextIsTag: parentCtx.isRoot ? i === children.length - 1 : !next || next.type !== 'text',
      inSvg: parentCtx.inSvg || node.tag === 'svg',
    };
    enter(node, ctx);
    if (node.type === 'element' && !VOID_ELEMENTS.has(node.tag) && !node.selfClosed) {
      walk(node.children, { isRoot: false, inSvg: ctx.inSvg }, enter, leave);
      leave(node);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Tree helpers used by the transform step
 * ------------------------------------------------------------------ */

export function* walkNodes(node) {
  if (!node) return;
  yield node;
  if (node.children) for (const child of [...node.children]) yield* walkNodes(child);
}

export function findAll(root, predicate) {
  const out = [];
  for (const node of walkNodes(root)) if (predicate(node)) out.push(node);
  return out;
}

export function find(root, predicate) {
  for (const node of walkNodes(root)) if (predicate(node)) return node;
  return null;
}

export function isElement(node, tag) {
  return Boolean(node) && node.type === 'element' && (tag ? node.tag === tag : true);
}

export function getAttr(node, name) {
  const attr = node.attrs?.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return attr ? attr.value : null;
}

export function hasAttr(node, name) {
  return Boolean(node.attrs?.some((a) => a.name.toLowerCase() === name.toLowerCase()));
}

export function setAttr(node, name, value) {
  const attr = node.attrs?.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (attr) attr.value = value;
  else node.attrs?.push({ name, value });
  return node;
}

export function removeAttr(node, name) {
  if (!node.attrs) return node;
  node.attrs = node.attrs.filter((a) => a.name.toLowerCase() !== name.toLowerCase());
  return node;
}

export function classList(node) {
  return (getAttr(node, 'class') || '').split(/\s+/).filter(Boolean);
}

export function hasClass(node, name) {
  return classList(node).includes(name);
}

export function parentOf(root, target) {
  for (const node of walkNodes(root)) {
    if (node.children?.includes(target)) return node;
  }
  return null;
}

/** Remove a node from wherever it lives in the tree. */
export function removeNode(root, target) {
  const parent = parentOf(root, target);
  if (!parent) return false;
  const idx = parent.children.indexOf(target);
  parent.children.splice(idx, 1);
  return true;
}

/** Insert `nodes` immediately after `target`. */
export function insertAfter(root, target, nodes) {
  const parent = parentOf(root, target);
  if (!parent) return false;
  const idx = parent.children.indexOf(target);
  parent.children.splice(idx + 1, 0, ...nodes);
  return true;
}

/** Append `nodes` at the end of `target`'s children. */
export function append(target, nodes) {
  target.children.push(...nodes);
  return target;
}

/** Parse an HTML fragment string into an array of nodes. */
export function fragment(html) {
  const { root } = parse(html);
  return root.children;
}

export function textContent(node) {
  let out = '';
  for (const child of walkNodes(node)) if (child.type === 'text') out += child.value;
  return out.replace(/\s+/g, ' ').trim();
}

export function outerHTML(node, opts = {}) {
  return serialize({ children: [node] }, opts);
}
