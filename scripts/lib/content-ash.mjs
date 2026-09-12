/**
 * content-ash.mjs — the words.
 *
 * The capture this site is built from belongs to a racing driver. The site now
 * belongs to a programmer who makes extensions, so every visible string gets
 * swapped for its equivalent here — but the *layout* is untouched: same
 * sections, same rhythm, same type. A race weekend becomes a release; the
 * helmet hall of fame becomes the extension shelf; "on track / off track"
 * becomes "in production / in the lab".
 *
 * Swaps are exact text-node matches, consumed in document order, which is what
 * lets repeated strings ("Season", "TRACK", the nav's and the hero's "since
 * 2019") map to different replacements. Anything in the table that no longer
 * matches is reported by the build as `missed`, so a changed capture cannot
 * silently skip a line.
 *
 * Everything here is placeholder-grade where Ash's real details are unknown:
 * extension names, years and links are stand-ins he can edit in this one file.
 */

export const TEXT_SWAPS = [
  /* ---- chrome: nav, preloader, orientation ---- */
  ['Store', 'GitHub'],
  ['On Track', 'Extensions'],
  ['Off Track', 'Lab'],
  ['Calendar', 'Changelog'],
  ['mclaren f1 since 2019', 'shipping extensions since 2019'],
  ['business enquiries', 'work with me'],
  ['tiktok', 'github'],
  ['instagram', 'mastodon'],
  ['youtube', 'youtube'],
  ['Twitch', 'discord'],
  ['This is a vertical drive.', 'This is a vertical terminal.'],
  ['Load Norris', 'Enter'],
  ['Message from lando', 'Message from ash'],

  /* ---- hero ---- */
  ['Lando Norris', 'ASH'],
  ['2025 Mclaren Formula 1 Driver', 'programmer · extension developer'],
  ['Next Race', 'Latest release'],
  ['Monza', 'Tab Reloader'],
  ['gp', 'v2.4.1'],
  ['mclaren f1 since 2019', 'shipping extensions\nsince 2019'],
  ['mclaren f1 since 2019', 'shipping extensions\nsince 2019'],
  ['mclaren f1 since 2019', 'shipping extensions\nsince 2019'],

  /* ---- the statement ---- */
  ['Redefining', 'Writing'],
  ['limits, fighting for', 'tools, fighting for'],
  ['wins', 'speed'],
  [', bringing it all in all ways. Defining a', ', shipping it all in all ways. Defining a'],
  ['legacy', 'craft'],
  ['in Formula 1 on and off the track.', 'in the browser, on and off the store.'],

  ['From his iconic blobs to innovative one-off designs, Lando has always been passionate about designing innovative and memorable helmets.',
    'From tiny userscripts to fully-fledged store releases, ash has always been passionate about building small tools that remove large annoyances.'],
  ['Lando is proud to collaborate with a range of partners, who share his passion for performance across a range of industries.',
    'ash is glad to work with a range of projects and maintainers who care about the same thing: a browser that gets out of the way.'],

  /* ---- the horizontal track: moments become releases ---- */
  ['Qatar, 2024', 'dark-mode-everywhere, 2024'],
  ['FIA Prize Giving, 2024', 'Editor’s Pick, 2024'],
  ['you progress from there.', 'you ship from there.'],
  ['Miami GP, 2024', 'tab-reloader, 2024'],
  ['Monaco, 2023', 'json-formatter, 2023'],
  ['Britain, 2025', 'cookie-guard, 2025'],
  ['Battersea, 2024', 'hackathon win, 2024'],
  ['High Performance Gala, 2024', 'perf summit talk, 2024'],
  ['Barcelona, 2024', 'devtools-digest, 2024'],
  ['austria, 2020', 'first userscript, 2020'],
  ['US, 2024', 'oss summit, 2024'],

  /* ---- the two panels ---- */
  ['ON', 'IN'],
  ['TRACK', 'PRODUCTION'],
  ['results', 'releases'],
  [', career stats and photos from trackside.', ', install counts and notes from the changelog.'],
  ['OFF', 'IN THE'],
  ['TRACK', 'LAB'],
  ['Campaigns', 'Experiments'],
  [', shoots and other such promotional materials for fans', ', side quests and half-finished things built for fun'],

  /* ---- the shelf: helmets become extensions ---- */
  ['Helmets', 'Extensions'],
  ['Hall of Fame', 'Shipped work'],
  ['Season', 'Tab Reloader'],
  ['Discoball', 'JSON Formatter'],
  ['Dark Glitter', 'Link Unshortener'],
  ['Season', 'Dark Mode Everywhere'],
  ['Porcelain', 'Clipboard History'],
  ['Japan', 'Pixel Ruler'],
  ['GIF', 'GIF Scrubber'],
  ['Dark Mode', 'Contrast Checker'],
  ['Race', 'Request Blocker'],
  ['Las Vegas', 'Session Buddy'],
  ['Chrome', 'DevTools Theme'],
  ['Beachball', 'Colour Picker'],
  ['Basketball', 'Markdown Preview'],
  ['Season', 'Cookie Guard'],
  ['Silverstone', 'Vim Bindings'],
  ['See more helmets and highlights from Lando on the track', 'See more extensions and experiments from ash on the store'],
  ['view on track', 'view all extensions'],
  ['LANDO STORE', 'ASH ON GITHUB'],

  /* ---- the tally ---- */
  ['World Drivers &#x27;', 'Open source'],
  ['Champion', 'since 2019'],
  ['Visit the store', 'Browse the code'],

  /* ---- stack, socials, footer ---- */
  ['partners', 'stack'],
  ['&amp;campaigns', '&tools'],
  ['view partnerships', 'view the stack'],
  ['Follow Lando on social media', 'Follow ash on the places he actually posts'],
  ['Partnerships', 'Stack'],
  ['Sign Up', 'Say hi'],
  ['bringing', 'shipping'],
  ['fight', 'good stuff'],
  ['© 2026 Lando Norris.', '© 2026 ash.'],
];

/** meta / open-graph attributes, matched on their current value. */
export const ATTR_SWAPS = [
  ['McLaren Formula 1 Driver — Lando Norris', 'ASH — programmer & extension developer'],
  ['Official hub for British racing star Lando Norris', 'The site of ash: a programmer who builds browser extensions.'],
];

/**
 * Apply the table to a parsed document. Returns the report fragment:
 * { swapped, missed } — a missed entry means the capture moved and this file
 * needs updating, which the build surfaces rather than swallowing.
 */
export function applyContent(root, helpers) {
  const { walkNodes, isElement, getAttr, setAttr } = helpers;
  const pending = TEXT_SWAPS.map(([from, to]) => ({ from, to, done: false }));
  const index = new Map();
  for (const entry of pending) {
    if (!index.has(entry.from)) index.set(entry.from, []);
    index.get(entry.from).push(entry);
  }

  for (const node of walkNodes(root)) {
    if (node.type === 'text') {
      const key = node.value.replace(/\s+/g, ' ').trim();
      const list = index.get(key);
      const next = list?.find((e) => !e.done);
      if (!next) continue;
      next.done = true;
      node.value = next.to;
      continue;
    }
    if (isElement(node, 'meta')) {
      const value = getAttr(node, 'content');
      const swap = ATTR_SWAPS.find(([from]) => from === value);
      if (swap) setAttr(node, 'content', swap[1]);
    }
    if (node.type === 'element' && node.tag === 'title') {
      for (const child of node.children || []) {
        if (child.type === 'text') {
          const swap = ATTR_SWAPS.find(([from]) => child.value.includes(from));
          if (swap) child.value = child.value.replace(swap[0], swap[1]);
        }
      }
    }
  }

  return {
    swapped: pending.filter((e) => e.done).length,
    missed: pending.filter((e) => !e.done).map((e) => e.from),
  };
}
